"use client";

import { Loader2, MapIcon, MapPin, PenLine, SatelliteIcon, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createFarmAction } from "@/app/dashboard/farms/actions";
import { Segmented } from "@/components/dashboard/segmented";
import { PickerMap, type PickerBasemap } from "@/components/farms/picker-map-loader";
import { PlaceSearch } from "@/components/farms/place-search";
import { LandProfileCard } from "@/components/land/land-profile-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CROPS, CROP_IDS, SOILS, type CropId, type SoilType } from "@/lib/agronomy-tables";
import { fieldSummary, polygonFromPoints, squareFieldAround } from "@/lib/farms/shapes";
import type { LngLat } from "@/lib/geo";
import type { LandCell } from "@/lib/land/profile";
import { cn } from "@/lib/utils";

type Mode = "pin" | "outline";

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-[12.5px] text-destructive">{message}</p> : null;
}

/** Add a farm: find it on the map (search or click), drop the pin, size or outline the field, save. */
export function AddFarmForm({ today }: { today: string }) {
  const router = useRouter();
  const [basemap, setBasemap] = useState<PickerBasemap>("satellite");
  const [mode, setMode] = useState<Mode>("pin");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [coordText, setCoordText] = useState({ lat: "", lng: "" });
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom: number; key: number } | null>(null);
  const [draft, setDraft] = useState<LngLat[]>([]);
  const [areaHa, setAreaHa] = useState("5");
  const [name, setName] = useState("");
  const [crop, setCrop] = useState<CropId>("tomato");
  const [plantingDate, setPlantingDate] = useState(today);
  const [soil, setSoil] = useState<SoilType | "auto">("auto");
  const [ecw, setEcw] = useState("");
  const [land, setLand] = useState<{ cell: LandCell | null; error: string | null; loading: boolean }>({ cell: null, error: null, loading: false });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const drawn = useMemo(() => (draft.length >= 3 ? polygonFromPoints(draft) : null), [draft]);
  const area = Number(areaHa);
  const outline = useMemo(() => {
    if (drawn) return drawn;
    if (pin && Number.isFinite(area) && area > 0) return squareFieldAround(pin.lat, pin.lng, Math.min(area, 5000));
    return null;
  }, [drawn, pin, area]);
  const drawnArea = drawn ? fieldSummary(drawn).areaHa : null;

  // Land profile of the pin's 10 km² cell (debounced while the pin is dragged around).
  useEffect(() => {
    if (!pin) return;
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      setLand((s) => ({ ...s, loading: true }));
      try {
        const res = await fetch(`/api/land?lat=${pin.lat.toFixed(5)}&lng=${pin.lng.toFixed(5)}`, { signal: controller.signal });
        const body = (await res.json()) as { cell?: LandCell; error?: string };
        setLand({ cell: body.cell ?? null, error: body.error ?? null, loading: false });
      } catch {
        if (!controller.signal.aborted) setLand({ cell: null, error: "Could not load the land profile.", loading: false });
      }
    }, 350);
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [pin]);

  const place = (lat: number, lng: number, fromInputs = false) => {
    const next = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    setPin(next);
    if (!fromInputs) setCoordText({ lat: String(next.lat), lng: String(next.lng) });
    setFieldErrors((e) => ({ ...e, lat: "" }));
  };

  /** Typed coordinates move the pin once both parse (the text itself stays as typed). */
  const typeCoord = (key: "lat" | "lng", value: string) => {
    const text = { ...coordText, [key]: value };
    setCoordText(text);
    const lat = Number(text.lat);
    const lng = Number(text.lng);
    if (text.lat.trim() && text.lng.trim() && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      place(lat, lng, true);
      setFlyTo({ lat, lng, zoom: 15, key: Date.now() });
    }
  };

  const cell = land.cell;
  const suggestedSoil = cell?.landscape.soil.farmSoilType;
  const suggestedEcw = cell?.landscape.groundwater.ecw_dS_m;

  const submit = () => {
    setError(null);
    setFieldErrors({});
    if (!pin) {
      setError("Drop the pin on your farm first — search for it or click the map.");
      return;
    }
    startTransition(async () => {
      const result = await createFarmAction({
        name,
        lat: pin.lat,
        lng: pin.lng,
        areaHa: drawnArea ?? (Number.isFinite(area) ? area : 0),
        boundary: drawn ? draft : undefined,
        mainCrop: crop,
        plantingDate,
        soilType: soil === "auto" ? undefined : soil,
        irrigationWaterEc: ecw.trim() === "" ? undefined : Number(ecw),
      });
      if (result.ok) {
        router.push(`/dashboard/farm/${encodeURIComponent(result.farmId)}/sensors?new=1`);
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  };

  return (
    <div className="mx-auto grid max-w-[1600px] gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      {/* Map */}
      <section aria-label="Locate your farm" className="flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <PlaceSearch
            className="min-w-[240px] flex-1"
            onSelect={(p) => {
              place(p.lat, p.lng);
              setFlyTo({ lat: p.lat, lng: p.lng, zoom: 16, key: Date.now() });
            }}
          />
          <Segmented
            ariaLabel="Base map"
            value={basemap}
            onChange={setBasemap}
            options={[
              { value: "satellite", label: <span className="hidden sm:inline">Satellite</span>, icon: <SatelliteIcon />, ariaLabel: "Satellite" },
              { value: "streets", label: <span className="hidden sm:inline">Streets</span>, icon: <MapIcon />, ariaLabel: "Streets" },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-[12.5px]">
          <Segmented<Mode>
            ariaLabel="Map tool"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: "pin", label: "Drop pin", icon: <MapPin /> },
              { value: "outline", label: "Outline field", icon: <PenLine />, disabled: !pin },
            ]}
          />
          {mode === "outline" ? (
            <>
              <span className="text-muted-foreground">Click each corner of the field ({draft.length} so far).</span>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length}>
                <Undo2 /> Undo
              </Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setDraft([])} disabled={!draft.length}>
                <Trash2 /> Clear
              </Button>
              <Button size="sm" className="h-7" onClick={() => setMode("pin")} disabled={draft.length > 0 && draft.length < 3}>
                Done
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground">
              {pin ? "Drag the pin to fine-tune, or click elsewhere to move it." : "Search above, or click the map to drop a pin on your farm."}
            </span>
          )}
        </div>
        <div className="relative isolate h-[clamp(360px,calc(100dvh_-_220px),760px)]">
          <PickerMap
            basemap={basemap}
            initial={{}}
            pin={pin}
            pinLabel={name.trim() || "Your farm"}
            onPick={place}
            mode={mode}
            onOutlinePoint={(p) => setDraft((d) => [...d, p])}
            outline={outline}
            draft={mode === "outline" || !drawn ? draft : []}
            flyTo={flyTo}
          />
        </div>
      </section>

      {/* Details */}
      <aside className="flex min-w-0 flex-col gap-4">
        <section aria-labelledby="farm-details" className="rounded-2xl border bg-card p-3 shadow-xs sm:p-4">
          <h2 id="farm-details" className="text-[16px] font-semibold">
            Farm details
          </h2>
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="farm-name">Farm name</Label>
              <Input id="farm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Green Valley Farm" maxLength={80} aria-invalid={Boolean(fieldErrors.name)} required />
              <FieldError message={fieldErrors.name} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="farm-lat">Latitude</Label>
                <Input
                  id="farm-lat"
                  inputMode="decimal"
                  value={coordText.lat}
                  placeholder="25.7500"
                  aria-invalid={Boolean(fieldErrors.lat)}
                  onChange={(e) => typeCoord("lat", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="farm-lng">Longitude</Label>
                <Input
                  id="farm-lng"
                  inputMode="decimal"
                  value={coordText.lng}
                  placeholder="51.3700"
                  onChange={(e) => typeCoord("lng", e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <FieldError message={fieldErrors.lat} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="farm-area">Area (hectares)</Label>
              {drawn ? (
                <p className="text-[13px] text-muted-foreground">
                  From your outline: <span className="font-semibold text-foreground">{drawnArea!.toFixed(2)} ha</span> ({draft.length} corners).{" "}
                  <button type="button" className="text-primary hover:underline" onClick={() => setDraft([])}>
                    Use a square instead
                  </button>
                </p>
              ) : (
                <>
                  <Input id="farm-area" inputMode="decimal" value={areaHa} onChange={(e) => setAreaHa(e.target.value)} aria-invalid={Boolean(fieldErrors.areaHa)} />
                  <p className="text-[12px] text-muted-foreground">Shown as a square around the pin — or use “Outline field” to draw the real boundary.</p>
                </>
              )}
              <FieldError message={fieldErrors.areaHa ?? fieldErrors.boundary} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="farm-crop">Main crop</Label>
                <Select value={crop} onValueChange={(v) => setCrop(v as CropId)}>
                  <SelectTrigger id="farm-crop" className="w-full bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CROP_IDS.map((id) => (
                      <SelectItem key={id} value={id}>
                        {CROPS[id].name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="farm-planted">Planted on</Label>
                <Input id="farm-planted" type="date" value={plantingDate} onChange={(e) => setPlantingDate(e.target.value)} aria-invalid={Boolean(fieldErrors.plantingDate)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="farm-soil">Soil</Label>
                <Select value={soil} onValueChange={(v) => setSoil(v as SoilType | "auto")}>
                  <SelectTrigger id="farm-soil" className="w-full bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{suggestedSoil ? `Atlas: ${SOILS[suggestedSoil].name.toLowerCase()}` : "From land atlas"}</SelectItem>
                    <SelectItem value="sand">Sand</SelectItem>
                    <SelectItem value="loamy_sand">Loamy sand</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="farm-ecw">Water ECw (dS/m)</Label>
                <Input
                  id="farm-ecw"
                  inputMode="decimal"
                  value={ecw}
                  onChange={(e) => setEcw(e.target.value)}
                  placeholder={suggestedEcw != null ? `≈${suggestedEcw} (atlas)` : "e.g. 2.5"}
                  aria-invalid={Boolean(fieldErrors.irrigationWaterEc)}
                />
              </div>
              <p className="col-span-2 text-[12px] text-muted-foreground">
                Leave these on the land-atlas estimate, or enter your well-water test result for better salinity advice.
              </p>
            </div>

            {error ? (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {pending ? "Saving…" : "Save farm and add sensors"}
            </Button>
          </form>
        </section>

        {pin ? (
          land.cell ? (
            <div className={cn("transition-opacity", land.loading && "opacity-60")}>
              {!land.cell.landscape.arable ? (
                <p className="mb-2 rounded-lg bg-risk-medium-soft px-3 py-2 text-[13px] text-risk-medium-ink">
                  The land atlas marks this area as not farmable ({land.cell.landscape.landformName}). You can still save it if your farm is here.
                </p>
              ) : null}
              <LandProfileCard cell={land.cell} compact />
            </div>
          ) : land.loading ? (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading the land profile…
            </p>
          ) : land.error ? (
            <p className="text-[13px] text-muted-foreground">{land.error}</p>
          ) : null
        ) : (
          <p className="rounded-2xl border border-dashed p-4 text-[13px] text-muted-foreground">
            Drop the pin to see the land profile of that spot: soil and fertility, rainfall, temperatures, groundwater salinity and which crops it can grow.
          </p>
        )}
      </aside>
    </div>
  );
}

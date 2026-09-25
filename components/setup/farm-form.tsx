"use client";

import { Crosshair, Loader2, LocateFixed, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { createFarmAction, updateFarmAction } from "@/app/dashboard/actions";
import { BoundaryMap } from "@/components/setup/maps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CROP_IDS, CROPS, SOILS, type CropId, type SoilType } from "@/lib/agronomy-tables";
import { qatarDateString } from "@/lib/data/time";
import { farmGeometry, validateFarmInput, type FarmFieldErrors, type FarmInput } from "@/lib/farm-input";
import { outerRing, type GeoPolygon, type LngLat } from "@/lib/geo";
import type { Farm } from "@/lib/types";
import { cn } from "@/lib/utils";

function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={id} className="text-[12.5px] text-destructive">
      {error}
    </p>
  ) : null;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-snug text-muted-foreground">{children}</p>;
}

/** Vertices of a stored polygon without the closing point. */
function openRing(polygon: GeoPolygon): LngLat[] {
  const ring = outerRing(polygon);
  const [first, last] = [ring[0], ring[ring.length - 1]];
  return first && last && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}

/** Add or edit a farm: its agronomy settings and the field outline drawn on satellite imagery. */
export function FarmForm({
  farm,
  otherFarms,
  onDone,
  onCancel,
}: {
  /** Edit this farm; omit to add a new one. */
  farm?: Farm;
  otherFarms: GeoPolygon[];
  onDone: (farmId: string) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(farm?.name ?? "");
  const [crop, setCrop] = useState<CropId>(farm?.main_crop ?? "tomato");
  const [plantingDate, setPlantingDate] = useState(farm?.planting_date ?? qatarDateString(new Date()));
  const [soil, setSoil] = useState<SoilType>(farm?.soil_type ?? "sand");
  const [region, setRegion] = useState(farm?.region ?? "");
  const [ecw, setEcw] = useState(String(farm?.irrigation_water_ec ?? 1.5));
  const [calibration, setCalibration] = useState(String(farm?.ec_calibration_factor ?? 3));
  const [elevation, setElevation] = useState(String(farm?.elevation_m ?? 10));
  const [vertices, setVertices] = useState<LngLat[]>(farm ? openRing(farm.polygon) : []);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; at: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FarmFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const geometry = vertices.length >= 3 ? farmGeometry(vertices) : null;

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setLocateError("This browser can't share its location.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setFlyTo({ lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() });
      },
      () => {
        setLocating(false);
        setLocateError("Location unavailable — zoom to your field on the map instead.");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: FarmInput = {
      name,
      main_crop: crop,
      planting_date: plantingDate,
      soil_type: soil,
      region,
      irrigation_water_ec: Number(ecw),
      ec_calibration_factor: Number(calibration),
      elevation_m: Number(elevation),
      boundary: vertices,
    };
    const checked = validateFarmInput(input);
    if (!checked.ok) {
      setErrors(checked.fieldErrors);
      setFormError("Check the highlighted fields.");
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = farm ? await updateFarmAction(farm.id, input) : await createFarmAction(input);
      if (result.ok) onDone(result.farmId);
      else {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
      }
    });
  };

  const described = (key: keyof FarmInput) => (errors[key] ? `${id}-${key}-error` : undefined);

  return (
    <form onSubmit={submit} noValidate className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
      <div className="space-y-4">
        {formError ? (
          <p role="alert" className="rounded-lg bg-risk-high-soft px-3 py-2 text-sm text-risk-high-ink">
            {formError}
          </p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>Farm name</Label>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Al Khor North Farm"
            maxLength={80}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={described("name")}
            className="h-10 bg-card"
            autoFocus={!farm}
          />
          <FieldError id={`${id}-name-error`} error={errors.name} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-crop`}>Main crop</Label>
            <Select value={crop} onValueChange={(v) => setCrop(v as CropId)}>
              <SelectTrigger id={`${id}-crop`} className="h-10 w-full bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CROP_IDS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CROPS[c].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Hint>
              Salt threshold {CROPS[crop].salinity.threshold_dS_per_m} dS/m ECe (FAO-29).
            </Hint>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-planted`}>Planting date</Label>
            <Input
              id={`${id}-planted`}
              type="date"
              value={plantingDate}
              onChange={(e) => setPlantingDate(e.target.value)}
              aria-invalid={errors.planting_date ? true : undefined}
              aria-describedby={described("planting_date")}
              className="h-10 bg-card"
            />
            <FieldError id={`${id}-planting_date-error`} error={errors.planting_date} />
            <Hint>Sets the growth stage and crop coefficient (FAO-56).</Hint>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-soil`}>Soil</Label>
            <Select value={soil} onValueChange={(v) => setSoil(v as SoilType)}>
              <SelectTrigger id={`${id}-soil`} className="h-10 w-full bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SOILS) as SoilType[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {SOILS[s].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-region`}>Area (optional)</Label>
            <Input
              id={`${id}-region`}
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="e.g. Al Khor"
              maxLength={60}
              className="h-10 bg-card"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-ecw`}>Irrigation water EC (dS/m)</Label>
            <Input
              id={`${id}-ecw`}
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              max={20}
              value={ecw}
              onChange={(e) => setEcw(e.target.value)}
              aria-invalid={errors.irrigation_water_ec ? true : undefined}
              aria-describedby={described("irrigation_water_ec")}
              className="h-10 bg-card"
            />
            <FieldError id={`${id}-irrigation_water_ec-error`} error={errors.irrigation_water_ec} />
            <Hint>Measured salinity of your water; drives the leaching requirement (FAO-29).</Hint>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-cal`}>ECe calibration factor</Label>
            <Input
              id={`${id}-cal`}
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0.5}
              max={10}
              value={calibration}
              onChange={(e) => setCalibration(e.target.value)}
              aria-invalid={errors.ec_calibration_factor ? true : undefined}
              aria-describedby={described("ec_calibration_factor")}
              className="h-10 bg-card"
            />
            <FieldError id={`${id}-ec_calibration_factor-error`} error={errors.ec_calibration_factor} />
            <Hint>ECe ≈ factor × probe EC. Fit it from lab saturated-paste samples.</Hint>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-elev`}>Elevation (m)</Label>
            <Input
              id={`${id}-elev`}
              type="number"
              inputMode="decimal"
              step="1"
              value={elevation}
              onChange={(e) => setElevation(e.target.value)}
              aria-invalid={errors.elevation_m ? true : undefined}
              className="h-10 bg-card"
            />
            <Hint>Used for air pressure in ET₀ (FAO-56 Eq. 7).</Hint>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="submit" size="lg" className="h-10 px-4" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {farm ? "Save changes" : "Save farm"}
          </Button>
          {onCancel ? (
            <Button type="button" variant="ghost" size="lg" className="h-10" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">Field outline</p>
          <span className="text-[12.5px] text-muted-foreground">
            {vertices.length === 0
              ? "Click the map at each corner of the field."
              : geometry?.ok
                ? `${vertices.length} corners · ${geometry.geometry.area_ha.toLocaleString("en-US", { maximumFractionDigits: 2 })} ha`
                : `${vertices.length} corner${vertices.length === 1 ? "" : "s"} — keep clicking`}
          </span>
          <div className="ml-auto flex gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={locate} disabled={locating}>
              {locating ? <Loader2 className="animate-spin" /> : <LocateFixed />} My location
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setVertices((v) => v.slice(0, -1))} disabled={vertices.length === 0}>
              <Undo2 /> Undo
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setVertices([])} disabled={vertices.length === 0}>
              {farm ? <RotateCcw /> : <Trash2 />} Clear
            </Button>
          </div>
        </div>
        <div
          className={cn(
            "relative isolate h-[360px] overflow-hidden rounded-xl border lg:h-full lg:min-h-[420px]",
            errors.boundary && "ring-2 ring-destructive/60",
          )}
        >
          <BoundaryMap vertices={vertices} onChange={setVertices} otherFarms={otherFarms} flyTo={flyTo} />
          {vertices.length === 0 ? (
            <span className="pointer-events-none absolute bottom-3 left-1/2 z-[1000] inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-forest-900/90 px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap text-primary-foreground shadow-md">
              <Crosshair className="size-3.5" aria-hidden="true" /> Zoom in, then click each corner of your field
            </span>
          ) : null}
        </div>
        <FieldError id={`${id}-boundary-error`} error={errors.boundary ?? (geometry && !geometry.ok ? geometry.error : undefined)} />
        {locateError ? <p className="text-[12.5px] text-muted-foreground">{locateError}</p> : null}
      </div>
    </form>
  );
}

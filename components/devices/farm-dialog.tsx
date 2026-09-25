"use client";

import { LocateFixed } from "lucide-react";
import dynamic from "next/dynamic";
import { useId, useState } from "react";
import { MapSkeleton } from "@/components/dashboard/map";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callApi, errorText } from "./api";
import type { ManagedFarm, Option } from "./types";

const LocationPicker = dynamic(() => import("./location-picker"), { ssr: false, loading: () => <MapSkeleton /> });

const SOIL_OPTIONS: Option[] = [
  { id: "sand", name: "Sand" },
  { id: "loamy_sand", name: "Loamy sand" },
];

interface Draft {
  name: string;
  lat: string;
  lng: string;
  area_ha: string;
  main_crop: string;
  planting_date: string;
  soil_type: string;
  irrigation_water_ec: string;
}

const today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

function draftOf(farm: ManagedFarm | null, crops: Option[]): Draft {
  return farm
    ? {
        name: farm.name,
        lat: String(farm.lat),
        lng: String(farm.lng),
        area_ha: String(farm.area_ha),
        main_crop: farm.crop_id,
        planting_date: farm.planting_date,
        soil_type: farm.soil_type,
        irrigation_water_ec: String(farm.irrigation_water_ec),
      }
    : { name: "", lat: "", lng: "", area_ha: "2", main_crop: crops[0]?.id ?? "tomato", planting_date: today(), soil_type: "sand", irrigation_water_ec: "1.5" };
}

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Add a farm, or edit one: name, where it is (click the map, type it, or use this phone's GPS), crop, area, soil and water. */
export function FarmDialog({
  open,
  onOpenChange,
  farm,
  crops,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  farm: ManagedFarm | null;
  crops: Option[];
  onSaved: (farmId: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(farm, crops));
  const [prevKey, setPrevKey] = useState<string | null>(open ? (farm?.id ?? "new") : null);
  const key = open ? (farm?.id ?? "new") : null;
  if (key !== prevKey) {
    setPrevKey(key);
    if (key) setDraft(draftOf(farm, crops));
  }
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const lat = num(draft.lat);
  const lng = num(draft.lng);
  const area = num(draft.area_ha);

  const locate = () => {
    if (!navigator.geolocation) {
      setError("This browser can't share its location. Click the map instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        set({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) });
      },
      () => {
        setLocating(false);
        setError("Couldn't get your location (permission denied or no GPS). Click the map instead.");
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError("Choose where the farm is: click the map, use your location, or type its latitude and longitude.");
      return;
    }
    const body = {
      name: draft.name,
      lat,
      lng,
      area_ha: area,
      main_crop: draft.main_crop,
      planting_date: draft.planting_date,
      soil_type: draft.soil_type,
      irrigation_water_ec: num(draft.irrigation_water_ec),
    };
    setSaving(true);
    try {
      const res = farm
        ? await callApi<{ farm: { id: string } }>(`/api/farms/${encodeURIComponent(farm.id)}`, { method: "PATCH", body })
        : await callApi<{ farm: { id: string } }>("/api/farms", { body });
      onSaved(res.farm.id);
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[4vh] max-h-[92dvh] max-w-2xl overflow-y-auto p-5 sm:p-6">
        <DialogTitle>{farm ? `Edit ${farm.name}` : "Add a farm"}</DialogTitle>
        <DialogDescription className="mt-1">
          {farm ? "Changes apply to new readings and advice straight away." : "Where it is and what grows there. You can connect ESP32 probes to it next."}
        </DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
          <Field label="Farm name" htmlFor={`${id}-name`}>
            <Input id={`${id}-name`} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Al Khor greenhouse" required maxLength={80} autoComplete="off" />
          </Field>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 text-sm font-medium">Location</p>
              <Button type="button" variant="outline" size="sm" onClick={locate} disabled={locating}>
                <LocateFixed aria-hidden="true" />
                {locating ? "Locating…" : "Use my location"}
              </Button>
            </div>
            <div className="h-56 overflow-hidden rounded-xl border sm:h-64">
              {open ? (
                <LocationPicker
                  lat={Number.isFinite(lat) ? lat : null}
                  lng={Number.isFinite(lng) ? lng : null}
                  areaHa={Number.isFinite(area) ? area : null}
                  onPick={(la, ln) => set({ lat: String(la), lng: String(ln) })}
                />
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude" htmlFor={`${id}-lat`}>
                <Input id={`${id}-lat`} inputMode="decimal" value={draft.lat} onChange={(e) => set({ lat: e.target.value })} placeholder="25.68" />
              </Field>
              <Field label="Longitude" htmlFor={`${id}-lng`}>
                <Input id={`${id}-lng`} inputMode="decimal" value={draft.lng} onChange={(e) => set({ lng: e.target.value })} placeholder="51.49" />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">Click the map where the field is. The square shows its area around that point.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Main crop" htmlFor={`${id}-crop`}>
              <Select value={draft.main_crop} onValueChange={(v) => set({ main_crop: v })}>
                <SelectTrigger id={`${id}-crop`} className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {crops.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Planting date" htmlFor={`${id}-planted`}>
              <Input id={`${id}-planted`} type="date" value={draft.planting_date} onChange={(e) => set({ planting_date: e.target.value })} />
            </Field>
            <Field label="Area (hectares)" htmlFor={`${id}-area`}>
              <Input id={`${id}-area`} inputMode="decimal" value={draft.area_ha} onChange={(e) => set({ area_ha: e.target.value })} />
            </Field>
            <Field label="Soil" htmlFor={`${id}-soil`}>
              <Select value={draft.soil_type} onValueChange={(v) => set({ soil_type: v })}>
                <SelectTrigger id={`${id}-soil`} className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOIL_OPTIONS.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Irrigation water EC (dS/m)" htmlFor={`${id}-ec`} hint="From a water test; 1.5 if you don't know.">
              <Input id={`${id}-ec`} inputMode="decimal" value={draft.irrigation_water_ec} onChange={(e) => set({ irrigation_water_ec: e.target.value })} />
            </Field>
          </div>

          {error ? (
            <p role="alert" className="rounded-lg bg-risk-high-soft px-3 py-2 text-sm text-risk-high-ink">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : farm ? "Save changes" : "Add farm"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

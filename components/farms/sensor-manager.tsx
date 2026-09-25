"use client";

import { Copy, Loader2, MapIcon, MapPin, Plus, SatelliteIcon, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addSensorAction, deleteFarmAction, deleteSensorAction } from "@/app/dashboard/farms/actions";
import { Segmented } from "@/components/dashboard/segmented";
import { PickerMap, type PickerBasemap } from "@/components/farms/picker-map-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isInsideField, parseLatLng } from "@/lib/farms/shapes";
import type { GeoPolygon } from "@/lib/geo";

export interface ManagedSensor {
  id: string;
  lat: number;
  lng: number;
  label: string;
}

/**
 * Place sensors on a farm: click the map to drop a pin (drag to adjust) or type the probe's
 * latitude/longitude, then save. Lists the farm's sensors with how to send their readings.
 */
export function SensorManager({
  farm,
  sensors,
  canEdit,
}: {
  farm: { id: string; name: string; lat: number; lng: number; polygon: GeoPolygon };
  sensors: ManagedSensor[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [basemap, setBasemap] = useState<PickerBasemap>("satellite");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [coords, setCoords] = useState("");
  const [sensorId, setSensorId] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom: number; key: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const place = (lat: number, lng: number, fromText = false) => {
    const next = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    setPin(next);
    if (!fromText) setCoords(`${next.lat}, ${next.lng}`);
    setError(null);
  };

  const outside = pin ? !isInsideField(pin.lat, pin.lng, farm.polygon) : false;

  const save = () => {
    setError(null);
    setFieldErrors({});
    setNotice(null);
    const point = pin ?? parseLatLng(coords);
    if (!point) {
      setError("Click the map where the sensor is, or type its coordinates (e.g. 25.7481, 51.3725).");
      return;
    }
    startTransition(async () => {
      const result = await addSensorAction({ farmId: farm.id, sensorId: sensorId.trim() || undefined, label: label.trim() || undefined, lat: point.lat, lng: point.lng });
      if (result.ok) {
        setNotice(`Sensor ${result.sensorId} added.`);
        setPin(null);
        setCoords("");
        setSensorId("");
        setLabel("");
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  };

  const remove = (id: string) => {
    if (!window.confirm(`Remove sensor ${id}? Its past readings stay in the history.`)) return;
    startTransition(async () => {
      const result = await deleteSensorAction(farm.id, id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  };

  const removeFarm = () => {
    if (!window.confirm(`Delete ${farm.name} and its sensors? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await deleteFarmAction(farm.id);
      if (result.ok) {
        router.push("/dashboard");
        router.refresh();
      } else setError(result.error);
    });
  };

  const example = sensors[0]?.id ?? "YOUR-SENSOR-ID";
  const curl = `curl -X POST https://<your-app>/api/readings \\
  -H "Authorization: Bearer $INGEST_API_KEY" -H "Content-Type: application/json" \\
  -d '{ "farm_id": "${farm.id}", "sensor_id": "${example}", "moisture": 12.4, "temperature": 27.9, "ec_us_cm": 1850, "ph": 7.9, "n": 35, "p": 20, "k": 150 }'`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section aria-label="Sensor map" className="flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-[12.5px]">
          <MapPin className="size-4 text-primary" aria-hidden="true" />
          <span className="text-muted-foreground">
            {canEdit ? "Click the map where a sensor is installed — drag the pin to adjust." : "Sensors on this farm."}
          </span>
          <Segmented
            className="ml-auto"
            ariaLabel="Base map"
            value={basemap}
            onChange={setBasemap}
            options={[
              { value: "satellite", label: <span className="hidden sm:inline">Satellite</span>, icon: <SatelliteIcon />, ariaLabel: "Satellite" },
              { value: "streets", label: <span className="hidden sm:inline">Streets</span>, icon: <MapIcon />, ariaLabel: "Streets" },
            ]}
          />
        </div>
        <div className="relative isolate h-[clamp(340px,calc(100dvh_-_260px),640px)]">
          <PickerMap
            basemap={basemap}
            initial={{ outline: farm.polygon }}
            pin={pin}
            pinLabel={sensorId.trim() || "New sensor"}
            onPick={canEdit ? (lat, lng) => place(lat, lng) : undefined}
            outline={farm.polygon}
            sensors={sensors}
            flyTo={flyTo}
          />
        </div>
      </section>

      <aside className="flex min-w-0 flex-col gap-4">
        {canEdit ? (
          <section aria-labelledby="add-sensor" className="rounded-2xl border bg-card p-3 shadow-xs sm:p-4">
            <h2 id="add-sensor" className="text-[16px] font-semibold">
              Add a sensor
            </h2>
            <form
              className="mt-3 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="sensor-coords">Location (latitude, longitude)</Label>
                <Input
                  id="sensor-coords"
                  value={coords}
                  placeholder={`e.g. ${farm.lat.toFixed(5)}, ${farm.lng.toFixed(5)}`}
                  aria-invalid={Boolean(fieldErrors.lat)}
                  onChange={(e) => {
                    setCoords(e.target.value);
                    const p = parseLatLng(e.target.value);
                    if (p) {
                      place(p.lat, p.lng, true);
                      setFlyTo({ lat: p.lat, lng: p.lng, zoom: 17, key: Date.now() });
                    }
                  }}
                />
                <p className="text-[12px] text-muted-foreground">Type the GPS coordinates from the probe, or drop a pin on the map.</p>
                {outside ? <p className="text-[12.5px] text-risk-medium-ink">This point is outside the field outline — fine for a weather mast, otherwise double-check it.</p> : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sensor-id">Sensor ID</Label>
                  <Input id="sensor-id" value={sensorId} onChange={(e) => setSensorId(e.target.value)} placeholder="Auto" maxLength={32} aria-invalid={Boolean(fieldErrors.sensorId)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sensor-label">Label</Label>
                  <Input id="sensor-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. North block" maxLength={60} />
                </div>
                <p className="col-span-2 text-[12px] text-muted-foreground">
                  Leave the ID empty to get one automatically, or enter the ID your probe sends.
                </p>
                {fieldErrors.sensorId ? <p className="col-span-2 text-[12.5px] text-destructive">{fieldErrors.sensorId}</p> : null}
              </div>
              {error ? (
                <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p role="status" className="rounded-lg bg-risk-low-soft px-3 py-2 text-[13px] text-risk-low-ink">
                  {notice}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : <Plus />}
                {pending ? "Saving…" : "Add sensor"}
              </Button>
            </form>
          </section>
        ) : (
          <p className="rounded-2xl border border-dashed p-4 text-[13px] text-muted-foreground">
            The demo account is read-only. Create your own account to add farms and place sensors.
          </p>
        )}

        <section aria-labelledby="sensor-list" className="rounded-2xl border bg-card shadow-xs">
          <div className="border-b px-3 py-3 sm:px-4">
            <h2 id="sensor-list" className="text-[16px] font-semibold">
              Sensors ({sensors.length})
            </h2>
          </div>
          {sensors.length ? (
            <ul className="divide-y">
              {sensors.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-[13px] sm:px-4">
                  <span className="size-2.5 shrink-0 rounded-full bg-teal-700" aria-hidden="true" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left hover:underline"
                    onClick={() => setFlyTo({ lat: s.lat, lng: s.lng, zoom: 18, key: Date.now() })}
                    title="Show on the map"
                  >
                    <span className="block truncate font-semibold">
                      {s.id}
                      {s.label ? <span className="font-normal text-muted-foreground"> · {s.label}</span> : null}
                    </span>
                    <span className="block text-[12px] text-muted-foreground tabular">
                      {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                    </span>
                  </button>
                  {canEdit ? (
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => remove(s.id)} disabled={pending} aria-label={`Remove sensor ${s.id}`}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-[13px] text-muted-foreground sm:px-4">No sensors yet. Add the first one above.</p>
          )}
        </section>

        <section aria-labelledby="send-readings" className="rounded-2xl border bg-card p-3 shadow-xs sm:p-4">
          <h2 id="send-readings" className="text-[15px] font-semibold">
            Send readings
          </h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Probes post to <code>/api/readings</code> with the farm ID <code className="font-semibold text-foreground">{farm.id}</code> and their sensor ID. The position defaults to the one saved here.
          </p>
          <div className="relative mt-2">
            <pre className="scrollbar-thin overflow-x-auto rounded-lg bg-forest-900 p-2.5 text-[11.5px] leading-relaxed text-primary-foreground">{curl}</pre>
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-1.5 right-1.5 size-7"
              aria-label="Copy the example request"
              onClick={() => void navigator.clipboard?.writeText(curl)}
            >
              <Copy />
            </Button>
          </div>
        </section>

        {canEdit ? (
          <section aria-label="Delete farm" className="rounded-2xl border border-destructive/25 p-3 sm:p-4">
            <p className="text-[13px] text-muted-foreground">Remove this farm, its sensors and its settings from your account.</p>
            <Button variant="outline" size="sm" className="mt-2 text-destructive" onClick={removeFarm} disabled={pending}>
              <Trash2 /> Delete farm
            </Button>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

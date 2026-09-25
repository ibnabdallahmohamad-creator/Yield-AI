"use client";

import { ArrowRight, Check, Cpu, LayoutDashboard, Loader2, MapPinned, Pencil, Plus, Radio, Sprout, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState, useTransition } from "react";
import { deleteFarmAction, rotateDeviceKeyAction, updateSettingsAction } from "@/app/dashboard/actions";
import { DashboardHeader, IntervalSelect, type HeaderUser } from "@/components/dashboard/dashboard-header";
import { ConnectGuide, DeviceForm, DeviceRow } from "@/components/setup/device-panel";
import { FarmForm } from "@/components/setup/farm-form";
import { Button } from "@/components/ui/button";
import { CROPS, SOILS } from "@/lib/agronomy-tables";
import { formatDay, formatInterval } from "@/lib/format";
import { localProjector, outerRing, polygonCentroid, type GeoPolygon } from "@/lib/geo";
import type { DataSource, Device, Farm, UserSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A farm's outline as a small SVG, projected to metres so the shape is true. */
function FarmOutline({ polygon, className }: { polygon: GeoPolygon; className?: string }) {
  const [lng0, lat0] = polygonCentroid(polygon);
  const proj = localProjector(lat0, lng0);
  const pts = outerRing(polygon).map(([lng, lat]) => proj.toXY(lng, lat));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const size = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = size * 0.08;
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${(x - minX + pad).toFixed(1)},${(maxY - y + pad).toFixed(1)}`).join(" ") + "Z";
  return (
    <svg viewBox={`0 0 ${(maxX - minX + 2 * pad).toFixed(1)} ${(maxY - minY + 2 * pad).toFixed(1)}`} className={className} aria-hidden="true">
      <path d={d} fill="var(--accent)" stroke="var(--primary)" strokeWidth={size / 40} strokeLinejoin="round" />
    </svg>
  );
}

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children?: React.ReactNode }) {
  return (
    <li className={cn("flex gap-3 rounded-xl border p-3", active ? "border-primary/40 bg-card shadow-xs" : "bg-card/50")}>
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold",
          done ? "bg-risk-low text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {done ? <Check className="size-4" /> : n}
      </span>
      <div className="min-w-0">
        <p className={cn("text-[14px] font-semibold", !done && !active && "text-muted-foreground")}>
          {title}
          <span className="sr-only">{done ? " (done)" : active ? " (next)" : ""}</span>
        </p>
        {children ? <div className="text-[12.5px] text-muted-foreground">{children}</div> : null}
      </div>
    </li>
  );
}

type FarmEditor = { kind: "add" } | { kind: "edit"; farmId: string } | null;
type DeviceEditor = { farmId: string; deviceId?: string } | null;

export function SetupPage({
  user,
  source,
  farms,
  devices: serverDevices,
  settings,
  serverUrl,
}: {
  user: HeaderUser;
  source: DataSource;
  farms: Farm[];
  devices: Device[];
  settings: UserSettings;
  serverUrl: string;
}) {
  const router = useRouter();
  const [devices, setDevices] = useState(serverDevices);
  const [prevServerDevices, setPrevServerDevices] = useState(serverDevices);
  if (prevServerDevices !== serverDevices) {
    setPrevServerDevices(serverDevices);
    setDevices(serverDevices);
  }
  const [interval, setIntervalS] = useState(settings.reading_interval_s);
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [savingInterval, startSavingInterval] = useTransition();
  const [farmEditor, setFarmEditor] = useState<FarmEditor>(farms.length === 0 ? { kind: "add" } : null);
  const [deviceEditor, setDeviceEditor] = useState<DeviceEditor>(null);
  const [guides, setGuides] = useState<Record<string, string | null>>({});
  const [rotating, setRotating] = useState<string | null>(null);
  const [farmError, setFarmError] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();

  const guideOpen = Object.keys(guides).length > 0;

  // Device status: every 3 s while a connection guide waits for a device, otherwise every 15 s.
  const refreshDevices = useEffectEvent(async () => {
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { devices?: Device[] };
      if (body.devices) setDevices(body.devices);
    } catch {
      // Keep the last known status; the next poll retries.
    }
  });
  useEffect(() => {
    if (devices.length === 0) return;
    const id = window.setInterval(() => void refreshDevices(), guideOpen ? 3000 : 15_000);
    return () => window.clearInterval(id);
  }, [guideOpen, devices.length]);

  const changeInterval = (seconds: number) => {
    const previous = interval;
    setIntervalS(seconds);
    setIntervalError(null);
    startSavingInterval(async () => {
      const result = await updateSettingsAction({ reading_interval_s: seconds });
      if (!result.ok) {
        setIntervalS(previous);
        setIntervalError(result.error);
      }
    });
  };

  const rotate = async (device: Device) => {
    setRotating(device.id);
    const result = await rotateDeviceKeyAction(device.id);
    setRotating(null);
    if (result.ok) setGuides((g) => ({ ...g, [device.id]: result.key }));
  };

  const removeFarm = (farm: Farm) => {
    if (!window.confirm(`Delete ${farm.name}? Its devices and every reading are deleted too. This can't be undone.`)) return;
    setFarmError(null);
    startDeleting(async () => {
      const result = await deleteFarmAction(farm.id);
      if (!result.ok) setFarmError(result.error);
    });
  };

  const anyConnected = devices.some((d) => d.last_seen_at);
  const firstRun = !anyConnected;
  const otherPolygons = (exceptId?: string) => farms.filter((f) => f.id !== exceptId).map((f) => f.polygon);

  return (
    <div className="min-h-dvh">
      <DashboardHeader className="sticky top-0" user={user} source={source} weatherOffline={false} title="Farms & devices" showSetupLink={false} />

      <main id="main" className="mx-auto max-w-6xl space-y-5 p-3 sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[28px] leading-tight font-semibold tracking-tight">
              {farms.length === 0 ? `Welcome, ${user.name.split(" ")[0]}` : "Farms & devices"}
            </h1>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {farms.length === 0
                ? "Your account starts empty — add your farm, then connect the ESP32 that reads its soil probe over Wi-Fi."
                : "Your farms, the ESP32 probes that report from them, and how often they report."}
            </p>
          </div>
          {farms.length > 0 ? (
            <Button asChild size="lg" className="ml-auto h-10 px-4">
              <Link href="/dashboard">
                <LayoutDashboard /> Open dashboard <ArrowRight />
              </Link>
            </Button>
          ) : null}
        </div>

        {firstRun ? (
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Getting started">
            <Step n={1} title="Add your farm" done={farms.length > 0} active={farms.length === 0}>
              Outline the field on the map and set its crop.
            </Step>
            <Step n={2} title="Register your ESP32" done={devices.length > 0} active={farms.length > 0 && devices.length === 0}>
              Place the probe and get its device key.
            </Step>
            <Step n={3} title="Connect it over Wi-Fi" done={anyConnected} active={devices.length > 0 && !anyConnected}>
              Upload the firmware; the status turns green.
            </Step>
            <Step n={4} title="Watch live readings" done={false} active={false}>
              Every {formatInterval(interval)} on the dashboard.
            </Step>
          </ol>
        ) : null}

        {/* Reading interval */}
        <section aria-labelledby="interval-heading" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-card px-4 py-3 shadow-xs">
          <Radio className="size-5 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="interval-heading" className="text-[14px] font-semibold">
              Reading interval
            </h2>
            <p className="text-[12.5px] text-muted-foreground">
              Your ESP32s send a reading every {formatInterval(interval)} and the dashboard refreshes at the same pace. Shorter gives more
              detail; longer saves power and data.
            </p>
            {intervalError ? <p className="text-[12.5px] text-destructive">{intervalError}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {savingInterval ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" /> : null}
            <IntervalSelect value={interval} onChange={changeInterval} pending={savingInterval} demo={false} />
          </div>
        </section>

        {farmError ? (
          <p role="alert" className="rounded-lg bg-risk-high-soft px-3 py-2 text-sm text-risk-high-ink">
            {farmError}
          </p>
        ) : null}

        {/* Farms */}
        {farms.map((farm) => {
          const farmDevices = devices.filter((d) => d.farm_id === farm.id);
          const editing = farmEditor?.kind === "edit" && farmEditor.farmId === farm.id;
          const editingDevice = deviceEditor?.farmId === farm.id ? farmDevices.find((d) => d.id === deviceEditor.deviceId) : undefined;
          return (
            <section key={farm.id} aria-labelledby={`farm-${farm.id}`} className="space-y-3 rounded-2xl border bg-card p-4 shadow-xs">
              {editing ? (
                <>
                  <h2 id={`farm-${farm.id}`} className="text-[16px] font-semibold">
                    Edit {farm.name}
                  </h2>
                  <FarmForm
                    farm={farm}
                    otherFarms={otherPolygons(farm.id)}
                    onDone={() => setFarmEditor(null)}
                    onCancel={() => setFarmEditor(null)}
                  />
                </>
              ) : (
                <div className="flex flex-wrap items-start gap-3">
                  <FarmOutline polygon={farm.polygon} className="size-14 shrink-0 rounded-lg bg-sand-100 p-1" />
                  <div className="min-w-0 flex-1">
                    <h2 id={`farm-${farm.id}`} className="text-[17px] leading-snug font-semibold">
                      {farm.name}
                    </h2>
                    <p className="text-[12.5px] text-muted-foreground">
                      {CROPS[farm.main_crop].name} · planted {formatDay(farm.planting_date)} · {farm.area_ha.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
                      ha · {SOILS[farm.soil_type].name.toLowerCase()} · water ECw {farm.irrigation_water_ec} dS/m
                      {farm.region ? ` · ${farm.region}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/dashboard?farm=${encodeURIComponent(farm.id)}`}>
                        <MapPinned /> Dashboard
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setFarmEditor({ kind: "edit", farmId: farm.id })}>
                      <Pencil /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeFarm(farm)} disabled={deleting}>
                      <Trash2 /> Delete
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">ESP32 devices · {farmDevices.length}</h3>
                  {deviceEditor?.farmId !== farm.id ? (
                    <Button variant={farmDevices.length === 0 ? "default" : "outline"} size="sm" className="ml-auto" onClick={() => setDeviceEditor({ farmId: farm.id })}>
                      <Plus /> Add ESP32
                    </Button>
                  ) : null}
                </div>
                {deviceEditor?.farmId === farm.id ? (
                  <div className="rounded-xl border bg-sidebar/60 p-3.5">
                    <h4 className="mb-3 text-[14px] font-semibold">{editingDevice ? `Edit ${editingDevice.name}` : "Register an ESP32"}</h4>
                    <DeviceForm
                      farm={farm}
                      devices={farmDevices}
                      device={editingDevice}
                      onCancel={() => setDeviceEditor(null)}
                      onDone={({ device, key }) => {
                        setDeviceEditor(null);
                        setDevices((list) => [...list.filter((d) => d.id !== device.id), device]);
                        if (key) setGuides((g) => ({ ...g, [device.id]: key }));
                      }}
                    />
                  </div>
                ) : null}
                {farmDevices.length === 0 && deviceEditor?.farmId !== farm.id ? (
                  <p className="flex items-center gap-2 rounded-xl border border-dashed px-3.5 py-3 text-[13px] text-muted-foreground">
                    <Cpu className="size-4" aria-hidden="true" /> No devices yet — add the ESP32 that reads this farm&apos;s soil probe.
                  </p>
                ) : null}
                <ul className="space-y-2">
                  {farmDevices.map((device) => (
                    <li key={device.id} className="space-y-2">
                      <DeviceRow
                        device={device}
                        intervalS={interval}
                        onGuide={() => setGuides((g) => ({ ...g, [device.id]: g[device.id] ?? null }))}
                        onEdit={() => setDeviceEditor({ farmId: farm.id, deviceId: device.id })}
                        onKey={(d, key) => {
                          setDevices((list) => list.map((x) => (x.id === d.id ? d : x)));
                          setGuides((g) => ({ ...g, [d.id]: key }));
                        }}
                        onRemoved={() => {
                          setDevices((list) => list.filter((x) => x.id !== device.id));
                          setGuides(({ [device.id]: _closed, ...rest }) => rest);
                        }}
                      />
                      {device.id in guides ? (
                        <ConnectGuide
                          device={device}
                          deviceKey={guides[device.id]}
                          intervalS={interval}
                          serverUrl={serverUrl}
                          rotating={rotating === device.id}
                          onRotate={() => void rotate(device)}
                          onClose={() => setGuides(({ [device.id]: _closed, ...rest }) => rest)}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })}

        {/* Add a farm */}
        {farmEditor?.kind === "add" ? (
          <section aria-labelledby="add-farm-heading" className="space-y-3 rounded-2xl border bg-card p-4 shadow-xs">
            <div className="flex items-center gap-2">
              <Sprout className="size-5 text-primary" aria-hidden="true" />
              <h2 id="add-farm-heading" className="text-[17px] font-semibold">
                {farms.length === 0 ? "Add your farm" : "Add another farm"}
              </h2>
            </div>
            <FarmForm
              otherFarms={otherPolygons()}
              onDone={(farmId) => {
                setFarmEditor(null);
                setDeviceEditor({ farmId });
                router.refresh();
              }}
              onCancel={farms.length > 0 ? () => setFarmEditor(null) : undefined}
            />
          </section>
        ) : (
          <Button variant="outline" size="lg" className="h-11 w-full border-dashed bg-card/50" onClick={() => setFarmEditor({ kind: "add" })}>
            <Plus /> Add another farm
          </Button>
        )}
      </main>
    </div>
  );
}

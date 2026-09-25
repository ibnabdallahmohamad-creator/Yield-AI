"use client";

import { Cpu, EllipsisVertical, KeyRound, MapPin, Pencil, Plus, QrCode, Sprout, Trash2, Wifi, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOptionalShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEVICE_STATUS_LABEL, deviceStatus, INTERVAL_OPTIONS_S, intervalLabel, type Device, type DeviceStatus } from "@/lib/account/types";
import { formatShortDay, formatTime, qatarDay, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { callApi, errorText } from "./api";
import { ConnectDialog, type ConnectStart } from "./connect-dialog";
import { ConfirmDialog, EditDeviceDialog, TokenDialog } from "./device-dialogs";
import { FarmDialog } from "./farm-dialog";
import type { ManagedFarm, Option } from "./types";

const CARD = "rounded-2xl border bg-card shadow-xs";

const STATUS_STYLE: Record<DeviceStatus, string> = {
  online: "bg-risk-low-soft text-risk-low-ink ring-risk-low/25",
  offline: "bg-risk-medium-soft text-risk-medium-ink ring-risk-medium/40",
  paired: "bg-accent text-primary ring-primary/20",
  waiting: "bg-muted text-muted-foreground ring-border",
};

function StatusPill({ status }: { status: DeviceStatus }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset", STATUS_STYLE[status])}>
      {status === "online" ? <Wifi className="size-3.5" aria-hidden="true" /> : status === "offline" ? <WifiOff className="size-3.5" aria-hidden="true" /> : null}
      {status === "paired" ? "Paired" : DEVICE_STATUS_LABEL[status]}
    </span>
  );
}

/** Re-render every few seconds so "online" and "2 min ago" stay true. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}

function lastSeenText(iso: string, now: number): string {
  const day = qatarDay(iso);
  const sameDay = day === qatarDay(new Date(now).toISOString());
  return `${relativeTime(iso, now)} · ${sameDay ? "" : `${formatShortDay(day)}, `}${formatTime(iso)}`;
}

function DeviceRow({
  device,
  now,
  onInterval,
  onEdit,
  onPair,
  onToken,
  onDelete,
}: {
  device: Device;
  now: number;
  onInterval: (seconds: number) => Promise<void>;
  onEdit: () => void;
  onPair: () => void;
  onToken: () => void;
  onDelete: () => void;
}) {
  const status = deviceStatus(device, now);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = [...new Set([...INTERVAL_OPTIONS_S, device.interval_s])].sort((a, b) => a - b);
  const facts = [
    device.last_seen_at ? `Last reading ${lastSeenText(device.last_seen_at, now)}` : null,
    device.readings_count ? `${device.readings_count.toLocaleString("en")} reading${device.readings_count === 1 ? "" : "s"}` : null,
    device.rssi != null ? `Wi-Fi ${device.rssi} dBm` : null,
    device.local_ip,
    device.firmware ? `Firmware ${device.firmware}` : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground" aria-hidden="true">
          <Cpu className="size-4.5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-semibold">{device.name}</p>
            <span className="font-mono text-xs text-muted-foreground">{device.sensor_id}</span>
            <StatusPill status={status} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {facts.length ? facts.join(" · ") : status === "waiting" ? "Enter its pairing code on the device's setup page to connect it." : "Paired; the first reading is on its way."}
          </p>
          {error ? (
            <p role="alert" className="mt-1 text-sm text-risk-high-ink">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2 pl-12 sm:pl-0">
        <label className="sr-only" htmlFor={`interval-${device.id}`}>
          Reading interval for {device.name}
        </label>
        <Select
          value={String(device.interval_s)}
          disabled={saving}
          onValueChange={async (v) => {
            setSaving(true);
            setError(null);
            try {
              await onInterval(Number(v));
            } catch (err) {
              setError(errorText(err));
            } finally {
              setSaving(false);
            }
          }}
        >
          <SelectTrigger id={`interval-${device.id}`} className="h-11 sm:h-9 sm:pointer-coarse:h-11 w-36" aria-label={`Reading interval for ${device.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((s) => (
              <SelectItem key={s} value={String(s)}>
                Every {intervalLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {status === "waiting" ? (
          <Button variant="outline" className="h-11 sm:h-9 sm:pointer-coarse:h-11" onClick={onPair}>
            <QrCode aria-hidden="true" />
            Pair
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-11 sm:size-9 sm:pointer-coarse:size-11" aria-label={`More actions for ${device.name}`}>
              <EllipsisVertical aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Rename or move
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPair}>
              <QrCode /> New pairing code
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onToken}>
              <KeyRound /> New token
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Remove device
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

type Confirm = { kind: "farm"; farm: ManagedFarm } | { kind: "device"; device: Device } | { kind: "token"; device: Device } | null;

/** The Farms & devices page: add farms, connect ESP32 probes, set how often each one reports. */
export function DevicesManager({
  farms,
  devices: initialDevices,
  crops,
  demo,
  error,
}: {
  farms: ManagedFarm[];
  devices: Device[];
  crops: Option[];
  demo: boolean;
  error: string | null;
}) {
  const router = useRouter();
  const shell = useOptionalShell();
  const now = useNow(5000);
  const [devices, setDevices] = useState(initialDevices);
  const [prevInitial, setPrevInitial] = useState(initialDevices);
  if (initialDevices !== prevInitial) {
    setPrevInitial(initialDevices);
    setDevices(initialDevices);
  }
  // Live updates carry fresh device status (last seen, readings) without reloading the page.
  const liveDevices = shell?.liveDevices ?? null;
  const [prevLive, setPrevLive] = useState(liveDevices);
  if (liveDevices !== prevLive) {
    setPrevLive(liveDevices);
    if (liveDevices) setDevices(liveDevices);
  }

  const [farmDialog, setFarmDialog] = useState<{ open: boolean; farm: ManagedFarm | null }>({ open: false, farm: null });
  const [connect, setConnect] = useState<{ open: boolean; farmId: string | null; start: ConnectStart | null }>({ open: false, farmId: null, start: null });
  const [editing, setEditing] = useState<Device | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [token, setToken] = useState<{ token: string; device: Device } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(() => router.refresh(), [router]);
  const farmOptions: Option[] = useMemo(() => farms.map((f) => ({ id: f.id, name: f.name })), [farms]);
  const byFarm = useMemo(() => {
    const map = new Map<string, Device[]>();
    for (const d of devices) map.set(d.farm_id, [...(map.get(d.farm_id) ?? []), d]);
    return map;
  }, [devices]);
  const online = devices.filter((d) => deviceStatus(d, now) === "online").length;

  const updateInterval = async (device: Device, seconds: number) => {
    const res = await callApi<{ device: Device }>(`/api/devices/${encodeURIComponent(device.id)}`, { method: "PATCH", body: { interval_s: seconds } });
    setDevices((list) => list.map((d) => (d.id === device.id ? res.device : d)));
    refresh();
  };

  const newPairingCode = async (device: Device) => {
    setActionError(null);
    try {
      const res = await callApi<{ device: Device }>(`/api/devices/${encodeURIComponent(device.id)}`, { body: { action: "pairing-code" } });
      setDevices((list) => list.map((d) => (d.id === device.id ? res.device : d)));
      setConnect({ open: true, farmId: device.farm_id, start: { device: res.device } });
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  if (demo) {
    return (
      <div className={cn(CARD, "mx-auto max-w-2xl p-6 text-center sm:p-8")}>
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent text-primary" aria-hidden="true">
          <Cpu className="size-6" />
        </span>
        <h1 className="mt-4 text-xl font-semibold">Connect your own ESP32 probes</h1>
        <p className="mt-2 text-muted-foreground">
          You&apos;re exploring the demo account, which shows sample farms. Create your own account to add your farms, pair ESP32 devices over Wi-Fi and see
          their readings live. A new account starts empty, with no sample data.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/signup">Create an account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to the demo</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">Farms &amp; devices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {farms.length === 0
              ? "Add your first farm, then connect an ESP32 to it."
              : `${farms.length} farm${farms.length === 1 ? "" : "s"} · ${devices.length} device${devices.length === 1 ? "" : "s"}${devices.length ? ` · ${online} online` : ""}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11 sm:h-9 sm:pointer-coarse:h-11" onClick={() => setFarmDialog({ open: true, farm: null })}>
            <Plus aria-hidden="true" />
            Add farm
          </Button>
          {farms.length ? (
            <Button className="h-11 sm:h-9 sm:pointer-coarse:h-11" onClick={() => setConnect({ open: true, farmId: shell?.farmId ?? farms[0].id, start: null })}>
              <Wifi aria-hidden="true" />
              Connect ESP32
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-risk-high-soft px-4 py-3 text-sm text-risk-high-ink">
          {error}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="rounded-xl bg-risk-high-soft px-4 py-3 text-sm text-risk-high-ink">
          {actionError}
        </p>
      ) : null}

      {farms.length === 0 && !error ? (
        <div className={cn(CARD, "p-6 sm:p-8")}>
          <ol className="grid gap-5 sm:grid-cols-3">
            {[
              { icon: <Sprout />, title: "1. Add a farm", text: "Where it is, what grows there, its soil and water." },
              { icon: <Wifi />, title: "2. Connect an ESP32", text: "It joins your Wi-Fi and pairs with a one-time code." },
              { icon: <Cpu />, title: "3. Watch the readings", text: "Soil moisture, temperature, EC, pH and NPK, every 10 s by default." },
            ].map((s) => (
              <li key={s.title}>
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary [&_svg]:size-5" aria-hidden="true">
                  {s.icon}
                </span>
                <p className="mt-3 font-semibold">{s.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
          <Button className="mt-6 h-11 sm:h-9 sm:pointer-coarse:h-11" onClick={() => setFarmDialog({ open: true, farm: null })}>
            <Plus aria-hidden="true" />
            Add your first farm
          </Button>
        </div>
      ) : null}

      {farms.map((farm) => {
        const list = byFarm.get(farm.id) ?? [];
        const lastAt = list.map((d) => d.last_seen_at).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
        return (
          <section key={farm.id} className={CARD} aria-labelledby={`farm-${farm.id}`}>
            <div className="flex flex-wrap items-start gap-3 border-b px-4 py-4 sm:px-5">
              <div className="min-w-0 flex-1">
                <h2 id={`farm-${farm.id}`} className="text-base font-semibold">
                  <Link href={`/dashboard/farm/${encodeURIComponent(farm.id)}`} className="hover:underline">
                    {farm.name}
                  </Link>
                </h2>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                  <span>
                    {farm.crop} · {farm.area_ha} ha
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" aria-hidden="true" />
                    {farm.region || `${farm.lat.toFixed(4)}, ${farm.lng.toFixed(4)}`}
                  </span>
                  <span>
                    {lastAt
                      ? `Last reading ${relativeTime(lastAt, now)}`
                      : farm.last_reading_day
                        ? `Last readings ${formatShortDay(farm.last_reading_day)}`
                        : "No readings yet"}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-11 sm:h-9 sm:pointer-coarse:h-11" onClick={() => setConnect({ open: true, farmId: farm.id, start: null })}>
                  <Plus aria-hidden="true" />
                  Device
                </Button>
                <Button variant="ghost" size="icon" className="size-11 sm:size-9 sm:pointer-coarse:size-11" aria-label={`Edit ${farm.name}`} onClick={() => setFarmDialog({ open: true, farm })}>
                  <Pencil aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="icon" className="size-11 sm:size-9 sm:pointer-coarse:size-11" aria-label={`Delete ${farm.name}`} onClick={() => setConfirm({ kind: "farm", farm })}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
            {list.length ? (
              <ul className="divide-y">
                {list.map((d) => (
                  <DeviceRow
                    key={d.id}
                    device={d}
                    now={now}
                    onInterval={(s) => updateInterval(d, s)}
                    onEdit={() => setEditing(d)}
                    onPair={() => void newPairingCode(d)}
                    onToken={() => setConfirm({ kind: "token", device: d })}
                    onDelete={() => setConfirm({ kind: "device", device: d })}
                  />
                ))}
              </ul>
            ) : (
              <div className="flex flex-wrap items-center gap-3 px-4 py-4 text-sm text-muted-foreground sm:px-5">
                <span className="flex-1">No devices on this farm yet.</span>
                <Button size="sm" className="h-11 sm:h-9 sm:pointer-coarse:h-11" onClick={() => setConnect({ open: true, farmId: farm.id, start: null })}>
                  <Wifi aria-hidden="true" />
                  Connect an ESP32
                </Button>
              </div>
            )}
          </section>
        );
      })}

      {farms.length ? (
        <details className={cn(CARD, "px-4 py-3 text-sm sm:px-5")}>
          <summary className="cursor-pointer font-semibold">How devices send readings</summary>
          <div className="mt-3 space-y-2 text-muted-foreground">
            <p>
              Each ESP32 sends a JSON reading to <code className="text-xs">POST /api/readings</code> with its token (<code className="text-xs">Authorization: Bearer yd_…</code>)
              over Wi-Fi. Fields: <code className="text-xs">moisture</code> (%), <code className="text-xs">temperature</code> (°C), <code className="text-xs">ec</code> (dS/m),{" "}
              <code className="text-xs">ph</code>, <code className="text-xs">n</code>, <code className="text-xs">p</code>, <code className="text-xs">k</code> (mg/kg),{" "}
              <code className="text-xs">air_temp</code> and <code className="text-xs">air_humidity</code>; any can be left out.
            </p>
            <p>
              The reply tells the device how many seconds to wait before the next reading (<code className="text-xs">interval_s</code>), so changing the interval here
              reaches it without reflashing. Readings taken while the Wi-Fi was down can be sent later in one batch with their own timestamps.
            </p>
          </div>
        </details>
      ) : null}

      <FarmDialog
        open={farmDialog.open}
        farm={farmDialog.farm}
        crops={crops}
        onOpenChange={(open) => setFarmDialog((s) => ({ ...s, open }))}
        onSaved={(id) => {
          refresh();
          if (!farmDialog.farm && devices.length === 0) setConnect({ open: true, farmId: id, start: null });
        }}
      />
      <ConnectDialog
        open={connect.open}
        onOpenChange={(open) => {
          setConnect((s) => ({ ...s, open }));
          if (!open) {
            refresh();
            if (devices.length || connect.start) shell?.setLive(true);
          }
        }}
        farms={farmOptions}
        defaultFarmId={connect.farmId}
        defaultInterval={shell?.intervalS}
        start={connect.start}
        onChanged={refresh}
      />
      <EditDeviceDialog device={editing} farms={farmOptions} onOpenChange={(open) => !open && setEditing(null)} onSaved={refresh} />
      <TokenDialog token={token?.token ?? null} device={token?.device ?? null} onOpenChange={(open) => !open && setToken(null)} />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        destructive={confirm?.kind !== "token"}
        title={
          confirm?.kind === "farm"
            ? `Delete ${confirm.farm.name}?`
            : confirm?.kind === "device"
              ? `Remove ${confirm.device.name}?`
              : confirm?.kind === "token"
                ? `New token for ${confirm.device.name}?`
                : ""
        }
        body={
          confirm?.kind === "farm" ? (
            <p>This deletes the farm, its devices and all of its readings. It can&apos;t be undone.</p>
          ) : confirm?.kind === "device" ? (
            <p>The device stops being able to send readings. The readings it already sent stay on the farm.</p>
          ) : (
            <p>The device&apos;s current token stops working straight away. Use this if a token leaked, or to flash it into your own firmware.</p>
          )
        }
        confirmLabel={confirm?.kind === "farm" ? "Delete farm" : confirm?.kind === "device" ? "Remove device" : "Issue new token"}
        onConfirm={async () => {
          if (!confirm) return;
          if (confirm.kind === "farm") {
            await callApi(`/api/farms/${encodeURIComponent(confirm.farm.id)}`, { method: "DELETE" });
          } else if (confirm.kind === "device") {
            await callApi(`/api/devices/${encodeURIComponent(confirm.device.id)}`, { method: "DELETE" });
            setDevices((list) => list.filter((d) => d.id !== confirm.device.id));
          } else {
            const res = await callApi<{ device: Device; token: string }>(`/api/devices/${encodeURIComponent(confirm.device.id)}`, { body: { action: "token" } });
            setToken({ token: res.token, device: res.device });
          }
          refresh();
        }}
      />
    </div>
  );
}

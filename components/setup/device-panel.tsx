"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Cpu,
  Download,
  KeyRound,
  Loader2,
  MapPin,
  MoreHorizontal,
  Radio,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useId, useState, useTransition } from "react";
import { createDeviceAction, deleteDeviceAction, rotateDeviceKeyAction, updateDeviceAction } from "@/app/dashboard/actions";
import { ProbeMap } from "@/components/setup/maps";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNow } from "@/hooks/use-now";
import { DEVICE_STATE_LABEL, deviceState, signalBars, type DeviceState } from "@/lib/devices";
import { FIRMWARE_FILENAME, FIRMWARE_PATH, fillFirmware } from "@/lib/firmware";
import { fmtNum, formatInterval, relativeTime } from "@/lib/format";
import { polygonCentroid } from "@/lib/geo";
import type { Device, Farm } from "@/lib/types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check /> : <ClipboardCopy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

const STATE_STYLE: Record<DeviceState, { dot: string; chip: string }> = {
  online: { dot: "bg-risk-low", chip: "bg-risk-low-soft text-risk-low-ink ring-risk-low/25" },
  "probe-error": { dot: "bg-risk-medium", chip: "bg-risk-medium-soft text-risk-medium-ink ring-risk-medium/40" },
  offline: { dot: "bg-risk-high", chip: "bg-risk-high-soft text-risk-high-ink ring-risk-high/25" },
  never: { dot: "bg-muted-foreground/40", chip: "bg-muted text-muted-foreground ring-border" },
};

export function DeviceStateChip({ state, className }: { state: DeviceState; className?: string }) {
  const s = STATE_STYLE[state];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-semibold ring-1 ring-inset", s.chip, className)}>
      <span className="relative flex size-2" aria-hidden="true">
        {state === "online" ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-risk-low opacity-60" /> : null}
        <span className={cn("relative inline-flex size-2 rounded-full", s.dot)} />
      </span>
      {DEVICE_STATE_LABEL[state]}
    </span>
  );
}

export function SignalBars({ rssi }: { rssi: number | null }) {
  const bars = signalBars(rssi);
  return (
    <span className="inline-flex items-end gap-0.5" role="img" aria-label={rssi == null ? "No signal reported" : `Wi-Fi signal ${rssi} dBm`}>
      {[1, 2, 3, 4].map((b) => (
        <span key={b} className={cn("w-1 rounded-sm", b <= bars ? "bg-foreground/70" : "bg-foreground/15")} style={{ height: 3 + b * 2.5 }} />
      ))}
    </span>
  );
}

/** The latest values a device sent, as compact chips. */
export function LastReading({ device }: { device: Pick<Device, "last_reading"> }) {
  const r = device.last_reading;
  if (!r) return null;
  const items: Array<[string, string]> = [
    ["Moisture", r.moisture == null ? "—" : `${fmtNum(r.moisture, 1)} %`],
    ["Soil temp.", r.temperature == null ? "—" : `${fmtNum(r.temperature, 1)} °C`],
    ["EC", r.ec == null ? "—" : `${fmtNum(r.ec, 2)} dS/m`],
    ["pH", r.ph == null ? "—" : fmtNum(r.ph, 2)],
    ["N · P · K", [r.n, r.p, r.k].map((v) => (v == null ? "—" : fmtNum(v, 0))).join(" · ")],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-5">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">{k}</dt>
          <dd className="font-semibold tabular">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Register / edit a device
// ---------------------------------------------------------------------------

export function DeviceForm({
  farm,
  devices,
  device,
  onDone,
  onCancel,
}: {
  farm: Farm;
  /** Other devices on the farm (shown on the map). */
  devices: Device[];
  /** Edit this device; omit to register a new one. */
  device?: Device;
  onDone: (result: { device: Device; key: string | null }) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(device?.name ?? `Probe ${devices.length + 1}`);
  const [position, setPosition] = useState(() => {
    if (device) return { lat: device.lat, lng: device.lng };
    const [lng, lat] = polygonCentroid(farm.polygon);
    return { lat, lng };
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      if (device) {
        const result = await updateDeviceAction(device.id, { name, ...position });
        if (result.ok) onDone({ device: result.device, key: null });
        else setError(result.error);
      } else {
        const result = await createDeviceAction({ farm_id: farm.id, name, ...position });
        if (result.ok) onDone({ device: result.device, key: result.key });
        else setError(result.error);
      }
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" noValidate>
      <div className="space-y-3">
        {error ? (
          <p role="alert" className="rounded-lg bg-risk-high-soft px-3 py-2 text-sm text-risk-high-ink">
            {error}
          </p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>Device name</Label>
          <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-10 bg-card" autoFocus />
        </div>
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          <MapPin className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
          Click the map where the probe is buried — its readings are mapped across the field from there.
        </p>
        <p className="text-[12px] text-muted-foreground tabular">
          {position.lat.toFixed(6)}, {position.lng.toFixed(6)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending} size="lg" className="h-10 px-4">
            {pending ? <Loader2 className="animate-spin" /> : device ? null : <Cpu />}
            {device ? "Save" : "Register ESP32"}
          </Button>
          <Button type="button" variant="ghost" size="lg" className="h-10" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
      <div className="relative isolate h-[300px] overflow-hidden rounded-xl border">
        <ProbeMap
          polygon={farm.polygon}
          position={position}
          onChange={setPosition}
          others={devices.filter((d) => d.id !== device?.id).map((d) => ({ id: d.sensor_id, lat: d.lat, lng: d.lng }))}
          label={name || "New probe"}
        />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Connection guide
// ---------------------------------------------------------------------------

const WIRING: Array<[string, string]> = [
  ["Probe brown (power)", "12 V supply + (check your probe: 5–24 V)"],
  ["Probe black (GND)", "Supply − and ESP32 GND"],
  ["Probe yellow (A)", "RS485 module A"],
  ["Probe blue (B)", "RS485 module B"],
  ["RS485 RO", "ESP32 GPIO 16"],
  ["RS485 DI", "ESP32 GPIO 17"],
  ["RS485 DE + RE", "ESP32 GPIO 4"],
  ["RS485 VCC / GND", "ESP32 3.3 V / GND"],
];

function isLocalAddress(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function ConnectionStatus({ device, intervalS }: { device: Device; intervalS: number }) {
  const now = useNow();
  const state = now ? deviceState(device, intervalS, now) : "never";
  if (state === "never") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed bg-card p-3.5" role="status" aria-live="polite">
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">Waiting for the first signal from your ESP32…</p>
          <p className="text-[12.5px] text-muted-foreground">This updates by itself as soon as the device checks in.</p>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "space-y-2.5 rounded-xl border p-3.5",
        state === "online" ? "border-risk-low/40 bg-risk-low-soft/60" : "border-risk-medium/40 bg-risk-medium-soft/60",
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2">
        {state === "online" ? (
          <CheckCircle2 className="size-4.5 text-risk-low-ink" aria-hidden="true" />
        ) : (
          <AlertTriangle className="size-4.5 text-risk-medium-ink" aria-hidden="true" />
        )}
        <p className="text-sm font-semibold">
          {state === "online" ? "Connected" : state === "probe-error" ? "Connected — the probe needs attention" : "Connected before, silent now"}
        </p>
        <span className="text-[12.5px] text-muted-foreground">
          last contact {now && device.last_seen_at ? relativeTime(device.last_seen_at, now) : "—"}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <SignalBars rssi={device.rssi} /> {device.rssi != null ? `${device.rssi} dBm` : ""}
        </span>
      </div>
      {device.last_error ? <p className="text-[12.5px] text-risk-medium-ink">Device reports: {device.last_error}</p> : null}
      <LastReading device={device} />
    </div>
  );
}

/** Everything needed to get one ESP32 online: its key, the firmware, wiring and a live status. */
export function ConnectGuide({
  device,
  deviceKey,
  intervalS,
  serverUrl,
  onRotate,
  rotating,
  onClose,
}: {
  device: Device;
  /** Only known right after registering or issuing a new key. */
  deviceKey: string | null;
  intervalS: number;
  /** The address this dashboard was opened on — where the ESP32 should post. */
  serverUrl: string;
  onRotate: () => void;
  rotating: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const [server, setServer] = useState(serverUrl);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (!deviceKey) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch(FIRMWARE_PATH, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const sketch = fillFirmware(await res.text(), { ssid, password, server, key: deviceKey });
      const url = URL.createObjectURL(new Blob([sketch], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = FIRMWARE_FILENAME;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      setDownloadError(`Could not prepare the firmware (${error instanceof Error ? error.message : "unknown error"}).`);
    } finally {
      setDownloading(false);
    }
  };

  const curl = deviceKey
    ? `curl -X POST ${server || "<dashboard address>"}/api/readings \\\n  -H "Authorization: Bearer ${deviceKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"rssi": -60, "fw": "connection-test"}'`
    : "";

  return (
    <div className="space-y-4 rounded-2xl border bg-sidebar/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[15px] font-semibold">Connect {device.name}</h4>
        <span className="text-[12.5px] text-muted-foreground">
          Probe id <span className="font-mono">{device.sensor_id}</span> · reports every {formatInterval(intervalS)}
        </span>
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          Close guide
        </Button>
      </div>

      <ConnectionStatus device={device} intervalS={intervalS} />

      <ol className="space-y-4 text-[13.5px]">
        <li className="space-y-2">
          <p className="font-semibold">1. Device key</p>
          {deviceKey ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border bg-card px-3 py-2 font-mono text-[12.5px]" data-testid="device-key">
                  {deviceKey}
                </code>
                <CopyButton value={deviceKey} />
              </div>
              <p className="flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
                <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                Shown only now — the server keeps just a fingerprint of it. Lost it? Issue a new key any time.
              </p>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
              <p className="text-[12.5px] text-muted-foreground">
                The key ending in <span className="font-mono">…{device.token_hint}</span> was shown when the device was added.
              </p>
              <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={onRotate} disabled={rotating}>
                {rotating ? <Loader2 className="animate-spin" /> : <KeyRound />} Issue a new key
              </Button>
            </div>
          )}
        </li>

        <li className="space-y-2">
          <p className="font-semibold">2. Download the firmware with your settings</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-3">
              <Label htmlFor={`${id}-server`} className="text-[12.5px]">
                Dashboard address (the ESP32 sends its readings here)
              </Label>
              <Input id={`${id}-server`} value={server} onChange={(e) => setServer(e.target.value)} className="h-9 bg-card font-mono text-[12.5px]" />
              {isLocalAddress(server) ? (
                <p className="text-[12px] text-risk-medium-ink">
                  “localhost” only works on this computer. Use your deployed address, or this computer&apos;s network address (e.g.
                  http://192.168.1.20:3000) with the ESP32 on the same Wi-Fi.
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-ssid`} className="text-[12.5px]">
                Wi-Fi name (optional)
              </Label>
              <Input id={`${id}-ssid`} value={ssid} onChange={(e) => setSsid(e.target.value)} className="h-9 bg-card" autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-pass`} className="text-[12.5px]">
                Wi-Fi password (optional)
              </Label>
              <Input
                id={`${id}-pass`}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9 bg-card"
                autoComplete="off"
              />
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={download} disabled={!deviceKey || downloading || !server} className="h-9 w-full">
                {downloading ? <Loader2 className="animate-spin" /> : <Download />} Download .ino
              </Button>
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground">
            The Wi-Fi password stays in your browser — it is written into the file on this computer and never sent to the server. Leave
            Wi-Fi empty to enter it from your phone instead (step 4).
          </p>
          {downloadError ? <p className="text-[12.5px] text-destructive">{downloadError}</p> : null}
        </li>

        <li className="space-y-2">
          <p className="font-semibold">3. Wire the probe and upload</p>
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-[12.5px]">
              <tbody>
                {WIRING.map(([from, to]) => (
                  <tr key={from} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-medium">{from}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">→ {to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            In the Arduino IDE, install <span className="font-medium text-foreground">esp32 by Espressif Systems</span> from the Boards
            Manager, choose <span className="font-medium text-foreground">ESP32 Dev Module</span>, open the downloaded file (let the IDE
            put it in a folder) and upload. No extra libraries are needed. The serial monitor (115200 baud) shows every reading.
          </p>
        </li>

        <li className="space-y-1.5">
          <p className="font-semibold">4. Wi-Fi from your phone (if you left it empty)</p>
          <p className="text-[12.5px] text-muted-foreground">
            The ESP32 opens a hotspot named <span className="font-mono text-foreground">YieldAI-Setup-XXXX</span>. Join it — the setup page
            opens (or browse to <span className="font-mono text-foreground">http://192.168.4.1</span>) — pick your Wi-Fi and enter its
            password, the dashboard address and the device key. Hold BOOT while powering up to open it again later.
          </p>
        </li>

        {deviceKey ? (
          <li className="space-y-1.5">
            <p className="font-semibold">Check the address and key from a computer (optional)</p>
            <p className="text-[12.5px] text-muted-foreground">
              This sends a heartbeat without a reading; the status above turns to “Connected” if the address and key work.
            </p>
            <div className="flex items-start gap-2">
              <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border bg-card px-3 py-2 font-mono text-[11.5px] leading-relaxed">
                {curl}
              </pre>
              <CopyButton value={curl} />
            </div>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Device row
// ---------------------------------------------------------------------------

export function DeviceRow({
  device,
  intervalS,
  onGuide,
  onEdit,
  onKey,
  onRemoved,
}: {
  device: Device;
  intervalS: number;
  onGuide: () => void;
  onEdit: () => void;
  onKey: (device: Device, key: string) => void;
  onRemoved: () => void;
}) {
  const now = useNow();
  const state = now ? deviceState(device, intervalS, now) : device.last_seen_at ? "offline" : "never";
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const rotate = () => {
    if (!window.confirm(`Issue a new key for ${device.name}? The old key stops working right away.`)) return;
    startTransition(async () => {
      const result = await rotateDeviceKeyAction(device.id);
      if (result.ok) onKey(result.device, result.key);
      else setError(result.error);
    });
  };
  const remove = () => {
    if (!window.confirm(`Remove ${device.name}? Its readings stay on the farm; the device can no longer send new ones.`)) return;
    startTransition(async () => {
      const result = await deleteDeviceAction(device.id);
      if (result.ok) onRemoved();
      else setError(result.error);
    });
  };

  return (
    <div className="space-y-2 rounded-xl border bg-card px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-primary" aria-hidden="true">
          {state === "online" || state === "probe-error" ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold">{device.name}</p>
          <p className="text-[12px] text-muted-foreground">
            <span className="font-mono">{device.sensor_id}</span>
            {device.firmware ? ` · firmware ${device.firmware}` : ""} · key …{device.token_hint}
          </p>
        </div>
        <DeviceStateChip state={state} />
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <SignalBars rssi={device.rssi} />
          {device.last_seen_at && now ? relativeTime(device.last_seen_at, now) : "never seen"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {state === "never" ? (
            <Button type="button" size="sm" onClick={onGuide}>
              <Radio /> Connect
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${device.name}`} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onGuide}>
                <Radio /> Connection guide
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onEdit}>
                <MapPin /> Rename or move
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={rotate}>
                <KeyRound /> Issue a new key
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={remove} className="text-destructive focus:text-destructive">
                <Trash2 /> Remove device
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {device.last_error && state !== "never" ? <p className="text-[12.5px] text-risk-medium-ink">Device reports: {device.last_error}</p> : null}
      {device.last_reading ? <LastReading device={device} /> : null}
      {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
    </div>
  );
}

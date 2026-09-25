"use client";

import { CircleCheck, LoaderCircle, TriangleAlert, Wifi } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_INTERVAL_S, formatPairingCode, INTERVAL_OPTIONS_S, intervalLabel, type Device } from "@/lib/account/types";
import { formatTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { callApi, errorText } from "./api";
import { CopyField } from "./copy-field";
import type { Option } from "./types";

/** Where the ESP32 should send its readings: this site, or (in development) this computer's address on the Wi-Fi. */
export function useServerUrls(): { origin: string; lanUrls: string[]; local: boolean } {
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
  useEffect(() => {
    if (!local) return;
    const ctrl = new AbortController();
    callApi<{ lan_urls?: string[] }>("/api/devices", { signal: ctrl.signal })
      .then((r) => setLanUrls(r.lan_urls ?? []))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [local]);
  return { origin, lanUrls, local };
}

export interface ConnectStart {
  /** Open straight at the pairing step for this device (e.g. after "New pairing code"). */
  device: Device;
  /** Set when a token was just issued (shown once). */
  token?: string | null;
}

type Step = "setup" | "pair";

/**
 * Connect an ESP32 in three steps: pick the farm (and how often it reports), put the pairing code into
 * the device's setup page, then watch it pair and send its first reading. Polls the device every 2 s.
 */
export function ConnectDialog({
  open,
  onOpenChange,
  farms,
  defaultFarmId,
  defaultInterval = DEFAULT_INTERVAL_S,
  start,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  farms: Option[];
  defaultFarmId: string | null;
  defaultInterval?: number;
  start: ConnectStart | null;
  onChanged: () => void;
}) {
  const id = useId();
  const { origin, lanUrls, local } = useServerUrls();
  const [step, setStep] = useState<Step>(start ? "pair" : "setup");
  const [farmId, setFarmId] = useState(defaultFarmId ?? farms[0]?.id ?? "");
  const [name, setName] = useState("ESP32 probe");
  const [interval, setIntervalValue] = useState(defaultInterval);
  const [device, setDevice] = useState<Device | null>(start?.device ?? null);
  const [token, setToken] = useState<string | null>(start?.token ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Reset whenever the dialog opens.
  const openKey = open ? `open:${start?.device.id ?? "new"}` : "closed";
  const [prevOpenKey, setPrevOpenKey] = useState(openKey);
  if (openKey !== prevOpenKey) {
    setPrevOpenKey(openKey);
    if (open) {
      setStep(start ? "pair" : "setup");
      setDevice(start?.device ?? null);
      setToken(start?.token ?? null);
      setFarmId(defaultFarmId ?? farms[0]?.id ?? "");
      setName("ESP32 probe");
      setIntervalValue(defaultInterval);
      setError(null);
    }
  }

  const deviceId = device?.id ?? null;
  const receiving = Boolean(device?.last_seen_at);
  // Follow the device until its first reading arrives.
  useEffect(() => {
    if (!open || step !== "pair" || !deviceId || receiving) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const res = await callApi<{ device: Device }>(`/api/devices/${encodeURIComponent(deviceId)}`);
        if (stopped) return;
        setDevice(res.device);
        if (res.device.last_seen_at) onChanged();
      } catch {
        // keep trying
      }
      if (!stopped) timer = window.setTimeout(poll, 2000);
    };
    timer = window.setTimeout(poll, 1500);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [open, step, deviceId, receiving, onChanged]);

  // A ticking clock for the code's countdown.
  useEffect(() => {
    if (!open || step !== "pair") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [open, step]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await callApi<{ device: Device; token: string }>("/api/devices", { body: { farm_id: farmId, name, interval_s: interval } });
      setDevice(res.device);
      setToken(res.token);
      setStep("pair");
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const renewCode = async () => {
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      const res = await callApi<{ device: Device }>(`/api/devices/${encodeURIComponent(device.id)}`, { body: { action: "pairing-code" } });
      setDevice(res.device);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const expiresIn = device?.pairing_expires_at ? Date.parse(device.pairing_expires_at) - now : null;
  const codeValid = Boolean(device?.pairing_code && expiresIn != null && expiresIn > 0);
  const serverUrl = local && lanUrls[0] ? lanUrls[0] : origin;
  const exampleBody = '{"moisture": 22.5, "temperature": 27.1, "ec": 1.8, "ph": 7.4}';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[4vh] max-h-[92dvh] max-w-xl overflow-y-auto p-5 sm:p-6">
        <DialogTitle>{step === "setup" ? "Connect an ESP32" : device ? `Connect ${device.name}` : "Connect an ESP32"}</DialogTitle>
        <DialogDescription className="mt-1">
          {step === "setup"
            ? "The device joins your Wi-Fi and sends its probe readings here. First, which farm is it on?"
            : "Put this code into the device's setup page. This window updates by itself when it connects."}
        </DialogDescription>

        {step === "setup" ? (
          <form onSubmit={create} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor={`${id}-farm`} className="block text-sm font-medium">
                Farm
              </label>
              <Select value={farmId} onValueChange={setFarmId}>
                <SelectTrigger id={`${id}-farm`} className="h-8 w-full">
                  <SelectValue placeholder="Choose a farm" />
                </SelectTrigger>
                <SelectContent>
                  {farms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-name`} className="block text-sm font-medium">
                Device name
              </label>
              <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. East block probe" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-interval`} className="block text-sm font-medium">
                Send a reading every
              </label>
              <Select value={String(interval)} onValueChange={(v) => setIntervalValue(Number(v))}>
                <SelectTrigger id={`${id}-interval`} className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS_S.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {intervalLabel(s)}
                      {s === DEFAULT_INTERVAL_S ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">You can change this any time; the device picks it up with its next reading.</p>
            </div>
            {error ? (
              <p role="alert" className="rounded-lg bg-risk-high-soft px-3 py-2 text-sm text-risk-high-ink">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !farmId}>
                {busy ? "Creating…" : "Next: pair the device"}
              </Button>
            </div>
          </form>
        ) : device ? (
          <div className="mt-4 space-y-5">
            <PairStatus device={device} now={now} />

            {!receiving ? (
              <>
                <div className="rounded-xl border bg-accent/40 p-4 text-center">
                  <p className="text-sm text-muted-foreground">Pairing code</p>
                  {codeValid ? (
                    <>
                      <p className="mt-1 font-mono text-[1.75rem] font-bold tracking-[0.2em] tabular" aria-label={`Pairing code ${device.pairing_code?.split("").join(" ")}`}>
                        {formatPairingCode(device.pairing_code!)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Valid for {Math.max(1, Math.ceil((expiresIn ?? 0) / 60_000))} more min · single use
                      </p>
                    </>
                  ) : (
                    <div className="mt-2 space-y-2">
                      <p className="text-sm">{device.paired_at ? "The device used its code." : "This code has expired."}</p>
                      {!device.paired_at ? (
                        <Button size="sm" onClick={renewCode} disabled={busy}>
                          New pairing code
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>

                <ol className="space-y-3 text-sm">
                  <li className="flex gap-3">
                    <StepNo n={1} />
                    <div>
                      Flash the Yield AI firmware onto the ESP32 (<code className="text-xs">firmware/esp32/yield-ai-probe</code> in this project) and power it on.
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <StepNo n={2} />
                    <div>
                      On your phone, join the Wi-Fi network <strong>YieldAI-Setup-…</strong> the device opens. Its setup page appears (or open <code className="text-xs">http://192.168.4.1</code>).
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <StepNo n={3} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <p>Choose your farm&apos;s Wi-Fi and enter its password, then this server address and the pairing code:</p>
                      <CopyField value={serverUrl} label="Server address" />
                      {local ? (
                        <p className="flex gap-2 text-xs text-risk-medium-ink">
                          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          {lanUrls.length
                            ? `You opened the dashboard on localhost, which the ESP32 can't reach. Use this computer's Wi-Fi address above (the device must be on the same network${lanUrls.length > 1 ? `; other addresses: ${lanUrls.slice(1).join(", ")}` : ""}).`
                            : "You opened the dashboard on localhost, which the ESP32 can't reach. Use this computer's address on your Wi-Fi (e.g. http://192.168.1.20:3000), or deploy the site."}
                        </p>
                      ) : null}
                    </div>
                  </li>
                </ol>

                {token ? (
                  <details className="rounded-lg border px-3 py-2 text-sm">
                    <summary className="cursor-pointer font-medium">No setup page? Use a token instead</summary>
                    <div className="mt-2 space-y-2 text-muted-foreground">
                      <p>
                        Put this token in your own firmware and send readings as JSON with <code className="text-xs">Authorization: Bearer &lt;token&gt;</code>. It&apos;s
                        shown only once, and pairing with the code above replaces it.
                      </p>
                      <CopyField value={token} label="Device token" />
                      <p>Test it from a computer:</p>
                      <CopyField
                        multiline
                        label="Test command"
                        value={`curl -X POST ${serverUrl}/api/readings -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${exampleBody}'`}
                      />
                    </div>
                  </details>
                ) : null}
              </>
            ) : null}

            {error ? (
              <p role="alert" className="rounded-lg bg-risk-high-soft px-3 py-2 text-sm text-risk-high-ink">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant={receiving ? "default" : "ghost"} onClick={() => onOpenChange(false)}>
                {receiving ? "Done" : "Finish later"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StepNo({ n }: { n: number }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary tabular" aria-hidden="true">
      {n}
    </span>
  );
}

/** Waiting → paired → receiving, as the device gets there. */
function PairStatus({ device, now }: { device: Device; now: number }) {
  const steps = [
    { done: true, label: "Device created", detail: `${device.sensor_id} · every ${intervalLabel(device.interval_s)}` },
    {
      done: Boolean(device.paired_at),
      label: device.paired_at ? "Joined Wi-Fi and paired" : "Waiting for the device to pair…",
      detail: device.paired_at ? [device.local_ip, device.firmware].filter(Boolean).join(" · ") || null : null,
    },
    {
      done: Boolean(device.last_seen_at),
      label: device.last_seen_at ? "Receiving readings" : device.paired_at ? "Waiting for the first reading…" : "First reading",
      detail: device.last_seen_at
        ? `${device.readings_count} reading${device.readings_count === 1 ? "" : "s"} · last ${formatTime(device.last_seen_at)} (${relativeTime(device.last_seen_at, now)})${device.rssi != null ? ` · Wi-Fi ${device.rssi} dBm` : ""}`
        : null,
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="space-y-2" aria-live="polite">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3">
          {s.done ? (
            <CircleCheck className="mt-0.5 size-5 shrink-0 text-risk-low" aria-hidden="true" />
          ) : i === current ? (
            <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Wifi className="mt-0.5 size-5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className={cn("text-sm font-medium", !s.done && i !== current && "text-muted-foreground")}>{s.label}</p>
            {s.detail ? <p className="text-xs text-muted-foreground">{s.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

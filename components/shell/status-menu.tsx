"use client";

import { CloudOff, CloudSun, Database, Radio } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useShell, type ShellStatus } from "@/components/shell/shell-context";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { LiveStatus } from "@/hooks/use-live-updates";
import { INTERVAL_OPTIONS_S, intervalLabel } from "@/lib/account/types";
import { formatTimeSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";

const LIVE_TEXT: Record<LiveStatus, string> = {
  off: "Off",
  connecting: "Connecting…",
  live: "Receiving readings",
  retrying: "Reconnecting…",
  "signed-out": "Sign in again for live data",
};

function Row({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function sourceLabelOf(status: ShellStatus): string {
  if (status.source === "account") return status.account?.error ? "Data unavailable" : "Your farms";
  if (status.source === "supabase") return "Demo data";
  return status.sourceNote ? "Demo data (Supabase offline)" : "Demo data";
}

function dataText(status: ShellStatus): React.ReactNode {
  if (status.source === "account") {
    if (status.account?.error) return `Your readings can't be loaded right now: ${status.account.error}`;
    const n = status.account?.devices ?? 0;
    return n ? (
      `Readings from your ${n === 1 ? "ESP32 device" : `${n} ESP32 devices`}, sent over Wi-Fi.`
    ) : (
      <>
        No devices yet.{" "}
        <Link href="/dashboard/devices" className="font-medium text-primary underline-offset-2 hover:underline">
          Connect an ESP32
        </Link>{" "}
        to start receiving readings.
      </>
    );
  }
  if (status.source === "supabase") return "Demo farms stored in the Supabase database.";
  return status.sourceNote
    ? "Supabase can't be reached, so the built-in demo data is shown. Everything keeps working."
    : "Built-in demo data: 8 farms in northern Qatar with 60 days of probe readings.";
}

/**
 * One neutral status dot for the whole app: data source, weather and live mode. Grey when all is
 * well, amber only when data is degraded, pulsing green while live readings stream in.
 */
export function StatusMenu() {
  const { status, live, setLive, liveStatus, lastEvent, intervalS, setIntervalS } = useShell();
  const switchId = useId();
  const intervalId = useId();
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const degraded = Boolean(status.sourceNote) || status.weatherOffline || Boolean(status.account?.error);
  const streaming = live && liveStatus === "live";
  const sourceLabel = sourceLabelOf(status);
  const hasDevices = (status.account?.devices ?? 0) > 0;
  const summary = streaming ? "Live" : degraded ? "Data degraded" : sourceLabel;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full px-3 text-sm sm:h-10 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          aria-label={`Data status: ${summary}`}
        >
          <span className="relative flex size-2.5 items-center justify-center" aria-hidden="true">
            {streaming ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-risk-low opacity-60" /> : null}
            <span
              className={cn(
                "relative inline-flex size-2 rounded-full",
                streaming ? "bg-risk-low" : degraded ? "bg-risk-medium" : "bg-muted-foreground/50",
              )}
            />
          </span>
          <span className={cn("hidden md:inline", streaming && "font-medium text-foreground")}>{streaming ? "Live" : sourceLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 divide-y p-4">
        <Row icon={<Database />} title="Data">
          {dataText(status)}
        </Row>
        <Row icon={status.weatherOffline ? <CloudOff /> : <CloudSun />} title="Weather">
          {status.weatherOffline
            ? "Open-Meteo can't be reached. ET₀ is estimated from air temperature (FAO-56 Hargreaves) and the weather charts are paused."
            : "Open-Meteo: past 60 days, a 7-day forecast, and an hourly forecast for the next 12 hours, refreshed at 00:00 and 12:00 Qatar time."}
        </Row>
        <div className="flex gap-3 pt-3">
          <span className="mt-0.5 text-muted-foreground [&_svg]:size-4" aria-hidden="true">
            <Radio />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <label htmlFor={switchId} className="flex-1 text-sm font-semibold">
                Live updates
              </label>
              <Switch id={switchId} checked={live} onCheckedChange={setLive} aria-describedby={`${switchId}-text`} />
            </div>
            <p id={`${switchId}-text`} className="text-sm text-muted-foreground" aria-live="polite">
              {live
                ? lastEvent
                  ? `${lastEvent.farmName} · ${lastEvent.probes} probe${lastEvent.probes === 1 ? "" : "s"} · ${formatTimeSeconds(lastEvent.at)}${lastEvent.simulated ? " · demo feed" : ""}`
                  : LIVE_TEXT[liveStatus]
                : `Show new probe readings as they arrive, every ${intervalLabel(intervalS)}.`}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor={intervalId} className="flex-1 text-sm">
                Update every
              </label>
              <Select
                value={String(intervalS)}
                disabled={saving}
                onValueChange={(v) => {
                  setIntervalError(null);
                  startSaving(async () => {
                    setIntervalError(await setIntervalS(Number(v)));
                  });
                }}
              >
                <SelectTrigger id={intervalId} size="sm" className="w-32" aria-describedby={`${intervalId}-text`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...INTERVAL_OPTIONS_S, intervalS])].sort((a, b) => a - b).map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {intervalLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p id={`${intervalId}-text`} className={cn("mt-1 text-xs", intervalError ? "text-risk-high-ink" : "text-muted-foreground")} aria-live="polite">
              {intervalError ?? (saving ? "Saving…" : hasDevices ? "Your devices send readings at this rate from their next report." : "How often the dashboard checks for new readings.")}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

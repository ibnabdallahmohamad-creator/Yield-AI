"use client";

import { Cpu, Plus } from "lucide-react";
import Link from "next/link";
import { DeviceStateChip, LastReading, SignalBars } from "@/components/setup/device-panel";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { deviceState } from "@/lib/devices";
import { formatInterval, relativeTime } from "@/lib/format";
import type { Device } from "@/lib/types";

/** The farm's ESP32s: connection state, signal and the latest values each one sent. */
export function DeviceStrip({ devices, intervalS, farmId }: { devices: Device[]; intervalS: number; farmId: string }) {
  const now = useNow();
  if (devices.length === 0) {
    return (
      <section aria-label="Devices" className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed bg-card/60 px-4 py-3">
        <Cpu className="size-5 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
          No ESP32 on this farm yet — connect one to receive its soil readings over Wi-Fi every {formatInterval(intervalS)}.
        </p>
        <Button asChild size="sm">
          <Link href={`/dashboard/setup#farm-${encodeURIComponent(farmId)}`}>
            <Plus /> Connect an ESP32
          </Link>
        </Button>
      </section>
    );
  }
  return (
    <section aria-label="Devices" className="grid gap-2 md:grid-cols-2">
      {devices.map((d) => {
        const state = now ? deviceState(d, intervalS, now) : d.last_seen_at ? "offline" : "never";
        return (
          <div key={d.id} className="space-y-2 rounded-xl border bg-card px-3.5 py-2.5 shadow-xs">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <p className="min-w-0 truncate text-[13.5px] font-semibold">
                {d.name} <span className="font-mono text-[12px] font-normal text-muted-foreground">{d.sensor_id}</span>
              </p>
              <DeviceStateChip state={state} />
              <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <SignalBars rssi={d.rssi} />
                {d.last_seen_at && now ? relativeTime(d.last_seen_at, now) : "never seen"}
              </span>
            </div>
            {d.last_error && state !== "never" ? <p className="text-[12px] text-risk-medium-ink">Device reports: {d.last_error}</p> : null}
            {d.last_reading ? (
              <LastReading device={d} />
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                {state === "never" ? (
                  <>
                    Waiting for its first reading — <Link className="font-medium text-primary underline-offset-2 hover:underline" href="/dashboard/setup">connection guide</Link>.
                  </>
                ) : (
                  "Checked in, no measurement yet."
                )}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}

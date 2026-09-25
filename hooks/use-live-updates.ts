"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { LiveUpdate } from "@/lib/types";

/** Default reading interval (seconds): what a new account's ESP32s and dashboard use. */
export const DEFAULT_INTERVAL_S = 10;

export type LiveStatus = "off" | "connecting" | "live" | "retrying" | "signed-out";

/**
 * Polls GET /api/live every `intervalS` seconds while enabled and hands each update to `onUpdate`.
 * Requests never overlap (the next poll is scheduled after the previous one settles), and a
 * hidden tab is polled at most once a minute.
 */
export function useLiveUpdates(enabled: boolean, intervalS: number, onUpdate: (update: LiveUpdate) => void): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>(enabled ? "connecting" : "off");
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    setStatus(enabled ? "connecting" : "off");
  }
  const handle = useEffectEvent(onUpdate);

  useEffect(() => {
    if (!enabled) return;
    const delay = () => Math.max(2, intervalS) * 1000 * (document.visibilityState === "hidden" ? Math.max(1, 60 / intervalS) : 1);
    let cursor: string | null = null;
    let timer: number | undefined;
    let stopped = false;
    let inFlight = false;

    const poll = async () => {
      inFlight = true;
      try {
        const res = await fetch(`/api/live${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
        if (stopped) return;
        if (res.status === 401) {
          setStatus("signed-out");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const update = (await res.json()) as LiveUpdate;
        if (stopped) return;
        cursor = update.cursor;
        setStatus("live");
        handle(update);
      } catch {
        if (stopped) return;
        setStatus("retrying");
      } finally {
        inFlight = false;
      }
      if (!stopped) timer = window.setTimeout(poll, delay());
    };
    void poll();

    // Coming back to the tab: poll right away instead of waiting out the slow hidden-tab delay.
    const onVisible = () => {
      if (document.visibilityState !== "visible" || stopped || inFlight) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(poll, 0);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalS]);

  return status;
}

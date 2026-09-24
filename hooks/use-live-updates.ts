"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { LiveUpdate } from "@/lib/types";

/** Live mode poll interval (the brief: every 5 s). */
export const LIVE_POLL_MS = 5000;

export type LiveStatus = "off" | "connecting" | "live" | "retrying" | "signed-out";

/**
 * Polls GET /api/live every 5 s while enabled and hands each update to `onUpdate`.
 * Requests never overlap (the next poll is scheduled after the previous one settles).
 */
export function useLiveUpdates(enabled: boolean, onUpdate: (update: LiveUpdate) => void): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>(enabled ? "connecting" : "off");
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    setStatus(enabled ? "connecting" : "off");
  }
  const handle = useEffectEvent(onUpdate);

  useEffect(() => {
    if (!enabled) return;
    let cursor: string | null = null;
    let timer: number | undefined;
    let stopped = false;

    const poll = async () => {
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
      }
      if (!stopped) timer = window.setTimeout(poll, LIVE_POLL_MS);
    };
    void poll();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [enabled]);

  return status;
}

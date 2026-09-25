"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { DEFAULT_INTERVAL_S } from "@/lib/account/types";
import type { LiveUpdate } from "@/lib/types";

/** Default live poll interval: every 10 s, the ESP32's default reporting interval. */
export const LIVE_POLL_MS = DEFAULT_INTERVAL_S * 1000;

export type LiveStatus = "off" | "connecting" | "live" | "retrying" | "signed-out";

/**
 * Polls GET /api/live every `intervalMs` while enabled and hands each update to `onUpdate`.
 * Requests never overlap (the next poll is scheduled after the previous one settles). Changing the
 * interval reschedules the next poll without losing the cursor, so no readings are skipped.
 */
export function useLiveUpdates(enabled: boolean, onUpdate: (update: LiveUpdate) => void, intervalMs: number = LIVE_POLL_MS): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>(enabled ? "connecting" : "off");
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    setStatus(enabled ? "connecting" : "off");
  }
  const handle = useEffectEvent(onUpdate);
  const cursor = useRef<string | null>(null);
  const lastPoll = useRef(0);

  useEffect(() => {
    if (!enabled) {
      cursor.current = null;
      lastPoll.current = 0;
      return;
    }
    const every = Math.max(1000, intervalMs);
    let timer: number | undefined;
    let stopped = false;

    const poll = async () => {
      lastPoll.current = Date.now();
      try {
        const c = cursor.current;
        const res = await fetch(`/api/live${c ? `?cursor=${encodeURIComponent(c)}` : ""}`, { cache: "no-store" });
        if (stopped) return;
        if (res.status === 401) {
          setStatus("signed-out");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const update = (await res.json()) as LiveUpdate;
        if (stopped) return;
        cursor.current = update.cursor;
        setStatus("live");
        handle(update);
      } catch {
        if (stopped) return;
        setStatus("retrying");
      }
      if (!stopped) timer = window.setTimeout(poll, every);
    };
    // First poll right away; after an interval change, keep the rhythm of the previous polls.
    const due = lastPoll.current ? Math.max(0, lastPoll.current + every - Date.now()) : 0;
    timer = window.setTimeout(poll, due);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [enabled, intervalMs]);

  return status;
}

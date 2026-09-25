"use client";

import { useCallback, useEffect, useState } from "react";
import { decodeGrid, type WeatherField } from "@/lib/weather/field";
import type { WeatherGridPayload } from "@/lib/weather/spec";

/** Refetch after this long (the server refreshes every 12 hours; the hour window moves every hour). */
const MAX_AGE_MS = 15 * 60_000;

let cache: { at: number; promise: Promise<WeatherField> } | null = null;

async function load(): Promise<WeatherField> {
  const res = await fetch("/api/weather/grid", { credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The weather map couldn't be loaded (HTTP ${res.status}).`);
  }
  return decodeGrid((await res.json()) as WeatherGridPayload);
}

function getField(force = false): Promise<WeatherField> {
  if (!force && cache && Date.now() - cache.at < MAX_AGE_MS) return cache.promise;
  const promise = load();
  cache = { at: Date.now(), promise };
  // A failure isn't cached: the next mount (or Retry) tries again.
  promise.catch(() => {
    if (cache?.promise === promise) cache = null;
  });
  return promise;
}

/** The weather grid, fetched once and shared by every weather map on the page. */
export function useWeatherGrid(enabled = true): { field: WeatherField | null; error: string | null; retry: () => void } {
  const [state, setState] = useState<{ field: WeatherField | null; error: string | null }>({ field: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getField(attempt > 0).then(
      (field) => alive && setState({ field, error: null }),
      (error: unknown) => alive && setState({ field: null, error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      alive = false;
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    setState({ field: null, error: null });
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, retry };
}

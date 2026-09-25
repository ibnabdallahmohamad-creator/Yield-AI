"use client";

import { useCallback, useEffect, useState } from "react";
import type { WeatherResponse } from "@/lib/weather/types";

/**
 * The account's 12-hourly forecast (GET /api/weather), shared by every weather tab and loaded
 * once per page. It is fetched again when the next 12-hourly update is due.
 */
const cache = new Map<string, { data: WeatherResponse; at: number }>();
const inflight = new Map<string, Promise<WeatherResponse>>();

async function load(key: string, force: boolean): Promise<WeatherResponse> {
  const running = inflight.get(key);
  if (running && !force) return running;
  const task = fetch("/api/weather", { cache: "no-store" })
    .then(async (res) => {
      if (res.status === 401) return { forecast: null, error: "Sign in again to see the forecast." };
      const body = (await res.json().catch(() => null)) as WeatherResponse | null;
      if (!res.ok || !body) return { forecast: null, error: "The forecast is unavailable right now." };
      return body;
    })
    .catch(() => ({ forecast: null, error: "Couldn't reach the server for the forecast." }))
    .then((data) => {
      cache.set(key, { data, at: Date.now() });
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

export function useForecast(userKey: string, enabled = true) {
  const [state, setState] = useState<{ key: string; data: WeatherResponse | null }>(() => ({
    key: userKey,
    data: cache.get(userKey)?.data ?? null,
  }));
  const [loading, setLoading] = useState(false);
  const data = state.key === userKey ? state.data : (cache.get(userKey)?.data ?? null);

  const reload = useCallback(
    async (force = true) => {
      setLoading(true);
      const next = await load(userKey, force);
      setState({ key: userKey, data: next });
      setLoading(false);
    },
    [userKey],
  );

  // First load (or a different account).
  useEffect(() => {
    if (!enabled || cache.has(userKey)) return;
    let cancelled = false;
    void load(userKey, false).then((next) => {
      if (!cancelled) setState({ key: userKey, data: next });
    });
    return () => {
      cancelled = true;
    };
  }, [userKey, enabled]);

  // The next 12-hourly update: fetch again once it is due (plus a minute for the server to refresh).
  const nextUpdate = data?.forecast?.nextUpdate;
  const failed = Boolean(data && !data.forecast);
  useEffect(() => {
    if (!enabled) return;
    const due = nextUpdate ? Date.parse(nextUpdate) + 60_000 - Date.now() : failed ? 5 * 60_000 : null;
    if (due == null) return;
    const id = window.setTimeout(() => void reload(true), Math.max(30_000, Math.min(due, 2 ** 31 - 1)));
    return () => window.clearTimeout(id);
  }, [nextUpdate, failed, enabled, reload]);

  return { data, loading: loading || (enabled && !data), reload };
}

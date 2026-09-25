/**
 * The 12-hourly weather forecast: hourly temperature, humidity, rain, wind (and more) for every
 * farm and a grid around them, for the next 24 hours. Fetched from Open-Meteo at most every
 * 12 hours per set of farms and cached in the shared store, so every server instance serves the
 * same forecast. Refreshed on demand (when a cached forecast is 12 hours old), on a 12-hour
 * timer in long-running servers (instrumentation.ts), and by GET /api/cron/weather.
 *
 * If Open-Meteo cannot be reached the last forecast is served, marked stale — never made up.
 */
import "server-only";
import { createHash } from "node:crypto";
import { getMockState } from "../data/mock-store";
import { deviceStores, sharedStore } from "../store";
import type { Farm } from "../types";
import { forecastUrl, gridLayout, parseForecastResponse } from "./open-meteo";
import type { ForecastBundle, WeatherResponse } from "./types";

export const FORECAST_TTL_MS = 12 * 3_600_000;
const TIMEOUT_MS = 15_000;
const MAX_FARMS = 40;

export type FarmPoint = Pick<Farm, "id" | "name" | "lat" | "lng">;

const baseUrl = () => process.env.OPEN_METEO_BASE_URL?.trim() || "https://api.open-meteo.com";
const disabled = () => process.env.OPEN_METEO_DISABLED === "true";

const memory = globalThis as unknown as {
  __yieldForecasts?: Map<string, ForecastBundle>;
  __yieldForecastInflight?: Map<string, Promise<WeatherResponse>>;
};

function points(farms: FarmPoint[]): FarmPoint[] {
  return [...farms].sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_FARMS);
}

/** Same farms (and positions) → same key, whoever asks. */
export function forecastKey(farms: FarmPoint[]): string {
  const sig = points(farms)
    .map((f) => `${f.id}@${f.lat.toFixed(3)},${f.lng.toFixed(3)}`)
    .join(";");
  return `forecast:v1:${createHash("sha1").update(sig).digest("hex").slice(0, 20)}`;
}

function bounds(farms: FarmPoint[]) {
  if (farms.length === 0) return null;
  return {
    minLat: Math.min(...farms.map((f) => f.lat)),
    maxLat: Math.max(...farms.map((f) => f.lat)),
    minLng: Math.min(...farms.map((f) => f.lng)),
    maxLng: Math.max(...farms.map((f) => f.lng)),
  };
}

function isBundle(value: unknown): value is ForecastBundle {
  const v = value as ForecastBundle | null;
  return Boolean(v && typeof v.fetchedAt === "string" && Array.isArray(v.points));
}

async function readCache(key: string): Promise<ForecastBundle | null> {
  const mem = memory.__yieldForecasts?.get(key);
  if (mem) return mem;
  try {
    const cached = await sharedStore().getCached(key);
    if (cached && isBundle(cached.payload)) {
      (memory.__yieldForecasts ??= new Map()).set(key, cached.payload);
      return cached.payload;
    }
  } catch (error) {
    console.warn("[weather] Forecast cache unavailable:", error instanceof Error ? error.message : error);
  }
  return null;
}

async function writeCache(key: string, bundle: ForecastBundle): Promise<void> {
  (memory.__yieldForecasts ??= new Map()).set(key, bundle);
  try {
    await sharedStore().putCached(key, { fetched_at: bundle.fetchedAt, payload: bundle });
  } catch (error) {
    console.warn("[weather] Could not cache the forecast:", error instanceof Error ? error.message : error);
  }
}

async function fetchForecast(farms: FarmPoint[], now: number): Promise<ForecastBundle> {
  const layout = gridLayout(bounds(farms));
  const locations = [...farms.map((f) => ({ lat: f.lat, lng: f.lng })), ...layout.lats.flatMap((lat) => layout.lngs.map((lng) => ({ lat, lng })))];
  const res = await fetch(forecastUrl(baseUrl(), locations), { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const { points: farmPoints, grid } = parseForecastResponse(await res.json(), farms, layout, now);
  if (farmPoints.length === 0 && !grid) throw new Error("Open-Meteo returned no hourly data");
  return {
    fetchedAt: new Date(now).toISOString(),
    nextUpdate: new Date(now + FORECAST_TTL_MS).toISOString(),
    source: "open-meteo",
    points: farmPoints,
    grid,
    stale: false,
  };
}

/**
 * The forecast for a set of farms: cached for 12 hours, then fetched again.
 * `maxAgeMs` lets the scheduler refresh a little early so runs never drift past 12 hours.
 */
export async function getForecast(
  farmList: FarmPoint[],
  { maxAgeMs = FORECAST_TTL_MS, now = Date.now() }: { maxAgeMs?: number; now?: number } = {},
): Promise<WeatherResponse> {
  if (disabled()) return { forecast: null, error: "Weather lookups are turned off on this server (OPEN_METEO_DISABLED)." };
  const farms = points(farmList);
  const key = forecastKey(farms);
  const cached = await readCache(key);
  if (cached && now - Date.parse(cached.fetchedAt) < maxAgeMs) return { forecast: cached, error: null };

  const inflight = (memory.__yieldForecastInflight ??= new Map());
  const running = inflight.get(key);
  if (running) return running;
  const task = (async (): Promise<WeatherResponse> => {
    try {
      const bundle = await fetchForecast(farms, now);
      await writeCache(key, bundle);
      return { forecast: bundle, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[weather] Forecast refresh failed:", message);
      if (cached) {
        return {
          forecast: { ...cached, stale: now - Date.parse(cached.fetchedAt) >= FORECAST_TTL_MS },
          error: "Open-Meteo can't be reached — showing the last forecast.",
        };
      }
      return { forecast: null, error: "The weather forecast is unavailable right now (Open-Meteo can't be reached)." };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

/** Every set of farms that needs a forecast: the demo farms and each account's farms. */
async function farmGroups(): Promise<FarmPoint[][]> {
  const groups: FarmPoint[][] = [getMockState().farms];
  for (const store of deviceStores()) {
    try {
      const byOwner = new Map<string, FarmPoint[]>();
      for (const farm of await store.listAllFarms()) {
        if (!farm.owner_id) continue;
        byOwner.set(farm.owner_id, [...(byOwner.get(farm.owner_id) ?? []), farm]);
      }
      groups.push(...byOwner.values());
    } catch (error) {
      console.warn(`[weather] Could not list ${store.kind} farms:`, error instanceof Error ? error.message : error);
    }
  }
  return groups;
}

/** Refresh every forecast that is due (the 12-hourly job). */
export async function refreshAllForecasts(): Promise<{ ok: number; failed: number; total: number }> {
  const groups = await farmGroups();
  let ok = 0;
  let failed = 0;
  // Refresh a quarter of an hour early so a 12-hour schedule never finds the forecast just short of due.
  for (const farms of groups) {
    const result = await getForecast(farms, { maxAgeMs: FORECAST_TTL_MS - 15 * 60_000 });
    if (result.error) failed++;
    else ok++;
  }
  return { ok, failed, total: groups.length };
}

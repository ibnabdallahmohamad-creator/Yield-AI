/**
 * The next 12 hours of weather at each farm: air temperature, humidity, rain (amount and chance) and
 * wind (speed, gusts, direction), hour by hour from Open-Meteo (free, no key).
 *
 * The forecast is downloaded every 12 hours, on a fixed schedule at 00:00 and 12:00 Asia/Qatar, for
 * the next 36 hours; between downloads the app shows the 12 hours starting at the current hour from
 * that copy. Downloads are cached in memory and in `.data/weather/forecast.json`, so a restart in the
 * same half-day does not download again. If a download fails the previous forecast is kept (marked
 * stale) and the download is retried every 10 minutes. Never throws.
 *
 * Refreshing happens on first use in each half-day, from instrumentation.ts on long-running servers,
 * and from GET /api/cron/weather for hosts with scheduled jobs.
 */
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dataRoot, writeAtomic } from "../storage/files";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const HOURLY_VARS = [
  "temperature_2m",
  "relative_humidity_2m",
  "dew_point_2m",
  "precipitation",
  "precipitation_probability",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
  "weather_code",
  "cloud_cover",
].join(",");
export const REFRESH_EVERY_MS = 12 * 3_600_000;
const QATAR_OFFSET_MS = 3 * 3_600_000;
/** Hours downloaded each time: enough to show 12 hours ahead until the next download and a bit more. */
const DOWNLOAD_HOURS = 36;
export const SHOW_HOURS = 12;
const RETRY_AFTER_MS = 10 * 60_000;
const TIMEOUT_MS = 10_000;
/** Locations nobody asked about for a week are no longer refreshed in the background. */
const TRACK_FOR_MS = 7 * 24 * 3_600_000;

export interface HourlyPoint {
  /** Start of the hour, ISO (UTC). */
  time: string;
  temp_c: number | null;
  humidity_pct: number | null;
  dew_point_c: number | null;
  precip_mm: number | null;
  precip_prob_pct: number | null;
  /** Mean wind at 10 m, m/s. */
  wind_ms: number | null;
  gust_ms: number | null;
  /** Direction the wind blows from, degrees clockwise from north. */
  wind_dir_deg: number | null;
  /** WMO weather code. */
  weather_code: number | null;
  cloud_pct: number | null;
}

export interface ForecastSummary {
  temp_min_c: number | null;
  temp_max_c: number | null;
  temp_max_at: string | null;
  humidity_min_pct: number | null;
  humidity_max_pct: number | null;
  rain_total_mm: number;
  /** Hours with at least 0.1 mm of rain forecast. */
  rain_hours: number;
  rain_max_prob_pct: number | null;
  wind_max_ms: number | null;
  gust_max_ms: number | null;
  gust_max_at: string | null;
  /** Mean direction (vector average) the wind comes from, degrees. */
  wind_dir_deg: number | null;
}

export interface HourlyForecast {
  source: "open-meteo";
  lat: number;
  lng: number;
  /** When this forecast was downloaded. */
  fetched_at: string;
  /** The next scheduled download (00:00 or 12:00 Asia/Qatar). */
  next_refresh_at: string;
  /** True when the last download failed and this is the previous forecast. */
  stale: boolean;
  /** The 12 hours from the current hour on. */
  hours: HourlyPoint[];
  summary: ForecastSummary;
}

interface Entry {
  lat: number;
  lng: number;
  /** Start of the half-day slot the download belongs to (ms). */
  slot: number;
  fetchedAt: number;
  hours: HourlyPoint[];
  lastAttempt: number;
  failed: boolean;
  lastRequested: number;
}

interface Shared {
  entries: Map<string, Entry>;
  loaded: Promise<void> | null;
  inflight: Map<string, Promise<void>>;
}

const g = globalThis as typeof globalThis & { __yieldForecast?: Shared };
const shared: Shared = (g.__yieldForecast ??= { entries: new Map(), loaded: null, inflight: new Map() });

export function resetForecastCache(): void {
  shared.entries.clear();
  shared.loaded = null;
  shared.inflight.clear();
}

/** Start of the current 12-hour slot: 00:00 or 12:00 in Qatar (21:00 or 09:00 UTC). */
export function slotStart(now: number): number {
  return Math.floor((now + QATAR_OFFSET_MS) / REFRESH_EVERY_MS) * REFRESH_EVERY_MS - QATAR_OFFSET_MS;
}

export const nextRefreshAt = (now: number) => slotStart(now) + REFRESH_EVERY_MS;

const keyOf = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

const cacheFile = () => path.join(dataRoot(), "weather", "forecast.json");

function disabled(): boolean {
  return process.env.OPEN_METEO_DISABLED === "true";
}

async function loadFromDisk(): Promise<void> {
  shared.loaded ??= (async () => {
    try {
      const parsed = JSON.parse(await readFile(cacheFile(), "utf8")) as { entries?: Entry[] };
      for (const e of parsed.entries ?? []) {
        if (typeof e?.lat !== "number" || !Array.isArray(e.hours)) continue;
        const key = keyOf(e.lat, e.lng);
        if (!shared.entries.has(key)) shared.entries.set(key, { ...e, lastAttempt: 0 });
      }
    } catch {
      // No cache yet (or unreadable): the next request downloads.
    }
  })();
  return shared.loaded;
}

async function saveToDisk(): Promise<void> {
  try {
    await writeAtomic(cacheFile(), JSON.stringify({ entries: [...shared.entries.values()] }));
  } catch {
    // Read-only hosts keep the forecast in memory only.
  }
}

interface OpenMeteoHourly {
  time: number[];
  temperature_2m?: Array<number | null>;
  relative_humidity_2m?: Array<number | null>;
  dew_point_2m?: Array<number | null>;
  precipitation?: Array<number | null>;
  precipitation_probability?: Array<number | null>;
  wind_speed_10m?: Array<number | null>;
  wind_gusts_10m?: Array<number | null>;
  wind_direction_10m?: Array<number | null>;
  weather_code?: Array<number | null>;
  cloud_cover?: Array<number | null>;
}

const val = (a: Array<number | null> | undefined, i: number) => {
  const v = a?.[i];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

export function parseHourly(hourly: OpenMeteoHourly): HourlyPoint[] {
  return (hourly.time ?? []).map((t, i) => ({
    time: new Date(t * 1000).toISOString(),
    temp_c: val(hourly.temperature_2m, i),
    humidity_pct: val(hourly.relative_humidity_2m, i),
    dew_point_c: val(hourly.dew_point_2m, i),
    precip_mm: val(hourly.precipitation, i),
    precip_prob_pct: val(hourly.precipitation_probability, i),
    wind_ms: val(hourly.wind_speed_10m, i),
    gust_ms: val(hourly.wind_gusts_10m, i),
    wind_dir_deg: val(hourly.wind_direction_10m, i),
    weather_code: val(hourly.weather_code, i),
    cloud_pct: val(hourly.cloud_cover, i),
  }));
}

/** Download the forecast for these locations (one request) into the cache. */
async function download(locations: Array<{ lat: number; lng: number }>, now: number): Promise<void> {
  const params = new URLSearchParams({
    latitude: locations.map((l) => l.lat.toFixed(4)).join(","),
    longitude: locations.map((l) => l.lng.toFixed(4)).join(","),
    hourly: HOURLY_VARS,
    forecast_hours: String(DOWNLOAD_HOURS),
    past_hours: "1",
    timeformat: "unixtime",
    timezone: "GMT",
    wind_speed_unit: "ms",
  });
  for (const l of locations) {
    const e = shared.entries.get(keyOf(l.lat, l.lng));
    if (e) e.lastAttempt = now;
  }
  try {
    const res = await fetch(`${OPEN_METEO_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    const list = (Array.isArray(json) ? json : [json]) as Array<{ hourly?: OpenMeteoHourly }>;
    locations.forEach((l, i) => {
      const hourly = list[i]?.hourly;
      const key = keyOf(l.lat, l.lng);
      const prev = shared.entries.get(key);
      if (!hourly?.time?.length) {
        if (prev) prev.failed = true;
        return;
      }
      shared.entries.set(key, {
        lat: l.lat,
        lng: l.lng,
        slot: slotStart(now),
        fetchedAt: now,
        hours: parseHourly(hourly),
        lastAttempt: now,
        failed: false,
        lastRequested: prev?.lastRequested ?? now,
      });
    });
    await saveToDisk();
  } catch (error) {
    console.warn("[forecast] Open-Meteo hourly forecast unavailable:", error instanceof Error ? error.message : error);
    for (const l of locations) {
      const key = keyOf(l.lat, l.lng);
      const prev = shared.entries.get(key);
      if (prev) prev.failed = true;
      else
        shared.entries.set(key, { lat: l.lat, lng: l.lng, slot: 0, fetchedAt: 0, hours: [], lastAttempt: now, failed: true, lastRequested: now });
    }
  }
}

/** Download whatever is missing or from an earlier half-day (retrying failures after 10 minutes). */
async function ensureFresh(locations: Array<{ lat: number; lng: number }>, now: number): Promise<void> {
  const due = locations.filter((l) => {
    const e = shared.entries.get(keyOf(l.lat, l.lng));
    if (!e || e.hours.length === 0) return !e || now - e.lastAttempt >= RETRY_AFTER_MS;
    if (e.slot >= slotStart(now)) return false;
    return now - e.lastAttempt >= RETRY_AFTER_MS || e.lastAttempt < slotStart(now);
  });
  if (due.length === 0) return;
  const unique = [...new Map(due.map((l) => [keyOf(l.lat, l.lng), l])).values()];
  const batchKey = unique.map((l) => keyOf(l.lat, l.lng)).join(";");
  let job = shared.inflight.get(batchKey);
  if (!job) {
    job = download(unique, now).finally(() => shared.inflight.delete(batchKey));
    shared.inflight.set(batchKey, job);
  }
  await job;
}

export function summarize(hours: HourlyPoint[]): ForecastSummary {
  const nums = (pick: (h: HourlyPoint) => number | null) => hours.map(pick).filter((v): v is number => v != null);
  const temps = nums((h) => h.temp_c);
  const hum = nums((h) => h.humidity_pct);
  const winds = nums((h) => h.wind_ms);
  const gusts = nums((h) => h.gust_ms);
  const probs = nums((h) => h.precip_prob_pct);
  const hottest = hours.reduce<HourlyPoint | null>((best, h) => (h.temp_c != null && (best?.temp_c == null || h.temp_c > best.temp_c) ? h : best), null);
  const gustiest = hours.reduce<HourlyPoint | null>((best, h) => (h.gust_ms != null && (best?.gust_ms == null || h.gust_ms > best.gust_ms) ? h : best), null);
  let x = 0;
  let y = 0;
  for (const h of hours) {
    if (h.wind_dir_deg == null || h.wind_ms == null) continue;
    const rad = (h.wind_dir_deg * Math.PI) / 180;
    x += Math.sin(rad) * h.wind_ms;
    y += Math.cos(rad) * h.wind_ms;
  }
  const dir = x === 0 && y === 0 ? null : Math.round((((Math.atan2(x, y) * 180) / Math.PI) % 360 + 360) % 360);
  const rain = nums((h) => h.precip_mm);
  return {
    temp_min_c: temps.length ? Math.min(...temps) : null,
    temp_max_c: temps.length ? Math.max(...temps) : null,
    temp_max_at: hottest?.time ?? null,
    humidity_min_pct: hum.length ? Math.min(...hum) : null,
    humidity_max_pct: hum.length ? Math.max(...hum) : null,
    rain_total_mm: Math.round(rain.reduce((a, b) => a + b, 0) * 10) / 10,
    rain_hours: rain.filter((v) => v >= 0.1).length,
    rain_max_prob_pct: probs.length ? Math.max(...probs) : null,
    wind_max_ms: winds.length ? Math.max(...winds) : null,
    gust_max_ms: gusts.length ? Math.max(...gusts) : null,
    gust_max_at: gustiest?.time ?? null,
    wind_dir_deg: dir,
  };
}

/** The 12 hours starting at the current hour, from a downloaded forecast. */
export function nextHours(hours: HourlyPoint[], now: number, count = SHOW_HOURS): HourlyPoint[] {
  const hourStart = Math.floor(now / 3_600_000) * 3_600_000;
  return hours.filter((h) => Date.parse(h.time) >= hourStart).slice(0, count);
}

function view(e: Entry, now: number): HourlyForecast | null {
  const hours = nextHours(e.hours, now);
  if (hours.length === 0) return null;
  return {
    source: "open-meteo",
    lat: e.lat,
    lng: e.lng,
    fetched_at: new Date(e.fetchedAt).toISOString(),
    next_refresh_at: new Date(nextRefreshAt(now)).toISOString(),
    stale: e.failed || e.slot < slotStart(now),
    hours,
    summary: summarize(hours),
  };
}

/** Next-12-hour forecast per farm id. Farms without one (Open-Meteo down, no cache) are left out. */
export async function getNext12hForecasts(
  farms: Array<{ id: string; lat: number; lng: number }>,
  now = Date.now(),
): Promise<Record<string, HourlyForecast>> {
  if (farms.length === 0 || disabled()) return {};
  await loadFromDisk();
  for (const f of farms) {
    const e = shared.entries.get(keyOf(f.lat, f.lng));
    if (e) e.lastRequested = now;
  }
  await ensureFresh(farms, now);
  const out: Record<string, HourlyForecast> = {};
  for (const f of farms) {
    const e = shared.entries.get(keyOf(f.lat, f.lng));
    const v = e ? view(e, now) : null;
    if (v) out[f.id] = v;
  }
  return out;
}

/** Re-download every location used in the last week (the 12-hour background job). */
export async function refreshTrackedForecasts(now = Date.now()): Promise<{ locations: number; ok: number }> {
  if (disabled()) return { locations: 0, ok: 0 };
  await loadFromDisk();
  const tracked = [...shared.entries.values()].filter((e) => now - (e.lastRequested || e.fetchedAt) < TRACK_FOR_MS);
  if (tracked.length === 0) return { locations: 0, ok: 0 };
  await ensureFresh(tracked, now);
  const ok = tracked.filter((e) => {
    const cur = shared.entries.get(keyOf(e.lat, e.lng));
    return cur && !cur.failed && cur.slot >= slotStart(now);
  }).length;
  return { locations: tracked.length, ok };
}

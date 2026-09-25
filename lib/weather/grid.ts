/**
 * The weather map's data: hourly temperature, humidity, rain, wind, gusts, cloud and pressure for the
 * next 72 hours on the grids in `spec.ts` (554 points), from Open-Meteo (free, no key) in one POST
 * request. A GET with that many coordinates is too long a URL.
 *
 * Downloaded on the same schedule as the farms' 12-hour forecast (00:00 and 12:00 Asia/Qatar, see
 * lib/data/forecast.ts), cached in memory and in `.data/weather/grid.json`. A failed download keeps
 * the previous grid (marked stale) and is retried after 10 minutes. Never throws.
 *
 * Budget: Open-Meteo counts each location as one call (up to 10 variables and 2 weeks). 554 calls
 * twice a day stays well inside the free tier (600 a minute, 10 000 a day). Over Qatar the default
 * model is ECMWF IFS HRES (≈ 9 km), so the 0.1° grid samples about one model cell per point.
 */
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { nextRefreshAt, slotStart } from "../data/forecast";
import { dataRoot, writeAtomic } from "../storage/files";
import { FIELD_SCALE, GRID_FIELDS, GRID_LEVELS, levelPoints, type GridFieldKey, type GridLevelId, type WeatherGridPayload } from "./spec";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const HOURLY_VARS = [
  "temperature_2m",
  "relative_humidity_2m",
  "precipitation",
  "precipitation_probability",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "cloud_cover",
  "pressure_msl",
].join(",");
const DOWNLOAD_HOURS = 72;
const RETRY_AFTER_MS = 10 * 60_000;
const TIMEOUT_MS = 30_000;
/** The grid is refreshed in the background only while someone has looked at a weather map this week. */
const TRACK_FOR_MS = 7 * 24 * 3_600_000;
const LEVEL_IDS: GridLevelId[] = ["coarse", "fine"];

type Fields = Record<GridFieldKey, Array<number | null>>;

interface Entry {
  slot: number;
  fetchedAt: number;
  /** Unix seconds of each downloaded hour. */
  times: number[];
  levels: Record<GridLevelId, Fields>;
  lastAttempt: number;
  failed: boolean;
  lastRequested: number;
}

interface Shared {
  entry: Entry | null;
  loaded: Promise<void> | null;
  inflight: Promise<void> | null;
  /** The last payload served, keyed by its first hour and download time. */
  served: { key: string; json: string } | null;
}

const g = globalThis as typeof globalThis & { __yieldWeatherGrid?: Shared };
const shared: Shared = (g.__yieldWeatherGrid ??= { entry: null, loaded: null, inflight: null, served: null });

const cacheFile = () => path.join(dataRoot(), "weather", "grid.json");
const disabled = () => process.env.OPEN_METEO_DISABLED === "true";

async function loadFromDisk(): Promise<void> {
  shared.loaded ??= (async () => {
    try {
      const parsed = JSON.parse(await readFile(cacheFile(), "utf8")) as Partial<Entry>;
      if (!shared.entry && Array.isArray(parsed.times) && parsed.levels?.coarse && parsed.levels?.fine) {
        shared.entry = { ...(parsed as Entry), lastAttempt: 0 };
      }
    } catch {
      // No cache yet: the first request downloads.
    }
  })();
  return shared.loaded;
}

async function saveToDisk(entry: Entry): Promise<void> {
  try {
    await writeAtomic(cacheFile(), JSON.stringify(entry));
  } catch {
    // Read-only hosts keep the grid in memory only.
  }
}

interface OpenMeteoLocation {
  hourly?: {
    time?: number[];
    temperature_2m?: Array<number | null>;
    relative_humidity_2m?: Array<number | null>;
    precipitation?: Array<number | null>;
    precipitation_probability?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
    wind_gusts_10m?: Array<number | null>;
    cloud_cover?: Array<number | null>;
    pressure_msl?: Array<number | null>;
  };
}

const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pack = (key: GridFieldKey, v: number | null) => (v == null ? null : Math.round(v * FIELD_SCALE[key]));

/** Open-Meteo's per-location series → the level's field arrays (hour-major, then row, then column). */
export function packLevel(locations: OpenMeteoLocation[], hours: number): Fields {
  const n = locations.length;
  const fields = Object.fromEntries(GRID_FIELDS.map((k) => [k, new Array<number | null>(hours * n).fill(null)])) as Fields;
  locations.forEach((loc, k) => {
    const h = loc.hourly;
    if (!h) return;
    for (let t = 0; t < hours; t++) {
      const at = t * n + k;
      const speed = num(h.wind_speed_10m?.[t]);
      const dir = num(h.wind_direction_10m?.[t]);
      // Meteorological direction is where the wind comes FROM: u, v point where it blows TO.
      const rad = dir == null ? 0 : (dir * Math.PI) / 180;
      fields.temp[at] = pack("temp", num(h.temperature_2m?.[t]));
      fields.rh[at] = pack("rh", num(h.relative_humidity_2m?.[t]));
      fields.precip[at] = pack("precip", num(h.precipitation?.[t]));
      fields.precipProb[at] = pack("precipProb", num(h.precipitation_probability?.[t]));
      fields.u[at] = speed == null || dir == null ? null : pack("u", -speed * Math.sin(rad));
      fields.v[at] = speed == null || dir == null ? null : pack("v", -speed * Math.cos(rad));
      fields.gust[at] = pack("gust", num(h.wind_gusts_10m?.[t]));
      fields.cloud[at] = pack("cloud", num(h.cloud_cover?.[t]));
      fields.pressure[at] = pack("pressure", num(h.pressure_msl?.[t]));
    }
  });
  return fields;
}

async function download(now: number): Promise<void> {
  const points = LEVEL_IDS.flatMap((id) => levelPoints(GRID_LEVELS[id]));
  const body = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(","),
    longitude: points.map((p) => p.lng).join(","),
    hourly: HOURLY_VARS,
    forecast_hours: String(DOWNLOAD_HOURS),
    timeformat: "unixtime",
    timezone: "GMT",
    wind_speed_unit: "ms",
    // The nearest model cell, sea or land. The default ("land") moves sea points onto the coast,
    // which would smear the peninsula's coastline into the Gulf.
    cell_selection: "nearest",
  });
  if (shared.entry) shared.entry.lastAttempt = now;
  try {
    const res = await fetch(OPEN_METEO_URL, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    const list = (Array.isArray(json) ? json : [json]) as OpenMeteoLocation[];
    if (list.length !== points.length) throw new Error(`expected ${points.length} locations, got ${list.length}`);
    const times = list[0]?.hourly?.time ?? [];
    if (times.length === 0) throw new Error("no hours in the response");
    let offset = 0;
    const levels = {} as Record<GridLevelId, Fields>;
    for (const id of LEVEL_IDS) {
      const count = GRID_LEVELS[id].nx * GRID_LEVELS[id].ny;
      levels[id] = packLevel(list.slice(offset, offset + count), times.length);
      offset += count;
    }
    const entry: Entry = {
      slot: slotStart(now),
      fetchedAt: now,
      times,
      levels,
      lastAttempt: now,
      failed: false,
      lastRequested: shared.entry?.lastRequested ?? now,
    };
    shared.entry = entry;
    shared.served = null;
    await saveToDisk(entry);
  } catch (error) {
    console.warn("[weather-grid] Open-Meteo grid unavailable:", error instanceof Error ? error.message : error);
    if (shared.entry) shared.entry.failed = true;
    else shared.entry = { slot: 0, fetchedAt: 0, times: [], levels: {} as Entry["levels"], lastAttempt: now, failed: true, lastRequested: now };
  }
}

function due(now: number): boolean {
  const e = shared.entry;
  if (!e || e.times.length === 0) return !e || now - e.lastAttempt >= RETRY_AFTER_MS;
  if (e.slot >= slotStart(now)) return false;
  return now - e.lastAttempt >= RETRY_AFTER_MS || e.lastAttempt < slotStart(now);
}

async function ensureFresh(now: number): Promise<void> {
  if (!due(now)) return;
  shared.inflight ??= download(now).finally(() => {
    shared.inflight = null;
  });
  await shared.inflight;
}

/**
 * The grid from the current hour on, as the JSON the browser receives (built once per hour and
 * download). Null when Open-Meteo is disabled or has never answered.
 */
export async function getWeatherGridJson(now = Date.now()): Promise<string | null> {
  if (disabled()) return null;
  await loadFromDisk();
  if (shared.entry) shared.entry.lastRequested = now;
  await ensureFresh(now);
  const e = shared.entry;
  if (!e || e.times.length === 0 || !e.levels.coarse || !e.levels.fine) return null;

  const hourStart = Math.floor(now / 3_600_000) * 3600;
  let t0 = e.times.findIndex((t) => t >= hourStart);
  if (t0 < 0) t0 = e.times.length - 1;
  const stale = e.failed || e.slot < slotStart(now);
  const key = `${e.fetchedAt}:${t0}:${stale}`;
  if (shared.served?.key === key) return shared.served.json;

  const levels = {} as WeatherGridPayload["levels"];
  for (const id of LEVEL_IDS) {
    const spec = GRID_LEVELS[id];
    const n = spec.nx * spec.ny;
    const fields = Object.fromEntries(GRID_FIELDS.map((k) => [k, e.levels[id][k].slice(t0 * n)])) as Fields;
    levels[id] = { ...spec, fields };
  }
  const payload: WeatherGridPayload = {
    source: "open-meteo",
    times: e.times.slice(t0),
    fetched_at: new Date(e.fetchedAt).toISOString(),
    next_refresh_at: new Date(nextRefreshAt(now)).toISOString(),
    stale,
    levels,
  };
  const json = JSON.stringify(payload);
  shared.served = { key, json };
  return json;
}

/** Background refresh (00:00 / 12:00 Qatar), only while the weather map is in use. */
export async function refreshWeatherGrid(now = Date.now()): Promise<boolean> {
  if (disabled()) return false;
  await loadFromDisk();
  const e = shared.entry;
  if (!e || now - (e.lastRequested || e.fetchedAt) >= TRACK_FOR_MS) return false;
  await ensureFresh(now);
  return Boolean(shared.entry && !shared.entry.failed && shared.entry.slot >= slotStart(now));
}

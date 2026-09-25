/**
 * Daily weather from Open-Meteo (free, no API key) for every farm in one request:
 * wind speed at 10 m and shortwave radiation for Penman–Monteith, air temperature / humidity
 * as a fallback when a probe has no air sensor, and Open-Meteo's own FAO ET0 as a cross-check.
 *
 * Responses are cached in memory for an hour; on failure we serve the last good response or
 * report "unavailable" so ET0 falls back to Hargreaves. Never throws.
 */
import type { Farm, WeatherDay } from "../types";
import { QATAR_TIMEZONE } from "./time";

const openMeteoUrl = () => `${(process.env.OPEN_METEO_BASE_URL?.trim() || "https://api.open-meteo.com").replace(/\/+$/, "")}/v1/forecast`;
const DAILY_VARS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "relative_humidity_2m_max",
  "relative_humidity_2m_min",
  "wind_speed_10m_mean",
  "shortwave_radiation_sum",
  "et0_fao_evapotranspiration",
].join(",");
const CACHE_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

export interface WeatherResult {
  byFarm: Record<string, Record<string, WeatherDay>>;
  source: "open-meteo" | "unavailable";
  note: string | null;
}

interface OpenMeteoDaily {
  time: string[];
  temperature_2m_max: Array<number | null>;
  temperature_2m_min: Array<number | null>;
  relative_humidity_2m_max: Array<number | null>;
  relative_humidity_2m_min: Array<number | null>;
  wind_speed_10m_mean: Array<number | null>;
  shortwave_radiation_sum: Array<number | null>;
  et0_fao_evapotranspiration: Array<number | null>;
}

const cache = new Map<string, { at: number; value: WeatherResult }>();

function parseLocation(daily: OpenMeteoDaily): Record<string, WeatherDay> {
  const out: Record<string, WeatherDay> = {};
  daily.time.forEach((date, i) => {
    out[date] = {
      date,
      tmax: daily.temperature_2m_max?.[i] ?? null,
      tmin: daily.temperature_2m_min?.[i] ?? null,
      rhMax: daily.relative_humidity_2m_max?.[i] ?? null,
      rhMin: daily.relative_humidity_2m_min?.[i] ?? null,
      wind10: daily.wind_speed_10m_mean?.[i] ?? null,
      rs: daily.shortwave_radiation_sum?.[i] ?? null,
      et0: daily.et0_fao_evapotranspiration?.[i] ?? null,
    };
  });
  return out;
}

export async function getWeatherForFarms(farms: Pick<Farm, "id" | "lat" | "lng">[], pastDays = 92): Promise<WeatherResult> {
  if (farms.length === 0) return { byFarm: {}, source: "unavailable", note: "No farms" };
  if (process.env.OPEN_METEO_DISABLED === "true") {
    return { byFarm: {}, source: "unavailable", note: "Weather lookups disabled (OPEN_METEO_DISABLED)" };
  }
  const key = farms.map((f) => `${f.id}@${f.lat.toFixed(3)},${f.lng.toFixed(3)}`).join(";") + `|${pastDays}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const params = new URLSearchParams({
    latitude: farms.map((f) => f.lat.toFixed(4)).join(","),
    longitude: farms.map((f) => f.lng.toFixed(4)).join(","),
    daily: DAILY_VARS,
    past_days: String(Math.min(92, Math.max(1, pastDays))),
    forecast_days: "1",
    timezone: QATAR_TIMEZONE,
    wind_speed_unit: "ms",
  });
  try {
    const res = await fetch(`${openMeteoUrl()}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    const locations = (Array.isArray(json) ? json : [json]) as Array<{ daily?: OpenMeteoDaily }>;
    const byFarm: WeatherResult["byFarm"] = {};
    farms.forEach((farm, i) => {
      const daily = locations[i]?.daily;
      if (daily?.time) byFarm[farm.id] = parseLocation(daily);
    });
    const value: WeatherResult = { byFarm, source: "open-meteo", note: null };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    console.warn("[weather] Open-Meteo unavailable:", error instanceof Error ? error.message : error);
    if (cached) return { ...cached.value, note: "Using cached weather (Open-Meteo unreachable)" };
    return { byFarm: {}, source: "unavailable", note: "Open-Meteo unreachable — ET0 estimated with Hargreaves" };
  }
}

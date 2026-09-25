/**
 * Open-Meteo forecast (free, no key): current conditions and a 7-day daily forecast for one or
 * many points in a single request. Fills the days WeatherAPI.com's plan does not return and backs
 * it up when it is unreachable. Cached for 30 minutes; never throws.
 */
import "server-only";
import { QATAR_TIMEZONE } from "../data/time";
import { compassFromDegrees, type CurrentWeather, type ForecastDay } from "./types";

const URL_FORECAST = "https://api.open-meteo.com/v1/forecast";
const CACHE_TTL_MS = 30 * 60_000;
const TIMEOUT_MS = 8000;

const DAILY = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "temperature_2m_mean",
  "relative_humidity_2m_max",
  "relative_humidity_2m_min",
  "relative_humidity_2m_mean",
  "wind_speed_10m_mean",
  "wind_speed_10m_max",
  "wind_direction_10m_dominant",
  "precipitation_sum",
  "precipitation_probability_max",
  "uv_index_max",
  "et0_fao_evapotranspiration",
].join(",");
const CURRENT = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
  "surface_pressure",
  "precipitation",
  "cloud_cover",
  "weather_code",
  "is_day",
].join(",");

/** WMO weather interpretation codes → text (Open-Meteo docs). */
const WMO: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  80: "Rain showers",
  81: "Heavy showers",
  82: "Violent showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with hail",
};
export const wmoText = (code: number | null | undefined) => (code == null ? "—" : (WMO[code] ?? "Unsettled"));

type Arr = Array<number | null> | undefined;

interface OpenMeteoLocation {
  current?: Record<string, number | string | null | undefined>;
  daily?: Record<string, Arr | string[] | undefined> & { time?: string[] };
}

export interface OpenMeteoResult {
  current: CurrentWeather | null;
  days: ForecastDay[];
}

const cache = new Map<string, { at: number; value: OpenMeteoResult[] }>();

function at(arr: Arr, i: number): number | null {
  const v = arr?.[i];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseOpenMeteoLocation(loc: OpenMeteoLocation): OpenMeteoResult {
  const c = loc.current;
  const n = (k: string) => (typeof c?.[k] === "number" ? (c[k] as number) : null);
  const current: CurrentWeather | null = c
    ? {
        observedAt: typeof c.time === "string" ? new Date(`${c.time}:00+03:00`).toISOString() : new Date().toISOString(),
        tempC: n("temperature_2m"),
        feelsLikeC: n("apparent_temperature"),
        humidity: n("relative_humidity_2m"),
        windKph: n("wind_speed_10m"),
        gustKph: n("wind_gusts_10m"),
        windDir: compassFromDegrees(n("wind_direction_10m")),
        windDegree: n("wind_direction_10m"),
        pressureMb: n("surface_pressure"),
        precipMm: n("precipitation"),
        cloud: n("cloud_cover"),
        uv: null,
        condition: wmoText(n("weather_code")),
        icon: null,
        isDay: n("is_day") == null ? null : n("is_day") === 1,
        source: "open-meteo",
      }
    : null;
  const d = loc.daily;
  const days: ForecastDay[] = (d?.time ?? []).map((date, i) => ({
    date,
    tmaxC: at(d?.temperature_2m_max as Arr, i),
    tminC: at(d?.temperature_2m_min as Arr, i),
    tavgC: at(d?.temperature_2m_mean as Arr, i),
    rhMax: at(d?.relative_humidity_2m_max as Arr, i),
    rhMin: at(d?.relative_humidity_2m_min as Arr, i),
    rhMean: at(d?.relative_humidity_2m_mean as Arr, i),
    windMeanKph: at(d?.wind_speed_10m_mean as Arr, i),
    windMaxKph: at(d?.wind_speed_10m_max as Arr, i),
    windDir: compassFromDegrees(at(d?.wind_direction_10m_dominant as Arr, i)),
    precipMm: at(d?.precipitation_sum as Arr, i),
    chanceOfRain: at(d?.precipitation_probability_max as Arr, i),
    uv: at(d?.uv_index_max as Arr, i),
    condition: wmoText(at(d?.weather_code as Arr, i)),
    icon: null,
    et0Mm: at(d?.et0_fao_evapotranspiration as Arr, i),
    source: "open-meteo",
  }));
  return { current, days };
}

/** Current + 7-day forecast for each point (same order). Returns null when Open-Meteo is off or down. */
export async function fetchOpenMeteoForecast(points: Array<{ lat: number; lng: number }>): Promise<OpenMeteoResult[] | null> {
  if (points.length === 0 || process.env.OPEN_METEO_DISABLED === "true") return null;
  const key = points.map((p) => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`).join(";");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(","),
    longitude: points.map((p) => p.lng.toFixed(4)).join(","),
    daily: DAILY,
    current: CURRENT,
    forecast_days: "7",
    timezone: QATAR_TIMEZONE,
    wind_speed_unit: "kmh",
  });
  try {
    const res = await fetch(`${URL_FORECAST}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    const list = (Array.isArray(json) ? json : [json]) as OpenMeteoLocation[];
    const value = points.map((_, i) => parseOpenMeteoLocation(list[i] ?? {}));
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    console.warn("[weather] Open-Meteo forecast unavailable:", error instanceof Error ? error.message : error);
    return cached?.value ?? null;
  }
}

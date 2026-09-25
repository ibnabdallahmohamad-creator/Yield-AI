/**
 * WeatherAPI.com client: real-time conditions and the daily forecast for a point
 * (GET https://api.weatherapi.com/v1/forecast.json?key=…&q=lat,lng&days=7&alerts=yes).
 *
 * The number of forecast days depends on the account's plan (the free plan returns 3); the
 * caller fills the rest of the week from Open-Meteo. Responses are cached per ~1 km for 15 min,
 * and on failure the last good response is served. Never throws.
 */
import "server-only";
import { z } from "zod";
import { computeDailyEt0 } from "../agronomy";
import { env } from "../env";
import { compassFromDegrees, type CurrentWeather, type ForecastDay } from "./types";

const BASE_URL = "https://api.weatherapi.com/v1/forecast.json";
const CACHE_TTL_MS = 15 * 60_000;
const TIMEOUT_MS = 8000;

const num = z.number().nullish();
const Condition = z.object({ text: z.string().nullish(), icon: z.string().nullish() }).nullish();

const HourSchema = z.object({
  time: z.string(),
  temp_c: num,
  humidity: num,
  wind_kph: num,
  wind_degree: num,
  gust_kph: num,
  precip_mm: num,
  chance_of_rain: num,
  uv: num,
  /** Shortwave (global horizontal) radiation, W/m² — present on current API versions. */
  short_rad: num,
});

const ForecastDaySchema = z.object({
  date: z.string(),
  day: z.object({
    maxtemp_c: num,
    mintemp_c: num,
    avgtemp_c: num,
    maxwind_kph: num,
    totalprecip_mm: num,
    avghumidity: num,
    daily_chance_of_rain: num,
    uv: num,
    condition: Condition,
  }),
  hour: z.array(HourSchema).default([]),
});

const ResponseSchema = z.object({
  location: z.object({ name: z.string().nullish(), region: z.string().nullish(), lat: z.number(), lon: z.number() }),
  current: z
    .object({
      last_updated_epoch: z.number().nullish(),
      temp_c: num,
      feelslike_c: num,
      humidity: num,
      wind_kph: num,
      gust_kph: num,
      wind_dir: z.string().nullish(),
      wind_degree: num,
      pressure_mb: num,
      precip_mm: num,
      cloud: num,
      uv: num,
      is_day: num,
      condition: Condition,
    })
    .nullish(),
  forecast: z.object({ forecastday: z.array(ForecastDaySchema) }).nullish(),
  alerts: z.object({ alert: z.array(z.object({ headline: z.string().nullish(), event: z.string().nullish() })).nullish() }).nullish(),
});

const ErrorSchema = z.object({ error: z.object({ code: z.number().optional(), message: z.string().optional() }) });

export interface WeatherApiResult {
  locationName: string | null;
  current: CurrentWeather | null;
  days: ForecastDay[];
  alerts: string[];
}

export class WeatherApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

const cache = new Map<string, { at: number; value: WeatherApiResult }>();

export function weatherApiConfigured(): boolean {
  return Boolean(env.weatherApiKey);
}

const iconUrl = (icon: string | null | undefined) => (icon ? (icon.startsWith("//") ? `https:${icon}` : icon) : null);
const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

function mean(values: Array<number | null | undefined>): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Vector-mean wind direction (degrees) weighted by speed. */
function dominantDirection(hours: Array<{ wind_degree?: number | null; wind_kph?: number | null }>): number | null {
  let x = 0;
  let y = 0;
  for (const h of hours) {
    if (h.wind_degree == null || h.wind_kph == null) continue;
    const rad = (h.wind_degree * Math.PI) / 180;
    x += Math.sin(rad) * h.wind_kph;
    y += Math.cos(rad) * h.wind_kph;
  }
  if (x === 0 && y === 0) return null;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

export function parseWeatherApi(json: unknown, lat: number, altitude_m = 20): WeatherApiResult {
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) {
    const err = ErrorSchema.safeParse(json);
    if (err.success) throw new WeatherApiError(err.data.error.message ?? "WeatherAPI.com error", err.data.error.code);
    throw new WeatherApiError(`Unexpected WeatherAPI.com response: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  const data = parsed.data;
  const c = data.current;
  const current: CurrentWeather | null = c
    ? {
        observedAt: c.last_updated_epoch ? new Date(c.last_updated_epoch * 1000).toISOString() : new Date().toISOString(),
        tempC: c.temp_c ?? null,
        feelsLikeC: c.feelslike_c ?? null,
        humidity: c.humidity ?? null,
        windKph: c.wind_kph ?? null,
        gustKph: c.gust_kph ?? null,
        windDir: c.wind_dir ?? compassFromDegrees(c.wind_degree),
        windDegree: c.wind_degree ?? null,
        pressureMb: c.pressure_mb ?? null,
        precipMm: c.precip_mm ?? null,
        cloud: c.cloud ?? null,
        uv: c.uv ?? null,
        condition: c.condition?.text?.trim() || "—",
        icon: iconUrl(c.condition?.icon),
        isDay: c.is_day == null ? null : c.is_day === 1,
        source: "weatherapi",
      }
    : null;

  const days: ForecastDay[] = (data.forecast?.forecastday ?? []).map((fd) => {
    const hours = fd.hour;
    const humid = hours.map((h) => h.humidity).filter((v): v is number => v != null);
    const rhMax = humid.length ? Math.max(...humid) : null;
    const rhMin = humid.length ? Math.min(...humid) : null;
    const windMean = mean(hours.map((h) => h.wind_kph));
    // Daily shortwave radiation Rs (MJ m⁻² day⁻¹) from hourly W/m² — only with a full day of values.
    const rad = hours.map((h) => h.short_rad).filter((v): v is number => v != null && v >= 0);
    const rs = rad.length >= 20 ? (rad.reduce((a, b) => a + b, 0) * 3600) / 1e6 : null;
    const et0 = computeDailyEt0({
      date: fd.date,
      latitude_deg: lat,
      altitude_m,
      tmax_C: fd.day.maxtemp_c ?? null,
      tmin_C: fd.day.mintemp_c ?? null,
      rhMax_pct: rhMax,
      rhMin_pct: rhMin,
      windSpeed_m_per_s: windMean != null ? windMean / 3.6 : null,
      windHeight_m: 10,
      rs_MJ_per_m2_day: rs,
    });
    return {
      date: fd.date,
      tmaxC: fd.day.maxtemp_c ?? null,
      tminC: fd.day.mintemp_c ?? null,
      tavgC: fd.day.avgtemp_c ?? null,
      rhMax,
      rhMin,
      rhMean: fd.day.avghumidity ?? (humid.length ? Math.round(mean(humid)!) : null),
      windMeanKph: round1(windMean),
      windMaxKph: fd.day.maxwind_kph ?? null,
      windDir: compassFromDegrees(dominantDirection(hours)),
      precipMm: fd.day.totalprecip_mm ?? null,
      chanceOfRain: fd.day.daily_chance_of_rain ?? null,
      uv: fd.day.uv ?? null,
      condition: fd.day.condition?.text?.trim() || "—",
      icon: iconUrl(fd.day.condition?.icon),
      et0Mm: et0 ? round1(et0.et0_mm_per_day) : null,
      source: "weatherapi",
    };
  });

  const alerts = (data.alerts?.alert ?? [])
    .map((a) => (a.headline || a.event || "").trim())
    .filter(Boolean)
    .slice(0, 5);
  const name = [data.location.name, data.location.region].filter(Boolean).join(", ");
  return { locationName: name || null, current, days, alerts };
}

/** Real-time conditions + forecast from WeatherAPI.com. Throws `WeatherApiError` on failure. */
export async function fetchWeatherApi(lat: number, lng: number, days = 7): Promise<WeatherApiResult> {
  const key = env.weatherApiKey;
  if (!key) throw new WeatherApiError("WEATHERAPI_KEY is not set");
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}|${days}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const params = new URLSearchParams({
    key,
    q: `${lat.toFixed(4)},${lng.toFixed(4)}`,
    days: String(days),
    aqi: "no",
    alerts: "yes",
  });
  try {
    const res = await fetch(`${BASE_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const err = ErrorSchema.safeParse(json);
      throw new WeatherApiError(
        err.success ? `WeatherAPI.com ${err.data.error.code ?? res.status}: ${err.data.error.message ?? res.statusText}` : `WeatherAPI.com HTTP ${res.status}`,
        err.success ? err.data.error.code : undefined,
      );
    }
    const value = parseWeatherApi(json, lat);
    cache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch (error) {
    if (cached) return cached.value;
    throw error instanceof WeatherApiError ? error : new WeatherApiError(error instanceof Error ? error.message : String(error));
  }
}

/** For tests. */
export function clearWeatherApiCache(): void {
  cache.clear();
}

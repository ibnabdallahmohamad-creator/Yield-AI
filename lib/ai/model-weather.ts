/**
 * Live weather for the fine-tuned model's inputs 5–8, from the same Open-Meteo daily variables and
 * units the training set used (lib/dataset/weather.ts): °C, %, m/s at 10 m, mm, FAO ET₀ in mm.
 * One request per location gives the 30 past days, today and the 7-day forecast. Cached for an hour.
 */
import "server-only";
import { addDays } from "../data/time";
import { DAILY_VARS, FORECAST_URL, parseOpenMeteo, weatherWindow, type WeatherSeries, type WeatherWindow } from "../dataset/weather";

const TTL_MS = 60 * 60_000;
const TIMEOUT_MS = 12_000;

const g = globalThis as typeof globalThis & { __harvestarModelWeather?: Map<string, { at: number; promise: Promise<WeatherSeries> }> };
const cache = (g.__harvestarModelWeather ??= new Map());

export function modelWeatherUrl(lat: number, lng: number): string {
  return (
    `${FORECAST_URL}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&daily=${DAILY_VARS.join(",")}` +
    `&timezone=Asia%2FQatar&wind_speed_unit=ms&past_days=31&forecast_days=8`
  );
}

async function fetchSeries(lat: number, lng: number): Promise<WeatherSeries> {
  if (process.env.OPEN_METEO_DISABLED === "true") throw new Error("Weather lookups are disabled (OPEN_METEO_DISABLED)");
  const res = await fetch(modelWeatherUrl(lat, lng), { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  return parseOpenMeteo(await res.json(), "open-meteo-forecast");
}

/** The daily series around today for a location (rounded to ~1 km so nearby farms share a request). */
export async function getModelWeatherSeries(lat: number, lng: number): Promise<WeatherSeries> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetchSeries(lat, lng);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

/**
 * The 7 past days, today, the 7-day forecast and the past 30 days around `asOf`. Open-Meteo sometimes
 * leaves the last forecast day or a past day incomplete; a missing day is filled from its neighbour so
 * the window is always whole (and the gap is reported).
 */
export function liveWeatherWindow(series: WeatherSeries, asOf: string): { window: WeatherWindow | null; filled: string[] } {
  const direct = weatherWindow(series, asOf);
  if (direct) return { window: direct, filled: [] };
  const byDate = new Map(series.days.map((d) => [d.date, d]));
  const filled: string[] = [];
  for (let offset = -30; offset <= 7; offset++) {
    const date = addDays(asOf, offset);
    if (byDate.has(date)) continue;
    const near = byDate.get(addDays(date, -1)) ?? byDate.get(addDays(date, 1)) ?? byDate.get(addDays(date, -2)) ?? byDate.get(addDays(date, 2));
    if (!near) return { window: null, filled };
    byDate.set(date, { ...near, date });
    filled.push(date);
  }
  return { window: weatherWindow({ ...series, days: [...byDate.values()] }, asOf), filled };
}

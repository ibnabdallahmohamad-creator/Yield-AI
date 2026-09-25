/**
 * The weather the app shows and the AI reads: real-time conditions from WeatherAPI.com and a
 * 7-day forecast (WeatherAPI.com days first, Open-Meteo for the rest of the week).
 *
 * For the land atlas, every 10 km² cell gets a derived 7-day forecast: forecasts are fetched for
 * a network of anchor points across Qatar and interpolated to each cell (inverse-distance
 * weighting, power 2) — 13 API calls cover all ≈1,200 cells.
 */
import "server-only";
import { addDays, qatarDateString } from "../data/time";
import { haversineKm } from "../land/grid";
import { fetchOpenMeteoForecast, type OpenMeteoResult } from "./open-meteo";
import { compassFromDegrees, type ForecastDay, type LocationWeather } from "./types";
import { fetchWeatherApi, weatherApiConfigured, type WeatherApiResult } from "./weatherapi";

export const FORECAST_DAYS = 7;

/** Merge provider days into one week starting `today`: WeatherAPI.com first, Open-Meteo after. */
export function mergeForecast(today: string, primary: ForecastDay[], fallback: ForecastDay[]): ForecastDay[] {
  const out: ForecastDay[] = [];
  for (let i = 0; i < FORECAST_DAYS; i++) {
    const date = addDays(today, i);
    const day = primary.find((d) => d.date === date) ?? fallback.find((d) => d.date === date);
    if (day) out.push(day);
  }
  return out;
}

function combine(
  lat: number,
  lng: number,
  wa: WeatherApiResult | null,
  om: OpenMeteoResult | null,
  notes: string[],
): LocationWeather {
  const today = qatarDateString(new Date());
  const days = mergeForecast(today, wa?.days ?? [], om?.days ?? []);
  const sources = [
    wa && (wa.current || days.some((d) => d.source === "weatherapi")) ? "WeatherAPI.com" : null,
    om && (days.some((d) => d.source === "open-meteo") || (!wa?.current && om.current)) ? "Open-Meteo" : null,
  ].filter((s): s is string => s !== null);
  return {
    lat,
    lng,
    locationName: wa?.locationName ?? null,
    current: wa?.current ?? om?.current ?? null,
    days,
    alerts: wa?.alerts ?? [],
    sources,
    fetchedAt: new Date().toISOString(),
    note: notes.length ? notes.join(" ") : null,
  };
}

/** Real-time conditions + 7-day forecast for a farm or any point. Never throws. */
export async function getLocationWeather(lat: number, lng: number): Promise<LocationWeather> {
  const notes: string[] = [];
  const [wa, om] = await Promise.all([
    weatherApiConfigured()
      ? fetchWeatherApi(lat, lng, FORECAST_DAYS).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[weather] WeatherAPI.com unavailable:", message);
          notes.push(`WeatherAPI.com unavailable (${message}).`);
          return null;
        })
      : Promise.resolve(null),
    fetchOpenMeteoForecast([{ lat, lng }]).then((r) => r?.[0] ?? null),
  ]);
  if (!weatherApiConfigured()) notes.push("Set WEATHERAPI_KEY for real-time conditions from WeatherAPI.com.");
  if (!wa && !om) notes.push("No weather provider could be reached.");
  return combine(lat, lng, wa, om, notes);
}

// ---------------------------------------------------------------------------
// Anchor network → per-cell forecasts
// ---------------------------------------------------------------------------

/** Forecast anchor points spread over Qatar's coasts, interior, north and south. */
export const WEATHER_ANCHORS = [
  { name: "Ar Ruwais", lat: 26.13, lng: 51.21 },
  { name: "Al Ghuwariyah", lat: 25.84, lng: 51.25 },
  { name: "Al Khor", lat: 25.68, lng: 51.5 },
  { name: "Al Jemailiya", lat: 25.61, lng: 51.08 },
  { name: "Umm Salal", lat: 25.47, lng: 51.4 },
  { name: "Dukhan", lat: 25.42, lng: 50.79 },
  { name: "Al Sheehaniya", lat: 25.37, lng: 51.22 },
  { name: "Doha", lat: 25.29, lng: 51.53 },
  { name: "Al Wakrah", lat: 25.17, lng: 51.6 },
  { name: "Al Karaana", lat: 25.01, lng: 51.04 },
  { name: "Mesaieed", lat: 24.99, lng: 51.55 },
  { name: "Abu Samra", lat: 24.75, lng: 50.84 },
  { name: "Khor Al Udeid", lat: 24.63, lng: 51.35 },
] as const;

export interface AnchorWeather {
  name: string;
  lat: number;
  lng: number;
  weather: LocationWeather;
}

const GRID_TTL_MS = 60 * 60_000;
const gridCache = globalThis as unknown as { __yieldAnchorWeather?: { at: number; promise: Promise<AnchorWeather[]> } };

async function loadAnchors(): Promise<AnchorWeather[]> {
  const om = await fetchOpenMeteoForecast(WEATHER_ANCHORS.map((a) => ({ lat: a.lat, lng: a.lng })));
  const wa = await Promise.all(
    WEATHER_ANCHORS.map((a) =>
      weatherApiConfigured() ? fetchWeatherApi(a.lat, a.lng, FORECAST_DAYS).catch(() => null) : Promise.resolve(null),
    ),
  );
  return WEATHER_ANCHORS.map((a, i) => ({
    name: a.name,
    lat: a.lat,
    lng: a.lng,
    weather: combine(a.lat, a.lng, wa[i], om?.[i] ?? null, []),
  }));
}

/** Weather at every anchor, cached for an hour (13 WeatherAPI.com calls + 1 Open-Meteo call). */
export async function getAnchorWeather(): Promise<AnchorWeather[]> {
  const cached = gridCache.__yieldAnchorWeather;
  if (cached && Date.now() - cached.at < GRID_TTL_MS) return cached.promise;
  const promise = loadAnchors();
  gridCache.__yieldAnchorWeather = { at: Date.now(), promise };
  promise.catch(() => {
    if (gridCache.__yieldAnchorWeather?.promise === promise) gridCache.__yieldAnchorWeather = undefined;
  });
  return promise;
}

type NumericKey = "tmaxC" | "tminC" | "tavgC" | "rhMax" | "rhMin" | "rhMean" | "windMeanKph" | "windMaxKph" | "precipMm" | "chanceOfRain" | "uv" | "et0Mm";
const NUMERIC: NumericKey[] = ["tmaxC", "tminC", "tavgC", "rhMax", "rhMin", "rhMean", "windMeanKph", "windMaxKph", "precipMm", "chanceOfRain", "uv", "et0Mm"];

/**
 * Derived 7-day forecast for a point: inverse-distance-weighted (power 2) blend of the anchor
 * forecasts. Wind direction is blended as a vector; the condition text comes from the nearest anchor.
 */
export function interpolateForecast(lat: number, lng: number, anchors: AnchorWeather[]): ForecastDay[] {
  const weighted = anchors
    .map((a) => ({ a, d: Math.max(0.5, haversineKm(lat, lng, a.lat, a.lng)) }))
    .sort((x, y) => x.d - y.d);
  if (weighted.length === 0) return [];
  const nearest = weighted[0].a;
  const dates = nearest.weather.days.map((d) => d.date);
  return dates.map((date) => {
    const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
    const values: Partial<Record<NumericKey, number | null>> = {};
    for (const key of NUMERIC) {
      let sum = 0;
      let wsum = 0;
      for (const { a, d } of weighted) {
        const v = a.weather.days.find((x) => x.date === date)?.[key];
        if (v == null) continue;
        const w = 1 / (d * d);
        sum += w * v;
        wsum += w;
      }
      values[key] = wsum > 0 ? round(sum / wsum, key === "precipMm" || key === "et0Mm" ? 1 : key.startsWith("rh") || key === "chanceOfRain" ? 0 : 1) : null;
    }
    // Wind direction: weighted vector mean of the anchors' dominant directions.
    let x = 0;
    let y = 0;
    for (const { a, d } of weighted) {
      const day = a.weather.days.find((v) => v.date === date);
      const deg = compassToDegrees(day?.windDir ?? null);
      if (deg == null) continue;
      const w = (day?.windMeanKph ?? 1) / (d * d);
      x += Math.sin((deg * Math.PI) / 180) * w;
      y += Math.cos((deg * Math.PI) / 180) * w;
    }
    const nearestDay = nearest.weather.days.find((v) => v.date === date);
    return {
      date,
      tmaxC: values.tmaxC ?? null,
      tminC: values.tminC ?? null,
      tavgC: values.tavgC ?? null,
      rhMax: values.rhMax ?? null,
      rhMin: values.rhMin ?? null,
      rhMean: values.rhMean ?? null,
      windMeanKph: values.windMeanKph ?? null,
      windMaxKph: values.windMaxKph ?? null,
      windDir: x === 0 && y === 0 ? null : compassFromDegrees(((Math.atan2(x, y) * 180) / Math.PI + 360) % 360),
      precipMm: values.precipMm ?? null,
      chanceOfRain: values.chanceOfRain ?? null,
      uv: values.uv ?? null,
      condition: nearestDay?.condition ?? "—",
      icon: nearestDay?.icon ?? null,
      et0Mm: values.et0Mm ?? null,
      source: "derived" as const,
    };
  });
}

const COMPASS_DEG: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};
function compassToDegrees(dir: string | null): number | null {
  return dir && dir in COMPASS_DEG ? COMPASS_DEG[dir] : null;
}

/** Derived 7-day forecast for any point from the anchor network. */
export async function getDerivedForecast(lat: number, lng: number): Promise<{ days: ForecastDay[]; sources: string[]; anchors: string[] }> {
  const anchors = await getAnchorWeather();
  const usable = anchors.filter((a) => a.weather.days.length > 0);
  const nearest = [...usable].sort((a, b) => haversineKm(lat, lng, a.lat, a.lng) - haversineKm(lat, lng, b.lat, b.lng)).slice(0, 3);
  return {
    days: interpolateForecast(lat, lng, usable),
    sources: [...new Set(usable.flatMap((a) => a.weather.sources))],
    anchors: nearest.map((a) => `${a.name} (${Math.round(haversineKm(lat, lng, a.lat, a.lng))} km)`),
  };
}

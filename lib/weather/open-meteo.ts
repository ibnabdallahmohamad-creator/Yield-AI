/**
 * Open-Meteo hourly forecast (free, no key): one request covers every farm plus a regular grid
 * of points around them for the weather maps. Pure functions — the fetch and cache live in
 * service.ts. https://open-meteo.com/en/docs
 */
import type { Bounds } from "../geo";
import { GRID_FIELDS, type GridForecast, type HourlyField, type HourlySeries, type PointForecast } from "./types";

/** Open-Meteo variable for each series. */
export const HOURLY_VARIABLES: Record<HourlyField, string> = {
  temperature: "temperature_2m",
  apparent: "apparent_temperature",
  dewPoint: "dew_point_2m",
  humidity: "relative_humidity_2m",
  precipitation: "precipitation",
  precipProbability: "precipitation_probability",
  windSpeed: "wind_speed_10m",
  windDirection: "wind_direction_10m",
  windGusts: "wind_gusts_10m",
  cloudCover: "cloud_cover",
  radiation: "shortwave_radiation",
  et0: "et0_fao_evapotranspiration",
  vpd: "vapour_pressure_deficit",
  weatherCode: "weather_code",
  uvIndex: "uv_index",
};
const FIELDS = Object.keys(HOURLY_VARIABLES) as HourlyField[];

/** Hours kept from each fetch: refreshed every 12 h, so at least the next 12 hours are always there. */
export const FORECAST_HOURS = 24;

export interface ForecastLocation {
  lat: number;
  lng: number;
}

export function forecastUrl(baseUrl: string, locations: ForecastLocation[]): string {
  const params = new URLSearchParams({
    latitude: locations.map((l) => l.lat.toFixed(4)).join(","),
    longitude: locations.map((l) => l.lng.toFixed(4)).join(","),
    hourly: FIELDS.map((f) => HOURLY_VARIABLES[f]).join(","),
    // Two days from today 00:00 UTC always cover the next 24 hours.
    forecast_days: "2",
    timezone: "GMT",
    timeformat: "unixtime",
    wind_speed_unit: "ms",
    precipitation_unit: "mm",
    temperature_unit: "celsius",
  });
  return `${baseUrl.replace(/\/+$/, "")}/v1/forecast?${params}`;
}

interface OpenMeteoLocation {
  latitude?: number;
  longitude?: number;
  elevation?: number;
  hourly?: Record<string, unknown>;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One location's hourly series from `fromMs` (the current hour) for FORECAST_HOURS hours. */
export function parseHourly(location: OpenMeteoLocation, fromMs: number, hours = FORECAST_HOURS): HourlySeries | null {
  const hourly = location.hourly;
  const times = hourly?.time;
  if (!hourly || !Array.isArray(times)) return null;
  const start = Math.floor(fromMs / 3_600_000) * 3_600_000;
  const indices: number[] = [];
  const stamps: number[] = [];
  times.forEach((t, i) => {
    // Unix seconds (timeformat=unixtime), or an ISO string in GMT.
    const ms = typeof t === "number" ? t * 1000 : Date.parse(/Z|[+-]\d\d:?\d\d$/.test(String(t)) ? String(t) : `${t}Z`);
    if (ms >= start && ms < start + hours * 3_600_000) {
      indices.push(i);
      stamps.push(ms);
    }
  });
  if (indices.length === 0) return null;
  const series = { time: stamps } as HourlySeries;
  for (const field of FIELDS) {
    const values = hourly[HOURLY_VARIABLES[field]];
    series[field] = indices.map((i) => (Array.isArray(values) ? num(values[i]) : null));
  }
  return series;
}

/** Open-Meteo answers one location with an object and several with an array. */
export function asLocations(json: unknown): OpenMeteoLocation[] {
  if (Array.isArray(json)) return json as OpenMeteoLocation[];
  if (json && typeof json === "object") return [json as OpenMeteoLocation];
  return [];
}

// ---------------------------------------------------------------------------
// Regional grid
// ---------------------------------------------------------------------------

export interface GridLayout {
  lats: number[];
  lngs: number[];
}

/** Northern Qatar, for accounts that have no farms yet. */
export const DEFAULT_REGION: Bounds = { minLat: 25.2, maxLat: 26.2, minLng: 50.9, maxLng: 51.65 };

/**
 * A grid around the farms: padded so the maps show the surrounding region, at least ~0.4° across
 * (forecast models resolve ~10 km, so a smaller box would show one flat colour).
 */
export function gridLayout(bounds: Bounds | null, target = 8): GridLayout {
  const b = bounds ?? DEFAULT_REGION;
  const midLat = (b.minLat + b.maxLat) / 2;
  const midLng = (b.minLng + b.maxLng) / 2;
  const cos = Math.cos((midLat * Math.PI) / 180);
  let latSpan = Math.max(b.maxLat - b.minLat, 0.01) * 1.6 + 0.2;
  let lngSpan = Math.max(b.maxLng - b.minLng, 0.01) * 1.6 + 0.2 / cos;
  latSpan = Math.max(latSpan, 0.4);
  lngSpan = Math.max(lngSpan, 0.4 / cos);
  // Similar spacing in km along both axes.
  const kmLat = latSpan * 111;
  const kmLng = lngSpan * 111 * cos;
  const cols = Math.round(Math.min(10, Math.max(5, kmLng >= kmLat ? target : (target * kmLng) / kmLat)));
  const rows = Math.round(Math.min(10, Math.max(5, kmLat >= kmLng ? target : (target * kmLat) / kmLng)));
  const lats = Array.from({ length: rows }, (_, r) => round4(midLat + latSpan / 2 - (r * latSpan) / (rows - 1)));
  const lngs = Array.from({ length: cols }, (_, c) => round4(midLng - lngSpan / 2 + (c * lngSpan) / (cols - 1)));
  return { lats, lngs };
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

export function gridLocations(layout: GridLayout): ForecastLocation[] {
  return layout.lats.flatMap((lat) => layout.lngs.map((lng) => ({ lat, lng })));
}

export function buildGrid(layout: GridLayout, series: Array<HourlySeries | null>): GridForecast | null {
  const first = series.find((s): s is HourlySeries => s !== null);
  if (!first) return null;
  const time = first.time;
  const fields = Object.fromEntries(
    GRID_FIELDS.map((f) => [f, time.map((_, h) => series.map((s) => (s ? (s[f][h] ?? null) : null)))]),
  ) as GridForecast["fields"];
  return { lats: layout.lats, lngs: layout.lngs, time, fields };
}

/** Farm forecasts and the grid from one multi-location response (farms first, then the grid). */
export function parseForecastResponse(
  json: unknown,
  farms: Array<{ id: string; name: string; lat: number; lng: number }>,
  layout: GridLayout,
  fromMs: number,
): { points: PointForecast[]; grid: GridForecast | null } {
  const locations = asLocations(json);
  const points: PointForecast[] = [];
  farms.forEach((farm, i) => {
    const loc = locations[i];
    const hourly = loc ? parseHourly(loc, fromMs) : null;
    if (hourly) points.push({ id: farm.id, name: farm.name, lat: farm.lat, lng: farm.lng, elevation: num(loc?.elevation), hourly });
  });
  const gridSeries = gridLocations(layout).map((_, i) => {
    const loc = locations[farms.length + i];
    return loc ? parseHourly(loc, fromMs) : null;
  });
  return { points, grid: buildGrid(layout, gridSeries) };
}

/**
 * Place search for "find my farm": coordinates and land-atlas cell ids are answered locally;
 * names go to OpenStreetMap Nominatim (restricted to Qatar), with WeatherAPI.com's location search
 * as a fallback. Nominatim's usage policy is respected: an identifying User-Agent, at most one
 * request per second from this server, and results cached for a day.
 */
import "server-only";
import { env } from "./env";
import { parseLatLng } from "./farms/shapes";
import { cellGeometryById, inQatarBbox, municipalityAt, QATAR_BBOX } from "./land/grid";

export interface PlaceResult {
  label: string;
  detail: string;
  lat: number;
  lng: number;
  source: "coordinates" | "atlas" | "openstreetmap" | "weatherapi";
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "YieldAI/1.0 (farm CRM for Qatar; https://github.com/ibnabdallahmohamad-creator/yield-ai)";
const CACHE_TTL_MS = 24 * 60 * 60_000;
const cache = new Map<string, { at: number; results: PlaceResult[] }>();
let nextSlot = 0;

async function politeDelay(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 1100;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

async function nominatim(query: string): Promise<PlaceResult[]> {
  await politeDelay();
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    countrycodes: "qa",
    limit: "6",
    viewbox: `${QATAR_BBOX.west},${QATAR_BBOX.north},${QATAR_BBOX.east},${QATAR_BBOX.south}`,
    bounded: "1",
    "accept-language": "en",
  });
  const res = await fetch(`${NOMINATIM}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(6000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{ display_name?: string; name?: string; lat?: string; lon?: string; type?: string }>;
  return rows
    .map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), name: r.name || r.display_name?.split(",")[0] || query, full: r.display_name ?? "" }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && inQatarBbox(r.lat, r.lng))
    .map((r) => ({
      label: r.name,
      detail: r.full.split(",").slice(1, 4).join(",").trim() || (municipalityAt(r.lng, r.lat) ?? "Qatar"),
      lat: r.lat,
      lng: r.lng,
      source: "openstreetmap" as const,
    }));
}

async function weatherApiSearch(query: string): Promise<PlaceResult[]> {
  if (!env.weatherApiKey) return [];
  const params = new URLSearchParams({ key: env.weatherApiKey, q: query });
  const res = await fetch(`https://api.weatherapi.com/v1/search.json?${params}`, { signal: AbortSignal.timeout(6000), cache: "no-store" });
  if (!res.ok) throw new Error(`WeatherAPI.com search HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{ name?: string; region?: string; country?: string; lat?: number; lon?: number }>;
  return rows
    .filter((r) => typeof r.lat === "number" && typeof r.lon === "number" && inQatarBbox(r.lat, r.lon))
    .map((r) => ({
      label: r.name ?? query,
      detail: [r.region, r.country].filter(Boolean).join(", "),
      lat: r.lat!,
      lng: r.lon!,
      source: "weatherapi" as const,
    }));
}

export async function searchPlaces(rawQuery: string): Promise<{ results: PlaceResult[]; note: string | null }> {
  const query = rawQuery.trim().slice(0, 120);
  if (query.length < 2) return { results: [], note: null };

  const point = parseLatLng(query);
  if (point) {
    const where = municipalityAt(point.lng, point.lat);
    return {
      results: [
        {
          label: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
          detail: where ? `${where}, Qatar` : inQatarBbox(point.lat, point.lng) ? "At sea or on the coast" : "Outside Qatar",
          lat: point.lat,
          lng: point.lng,
          source: "coordinates",
        },
      ],
      note: null,
    };
  }
  const cell = cellGeometryById(query.toUpperCase());
  if (cell) {
    return {
      results: [{ label: cell.id, detail: `Land-atlas cell in ${cell.municipality}`, lat: cell.lat, lng: cell.lng, source: "atlas" }],
      note: null,
    };
  }

  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { results: cached.results, note: null };

  let results: PlaceResult[] = [];
  let note: string | null = null;
  try {
    results = await nominatim(query);
  } catch (error) {
    console.warn("[geocode] Nominatim unavailable:", error instanceof Error ? error.message : error);
    note = "Place search is limited right now — you can also type coordinates like 25.75, 51.37 or drop the pin on the map.";
  }
  if (results.length === 0) {
    try {
      results = await weatherApiSearch(query);
      if (results.length) note = null;
    } catch (error) {
      console.warn("[geocode] WeatherAPI.com search unavailable:", error instanceof Error ? error.message : error);
    }
  }
  if (results.length) cache.set(key, { at: Date.now(), results });
  return { results, note };
}

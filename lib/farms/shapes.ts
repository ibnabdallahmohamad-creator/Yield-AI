/**
 * Pure helpers for creating farms and sensors: field outlines from a pin, ids, validation.
 * Client-safe (the add-farm page previews the outline before saving).
 */
import { localProjector, pointInPolygon, polygonArea_ha, polygonCentroid, type GeoPolygon, type LngLat } from "../geo";

/** Square field of `areaHa` hectares centred on the pin. */
export function squareFieldAround(lat: number, lng: number, areaHa: number): GeoPolygon {
  const half = Math.sqrt(Math.max(areaHa, 0.01) * 10_000) / 2;
  const proj = localProjector(lat, lng);
  const round = (p: LngLat): LngLat => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];
  const ring: LngLat[] = [
    proj.toLngLat(-half, -half),
    proj.toLngLat(half, -half),
    proj.toLngLat(half, half),
    proj.toLngLat(-half, half),
  ].map(round);
  return { type: "Polygon", coordinates: [[...ring, ring[0]]] };
}

/** Close a drawn ring and check it is a usable field outline (≥ 3 distinct points, non-zero area). */
export function polygonFromPoints(points: LngLat[]): GeoPolygon | null {
  const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  if (pts.length > 1 && pts[0][0] === pts.at(-1)![0] && pts[0][1] === pts.at(-1)![1]) pts.pop();
  if (pts.length < 3) return null;
  const polygon: GeoPolygon = { type: "Polygon", coordinates: [[...pts, pts[0]]] };
  return polygonArea_ha(polygon) > 0.001 ? polygon : null;
}

export function fieldSummary(polygon: GeoPolygon): { lat: number; lng: number; areaHa: number } {
  const [lng, lat] = polygonCentroid(polygon);
  return { lat, lng, areaHa: polygonArea_ha(polygon) };
}

export function isInsideField(lat: number, lng: number, polygon: GeoPolygon): boolean {
  return pointInPolygon(lng, lat, polygon);
}

/** URL-safe slug, e.g. "Green Valley Farm" → "green-valley-farm". */
export function slugify(name: string, max = 40): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "farm";
}

/** Probe-id prefix from a farm name: initials of up to three words, e.g. "Green Valley Farm" → "GVF". */
export function sensorPrefix(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const initials = words.slice(0, 3).map((w) => w[0]!.toUpperCase()).join("");
  return initials.length >= 2 ? initials : (words[0] ?? "P").slice(0, 3).toUpperCase().padEnd(2, "X");
}

/** Next free probe id for a farm: PREFIX-01, PREFIX-02 … skipping ids already in use. */
export function nextSensorId(prefix: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  for (let n = 1; n < 1000; n++) {
    const id = `${prefix}-${String(n).padStart(2, "0")}`;
    if (!used.has(id.toLowerCase())) return id;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

export const SENSOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,31}$/;

/** Parse "25.2854, 51.5310" (or "25.2854 51.5310", or with N/E) into a point. */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*°?\s*[nN]?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*[eE]?\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

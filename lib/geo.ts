/**
 * Small, dependency-free geometry helpers for farm polygons.
 * Coordinates follow GeoJSON order: [longitude, latitude].
 */

export type LngLat = [number, number];

export interface GeoPolygon {
  type: "Polygon";
  coordinates: LngLat[][];
}

export interface Bounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** Metres per degree of latitude (WGS-84 mean, adequate for field-scale distances). */
export const METERS_PER_DEG_LAT = 110_574;
/** Metres per degree of longitude at the equator; multiply by cos(latitude). */
export const METERS_PER_DEG_LNG_EQUATOR = 111_320;

/** Local equirectangular projection around a reference point — accurate to < 0.1 % over a farm. */
export function localProjector(refLat: number, refLng: number) {
  const kx = METERS_PER_DEG_LNG_EQUATOR * Math.cos((refLat * Math.PI) / 180);
  const ky = METERS_PER_DEG_LAT;
  return {
    toXY(lng: number, lat: number): [number, number] {
      return [(lng - refLng) * kx, (lat - refLat) * ky];
    },
    toLngLat(x: number, y: number): LngLat {
      return [refLng + x / kx, refLat + y / ky];
    },
    metersPerDegLng: kx,
    metersPerDegLat: ky,
  };
}

export function outerRing(polygon: GeoPolygon): LngLat[] {
  return polygon.coordinates[0];
}

/** Ray-casting point-in-ring test. */
export function pointInRing(lng: number, lat: number, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Point in polygon (outer ring minus holes). */
export function pointInPolygon(lng: number, lat: number, polygon: GeoPolygon): boolean {
  const [outer, ...holes] = polygon.coordinates;
  if (!pointInRing(lng, lat, outer)) return false;
  return !holes.some((hole) => pointInRing(lng, lat, hole));
}

export function polygonBounds(polygon: GeoPolygon): Bounds {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of outerRing(polygon)) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

/** Area-weighted centroid of the outer ring. */
export function polygonCentroid(polygon: GeoPolygon): LngLat {
  const ring = outerRing(polygon);
  const [refLng, refLat] = ring[0];
  const proj = localProjector(refLat, refLng);
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = proj.toXY(ring[i][0], ring[i][1]);
    const [x2, y2] = proj.toXY(ring[i + 1][0], ring[i + 1][1]);
    const cross = x1 * y2 - x2 * y1;
    area2 += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(area2) < 1e-9) return ring[0];
  return proj.toLngLat(cx / (3 * area2), cy / (3 * area2));
}

/** Polygon area in hectares (outer ring, local projection). */
export function polygonArea_ha(polygon: GeoPolygon): number {
  const ring = outerRing(polygon);
  const [refLng, refLat] = ring[0];
  const proj = localProjector(refLat, refLng);
  let area2 = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = proj.toXY(ring[i][0], ring[i][1]);
    const [x2, y2] = proj.toXY(ring[i + 1][0], ring[i + 1][1]);
    area2 += x1 * y2 - x2 * y1;
  }
  return Math.abs(area2) / 2 / 10_000;
}

/** Shortest distance (m) from a point to the polygon's outer boundary. */
export function distanceToBoundary_m(lng: number, lat: number, polygon: GeoPolygon): number {
  const ring = outerRing(polygon);
  const proj = localProjector(lat, lng);
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = proj.toXY(ring[i][0], ring[i][1]);
    const [bx, by] = proj.toXY(ring[i + 1][0], ring[i + 1][1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    best = Math.min(best, Math.hypot(px, py));
  }
  return best;
}

/** Leaflet-style [lat, lng] ring for rendering. */
export function toLatLngRing(polygon: GeoPolygon): [number, number][] {
  return outerRing(polygon).map(([lng, lat]) => [lat, lng]);
}

/** A closed GeoJSON polygon from an open list of vertices ([lng, lat]). */
export function polygonFromVertices(vertices: LngLat[]): GeoPolygon {
  const ring = vertices.map(([lng, lat]) => [lng, lat] as LngLat);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0], first[1]]);
  return { type: "Polygon", coordinates: [ring] };
}

function segmentsCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const orient = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** True when two non-adjacent edges of the outer ring cross (a "bow-tie" outline). */
export function ringSelfIntersects(polygon: GeoPolygon): boolean {
  const ring = outerRing(polygon);
  const n = ring.length - 1; // closed ring: last point repeats the first
  if (n < 4) return false;
  const [refLng, refLat] = ring[0];
  const proj = localProjector(refLat, refLng);
  const pts = ring.map(([lng, lat]) => proj.toXY(lng, lat));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
      if (segmentsCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) return true;
    }
  }
  return false;
}

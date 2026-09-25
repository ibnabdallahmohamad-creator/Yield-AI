/**
 * The Qatar land grid: square cells of 10 km² (≈3.16 km × 3.16 km) laid over the peninsula and
 * clipped to land with the municipality boundaries. Pure geometry — the land profile of each
 * cell is built in `profile.ts`.
 */
import { METERS_PER_DEG_LAT, METERS_PER_DEG_LNG_EQUATOR, pointInRing, type LngLat } from "../geo";
import { QATAR_MUNICIPALITIES } from "./qatar-municipalities";

/** Cell edge: √10 km² ≈ 3,162 m, so every cell covers ≈10 km². */
export const CELL_SIZE_M = Math.sqrt(10_000_000);
/** South-west corner of the grid and its extent (covers all of Qatar with a margin). */
export const GRID_ORIGIN = { lat: 24.45, lng: 50.7 } as const;
export const GRID_EXTENT = { lat: 26.2, lng: 51.7 } as const;
/** Longitude spacing is fixed at the peninsula's mid-latitude, so cell area varies < ±1 %. */
const REFERENCE_LAT = 25.3;
export const CELL_DLAT = CELL_SIZE_M / METERS_PER_DEG_LAT;
export const CELL_DLNG = CELL_SIZE_M / (METERS_PER_DEG_LNG_EQUATOR * Math.cos((REFERENCE_LAT * Math.PI) / 180));
export const GRID_ROWS = Math.ceil((GRID_EXTENT.lat - GRID_ORIGIN.lat) / CELL_DLAT);
export const GRID_COLS = Math.ceil((GRID_EXTENT.lng - GRID_ORIGIN.lng) / CELL_DLNG);
/** Cells with less land than this (sea, tiny islets) are left out of the grid. */
export const MIN_LAND_FRACTION = 0.15;
const LAND_SAMPLES_PER_SIDE = 6;

export interface CellGeometry {
  id: string;
  row: number;
  col: number;
  /** Cell centre. */
  lat: number;
  lng: number;
  bounds: { south: number; west: number; north: number; east: number };
  /** Share of the cell that is land (0–1). */
  landFraction: number;
  /** Land area of the cell, km². */
  landAreaKm2: number;
  /** Municipality covering most of the cell. */
  municipality: string;
  /** Distance from the cell centre to the sea coast, km (0 when the centre is on the shore or at sea). */
  coastDistanceKm: number;
}

export const cellId = (row: number, col: number) =>
  `QA-R${String(row).padStart(2, "0")}-C${String(col).padStart(2, "0")}`;

export function parseCellId(id: string): { row: number; col: number } | null {
  const m = /^QA-R(\d{2})-C(\d{2})$/.exec(id);
  if (!m) return null;
  const row = Number(m[1]);
  const col = Number(m[2]);
  return row < GRID_ROWS && col < GRID_COLS ? { row, col } : null;
}

/** Row and column of the cell containing a point, or null outside the grid. */
export function cellIndexAt(lat: number, lng: number): { row: number; col: number } | null {
  const row = Math.floor((lat - GRID_ORIGIN.lat) / CELL_DLAT);
  const col = Math.floor((lng - GRID_ORIGIN.lng) / CELL_DLNG);
  if (!Number.isFinite(row) || !Number.isFinite(col) || row < 0 || col < 0 || row >= GRID_ROWS || col >= GRID_COLS) return null;
  return { row, col };
}

export function cellBounds(row: number, col: number) {
  const south = GRID_ORIGIN.lat + row * CELL_DLAT;
  const west = GRID_ORIGIN.lng + col * CELL_DLNG;
  return { south, west, north: south + CELL_DLAT, east: west + CELL_DLNG };
}

const RINGS = QATAR_MUNICIPALITIES.flatMap((m) =>
  m.rings.map((ring) => {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const [x, y] of ring) {
      minLng = Math.min(minLng, x);
      maxLng = Math.max(maxLng, x);
      minLat = Math.min(minLat, y);
      maxLat = Math.max(maxLat, y);
    }
    return { name: m.name, ring, minLng, minLat, maxLng, maxLat };
  }),
);

/** The municipality containing a point, or null at sea / outside Qatar. */
export function municipalityAt(lng: number, lat: number): string | null {
  for (const r of RINGS) {
    if (lng < r.minLng || lng > r.maxLng || lat < r.minLat || lat > r.maxLat) continue;
    if (pointInRing(lng, lat, r.ring)) return r.name;
  }
  return null;
}

export function isInQatar(lat: number, lng: number): boolean {
  return municipalityAt(lng, lat) !== null;
}

/** Loose bounding box used to validate coordinates typed by users (land test is separate). */
export const QATAR_BBOX = { south: 24.4, west: 50.7, north: 26.2, east: 51.7 } as const;

export function inQatarBbox(lat: number, lng: number): boolean {
  return lat >= QATAR_BBOX.south && lat <= QATAR_BBOX.north && lng >= QATAR_BBOX.west && lng <= QATAR_BBOX.east;
}

/**
 * Land south of the Qatar–Saudi Arabia border (roughly Salwa → Khor Al Udeid). Points there are
 * outside Qatar but not sea, so the border is not mistaken for a coastline.
 */
function isSaudiLand(lng: number, lat: number): boolean {
  return lng < 51.33 && lat < 24.8 - (lng - 50.78) * 0.44;
}

const isSea = (lng: number, lat: number) => municipalityAt(lng, lat) === null && !isSaudiLand(lng, lat);

type Segment = [LngLat, LngLat];

let coastSegments: Segment[] | null = null;

/**
 * Boundary edges that face the sea: an edge is coastal when a point 250 m off its midpoint,
 * on either side, is sea. Internal municipality borders and the land border are skipped.
 */
function getCoastSegments(): Segment[] {
  if (coastSegments) return coastSegments;
  const out: Segment[] = [];
  const offsetDeg = 250 / METERS_PER_DEG_LAT;
  for (const m of QATAR_MUNICIPALITIES) {
    for (const ring of m.rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len === 0) continue;
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        const nx = (-dy / len) * offsetDeg;
        const ny = (dx / len) * offsetDeg;
        if (isSea(mx + nx, my + ny) || isSea(mx - nx, my - ny)) out.push([a, b]);
      }
    }
  }
  coastSegments = out;
  return out;
}

/** Distance (km) from a point to the nearest sea coast. */
export function coastDistanceKm(lat: number, lng: number): number {
  const kx = METERS_PER_DEG_LNG_EQUATOR * Math.cos((lat * Math.PI) / 180);
  const ky = METERS_PER_DEG_LAT;
  let best = Infinity;
  for (const [a, b] of getCoastSegments()) {
    const ax = (a[0] - lng) * kx;
    const ay = (a[1] - lat) * ky;
    const bx = (b[0] - lng) * kx;
    const by = (b[1] - lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  if (!isInQatar(lat, lng)) return 0;
  return best / 1000;
}

function buildCell(row: number, col: number): CellGeometry | null {
  const bounds = cellBounds(row, col);
  const counts = new Map<string, number>();
  let land = 0;
  const n = LAND_SAMPLES_PER_SIDE;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const lat = bounds.south + ((i + 0.5) / n) * CELL_DLAT;
      const lng = bounds.west + ((j + 0.5) / n) * CELL_DLNG;
      const m = municipalityAt(lng, lat);
      if (!m) continue;
      land++;
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
  }
  const landFraction = land / (n * n);
  if (landFraction < MIN_LAND_FRACTION) return null;
  const lat = (bounds.south + bounds.north) / 2;
  const lng = (bounds.west + bounds.east) / 2;
  const areaKm2 =
    (CELL_DLAT * METERS_PER_DEG_LAT * CELL_DLNG * METERS_PER_DEG_LNG_EQUATOR * Math.cos((lat * Math.PI) / 180)) / 1e6;
  const municipality = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return {
    id: cellId(row, col),
    row,
    col,
    lat,
    lng,
    bounds,
    landFraction,
    landAreaKm2: areaKm2 * landFraction,
    municipality,
    coastDistanceKm: coastDistanceKm(lat, lng),
  };
}

let cells: CellGeometry[] | null = null;
let byId: Map<string, CellGeometry> | null = null;

/** Every land cell of the grid (≈1,200), south to north, west to east. Built once, then cached. */
export function landCells(): CellGeometry[] {
  if (cells) return cells;
  const out: CellGeometry[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const cell = buildCell(row, col);
      if (cell) out.push(cell);
    }
  }
  cells = out;
  byId = new Map(out.map((c) => [c.id, c]));
  return out;
}

export function cellGeometryById(id: string): CellGeometry | null {
  landCells();
  return byId?.get(id) ?? null;
}

/** The land cell containing a point, or the nearest land cell within `maxKm` (for coastal points). */
export function cellGeometryAt(lat: number, lng: number, maxKm = 4): CellGeometry | null {
  const idx = cellIndexAt(lat, lng);
  if (idx) {
    const hit = cellGeometryById(cellId(idx.row, idx.col));
    if (hit) return hit;
  }
  let best: CellGeometry | null = null;
  let bestD = Infinity;
  for (const c of landCells()) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best && bestD <= maxKm + CELL_SIZE_M / 1000 ? best : null;
}

/** The 8 cells around a cell that are on land. */
export function neighbourCells(cell: CellGeometry): CellGeometry[] {
  const out: CellGeometry[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const n = cellGeometryById(cellId(cell.row + dr, cell.col + dc));
      if (n) out.push(n);
    }
  }
  return out;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

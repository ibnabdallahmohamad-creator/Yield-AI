/**
 * Inverse distance weighting (IDW) interpolation of probe readings inside a farm polygon.
 *
 *   v(x) = Σ wᵢ vᵢ / Σ wᵢ,   wᵢ = 1 / dᵢ^p   (Shepard 1968), with power p = 2.
 *
 * The field is sampled on a regular grid of ~5 m cells clipped to the polygon.
 */
import { localProjector, pointInPolygon, polygonBounds, type GeoPolygon } from "./geo";

export const IDW_POWER = 2;
export const DEFAULT_CELL_SIZE_M = 5;

export interface IdwSample {
  lng: number;
  lat: number;
  value: number;
}

export interface RasterGrid {
  cols: number;
  rows: number;
  /** Western edge of the grid (longitude of the first column's left side). */
  west: number;
  /** Northern edge of the grid (latitude of the first row's top side). */
  north: number;
  east: number;
  south: number;
  cellSize_m: number;
  /** Row-major values, north → south, west → east. NaN outside the polygon. */
  values: Float32Array;
  min: number;
  max: number;
}

/** IDW estimate at (x, y) in metres from projected samples. Exact at a sample location. */
export function idwValue(samples: Array<{ x: number; y: number; value: number }>, x: number, y: number, power = IDW_POWER): number {
  let weighted = 0;
  let weights = 0;
  for (const s of samples) {
    const d = Math.hypot(x - s.x, y - s.y);
    if (d < 1e-6) return s.value;
    const w = 1 / Math.pow(d, power);
    weighted += w * s.value;
    weights += w;
  }
  return weights > 0 ? weighted / weights : NaN;
}

/**
 * Interpolate samples onto a grid covering the polygon's bounding box and clip it to the polygon.
 * Pass a single sample (or identical values) to get a uniform field.
 *
 * With `clip: false` every cell of the bounding box gets a value; the map renderer uses this and
 * clips to the exact polygon outline itself, so smoothing never fades the field's edge.
 */
export function buildIdwGrid(
  polygon: GeoPolygon,
  samples: IdwSample[],
  cellSize_m = DEFAULT_CELL_SIZE_M,
  power = IDW_POWER,
  { clip = true }: { clip?: boolean } = {},
): RasterGrid {
  const b = polygonBounds(polygon);
  const refLat = (b.minLat + b.maxLat) / 2;
  const refLng = (b.minLng + b.maxLng) / 2;
  const proj = localProjector(refLat, refLng);
  const dLng = cellSize_m / proj.metersPerDegLng;
  const dLat = cellSize_m / proj.metersPerDegLat;
  const cols = Math.max(1, Math.ceil((b.maxLng - b.minLng) / dLng));
  const rows = Math.max(1, Math.ceil((b.maxLat - b.minLat) / dLat));
  const values = new Float32Array(cols * rows);
  const projected = samples
    .filter((s) => Number.isFinite(s.value))
    .map((s) => {
      const [x, y] = proj.toXY(s.lng, s.lat);
      return { x, y, value: s.value };
    });

  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < rows; r++) {
    const lat = b.maxLat - (r + 0.5) * dLat;
    for (let c = 0; c < cols; c++) {
      const lng = b.minLng + (c + 0.5) * dLng;
      const i = r * cols + c;
      if (projected.length === 0 || (clip && !pointInPolygon(lng, lat, polygon))) {
        values[i] = NaN;
        continue;
      }
      const [x, y] = proj.toXY(lng, lat);
      const v = idwValue(projected, x, y, power);
      values[i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return {
    cols,
    rows,
    west: b.minLng,
    north: b.maxLat,
    east: b.minLng + cols * dLng,
    south: b.maxLat - rows * dLat,
    cellSize_m,
    values,
    min,
    max,
  };
}

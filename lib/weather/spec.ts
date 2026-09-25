/**
 * The weather map's sampling grids (client-safe): a detailed 0.1° grid over Qatar (about 11 km, the
 * resolution of the forecast model itself) nested in a 0.5° grid over the Gulf for context. Both are
 * downloaded from Open-Meteo in one request (554 points) and blended where they meet.
 */

export interface GridLevelSpec {
  /** Latitude of row 0 (the southern edge), degrees. */
  south: number;
  /** Longitude of column 0 (the western edge), degrees. */
  west: number;
  /** Spacing between rows and columns, degrees. */
  step: number;
  nx: number;
  ny: number;
}

export type GridLevelId = "coarse" | "fine";

export const GRID_LEVELS: Record<GridLevelId, GridLevelSpec> = {
  // 22.0–28.5 N, 47.5–55.0 E: the Gulf from Kuwait's south to the UAE.
  coarse: { south: 22.0, west: 47.5, step: 0.5, nx: 16, ny: 14 },
  // 24.3–26.4 N, 50.5–51.9 E: the peninsula with a margin of sea all round.
  fine: { south: 24.3, west: 50.5, step: 0.1, nx: 15, ny: 22 },
};

export const levelNorth = (l: GridLevelSpec) => l.south + (l.ny - 1) * l.step;
export const levelEast = (l: GridLevelSpec) => l.west + (l.nx - 1) * l.step;

/** Every grid point, row by row from the south-west corner (the order the fields are stored in). */
export function levelPoints(l: GridLevelSpec): Array<{ lat: number; lng: number }> {
  const out: Array<{ lat: number; lng: number }> = [];
  for (let j = 0; j < l.ny; j++) {
    for (let i = 0; i < l.nx; i++) out.push({ lat: round4(l.south + j * l.step), lng: round4(l.west + i * l.step) });
  }
  return out;
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Fields sent to the browser. Stored as integers (value × scale) to keep the payload small; `null`
 * where the model had no value. Wind is sent as u/v components (m/s, eastward / northward) so it can
 * be interpolated in space and time without the 359°→0° jump of a direction.
 */
export const GRID_FIELDS = ["temp", "rh", "precip", "precipProb", "u", "v", "gust", "cloud", "pressure"] as const;
export type GridFieldKey = (typeof GRID_FIELDS)[number];

export const FIELD_SCALE: Record<GridFieldKey, number> = {
  temp: 10,
  rh: 1,
  precip: 100,
  precipProb: 1,
  u: 10,
  v: 10,
  gust: 10,
  cloud: 1,
  pressure: 10,
};

export interface GridLevelPayload extends GridLevelSpec {
  /** Per field: nt × ny × nx integers, index `(t * ny + j) * nx + i`. */
  fields: Record<GridFieldKey, Array<number | null>>;
}

export interface WeatherGridPayload {
  source: "open-meteo";
  /** Start of each hour (Unix seconds, UTC), from the current hour on. */
  times: number[];
  fetched_at: string;
  next_refresh_at: string;
  /** True when the last download failed and this is the previous forecast. */
  stale: boolean;
  levels: Record<GridLevelId, GridLevelPayload>;
}

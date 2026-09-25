/**
 * The weather grid in the browser: decoded to Float32Arrays, derived fields (wind speed, dew point,
 * feels-like, accumulated rain) computed once per grid node, and sampled anywhere with Catmull–Rom
 * bicubic interpolation in space and linear interpolation in time. The 0.1° Qatar grid is blended into
 * the 0.5° Gulf grid over its outer 0.2°, so the detail fades in without a seam.
 */
import { FIELD_SCALE, GRID_FIELDS, levelEast, levelNorth, type GridFieldKey, type GridLevelSpec, type WeatherGridPayload } from "./spec";

export type ScalarKey = GridFieldKey | "speed" | "dew" | "feels" | "precipSum";

export interface Level extends GridLevelSpec {
  north: number;
  east: number;
  /** Points per hour (nx × ny). */
  n: number;
  nt: number;
  data: Partial<Record<ScalarKey, Float32Array>>;
}

export interface WeatherField {
  /** Start of each hour, ms (UTC). */
  times: number[];
  nt: number;
  fetchedAt: string;
  nextRefreshAt: string;
  stale: boolean;
  coarse: Level;
  fine: Level;
}

/** Width of the band (degrees) inside the fine grid's edge where it fades into the coarse grid. */
export const BLEND_DEG = 0.2;

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** Replace gaps with the mean of their valid neighbours (a few passes), then the slice mean. */
function fillGaps(a: Float32Array, nx: number, ny: number, nt: number): void {
  const n = nx * ny;
  for (let t = 0; t < nt; t++) {
    const o = t * n;
    let missing = 0;
    let sum = 0;
    for (let k = 0; k < n; k++) {
      if (Number.isNaN(a[o + k])) missing++;
      else sum += a[o + k];
    }
    if (missing === 0 || missing === n) continue;
    for (let pass = 0; pass < 4 && missing > 0; pass++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = o + j * nx + i;
          if (!Number.isNaN(a[k])) continue;
          let s = 0;
          let c = 0;
          for (const nb of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < ny - 1 ? k + nx : -1]) {
            if (nb < 0 || Number.isNaN(a[nb])) continue;
            s += a[nb];
            c++;
          }
          if (c > 0) {
            a[k] = s / c;
            missing--;
          }
        }
      }
    }
    const mean = sum / (n - missing);
    for (let k = 0; k < n; k++) if (Number.isNaN(a[o + k])) a[o + k] = mean;
  }
}

function decodeLevel(p: WeatherGridPayload["levels"]["coarse"], nt: number): Level {
  const n = p.nx * p.ny;
  const data: Level["data"] = {};
  for (const key of GRID_FIELDS) {
    const src = p.fields[key] ?? [];
    const out = new Float32Array(nt * n);
    const scale = FIELD_SCALE[key];
    for (let k = 0; k < out.length; k++) {
      const v = src[k];
      out[k] = v == null ? NaN : v / scale;
    }
    fillGaps(out, p.nx, p.ny, nt);
    data[key] = out;
  }
  return { south: p.south, west: p.west, step: p.step, nx: p.nx, ny: p.ny, north: levelNorth(p), east: levelEast(p), n, nt, data };
}

export function decodeGrid(p: WeatherGridPayload): WeatherField {
  const nt = p.times.length;
  return {
    times: p.times.map((t) => t * 1000),
    nt,
    fetchedAt: p.fetched_at,
    nextRefreshAt: p.next_refresh_at,
    stale: p.stale,
    coarse: decodeLevel(p.levels.coarse, nt),
    fine: decodeLevel(p.levels.fine, nt),
  };
}

// ---------------------------------------------------------------------------
// Derived quantities (per grid node)
// ---------------------------------------------------------------------------

/** Dew point (°C) from air temperature and relative humidity: Magnus formula (Alduchov & Eskridge 1996). */
export function dewPoint(tempC: number, rh: number): number {
  const a = 17.625;
  const b = 243.04;
  const gamma = Math.log(Math.max(rh, 1) / 100) + (a * tempC) / (b + tempC);
  return (b * gamma) / (a - gamma);
}

/**
 * Feels-like (apparent) temperature, °C: the Australian Bureau of Meteorology formula (Steadman 1994)
 * for shade, from air temperature, humidity and 10 m wind — the one Open-Meteo uses.
 */
export function apparentTemperature(tempC: number, rh: number, windMs: number): number {
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
  return tempC + 0.33 * e - 0.7 * windMs - 4;
}

/** Wet-bulb temperature, °C (Stull 2011; valid for RH 5–99 %, −20–50 °C). */
export function wetBulb(tempC: number, rh: number): number {
  const r = Math.min(99, Math.max(5, rh));
  return (
    tempC * Math.atan(0.151977 * Math.sqrt(r + 8.313659)) +
    Math.atan(tempC + r) -
    Math.atan(r - 1.676331) +
    0.00391838 * Math.pow(r, 1.5) * Math.atan(0.023101 * r) -
    4.686035
  );
}

function derive(level: Level, key: ScalarKey): Float32Array {
  const cached = level.data[key];
  if (cached) return cached;
  const len = level.n * level.nt;
  const out = new Float32Array(len);
  const T = level.data.temp!;
  const RH = level.data.rh!;
  const U = level.data.u!;
  const V = level.data.v!;
  switch (key) {
    case "speed":
      for (let k = 0; k < len; k++) out[k] = Math.hypot(U[k], V[k]);
      break;
    case "dew":
      for (let k = 0; k < len; k++) out[k] = dewPoint(T[k], RH[k]);
      break;
    case "feels":
      for (let k = 0; k < len; k++) out[k] = apparentTemperature(T[k], RH[k], Math.hypot(U[k], V[k]));
      break;
    case "precipSum": {
      const P = level.data.precip!;
      for (let k = 0; k < level.n; k++) {
        let s = 0;
        for (let t = 0; t < level.nt; t++) {
          const i = t * level.n + k;
          s += Math.max(0, P[i]);
          out[i] = s;
        }
      }
      break;
    }
    default:
      return level.data[key]!;
  }
  level.data[key] = out;
  return out;
}

export function levelArray(level: Level, key: ScalarKey): Float32Array {
  return derive(level, key);
}

/** One hour-interpolated slice of a field (nx × ny values) at fractional hour `t`. */
export function frameAt(level: Level, key: ScalarKey, t: number, out?: Float32Array): Float32Array {
  const a = derive(level, key);
  const n = level.n;
  const res = out ?? new Float32Array(n);
  const tc = Math.min(level.nt - 1, Math.max(0, t));
  const t0 = Math.floor(tc);
  const t1 = Math.min(level.nt - 1, t0 + 1);
  const f = tc - t0;
  const o0 = t0 * n;
  const o1 = t1 * n;
  if (f === 0 || t0 === t1) {
    for (let k = 0; k < n; k++) res[k] = a[o0 + k];
  } else {
    for (let k = 0; k < n; k++) res[k] = a[o0 + k] + (a[o1 + k] - a[o0 + k]) * f;
  }
  return res;
}

// ---------------------------------------------------------------------------
// Spatial interpolation
// ---------------------------------------------------------------------------

/** Catmull–Rom weights for a fractional offset s ∈ [0, 1), written into w[0..3]. */
export function cubicWeights(s: number, w: Float32Array | number[], o = 0): void {
  const s2 = s * s;
  const s3 = s2 * s;
  w[o] = (-s3 + 2 * s2 - s) / 2;
  w[o + 1] = (3 * s3 - 5 * s2 + 2) / 2;
  w[o + 2] = (-3 * s3 + 4 * s2 + s) / 2;
  w[o + 3] = (s3 - s2) / 2;
}

const W_X = new Float32Array(4);
const W_Y = new Float32Array(4);

/** Bicubic value of a slice at fractional grid coordinates (gx along columns, gy along rows). */
export function bicubic(slice: Float32Array, nx: number, ny: number, gx: number, gy: number): number {
  const x = Math.min(nx - 1, Math.max(0, gx));
  const y = Math.min(ny - 1, Math.max(0, gy));
  const i1 = Math.min(nx - 2, Math.floor(x));
  const j1 = Math.min(ny - 2, Math.floor(y));
  cubicWeights(x - i1, W_X);
  cubicWeights(y - j1, W_Y);
  let v = 0;
  for (let b = 0; b < 4; b++) {
    const j = Math.min(ny - 1, Math.max(0, j1 - 1 + b));
    let row = 0;
    for (let a = 0; a < 4; a++) {
      const i = Math.min(nx - 1, Math.max(0, i1 - 1 + a));
      row += W_X[a] * slice[j * nx + i];
    }
    v += W_Y[b] * row;
  }
  // Clamp to the four surrounding values (Catmull–Rom overshoots next to sharp changes).
  const k = j1 * nx + i1;
  const lo = Math.min(slice[k], slice[k + 1], slice[k + nx], slice[k + nx + 1]);
  const hi = Math.max(slice[k], slice[k + 1], slice[k + nx], slice[k + nx + 1]);
  return v < lo ? lo : v > hi ? hi : v;
}

/** Bilinear value (used for the particle field, where overshoot would show as swirls). */
export function bilinear(slice: Float32Array, nx: number, ny: number, gx: number, gy: number): number {
  const x = Math.min(nx - 1, Math.max(0, gx));
  const y = Math.min(ny - 1, Math.max(0, gy));
  const i = Math.min(nx - 2, Math.floor(x));
  const j = Math.min(ny - 2, Math.floor(y));
  const fx = x - i;
  const fy = y - j;
  const k = j * nx + i;
  const a = slice[k] + (slice[k + 1] - slice[k]) * fx;
  const b = slice[k + nx] + (slice[k + nx + 1] - slice[k + nx]) * fx;
  return a + (b - a) * fy;
}

export function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Weight of the fine grid at a point: 1 well inside it, fading to 0 at its edge, 0 outside. */
export function fineWeight(fine: Level, lat: number, lng: number): number {
  const d = Math.min(lat - fine.south, fine.north - lat, lng - fine.west, fine.east - lng);
  return d <= 0 ? 0 : smoothstep(d / BLEND_DEG);
}

export const insideLevel = (l: Level, lat: number, lng: number) => lat >= l.south && lat <= l.north && lng >= l.west && lng <= l.east;

/** Field value range clamps: interpolation must not invent negative rain or humidity above 100 %. */
export function clampValue(key: ScalarKey, v: number): number {
  switch (key) {
    case "precip":
    case "precipSum":
    case "speed":
    case "gust":
      return Math.max(0, v);
    case "rh":
    case "cloud":
    case "precipProb":
      return Math.min(100, Math.max(0, v));
    default:
      return v;
  }
}

/** Slices at one time, cached, so sampling many points (picker, farm labels) is cheap. */
export class FieldSampler {
  private cache = new Map<string, Float32Array>();
  constructor(
    readonly field: WeatherField,
    readonly t: number,
  ) {}

  slice(level: "coarse" | "fine", key: ScalarKey): Float32Array {
    const id = `${level}:${key}`;
    let s = this.cache.get(id);
    if (!s) {
      s = frameAt(this.field[level], key, this.t);
      this.cache.set(id, s);
    }
    return s;
  }

  private levelValue(level: "coarse" | "fine", key: ScalarKey, lat: number, lng: number, linear: boolean): number {
    const l = this.field[level];
    const gx = (lng - l.west) / l.step;
    const gy = (lat - l.south) / l.step;
    const s = this.slice(level, key);
    return linear ? bilinear(s, l.nx, l.ny, gx, gy) : bicubic(s, l.nx, l.ny, gx, gy);
  }

  /** The value at a point, or NaN outside the Gulf grid. */
  value(key: ScalarKey, lat: number, lng: number, linear = false): number {
    const { coarse, fine } = this.field;
    if (!insideLevel(coarse, lat, lng)) return NaN;
    const w = fineWeight(fine, lat, lng);
    let v: number;
    if (w >= 1) v = this.levelValue("fine", key, lat, lng, linear);
    else if (w <= 0) v = this.levelValue("coarse", key, lat, lng, linear);
    else v = this.levelValue("coarse", key, lat, lng, linear) * (1 - w) + this.levelValue("fine", key, lat, lng, linear) * w;
    return clampValue(key, v);
  }

  /** Wind (u east, v north, m/s) at a point. */
  wind(lat: number, lng: number): { u: number; v: number } {
    return { u: this.value("u", lat, lng, true), v: this.value("v", lat, lng, true) };
  }
}

// ---------------------------------------------------------------------------
// Time series at a point (the meteogram and the timeline strip)
// ---------------------------------------------------------------------------

export interface PointHour {
  time: number;
  temp: number;
  feels: number;
  dew: number;
  rh: number;
  precip: number;
  precipProb: number;
  wind: number;
  /** Direction the wind blows from, degrees clockwise from north. */
  windDir: number;
  gust: number;
  cloud: number;
  pressure: number;
}

/** Meteorological direction (where the wind comes from) of a u/v vector. */
export function windFromDeg(u: number, v: number): number {
  return ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
}

function hourAt(s: FieldSampler, time: number, lat: number, lng: number): PointHour {
  const u = s.value("u", lat, lng);
  const v = s.value("v", lat, lng);
  return {
    time,
    temp: s.value("temp", lat, lng),
    feels: s.value("feels", lat, lng),
    dew: s.value("dew", lat, lng),
    rh: s.value("rh", lat, lng),
    precip: s.value("precip", lat, lng),
    precipProb: s.value("precipProb", lat, lng),
    wind: Math.hypot(u, v),
    windDir: windFromDeg(u, v),
    gust: s.value("gust", lat, lng),
    cloud: s.value("cloud", lat, lng),
    pressure: s.value("pressure", lat, lng),
  };
}

/** Every hour of the forecast at one point. */
export function pointSeries(field: WeatherField, lat: number, lng: number): PointHour[] {
  return pointSeriesMany(field, [{ lat, lng }])[0];
}

/** Every hour at several points, sharing each hour's slices (the farm table). */
export function pointSeriesMany(field: WeatherField, points: Array<{ lat: number; lng: number }>): PointHour[][] {
  const out: PointHour[][] = points.map(() => []);
  for (let t = 0; t < field.nt; t++) {
    const s = new FieldSampler(field, t);
    points.forEach((p, k) => out[k].push(hourAt(s, field.times[t], p.lat, p.lng)));
  }
  return out;
}

/** One field's value at a point for every hour (for the timeline strip). */
export function pointValues(field: WeatherField, key: ScalarKey, lat: number, lng: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < field.nt; t++) out.push(new FieldSampler(field, t).value(key, lat, lng));
  return out;
}

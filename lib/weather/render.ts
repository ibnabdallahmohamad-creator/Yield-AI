/**
 * Paints one grid level into RGBA pixels for an image overlay. Separable Catmull–Rom bicubic
 * (rows first, then columns) keeps it to ~8 multiply-adds a pixel, so a 500 × 700 frame takes a few
 * milliseconds and the timeline can play smoothly. Rows are spaced evenly in Web Mercator y, not in
 * latitude, because Leaflet stretches an overlay linearly between its corners in projected space:
 * that keeps every pixel exactly where its latitude is on the map.
 */
import { clampValue, cubicWeights, smoothstep, type Level, type ScalarKey } from "./field";
import { lutIndex, type Lut } from "./palettes";

const RAD = Math.PI / 180;
export const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
export const invMercY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;

/** Pixel height that keeps a level's image at the same scale as its width, on the map. */
export function mercatorHeight(level: Pick<Level, "west" | "east" | "south" | "north">, width: number): number {
  const spanX = (level.east - level.west) * RAD;
  const spanY = mercY(level.north) - mercY(level.south);
  return Math.max(2, Math.round((width * spanY) / spanX));
}

interface Axis {
  i1: Int32Array;
  w: Float32Array;
  alpha: Float32Array;
}

const axisCache = new Map<string, { x: Axis; y: Axis }>();

function axes(level: Level, width: number, height: number, feather: number): { x: Axis; y: Axis } {
  const id = `${level.west},${level.south},${level.step},${level.nx},${level.ny},${width},${height},${feather}`;
  const hit = axisCache.get(id);
  if (hit) return hit;
  const x: Axis = { i1: new Int32Array(width), w: new Float32Array(width * 4), alpha: new Float32Array(width) };
  for (let px = 0; px < width; px++) {
    const lng = level.west + ((px + 0.5) / width) * (level.east - level.west);
    const g = (lng - level.west) / level.step;
    const i1 = Math.min(level.nx - 2, Math.max(0, Math.floor(g)));
    x.i1[px] = i1;
    cubicWeights(Math.min(1, Math.max(0, g - i1)), x.w, px * 4);
    x.alpha[px] = feather > 0 ? smoothstep(Math.min(lng - level.west, level.east - lng) / feather) : 1;
  }
  const yN = mercY(level.north);
  const yS = mercY(level.south);
  const y: Axis = { i1: new Int32Array(height), w: new Float32Array(height * 4), alpha: new Float32Array(height) };
  for (let py = 0; py < height; py++) {
    const lat = invMercY(yN - ((py + 0.5) / height) * (yN - yS));
    const g = (lat - level.south) / level.step;
    const j1 = Math.min(level.ny - 2, Math.max(0, Math.floor(g)));
    y.i1[py] = j1;
    cubicWeights(Math.min(1, Math.max(0, g - j1)), y.w, py * 4);
    y.alpha[py] = feather > 0 ? smoothstep(Math.min(lat - level.south, level.north - lat) / feather) : 1;
  }
  const out = { x, y };
  if (axisCache.size > 24) axisCache.clear();
  axisCache.set(id, out);
  return out;
}

let tmp = new Float32Array(0);

/**
 * RGBA pixels (row 0 = north) of a level's slice at the given size. `feather` (degrees) fades the
 * edges to transparent so the fine grid blends into the coarse one below it.
 */
export function renderLevel(
  level: Level,
  slice: Float32Array,
  key: ScalarKey,
  lut: Lut,
  width: number,
  height: number,
  feather = 0,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const { nx, ny } = level;
  const { x, y } = axes(level, width, height, feather);
  const px = out && out.length === width * height * 4 ? out : new Uint8ClampedArray(width * height * 4);
  if (tmp.length < ny * width) tmp = new Float32Array(ny * width);

  // Pass 1: interpolate every grid row along x.
  for (let j = 0; j < ny; j++) {
    const row = j * nx;
    const o = j * width;
    for (let c = 0; c < width; c++) {
      const i1 = x.i1[c];
      const w = c * 4;
      const i0 = i1 > 0 ? i1 - 1 : 0;
      const i2 = i1 + 1;
      const i3 = i1 + 2 < nx ? i1 + 2 : nx - 1;
      tmp[o + c] = x.w[w] * slice[row + i0] + x.w[w + 1] * slice[row + i1] + x.w[w + 2] * slice[row + i2] + x.w[w + 3] * slice[row + i3];
    }
  }
  // Pass 2: interpolate those along y, colour, fade the edges.
  const rgba = lut.rgba;
  for (let r = 0; r < height; r++) {
    const j1 = y.i1[r];
    const w = r * 4;
    const o0 = (j1 > 0 ? j1 - 1 : 0) * width;
    const o1 = j1 * width;
    const o2 = (j1 + 1) * width;
    const o3 = (j1 + 2 < ny ? j1 + 2 : ny - 1) * width;
    const w0 = y.w[w];
    const w1 = y.w[w + 1];
    const w2 = y.w[w + 2];
    const w3 = y.w[w + 3];
    const ay = y.alpha[r];
    const rowA = j1 * nx;
    const rowB = (j1 + 1) * nx;
    let p = r * width * 4;
    for (let c = 0; c < width; c++, p += 4) {
      let v = w0 * tmp[o0 + c] + w1 * tmp[o1 + c] + w2 * tmp[o2 + c] + w3 * tmp[o3 + c];
      // Keep within the four surrounding grid values: no overshoot rings along sharp coastlines.
      const i1 = x.i1[c];
      const a = slice[rowA + i1];
      const b = slice[rowA + i1 + 1];
      const d = slice[rowB + i1];
      const e = slice[rowB + i1 + 1];
      const lo = Math.min(a, b, d, e);
      const hi = Math.max(a, b, d, e);
      if (v < lo) v = lo;
      else if (v > hi) v = hi;
      if (!Number.isFinite(v)) {
        px[p + 3] = 0;
        continue;
      }
      const k = lutIndex(lut, clampValue(key, v)) * 4;
      px[p] = rgba[k];
      px[p + 1] = rgba[k + 1];
      px[p + 2] = rgba[k + 2];
      const ax = x.alpha[c];
      px[p + 3] = rgba[k + 3] * (ax < ay ? ax : ay);
    }
  }
  return px;
}

/**
 * Colour scales for the weather maps, built like Windy.com's: fixed value stops, blended in a
 * luma/chroma (YCbCr) space with the chroma magnitude kept, so a ramp between two saturated hues
 * doesn't turn grey in the middle (Windy's own client does the same).
 *
 * Wind, humidity and pressure use Windy's stops exactly (from its client bundle). Temperature keeps
 * Windy's stops up to 21 °C and stretches orange → red → crimson → plum over 26–52 °C, because
 * Windy's ramp spends 30–47 °C on one orange-to-brown segment and a Qatar summer would read as a
 * single colour. Rain uses Windy's hues at a third of its 3-hour stops (so per hour), transparent
 * when dry, on a square-root scale so drizzle and downpours both read.
 */

export type Rgba = [number, number, number, number];

export interface Palette {
  /** Value → colour stops, ascending. Alpha 0–255 (missing = 255). */
  stops: Array<[number, [number, number, number] | Rgba]>;
  /** Position scale for the lookup table and the legend. */
  scale?: "linear" | "sqrt";
}

export const PALETTES = {
  // °C. Windy's stops (its Kelvin table) to 21 °C, then a ramp stretched over Qatar's range.
  temp: {
    stops: [
      [-25, [143, 89, 169]],
      [-15, [157, 219, 217]],
      [-8, [106, 191, 181]],
      [-4, [100, 166, 189]],
      [0, [93, 133, 198]],
      [0.85, [68, 125, 99]],
      [9.85, [128, 147, 24]],
      [20.85, [243, 183, 4]],
      [26, [240, 140, 20]],
      [31, [232, 83, 25]],
      [36, [206, 36, 38]],
      [41, [160, 16, 60]],
      [46, [110, 10, 80]],
      [52, [62, 6, 58]],
    ],
  },
  // m/s. Windy's stops: calm blue → teal → green → yellow-brown → red → violet for storms.
  wind: {
    stops: [
      [0, [98, 113, 183]],
      [1, [57, 97, 159]],
      [3, [74, 148, 169]],
      [5, [77, 141, 123]],
      [7, [83, 165, 83]],
      [9, [53, 159, 53]],
      [11, [167, 157, 81]],
      [13, [159, 127, 58]],
      [15, [161, 108, 92]],
      [17, [129, 58, 78]],
      [19, [175, 80, 136]],
      [21, [117, 74, 147]],
      [24, [109, 97, 163]],
      [27, [68, 105, 141]],
      [29, [92, 144, 152]],
      [36, [125, 68, 165]],
      [46, [231, 215, 215]],
    ],
  },
  // % relative humidity. Windy's stops: dry browns → greens → teals → deep blue.
  rh: {
    stops: [
      [0, [173, 85, 56]],
      [30, [173, 110, 56]],
      [40, [173, 146, 56]],
      [50, [105, 173, 56]],
      [60, [56, 173, 121]],
      [70, [56, 174, 173]],
      [75, [56, 160, 173]],
      [80, [56, 157, 173]],
      [83, [56, 148, 173]],
      [87, [56, 135, 173]],
      [90, [56, 132, 173]],
      [93, [56, 123, 173]],
      [97, [56, 98, 157]],
      [100, [56, 70, 114]],
    ],
  },
  // mm/h. Transparent when dry, then Windy's rain hues (its mm-per-3-hours stops ÷ 3).
  rain: {
    scale: "sqrt",
    stops: [
      [0, [60, 116, 160, 0]],
      [0.04, [60, 116, 160, 0]],
      [0.2, [60, 116, 160, 215]],
      [2, [59, 161, 161, 245]],
      [2.7, [59, 161, 61, 255]],
      [3.3, [130, 161, 59, 255]],
      [5, [161, 161, 59, 255]],
      [6.7, [161, 59, 59, 255]],
      [10.3, [161, 59, 161, 255]],
      [16.7, [168, 168, 168, 255]],
      [30, [230, 230, 230, 255]],
    ],
  },
  // mm accumulated, same hues on a wider scale.
  rainAccum: {
    scale: "sqrt",
    stops: [
      [0, [60, 116, 160, 0]],
      [0.09, [60, 116, 160, 0]],
      [0.3, [60, 116, 160, 215]],
      [3, [59, 161, 161, 245]],
      [6, [59, 161, 61, 255]],
      [10, [130, 161, 59, 255]],
      [15, [161, 161, 59, 255]],
      [20, [161, 59, 59, 255]],
      [31, [161, 59, 161, 255]],
      [50, [168, 168, 168, 255]],
      [100, [230, 230, 230, 255]],
    ],
  },
  // % chance of rain.
  precipProb: {
    stops: [
      [0, [80, 110, 150, 0]],
      [5, [80, 110, 150, 0]],
      [10, [96, 140, 190, 110]],
      [30, [70, 130, 200, 180]],
      [50, [60, 110, 200, 220]],
      [70, [90, 80, 200, 240]],
      [90, [140, 60, 190, 255]],
      [100, [170, 60, 170, 255]],
    ],
  },
  // % cloud cover: clear sky shows the map, overcast is near-white.
  cloud: {
    stops: [
      [0, [60, 60, 70, 0]],
      [10, [90, 90, 100, 40]],
      [40, [150, 150, 160, 130]],
      [70, [205, 205, 212, 200]],
      [100, [245, 245, 248, 240]],
    ],
  },
  // hPa at mean sea level. Windy's stops (its table is in Pa).
  pressure: {
    stops: [
      [950, [0, 32, 96]],
      [976, [0, 52, 146]],
      [986, [0, 90, 148]],
      [995, [0, 117, 146]],
      [1002, [26, 140, 147]],
      [1007, [103, 162, 155]],
      [1011.25, [155, 183, 172]],
      [1013.25, [182, 182, 182]],
      [1015.25, [176, 174, 152]],
      [1019, [167, 147, 107]],
      [1024, [163, 116, 67]],
      [1030, [159, 81, 44]],
      [1038, [142, 47, 57]],
      [1046, [111, 24, 64]],
    ],
  },
} satisfies Record<string, Palette>;

export type PaletteKey = keyof typeof PALETTES;

const pos = (p: Palette, v: number) => (p.scale === "sqrt" ? Math.sqrt(Math.max(0, v)) : v);
const unpos = (p: Palette, x: number) => (p.scale === "sqrt" ? x * x : x);
const withAlpha = (c: [number, number, number] | Rgba): Rgba => (c.length === 4 ? c : [c[0], c[1], c[2], 255]);

/** RGB (0–255) → luma and two chroma axes (JPEG YCbCr, scaled as Windy does). */
function toYcc(c: Rgba): [number, number, number] {
  const r = c[0] / 255;
  const g = c[1] / 255;
  const b = c[2] / 255;
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return [y, (b - y) * 0.565, (r - y) * 0.713];
}

/** Blend two stops at f ∈ [0, 1] in YCbCr, keeping the chroma magnitude (no grey middle). */
function blend(a: Rgba, b: Rgba, f: number): Rgba {
  const A = toYcc(a);
  const B = toYcc(b);
  const y = A[0] + (B[0] - A[0]) * f;
  let cb = A[1] + (B[1] - A[1]) * f;
  let cr = A[2] + (B[2] - A[2]) * f;
  const ca = Math.hypot(A[1], A[2]);
  const cbm = Math.hypot(B[1], B[2]);
  const cm = Math.hypot(cb, cr);
  if (ca > 0.05 && cbm > 0.05 && cm > 0.01) {
    const k = (ca * (1 - f) + cbm * f) / cm;
    cb *= k;
    cr *= k;
  }
  const to255 = (v: number) => Math.min(255, Math.max(0, v * 255));
  return [to255(y + 1.403 * cr), to255(y - 0.344 * cb - 0.714 * cr), to255(y + 1.77 * cb), a[3] + (b[3] - a[3]) * f];
}

/** The colour of a value (RGBA, 0–255). */
export function paletteColor(p: Palette, v: number): Rgba {
  const s = p.stops;
  if (!Number.isFinite(v)) return [0, 0, 0, 0];
  if (v <= s[0][0]) return withAlpha(s[0][1]);
  for (let i = 1; i < s.length; i++) {
    if (v <= s[i][0]) {
      const [v0, c0] = s[i - 1];
      const [v1, c1] = s[i];
      const f = (pos(p, v) - pos(p, v0)) / (pos(p, v1) - pos(p, v0) || 1);
      return blend(withAlpha(c0), withAlpha(c1), f);
    }
  }
  return withAlpha(s[s.length - 1][1]);
}

/** A fast lookup table (2048 entries across the palette's range, in its position scale). */
export interface Lut {
  rgba: Uint8ClampedArray;
  lo: number;
  hi: number;
  size: number;
  sqrt: boolean;
}

const lutCache = new WeakMap<Palette, Lut>();

export function lutFor(p: Palette, size = 2048): Lut {
  const hit = lutCache.get(p);
  if (hit) return hit;
  const lo = pos(p, p.stops[0][0]);
  const hi = pos(p, p.stops[p.stops.length - 1][0]);
  const rgba = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < size; i++) {
    const c = paletteColor(p, unpos(p, lo + ((hi - lo) * i) / (size - 1)));
    rgba[i * 4] = c[0];
    rgba[i * 4 + 1] = c[1];
    rgba[i * 4 + 2] = c[2];
    rgba[i * 4 + 3] = c[3];
  }
  const lut = { rgba, lo, hi, size, sqrt: p.scale === "sqrt" };
  lutCache.set(p, lut);
  return lut;
}

/** Index into a LUT for a value (clamped). */
export function lutIndex(l: Lut, v: number): number {
  const x = l.sqrt ? Math.sqrt(v > 0 ? v : 0) : v;
  const i = Math.round(((x - l.lo) / (l.hi - l.lo)) * (l.size - 1));
  return i < 0 ? 0 : i >= l.size ? l.size - 1 : i;
}

/** Legend position (0–1) of a value within [min, max] in the palette's scale. */
export function legendPos(p: Palette, v: number, min: number, max: number): number {
  const a = pos(p, min);
  const b = pos(p, max);
  return Math.min(1, Math.max(0, (pos(p, v) - a) / (b - a || 1)));
}

/** CSS gradient for a legend bar from `min` to `max`. Transparent stops keep a faint tint so "none" still reads. */
export function paletteGradient(p: Palette, min: number, max: number, steps = 32): string {
  const a = pos(p, min);
  const b = pos(p, max);
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const v = unpos(p, a + ((b - a) * i) / steps);
    const c = paletteColor(p, v);
    const alpha = Math.max(0.18, c[3] / 255);
    parts.push(`rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha.toFixed(2)}) ${((i / steps) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/** Black or white text on a palette colour (WCAG relative luminance; 0.18 balances contrast both ways). */
export function textOn(c: Rgba): string {
  const [r, g, b] = [c[0], c[1], c[2]].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? "#101412" : "#ffffff";
}

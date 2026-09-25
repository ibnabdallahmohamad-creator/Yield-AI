/**
 * Map layers for the land atlas: compact per-cell rows (sent to the browser) and colour scales.
 * Client-safe.
 */
import type { LandformId } from "./landscape";

/** One cell of the atlas map (short keys keep the ≈1,200-row payload small). */
export interface AtlasCell {
  id: string;
  /** Bounds: south, west, north, east. */
  b: [number, number, number, number];
  /** Municipality. */
  m: string;
  lf: LandformId;
  arable: boolean;
  fertility: number;
  rain: number;
  tmax: number;
  tmin: number;
  rh: number;
  tds: number;
  et0: number;
}

export type AtlasLayer = "fertility" | "rain" | "tmax" | "tmin" | "rh" | "tds" | "landform";

type Rgb = [number, number, number];

interface ScaleLayer {
  kind: "scale";
  label: string;
  unit: string;
  value: (c: AtlasCell) => number;
  domain: [number, number];
  stops: Rgb[];
  describe: string;
}

interface CategoryLayer {
  kind: "category";
  label: string;
  describe: string;
}

export const LANDFORM_COLORS: Record<LandformId, { color: string; label: string }> = {
  "rawdat-plain": { color: "#3f8f4f", label: "Rawdat plain" },
  "limestone-plateau": { color: "#c9b47a", label: "Limestone plateau" },
  "coastal-flat": { color: "#8fb8b0", label: "Coastal flat" },
  sabkha: { color: "#e9e1d0", label: "Sabkha" },
  dukhan: { color: "#b08968", label: "Dukhan anticline" },
  dunes: { color: "#e8c77c", label: "Sand dunes" },
  urban: { color: "#8c8c96", label: "Urban" },
  industrial: { color: "#5f5f6b", label: "Industrial" },
};

export const ATLAS_LAYERS: Record<AtlasLayer, ScaleLayer | CategoryLayer> = {
  fertility: {
    kind: "scale",
    label: "Fertility",
    unit: "/100",
    value: (c) => c.fertility,
    domain: [0, 70],
    stops: [
      [237, 226, 196],
      [190, 205, 130],
      [63, 143, 79],
      [22, 88, 55],
    ],
    describe: "Relative to Qatar's soils: rawdat depth and texture, salinity and coastal flats.",
  },
  rain: {
    kind: "scale",
    label: "Rainfall",
    unit: "mm/yr",
    value: (c) => c.rain,
    domain: [50, 105],
    stops: [
      [240, 236, 220],
      [150, 200, 225],
      [40, 110, 180],
    ],
    describe: "Long-term mean annual rainfall (north–south gradient, Mamoon & Rahman 2017).",
  },
  tmax: {
    kind: "scale",
    label: "July highs",
    unit: "°C",
    value: (c) => c.tmax,
    domain: [40.5, 44.5],
    stops: [
      [254, 232, 170],
      [245, 150, 80],
      [190, 40, 40],
    ],
    describe: "Mean daily maximum in July — hotter inland, milder on the coast and in the north.",
  },
  tmin: {
    kind: "scale",
    label: "January lows",
    unit: "°C",
    value: (c) => c.tmin,
    domain: [10.5, 14.5],
    stops: [
      [40, 90, 170],
      [130, 180, 220],
      [235, 240, 245],
    ],
    describe: "Mean daily minimum in January — inland nights are cooler.",
  },
  rh: {
    kind: "scale",
    label: "Humidity",
    unit: "%",
    value: (c) => c.rh,
    domain: [48, 62],
    stops: [
      [245, 235, 210],
      [150, 200, 190],
      [30, 120, 140],
    ],
    describe: "Mean annual relative humidity — highest on the coasts.",
  },
  tds: {
    kind: "scale",
    label: "Groundwater salinity",
    unit: "mg/L",
    value: (c) => c.tds,
    domain: [1500, 9000],
    stops: [
      [60, 140, 90],
      [240, 200, 90],
      [200, 60, 50],
    ],
    describe: "Estimated TDS of well water — freshest in the northern basin, saltier toward coasts and the south.",
  },
  landform: { kind: "category", label: "Landform", describe: "Soil and landform classes after the Atlas of Soils for the State of Qatar." },
};

function lerp(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scaleColor(layer: ScaleLayer, value: number): string {
  const [lo, hi] = layer.domain;
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  const seg = t * (layer.stops.length - 1);
  const i = Math.min(layer.stops.length - 2, Math.floor(seg));
  const rgb = lerp(layer.stops[i], layer.stops[i + 1], seg - i);
  return `rgb(${rgb.map(Math.round).join(",")})`;
}

export function cellColor(layer: AtlasLayer, cell: AtlasCell): string {
  const def = ATLAS_LAYERS[layer];
  if (def.kind === "category") return LANDFORM_COLORS[cell.lf].color;
  if (layer === "fertility" && !cell.arable) return "#d9d4c7";
  return scaleColor(def, def.value(cell));
}

export function formatLayerValue(layer: AtlasLayer, cell: AtlasCell): string {
  const def = ATLAS_LAYERS[layer];
  if (def.kind === "category") return LANDFORM_COLORS[cell.lf].label;
  const v = def.value(cell);
  if (layer === "fertility" && !cell.arable) return "not farmable";
  return `${v.toLocaleString("en-US", { maximumFractionDigits: layer === "tmax" || layer === "tmin" ? 1 : 0 })} ${def.unit}`;
}

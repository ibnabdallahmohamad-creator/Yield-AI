/**
 * Map layers / chart metrics: labels, units, the method behind each value (shown in info
 * tooltips), and scientific colour scales with fixed, labelled thresholds.
 *
 * Colour ramps are ColorBrewer schemes (Brewer, Harrower & Penn State): one-hue or analogous
 * sequential ramps for magnitudes and a two-hue diverging ramp with a neutral grey midpoint
 * for quantities with a meaningful centre (pH neutrality, the RAW irrigation trigger).
 */
import { CROPS } from "./agronomy-tables";
import type { FarmDay, SensorDay } from "./types";

export type MetricKey =
  | "ece"
  | "moisture"
  | "ph"
  | "temperature"
  | "n"
  | "p"
  | "k"
  | "et0"
  | "etc"
  | "deficit"
  | "yieldLoss";

export interface ScaleClass {
  min: number;
  max: number;
  color: string;
  label: string;
}

export interface MetricDef {
  key: MetricKey;
  label: string;
  short: string;
  unit: string;
  decimals: number;
  group: "probe" | "derived";
  /** Interpolated per probe (IDW) vs one value for the whole farm. */
  spatial: boolean;
  /** Method / source, shown in info tooltips next to every value. */
  method: string;
  classes: ScaleClass[];
  /** Upper bound used to draw the open-ended last class. */
  displayMax: number;
  /** Direction that is bad for the crop (colours delta badges); null = neutral. */
  higherIsWorse: boolean | null;
  deltaMode: "relative" | "absolute";
  deltaUnit?: string;
  farmValue: (day: FarmDay) => number | null;
  sensorValue: (sensor: SensorDay, day: FarmDay) => number | null;
}

const salinityClasses: ScaleClass[] = [
  // FAO/USDA classes by ECe of the saturated paste extract (project brief). ColorBrewer YlOrRd.
  { min: 0, max: 2, color: "#ffffb2", label: "Non-saline" },
  { min: 2, max: 4, color: "#fecc5c", label: "Slightly saline" },
  { min: 4, max: 8, color: "#fd8d3c", label: "Moderately saline" },
  { min: 8, max: 16, color: "#e8412b", label: "Strongly saline" },
  { min: 16, max: Infinity, color: "#a50026", label: "Very strongly saline" },
];

export const METRICS: Record<MetricKey, MetricDef> = {
  ece: {
    key: "ece",
    label: "Salinity (ECe)",
    short: "ECe",
    unit: "dS/m",
    decimals: 1,
    group: "probe",
    spatial: true,
    method:
      "ECe (estimated) = probe bulk EC × the farm's calibration factor (fit from paired lab saturated-paste samples). Classes: FAO/USDA salinity classes.",
    classes: salinityClasses,
    displayMax: 24,
    higherIsWorse: true,
    deltaMode: "relative",
    farmValue: (d) => d.ece,
    sensorValue: (s) => s.ece,
  },
  moisture: {
    key: "moisture",
    label: "Soil moisture",
    short: "Moisture",
    unit: "% VWC",
    decimals: 1,
    group: "probe",
    spatial: true,
    method:
      "Volumetric water content from the probe's capacitance sensor. Reference θWP/θFC for the farm's soil: FAO-56 Table 19.",
    // ColorBrewer YlGnBu (dry → wet). Class edges bracket FAO-56 Table 19 sand / loamy sand limits.
    classes: [
      { min: 0, max: 5, color: "#ffffcc", label: "< 5 %" },
      { min: 5, max: 8, color: "#c7e9b4", label: "5–8 %" },
      { min: 8, max: 11, color: "#7fcdbb", label: "8–11 %" },
      { min: 11, max: 14, color: "#41b6c4", label: "11–14 %" },
      { min: 14, max: 18, color: "#2c7fb8", label: "14–18 %" },
      { min: 18, max: Infinity, color: "#253494", label: "> 18 %" },
    ],
    displayMax: 24,
    higherIsWorse: false,
    deltaMode: "relative",
    farmValue: (d) => d.moisture,
    sensorValue: (s) => s.moisture,
  },
  ph: {
    key: "ph",
    label: "Soil pH",
    short: "pH",
    unit: "pH",
    decimals: 2,
    group: "probe",
    spatial: true,
    method: "Probe pH electrode. Classes: USDA-NRCS Soil Survey Manual soil reaction classes.",
    // ColorBrewer RdBu with a neutral grey midpoint.
    classes: [
      { min: 0, max: 5.6, color: "#b2182b", label: "Strongly acid" },
      { min: 5.6, max: 6.6, color: "#ef8a62", label: "Acid" },
      { min: 6.6, max: 7.4, color: "#e2e0d8", label: "Neutral" },
      { min: 7.4, max: 7.9, color: "#d1e5f0", label: "Slightly alkaline" },
      { min: 7.9, max: 8.5, color: "#92c5de", label: "Moderately alkaline" },
      { min: 8.5, max: 9.1, color: "#4393c3", label: "Strongly alkaline" },
      { min: 9.1, max: Infinity, color: "#2166ac", label: "Very strongly alkaline" },
    ],
    displayMax: 10,
    higherIsWorse: null,
    deltaMode: "absolute",
    deltaUnit: "",
    farmValue: (d) => d.ph,
    sensorValue: (s) => s.ph,
  },
  temperature: {
    key: "temperature",
    label: "Soil temperature",
    short: "Soil temp.",
    unit: "°C",
    decimals: 1,
    group: "probe",
    spatial: true,
    method: "Probe thermistor at root depth (daily mean). Display bins every 5 °C.",
    // ColorBrewer Oranges.
    classes: [
      { min: -Infinity, max: 20, color: "#feedde", label: "< 20 °C" },
      { min: 20, max: 25, color: "#fdd0a2", label: "20–25 °C" },
      { min: 25, max: 30, color: "#fdae6b", label: "25–30 °C" },
      { min: 30, max: 35, color: "#fd8d3c", label: "30–35 °C" },
      { min: 35, max: 40, color: "#e6550d", label: "35–40 °C" },
      { min: 40, max: Infinity, color: "#a63603", label: "> 40 °C" },
    ],
    displayMax: 45,
    higherIsWorse: null,
    deltaMode: "absolute",
    deltaUnit: "°C",
    farmValue: (d) => d.temperature,
    sensorValue: (s) => s.temperature,
  },
  n: {
    key: "n",
    label: "Nitrogen (N)",
    short: "N",
    unit: "mg/kg",
    decimals: 0,
    group: "probe",
    spatial: true,
    method: "Probe N estimate (mg/kg). Display bins only — not a lab soil-test sufficiency rating.",
    classes: [
      { min: 0, max: 10, color: "#edf8e9", label: "< 10" },
      { min: 10, max: 20, color: "#c7e9c0", label: "10–20" },
      { min: 20, max: 40, color: "#74c476", label: "20–40" },
      { min: 40, max: 60, color: "#31a354", label: "40–60" },
      { min: 60, max: Infinity, color: "#006d2c", label: "> 60" },
    ],
    displayMax: 80,
    higherIsWorse: false,
    deltaMode: "relative",
    farmValue: (d) => d.n,
    sensorValue: (s) => s.n,
  },
  p: {
    key: "p",
    label: "Phosphorus (P)",
    short: "P",
    unit: "mg/kg",
    decimals: 0,
    group: "probe",
    spatial: true,
    method: "Probe P estimate (mg/kg). Display bins only — not a lab soil-test sufficiency rating.",
    classes: [
      { min: 0, max: 10, color: "#edf8e9", label: "< 10" },
      { min: 10, max: 20, color: "#c7e9c0", label: "10–20" },
      { min: 20, max: 30, color: "#74c476", label: "20–30" },
      { min: 30, max: 40, color: "#31a354", label: "30–40" },
      { min: 40, max: Infinity, color: "#006d2c", label: "> 40" },
    ],
    displayMax: 50,
    higherIsWorse: false,
    deltaMode: "relative",
    farmValue: (d) => d.p,
    sensorValue: (s) => s.p,
  },
  k: {
    key: "k",
    label: "Potassium (K)",
    short: "K",
    unit: "mg/kg",
    decimals: 0,
    group: "probe",
    spatial: true,
    method: "Probe K estimate (mg/kg). Display bins only — not a lab soil-test sufficiency rating.",
    classes: [
      { min: 0, max: 100, color: "#edf8e9", label: "< 100" },
      { min: 100, max: 150, color: "#c7e9c0", label: "100–150" },
      { min: 150, max: 200, color: "#74c476", label: "150–200" },
      { min: 200, max: 250, color: "#31a354", label: "200–250" },
      { min: 250, max: Infinity, color: "#006d2c", label: "> 250" },
    ],
    displayMax: 300,
    higherIsWorse: false,
    deltaMode: "relative",
    farmValue: (d) => d.k,
    sensorValue: (s) => s.k,
  },
  et0: {
    key: "et0",
    label: "Reference ET (ET₀)",
    short: "ET₀",
    unit: "mm/day",
    decimals: 1,
    group: "derived",
    spatial: false,
    method:
      "FAO-56 Penman–Monteith (Eq. 6, daily, G = 0): probe air Tmax/Tmin and RH, Open-Meteo wind (10 m → 2 m, Eq. 47) and solar radiation. Falls back to FAO-56 Hargreaves (Eq. 52) when an input is missing.",
    // ColorBrewer Purples.
    classes: [
      { min: 0, max: 2, color: "#f2f0f7", label: "< 2" },
      { min: 2, max: 4, color: "#dadaeb", label: "2–4" },
      { min: 4, max: 6, color: "#bcbddc", label: "4–6" },
      { min: 6, max: 8, color: "#9e9ac8", label: "6–8" },
      { min: 8, max: 10, color: "#756bb1", label: "8–10" },
      { min: 10, max: Infinity, color: "#54278f", label: "> 10" },
    ],
    displayMax: 12,
    higherIsWorse: null,
    deltaMode: "relative",
    farmValue: (d) => d.et0,
    sensorValue: (_s, d) => d.et0,
  },
  etc: {
    key: "etc",
    label: "Crop water use (ETc)",
    short: "ETc",
    unit: "mm/day",
    decimals: 1,
    group: "derived",
    spatial: false,
    method:
      "ETc = Kc × ET₀ (FAO-56 Eq. 56). Kc by growth stage from FAO-56 Tables 11–12, Kc mid/end adjusted for local wind and humidity (Eq. 62, 65).",
    classes: [
      { min: 0, max: 2, color: "#f2f0f7", label: "< 2" },
      { min: 2, max: 4, color: "#dadaeb", label: "2–4" },
      { min: 4, max: 6, color: "#bcbddc", label: "4–6" },
      { min: 6, max: 8, color: "#9e9ac8", label: "6–8" },
      { min: 8, max: 10, color: "#756bb1", label: "8–10" },
      { min: 10, max: Infinity, color: "#54278f", label: "> 10" },
    ],
    displayMax: 12,
    higherIsWorse: null,
    deltaMode: "relative",
    farmValue: (d) => d.etc,
    sensorValue: (_s, d) => d.etc,
  },
  deficit: {
    key: "deficit",
    label: "Water deficit",
    short: "Deficit",
    unit: "% of RAW",
    decimals: 0,
    group: "derived",
    spatial: true,
    method:
      "Root-zone depletion Dr = 1000 (θFC − θ) Zr (FAO-56 Eq. 87) as a share of readily available water RAW = p × TAW (Eq. 82–83, p adjusted for ETc). 100 % = irrigation trigger; above it the crop is water-stressed (Ks < 1, Eq. 84).",
    // ColorBrewer RdBu, neutral grey at the irrigation trigger.
    classes: [
      { min: 0, max: 50, color: "#2166ac", label: "Well watered" },
      { min: 50, max: 80, color: "#92c5de", label: "Adequate" },
      { min: 80, max: 100, color: "#e2e0d8", label: "Irrigate soon" },
      { min: 100, max: 150, color: "#f4a582", label: "Water stress" },
      { min: 150, max: Infinity, color: "#b2182b", label: "Severe stress" },
    ],
    displayMax: 250,
    higherIsWorse: true,
    deltaMode: "absolute",
    deltaUnit: "pts",
    farmValue: (d) => d.deficitPct,
    sensorValue: (s) => s.deficitPct,
  },
  yieldLoss: {
    key: "yieldLoss",
    label: "Predicted yield loss",
    short: "Yield loss",
    unit: "%",
    decimals: 0,
    group: "derived",
    spatial: true,
    method:
      "Maas–Hoffman salinity model: relative yield = 100 − b (ECe − threshold), crop threshold and slope from FAO-29 Table 4 (FAO-61 Table A1.1 for eggplant). Bins follow the FAO-29 90/75/50 % yield-potential columns.",
    // ColorBrewer Reds.
    classes: [
      { min: 0, max: 10, color: "#fee5d9", label: "0–10 %" },
      { min: 10, max: 25, color: "#fcae91", label: "10–25 %" },
      { min: 25, max: 50, color: "#fb6a4a", label: "25–50 %" },
      { min: 50, max: 100.01, color: "#cb181d", label: "> 50 %" },
    ],
    displayMax: 100,
    higherIsWorse: true,
    deltaMode: "absolute",
    deltaUnit: "pts",
    farmValue: (d) => d.yieldLoss,
    sensorValue: (s) => s.yieldLoss,
  },
};

/** Order of the map metric switcher. NPK is one switcher entry with an N/P/K sub-toggle. */
export const PROBE_LAYERS: MetricKey[] = ["ece", "moisture", "ph", "temperature", "n"];
export const DERIVED_LAYERS: MetricKey[] = ["et0", "etc", "deficit", "yieldLoss"];
export const NUTRIENT_KEYS: MetricKey[] = ["n", "p", "k"];

export function isNutrient(key: MetricKey): boolean {
  return key === "n" || key === "p" || key === "k";
}

// ---------------------------------------------------------------------------
// Colour scale
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const rgbCache = new Map<string, [number, number, number]>();
function rgb(hex: string) {
  let v = rgbCache.get(hex);
  if (!v) {
    v = hexToRgb(hex);
    rgbCache.set(hex, v);
  }
  return v;
}

/**
 * Position of a value along the legend (0–1): each class occupies an equal-width segment,
 * values are placed linearly inside their class.
 */
export function legendPosition(metric: MetricDef, value: number): number {
  const classes = metric.classes;
  const n = classes.length;
  for (let i = 0; i < n; i++) {
    const c = classes[i];
    if (value < c.max || i === n - 1) {
      const lo = Number.isFinite(c.min) ? c.min : Math.min(c.max - (classes[1].max - classes[1].min), value);
      const hi = Number.isFinite(c.max) ? c.max : metric.displayMax;
      const f = hi > lo ? Math.min(1, Math.max(0, (value - lo) / (hi - lo))) : 0.5;
      return (i + f) / n;
    }
  }
  return 1;
}

/** Smooth colour for a value: class colours anchored at segment centres, linear blend between. */
export function colorRgb(metric: MetricDef, value: number): [number, number, number] {
  const n = metric.classes.length;
  const t = legendPosition(metric, value) * n - 0.5; // in anchor units
  if (t <= 0) return rgb(metric.classes[0].color);
  if (t >= n - 1) return rgb(metric.classes[n - 1].color);
  const i = Math.floor(t);
  const f = t - i;
  const a = rgb(metric.classes[i].color);
  const b = rgb(metric.classes[i + 1].color);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function colorFor(metric: MetricDef, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "#9ca3af";
  const [r, g, b] = colorRgb(metric, value);
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/** CSS gradient that matches `colorRgb` exactly, for the legend bar. */
export function legendGradient(metric: MetricDef): string {
  const n = metric.classes.length;
  const stops = metric.classes.map((c, i) => `${c.color} ${(((i + 0.5) / n) * 100).toFixed(2)}%`);
  return `linear-gradient(to right, ${metric.classes[0].color} 0%, ${stops.join(", ")}, ${metric.classes[n - 1].color} 100%)`;
}

export function classFor(metric: MetricDef, value: number | null | undefined): ScaleClass | null {
  if (value == null || !Number.isFinite(value)) return null;
  return metric.classes.find((c) => value >= c.min && value < c.max) ?? metric.classes[metric.classes.length - 1];
}

/** Pick black or white text for a label drawn on top of a colour. */
export function readableTextOn(rgbColor: [number, number, number]): string {
  const [r, g, b] = rgbColor.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#1c2320" : "#ffffff";
}

// ---------------------------------------------------------------------------
// Formatting & deltas
// ---------------------------------------------------------------------------

export function formatValue(metric: MetricDef, value: number | null | undefined, withUnit = true): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const v = value.toLocaleString("en-US", {
    minimumFractionDigits: metric.decimals,
    maximumFractionDigits: metric.decimals,
  });
  if (!withUnit) return v;
  if (metric.unit === "pH") return `pH ${v}`;
  return `${v} ${metric.unit}`;
}

/** Units for tight spaces (farm list rows, map pins). */
const COMPACT_UNIT: Partial<Record<MetricKey, string>> = {
  moisture: "%",
  deficit: "%",
  yieldLoss: "%",
  ph: "",
  et0: "mm/d",
  etc: "mm/d",
};

/** Value with a short unit, e.g. "12.8%", "6.6 dS/m", "7.85" (pH). */
export function formatCompact(metric: MetricDef, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const v = formatValue(metric, value, false);
  const unit = COMPACT_UNIT[metric.key] ?? metric.unit;
  if (!unit) return v;
  return unit === "%" ? `${v}%` : `${v} ${unit}`;
}

export interface Delta {
  value: number;
  text: string;
  tone: "bad" | "good" | "neutral";
}

/** Change from `then` to `now`, as the metric's delta badge (e.g. "ECe +18%"). */
export function computeDelta(metric: MetricDef, then: number | null, now: number | null): Delta | null {
  if (then == null || now == null || !Number.isFinite(then) || !Number.isFinite(now)) return null;
  let value: number;
  let text: string;
  if (metric.deltaMode === "relative") {
    if (Math.abs(then) < 1e-9) return null;
    value = ((now - then) / Math.abs(then)) * 100;
    text = `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(0)}%`;
  } else {
    value = now - then;
    const decimals = metric.key === "ph" ? 2 : metric.key === "temperature" ? 1 : 0;
    text = `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(decimals)}${metric.deltaUnit ? ` ${metric.deltaUnit}` : ""}`;
  }
  const significant = metric.deltaMode === "relative" ? Math.abs(value) >= 5 : Math.abs(value) >= (metric.key === "ph" ? 0.1 : 3);
  let tone: Delta["tone"] = "neutral";
  if (significant && metric.higherIsWorse !== null) {
    tone = value > 0 === metric.higherIsWorse ? "bad" : "good";
  }
  return { value, text, tone };
}

/** Crop salinity threshold for chart reference lines. */
export function cropSalinityThreshold(cropId: keyof typeof CROPS): number {
  return CROPS[cropId].salinity.threshold_dS_per_m;
}

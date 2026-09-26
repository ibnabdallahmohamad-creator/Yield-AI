/**
 * ESP32 readings → the units the app stores and the fine-tuned model expects.
 *
 * Stored units (lib/types.ts SensorReading), which are also the model's units:
 *   moisture       volumetric water content, % (m³/m³ × 100)   → model input 9 `soil_moisture` (*_vwc_pct)
 *   temperature    soil temperature, °C
 *   ec             bulk soil EC, dS/m (= mS/cm)
 *   ph             pH units
 *   n, p, k        mg/kg (= ppm)
 *   air_temp       °C                                          (model inputs 5–8 come from Open-Meteo in
 *   air_humidity   relative humidity, %                         °C, %, m/s at 10 m and mm — see below)
 *
 * `normalizeDeviceUnits` runs before validation on every ESP32 upload, so a sketch may send the units
 * its sensor gives: a fraction instead of a percentage, °F, µS/cm or mS/m, … either as suffixed field
 * names (`vwc`, `soil_temp_f`, `ec_us_cm`, `ec_ms_m`, `air_temp_f`, `humidity_frac`) or as an explicit
 * `units` object (`{ "moisture": "fraction", "temperature": "F", "ec": "uS/cm" }`).
 *
 * `soilMoistureInput` turns the account's probe readings into input 9 exactly as the training set
 * shaped the field robot's survey (lib/dataset/soil.ts RobotSurvey): VWC % at 0–30 cm, mean / min / max
 * across the field, the number of readings and the change over 7 days.
 */

type Json = Record<string, unknown>;

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export const fahrenheitToCelsius = (f: number) => r2(((f - 32) * 5) / 9);
export const kelvinToCelsius = (k: number) => r2(k - 273.15);

/** EC in any common unit → dS/m (= mS/cm). */
export function ecToDsPerM(value: number, unit: string): number | null {
  const u = unit.toLowerCase().replace(/[\s_µ]/g, (c) => (c === "µ" ? "u" : "")).replace("/", "");
  switch (u) {
    case "dsm":
    case "mscm":
      return value;
    case "uscm":
      return value / 1000;
    case "msm":
      return value / 100;
    case "sm":
      return value * 10;
    default:
      return null;
  }
}

/** Moisture in any common unit → % VWC. "raw" ADC counts can't be converted without calibration. */
export function moistureToPercent(value: number, unit: string): number | null {
  const u = unit.toLowerCase().replace(/\s/g, "");
  if (u === "%" || u === "pct" || u === "percent" || u === "vwc%") return value;
  if (u === "fraction" || u === "m3/m3" || u === "m³/m³" || u === "frac") return value * 100;
  if (u === "permille" || u === "‰") return value / 10;
  return null;
}

function temperatureToCelsius(value: number, unit: string): number | null {
  const u = unit.toLowerCase().replace(/[\s°]/g, "");
  if (u === "c" || u === "celsius") return value;
  if (u === "f" || u === "fahrenheit") return fahrenheitToCelsius(value);
  if (u === "k" || u === "kelvin") return kelvinToCelsius(value);
  return null;
}

/** Suffixed field → [canonical field, converter]. The canonical field wins when both are sent. */
const SUFFIXED: Record<string, [string, (v: number) => number]> = {
  vwc: ["moisture", (v) => v * 100],
  moisture_frac: ["moisture", (v) => v * 100],
  soil_moisture_frac: ["moisture", (v) => v * 100],
  moisture_pct: ["moisture", (v) => v],
  soil_moisture_pct: ["moisture", (v) => v],
  temperature_f: ["temperature", fahrenheitToCelsius],
  soil_temp_f: ["temperature", fahrenheitToCelsius],
  soil_temperature_f: ["temperature", fahrenheitToCelsius],
  temperature_c: ["temperature", (v) => v],
  soil_temp_c: ["temperature", (v) => v],
  ec_ds_m: ["ec", (v) => v],
  ec_ms_cm: ["ec", (v) => v],
  ec_ms_m: ["ec", (v) => v / 100],
  ec_s_m: ["ec", (v) => v * 10],
  ec_us_cm: ["ec", (v) => v / 1000],
  air_temp_f: ["air_temp", fahrenheitToCelsius],
  air_temperature_f: ["air_temp", fahrenheitToCelsius],
  air_temp_c: ["air_temp", (v) => v],
  humidity_frac: ["air_humidity", (v) => v * 100],
  air_humidity_frac: ["air_humidity", (v) => v * 100],
  humidity_pct: ["air_humidity", (v) => v],
  n_ppm: ["n", (v) => v],
  p_ppm: ["p", (v) => v],
  k_ppm: ["k", (v) => v],
  n_mg_kg: ["n", (v) => v],
  p_mg_kg: ["p", (v) => v],
  k_mg_kg: ["k", (v) => v],
};

/**
 * One ESP32 reading with every measurement converted to the stored units. Unknown fields pass
 * through untouched; values that can't be converted are left for validation to reject.
 */
export function normalizeDeviceUnits(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Json = { ...(value as Json) };

  for (const [field, [target, convert]] of Object.entries(SUFFIXED)) {
    const v = toNum(out[field]);
    if (v == null || out[target] != null) continue;
    // ec_us_cm keeps its own field (the ingest schema reads it), everything else maps onto the canonical name.
    if (field === "ec_us_cm") continue;
    out[target] = r2(convert(v));
  }

  const units = out.units && typeof out.units === "object" && !Array.isArray(out.units) ? (out.units as Json) : null;
  if (units) {
    const unitOf = (k: string) => (typeof units[k] === "string" ? (units[k] as string) : null);
    const convert = (field: string, unit: string | null, fn: (v: number, u: string) => number | null) => {
      const v = toNum(out[field]);
      if (v == null || !unit) return;
      const c = fn(v, unit);
      if (c != null) out[field] = r2(c);
    };
    convert("moisture", unitOf("moisture") ?? unitOf("soil_moisture"), moistureToPercent);
    convert("temperature", unitOf("temperature") ?? unitOf("soil_temp"), temperatureToCelsius);
    convert("air_temp", unitOf("air_temp") ?? unitOf("air_temperature"), temperatureToCelsius);
    convert("air_humidity", unitOf("air_humidity") ?? unitOf("humidity"), moistureToPercent);
    convert("ec", unitOf("ec"), ecToDsPerM);
    delete out.units;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Model input 9: soil moisture
// ---------------------------------------------------------------------------

export interface ProbeMoisture {
  sensor_id: string;
  /** ISO time of the reading. */
  timestamp: string;
  /** % VWC (already normalized at ingest). */
  moisture: number | null;
}

/** Input 9 as the model was trained on it (lib/dataset/farm-analysis.ts). */
export type SoilMoistureInput =
  | {
      source: string;
      measured_at: string;
      depth_cm: string;
      mean_vwc_pct: number;
      min_vwc_pct: number;
      max_vwc_pct: number;
      readings: number;
      change_7d_pct_points: number;
    }
  | { source: string; status: string };

/** The survey part of input 9 (lib/dataset/soil.ts RobotSurvey), or null without a recent reading. */
export interface MoistureSurvey {
  mean_vwc_pct: number;
  min_vwc_pct: number;
  max_vwc_pct: number;
  readings: number;
  change_7d_pct_points: number;
  /** Newest reading used, ISO. */
  latest: string;
}

const HOUR = 3_600_000;

/**
 * The latest field survey from fixed ESP32 probes: each probe's mean over the last hour it reported
 * (within the last 24 h) is one "location" of the survey, like one stop of the field robot. The 7-day
 * change compares the field mean with the same probes' readings 7 days earlier (± 12 h); without
 * those it is 0 and the caller should list it as a data gap.
 */
export function moistureSurvey(readings: ProbeMoisture[], now = Date.now()): { survey: MoistureSurvey | null; weekAgoKnown: boolean } {
  const valid = readings.filter((r) => r.moisture != null && Number.isFinite(r.moisture) && r.moisture >= 0 && r.moisture <= 100);
  const bySensor = new Map<string, Array<{ t: number; v: number }>>();
  for (const r of valid) {
    const t = Date.parse(r.timestamp);
    if (!Number.isFinite(t) || t > now + 5 * 60_000) continue;
    let list = bySensor.get(r.sensor_id);
    if (!list) bySensor.set(r.sensor_id, (list = []));
    list.push({ t, v: r.moisture! });
  }

  const current: number[] = [];
  const weekAgo: number[] = [];
  let latest = 0;
  let count = 0;
  for (const list of bySensor.values()) {
    const last = Math.max(...list.map((x) => x.t));
    if (now - last <= 24 * HOUR) {
      const recent = list.filter((x) => x.t > last - HOUR);
      current.push(recent.reduce((a, x) => a + x.v, 0) / recent.length);
      count += recent.length;
      latest = Math.max(latest, last);
    }
    const target = now - 7 * 24 * HOUR;
    const old = list.filter((x) => Math.abs(x.t - target) <= 12 * HOUR);
    if (old.length) weekAgo.push(old.reduce((a, x) => a + x.v, 0) / old.length);
  }
  if (current.length === 0) return { survey: null, weekAgoKnown: false };
  const mean = current.reduce((a, b) => a + b, 0) / current.length;
  const weekMean = weekAgo.length ? weekAgo.reduce((a, b) => a + b, 0) / weekAgo.length : null;
  return {
    survey: {
      mean_vwc_pct: r1(mean),
      min_vwc_pct: r1(Math.min(...current)),
      max_vwc_pct: r1(Math.max(...current)),
      readings: count,
      change_7d_pct_points: weekMean != null ? r1(mean - weekMean) : 0,
      latest: new Date(latest).toISOString(),
    },
    weekAgoKnown: weekMean != null,
  };
}

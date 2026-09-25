/**
 * Indicative guide values for the charts: nutrient sufficiency ranges and heat-stress lines.
 *
 * Unlike `lib/agronomy-tables.ts`, these are NOT copied from a single published table. They are
 * generic rules of thumb, drawn as faint reference bands and always labelled "indicative" in the
 * UI. Replace them with your agronomist's targets (see ui_improvement.md §10, questions 10–11).
 */
import type { CropId } from "./agronomy-tables";

export type NutrientKey = "n" | "p" | "k";

export interface NutrientGuide {
  key: NutrientKey;
  label: string;
  /** Below `low`: likely deficient. Between `low` and `high`: adequate. Above `high`: ample. */
  low: number;
  high: number;
  /** Top of the chart's y-axis should reach at least this. */
  chartMax: number;
}

export const NUTRIENT_GUIDE: Record<NutrientKey, NutrientGuide> = {
  n: { key: "n", label: "Nitrogen", low: 20, high: 40, chartMax: 60 },
  p: { key: "p", label: "Phosphorus", low: 10, high: 25, chartMax: 40 },
  k: { key: "k", label: "Potassium", low: 100, high: 200, chartMax: 250 },
};

export const NUTRIENT_GUIDE_SOURCE =
  "Indicative soil-test ranges for vegetables on sandy soils (mg/kg), not crop-specific. Confirm targets with your agronomist.";

export type NutrientStatus = "low" | "adequate" | "ample";

export function nutrientStatus(key: NutrientKey, value: number | null | undefined): NutrientStatus | null {
  if (value == null || !Number.isFinite(value)) return null;
  const g = NUTRIENT_GUIDE[key];
  if (value < g.low) return "low";
  if (value > g.high) return "ample";
  return "adequate";
}

/**
 * Daily maximum air temperature (°C) above which heat stress is likely — flower drop and poor
 * fruit set for the vegetables, growth slowdown for alfalfa. Indicative, not a published table.
 */
export const HEAT_STRESS_C: Record<CropId, number> = {
  tomato: 35,
  cucumber: 35,
  sweet_pepper: 35,
  eggplant: 35,
  zucchini: 35,
  alfalfa: 38,
};

export const HEAT_STRESS_SOURCE = "Indicative heat-stress line for the crop (daily maximum air temperature).";

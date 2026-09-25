/**
 * Client-safe helpers that turn `DashboardData` into what the dashboard draws: ranked farms,
 * per-farm values for a metric and day, probe samples for the IDW layer and chart series.
 */
import { GROWTH_STAGE_LABEL, soilWaterLimits } from "./agronomy";
import { CROPS, SOILS } from "./agronomy-tables";
import { lastDataIndex } from "./ai/analysis";
import type { MetricDef } from "./metrics";
import type { Farm, FarmBundle, FarmDay } from "./types";

/** Farms ordered by AI risk score (highest first); farms without an insight go last. */
export function rankFarms(farms: FarmBundle[]): FarmBundle[] {
  return [...farms].sort((a, b) => {
    const ra = a.insight?.risk_score ?? -1;
    const rb = b.insight?.risk_score ?? -1;
    return rb - ra || a.farm.name.localeCompare(b.farm.name);
  });
}

/** The farm day at `index`, or null when that day has no readings. */
export function dayAtIndex(bundle: FarmBundle, index: number): FarmDay | null {
  return bundle.days[index] ?? null;
}

/** The latest day at or before `index` that has data (falls back across gaps, e.g. a quiet today). */
export function latestDayAt(bundle: FarmBundle, index: number): { day: FarmDay; index: number } | null {
  const i = lastDataIndex(bundle, index);
  return i >= 0 && bundle.days[i] ? { day: bundle.days[i]!, index: i } : null;
}

export function farmValueAt(bundle: FarmBundle, metric: MetricDef, index: number): number | null {
  const day = bundle.days[index];
  if (!day) return null;
  const v = metric.farmValue(day);
  return v != null && Number.isFinite(v) ? v : null;
}

export interface ProbeSample {
  id: string;
  lat: number;
  lng: number;
  value: number;
}

/** Per-probe values of a metric on one day, positioned for the map / IDW layer. */
export function probeSamples(bundle: FarmBundle, metric: MetricDef, index: number): ProbeSample[] {
  const day = bundle.days[index];
  if (!day) return [];
  const out: ProbeSample[] = [];
  for (const s of day.sensors) {
    const pos = bundle.sensors.find((p) => p.id === s.id);
    const value = metric.sensorValue(s, day);
    if (!pos || value == null || !Number.isFinite(value)) continue;
    out.push({ id: s.id, lat: pos.lat, lng: pos.lng, value });
  }
  return out;
}

/** Field capacity / wilting point for the farm's soil, in % VWC (FAO-56 Table 19 or farm override). */
export function moistureLimitsPct(farm: Farm): { fc: number; wp: number } {
  const { thetaFc, thetaWp } = soilWaterLimits(farm.soil_type, { thetaFc: farm.theta_fc, thetaWp: farm.theta_wp });
  return { fc: thetaFc * 100, wp: thetaWp * 100 };
}

/**
 * Soil moisture (% VWC) at which depletion reaches RAW — the irrigation trigger:
 * θ = θFC − RAW / (1000 Zr) (FAO-56 Eq. 87 solved for θ at Dr = RAW).
 */
export function triggerMoisturePct(farm: Farm, day: FarmDay): number | null {
  if (!(day.rootDepth > 0)) return null;
  const { fc } = moistureLimitsPct(farm);
  return fc - (day.raw / (1000 * day.rootDepth)) * 100;
}

export interface ChartRow {
  date: string;
  /** Farm mean. */
  value: number | null;
  /** Min–max across probes. */
  range: [number, number] | null;
  /** Comparison series (previous period or another farm), aligned by position in the window. */
  overlay: number | null;
  /** Metric-specific reference series (Open-Meteo ET₀ for ET₀, ET₀ for ETc, irrigation trigger for moisture). */
  reference: number | null;
}

export type ChartOverlay = { kind: "none" } | { kind: "previous" } | { kind: "farm"; bundle: FarmBundle };

function probeRange(metric: MetricDef, day: FarmDay): [number, number] | null {
  if (!metric.spatial || day.sensors.length < 2) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of day.sensors) {
    const v = metric.sensorValue(s, day);
    if (v == null || !Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

function referenceValue(metric: MetricDef, bundle: FarmBundle, day: FarmDay): number | null {
  if (metric.key === "et0") return day.et0OpenMeteo;
  if (metric.key === "etc") return day.et0;
  if (metric.key === "moisture") return triggerMoisturePct(bundle.farm, day);
  return null;
}

/** Chart rows for `bundle` over [start, end] (inclusive indices into `dates`). */
export function chartRows(
  bundle: FarmBundle,
  metric: MetricDef,
  dates: string[],
  start: number,
  end: number,
  overlay: ChartOverlay,
): ChartRow[] {
  const span = end - start + 1;
  const rows: ChartRow[] = [];
  for (let i = start; i <= end; i++) {
    const day = bundle.days[i];
    let overlayValue: number | null = null;
    if (overlay.kind === "previous") {
      const j = i - span;
      const prev = j >= 0 ? bundle.days[j] : null;
      overlayValue = prev ? metric.farmValue(prev) : null;
    } else if (overlay.kind === "farm") {
      const other = overlay.bundle.days[i];
      overlayValue = other ? metric.farmValue(other) : null;
    }
    rows.push({
      date: dates[i],
      value: day ? metric.farmValue(day) : null,
      range: day ? probeRange(metric, day) : null,
      overlay: overlayValue,
      reference: day ? referenceValue(metric, bundle, day) : null,
    });
  }
  return rows;
}

/** Does the window before [start, end] contain any data (so "previous period" can be offered)? */
export function hasPreviousPeriod(start: number, end: number): boolean {
  return start - (end - start + 1) >= 0;
}

/** Three starter questions for the chat, the first matched to the farm's main problem. */
export function suggestedQuestions(day: FarmDay | null): string[] {
  const first =
    day?.yieldLoss != null && day.yieldLoss >= 2
      ? "Why is salinity rising?"
      : day?.deficitPct != null && day.deficitPct > 100
        ? "Why is the soil so dry?"
        : "What is the biggest risk right now?";
  return [first, "How much should I irrigate?", "What should I plant next season?"];
}

/** One line under a farm's name: "Tomato · 4.2 ha · Al Khor · owner · sand · 6 probes · mid-season, day 43". */
export function farmFacts(bundle: FarmBundle, day: FarmDay | null): string {
  const { farm } = bundle;
  const parts = [
    CROPS[farm.main_crop].name,
    `${farm.area_ha.toLocaleString("en-US", { maximumFractionDigits: farm.area_ha < 1 ? 2 : 1 })} ha`,
    farm.region,
    farm.owner,
    SOILS[farm.soil_type].name.toLowerCase(),
    `${bundle.sensors.length} probe${bundle.sensors.length === 1 ? "" : "s"}`,
  ];
  if (day) parts.push(`${GROWTH_STAGE_LABEL[day.stage].toLowerCase()}, day ${day.dap}`);
  return parts.filter((p) => p.trim() !== "").join(" · ");
}

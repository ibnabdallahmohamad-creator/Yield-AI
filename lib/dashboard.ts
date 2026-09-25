/**
 * Client-safe helpers that turn `DashboardData` into what the dashboard draws: ranked farms,
 * per-farm values for a metric and day, probe samples for the IDW layer and chart series.
 */
import { GROWTH_STAGE_LABEL, soilWaterLimits } from "./agronomy";
import { CROPS, SOILS, type MarketStatus } from "./agronomy-tables";
import { lastDataIndex, rankCrops, trend, VEGETABLE_CROPS, type CropOption } from "./ai/analysis";
import type { AiInsight, Priority, Recommendation } from "./ai/contract";
import { addDays } from "./data/time";
import { formatWeekday, plural } from "./format";
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

// ---------------------------------------------------------------------------
// Plain-language summaries
// ---------------------------------------------------------------------------

/** Health tone for words and dots: red, amber and green are reserved for these. */
export type HealthTone = "bad" | "warn" | "ok" | "none";

export interface RiskReason {
  /** Two or three words, e.g. "Drying out", "Salt rising", "Healthy". */
  label: string;
  tone: HealthTone;
  /** What drives it, for choosing the chart tab and map layer that explain it. */
  driver: "water" | "salinity" | "none";
}

/** Farm-mean yield loss (%) from which salinity counts as costing yield (matches the insight rules). */
const MEANINGFUL_LOSS_PCT = 2;

/** Why a farm is (or isn't) at risk, in words — shown instead of a bare layer value (ui_improvement D4). */
export function riskReason(bundle: FarmBundle, index = bundle.days.length - 1): RiskReason {
  const i = lastDataIndex(bundle, index);
  const d = i >= 0 ? bundle.days[i] : null;
  if (!d) return { label: "No readings", tone: "none", driver: "none" };
  const threshold = CROPS[bundle.farm.main_crop].salinity.threshold_dS_per_m;
  if ((d.deficitPct ?? 0) > 100) return { label: "Drying out", tone: "bad", driver: "water" };
  const loss = d.yieldLoss ?? 0;
  if (loss >= MEANINGFUL_LOSS_PCT) {
    const rising = (trend(bundle, i, 30, (x) => x.ece).changePct ?? 0) > 10;
    return { label: rising ? "Salt rising" : "Salty soil", tone: loss >= 10 ? "bad" : "warn", driver: "salinity" };
  }
  if (d.ece != null && d.ece >= 0.85 * threshold) return { label: "Near salt limit", tone: "warn", driver: "salinity" };
  if ((d.deficitPct ?? 0) >= 80) return { label: "Irrigate soon", tone: "warn", driver: "water" };
  return { label: "Healthy", tone: "ok", driver: "none" };
}

/** One plain sentence on what is happening at the farm — numbers stay one tap away. */
export function plainHeadline(bundle: FarmBundle, index = bundle.days.length - 1): string {
  const i = lastDataIndex(bundle, index);
  const d = i >= 0 ? bundle.days[i] : null;
  if (!d) return "No probe readings yet.";
  const crop = CROPS[bundle.farm.main_crop].name.toLowerCase();
  const reason = riskReason(bundle, index);
  const loss = Math.round(d.yieldLoss ?? 0);
  switch (reason.label) {
    case "Drying out":
      return `The soil is drying out, so the ${crop} is short of water now.`;
    case "Salt rising":
      return `Salt is building up in the soil. About ${loss}% of the ${crop} yield is at risk.`;
    case "Salty soil":
      return `The soil is salty. About ${loss}% of the ${crop} yield is at risk.`;
    case "Near salt limit":
      return `Salinity is right at the ${crop}'s limit. No yield lost yet, but any rise will cost yield.`;
    case "Irrigate soon":
      return `Everything is in range, but the root zone is nearly due for water.`;
    default:
      return `${d.sensors.length === 1 ? "The probe is" : `All ${d.sensors.length} probes are`} in range. Keep the current schedule.`;
  }
}

export interface IrrigationPlan {
  status: "now" | "soon" | "later" | "unknown";
  /** "Now", "Today", "Tomorrow", or a weekday such as "Sat". */
  when: string;
  inDays: number | null;
  grossMm: number | null;
  netMm: number | null;
  /** Extra water on top of the crop's need, to wash salt below the roots (mm). */
  leachMm: number | null;
  /** The one sentence used everywhere (ui_improvement X2). */
  sentence: string;
}

/** When to irrigate next and how much — one fact, phrased once. */
export function irrigationPlan(day: FarmDay | null, dates: string[], index: number): IrrigationPlan {
  const empty: IrrigationPlan = { status: "unknown", when: "—", inDays: null, grossMm: null, netMm: null, leachMm: null, sentence: "No readings to plan irrigation." };
  if (!day || day.daysToIrrigation == null || day.grossDepth == null) return empty;
  const inDays = Math.max(0, day.daysToIrrigation);
  const offset = Math.round(inDays);
  const date = dates[index] ?? day.date;
  const when = inDays <= 0.05 ? "Now" : offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : formatWeekday(addDays(date, offset));
  const status = inDays <= 0.05 ? "now" : inDays < 1 ? "soon" : "later";
  const gross = Math.round(day.grossDepth);
  const net = day.netDepth != null ? Math.round(day.netDepth) : null;
  const leach = net != null ? gross - net : null;
  const whenText = when === "Now" ? "now" : when === "Today" || when === "Tomorrow" ? when.toLowerCase() : `on ${when}`;
  const sentence =
    leach != null && leach >= 1
      ? `Irrigate ${gross} mm ${whenText}: ${net} mm for the crop plus ${leach} mm to wash salt below the roots.`
      : `Irrigate ${gross} mm ${whenText}.`;
  return { status, when, inDays, grossMm: gross, netMm: net, leachMm: leach, sentence };
}

export interface CropChoice {
  /** The crop to plant: the assessment's suggestion, else the best crop for this salt level. */
  best: CropOption;
  /** Offered when that crop's market is oversupplied: the best-yielding crop that isn't (ui_improvement X1). */
  alternative: CropOption | null;
}

/** Next season's crop at the farm's current salinity and, if its market is glutted, an alternative. */
export function cropChoice(bundle: FarmBundle): CropChoice | null {
  const i = lastDataIndex(bundle);
  const ece = i >= 0 ? bundle.days[i]?.ece : null;
  if (ece == null) return null;
  const byYield = rankCrops(bundle.farm.main_crop, ece).sort((a, b) => b.relativeYield - a.relativeYield);
  // Follow the written assessment so the headline never contradicts its reason ("Keep tomato…").
  const suggested = bundle.insight?.crop_suggestion?.crop.toLowerCase();
  const best = byYield.find((o) => o.name.toLowerCase() === suggested) ?? byYield[0];
  if (!best) return null;
  const alternative =
    best.market === "oversupplied" && VEGETABLE_CROPS.includes(best.crop)
      ? (byYield.find((o) => o.market !== "oversupplied" && o.relativeYield >= 40) ?? null)
      : null;
  return { best, alternative };
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** An insight's actions, most urgent first (stable within a priority). */
export function sortedActions(insight: AiInsight | null): Recommendation[] {
  if (!insight) return [];
  return insight.recommendations
    .map((r, i) => ({ r, i }))
    .sort((a, b) => PRIORITY_RANK[a.r.priority] - PRIORITY_RANK[b.r.priority] || a.i - b.i)
    .map(({ r }) => r);
}

export const MARKET_LABEL: Record<MarketStatus, string> = {
  undersupplied: "In demand",
  oversupplied: "Oversupplied",
  "no-signal": "No market signal",
};

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
    `${farm.area_ha.toLocaleString("en-US", { maximumFractionDigits: 1 })} ha`,
    farm.region,
    farm.owner,
    SOILS[farm.soil_type].name.toLowerCase(),
    plural(bundle.sensors.length, "probe"),
  ];
  if (day) parts.push(`${GROWTH_STAGE_LABEL[day.stage].toLowerCase()}, day ${day.dap}`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Actions (Insights & Advice)
// ---------------------------------------------------------------------------

export const PRIORITY_WORD: Record<Priority, string> = { high: "Do first", medium: "This week", low: "When you can" };
export const PRIORITY_TONE: Record<Priority, HealthTone> = { high: "bad", medium: "warn", low: "none" };

/** The little an action needs to know about its farm (keeps client props small). */
export interface ActionFarm {
  id: string;
  name: string;
  insightId: string | null;
  riskScore: number | null;
}

export function actionFarm(bundle: FarmBundle): ActionFarm {
  return {
    id: bundle.farm.id,
    name: bundle.farm.name,
    insightId: bundle.insight?.id ?? null,
    riskScore: bundle.insight ? Math.round(bundle.insight.risk_score) : null,
  };
}

export interface FarmAction {
  rec: Recommendation;
  farm: ActionFarm;
}

/** Every farm's actions in one list: most urgent first, then the riskier farm first (ui_improvement §6.1). */
export function weeklyActions(farms: FarmBundle[]): FarmAction[] {
  return farms
    .flatMap((b) => sortedActions(b.insight).map((rec, i) => ({ rec, i, farm: actionFarm(b) })))
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.rec.priority] - PRIORITY_RANK[b.rec.priority] ||
        (b.farm.riskScore ?? -1) - (a.farm.riskScore ?? -1) ||
        a.farm.name.localeCompare(b.farm.name) ||
        a.i - b.i,
    )
    .map(({ rec, farm }) => ({ rec, farm }));
}

export interface RiskTrend {
  first: number;
  last: number;
  /** Change in points over the window (last − first). */
  change: number;
  /** Days covered, counting both ends. */
  days: number;
  /** "Rising", "Falling" or "Steady" (±5 points counts as steady). */
  word: "Rising" | "Falling" | "Steady";
}

/** How the risk score moved over its history, in words. */
export function riskTrend(points: Array<{ date: string; score: number }>): RiskTrend | null {
  if (points.length < 2) return null;
  const first = points[0].score;
  const last = points[points.length - 1].score;
  const change = last - first;
  const days = Math.round((Date.parse(points[points.length - 1].date) - Date.parse(points[0].date)) / 86_400_000) + 1;
  return { first, last, change, days, word: change > 5 ? "Rising" : change < -5 ? "Falling" : "Steady" };
}

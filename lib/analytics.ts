/**
 * Numbers behind the AI Insights tab, computed from a farm's daily data with plain statistics:
 * trends (least-squares slope and R²), anomalies (z-score of the latest day against the previous
 * two weeks), how much the probes disagree (coefficient of variation), correlations between
 * layers (Pearson r), where the salinity trend leads (Maas–Hoffman yield loss), and data quality.
 * Pure and client-safe.
 */
import { yieldLoss_pct } from "./agronomy";
import { CROPS } from "./agronomy-tables";
import { lastDataIndex } from "./ai/analysis";
import { METRICS, type MetricKey } from "./metrics";
import type { FarmBundle, FarmDay } from "./types";

export const TREND_DAYS = 14;
export const ANOMALY_BASELINE_DAYS = 14;
/** A day is an anomaly when it sits this many standard deviations off the trend of the days before it. */
export const ANOMALY_Z = 3;
/** Measured layers checked for anomalies (derived and weather-driven layers follow from these). */
const ANOMALY_METRICS = new Set<MetricKey>(["ece", "moisture", "ph", "temperature", "n", "p", "k"]);

export interface Regression {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
}

/** Ordinary least squares y = a + b x. Null with fewer than 3 points or no spread in x. */
export function linearRegression(points: Array<[number, number]>): Regression | null {
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((a, [x]) => a + x, 0) / n;
  const my = points.reduce((a, [, y]) => a + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy), n };
}

/** Pearson correlation; null with fewer than 5 pairs or no variation. */
export function pearson(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n < 5) return null;
  const mx = pairs.reduce((a, [x]) => a + x, 0) / n;
  const my = pairs.reduce((a, [, y]) => a + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

function meanSd(values: number[]): { mean: number; sd: number } | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1));
  return { mean, sd };
}

function series(bundle: FarmBundle, key: MetricKey, end: number, days: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = Math.max(0, end - days + 1); i <= end; i++) {
    const d = bundle.days[i];
    const v = d ? METRICS[key].farmValue(d) : null;
    if (v != null && Number.isFinite(v)) out.push([i, v]);
  }
  return out;
}

export interface MetricTrend {
  key: MetricKey;
  latest: number | null;
  mean7: number | null;
  mean30: number | null;
  min30: number | null;
  max30: number | null;
  /** Units per day over the last TREND_DAYS days. */
  slopePerDay: number | null;
  r2: number | null;
  /**
   * The last complete day against the trend of the two weeks before it, in standard deviations
   * of the residuals (so a steady seasonal drift is not an anomaly).
   */
  zScore: number | null;
  anomaly: "high" | "low" | null;
  /** The day the anomaly check looked at. */
  checkedDate: string | null;
  /** The last 30 days (date, value) for sparklines. */
  spark: Array<{ date: string; value: number | null }>;
}

export interface ProbeSpread {
  key: MetricKey;
  /** Coefficient of variation across probes, %. */
  cvPct: number;
  low: { id: string; value: number };
  high: { id: string; value: number };
  probes: number;
}

export interface Correlation {
  a: MetricKey;
  b: MetricKey;
  r: number;
  n: number;
}

export interface DataQuality {
  daysWithData30: number;
  /** Readings per day for the last 7 days (oldest first). */
  readings7: Array<{ date: string; count: number }>;
  probesReporting: number;
  probesTotal: number;
  lastDataDate: string | null;
}

export interface SalinityOutlook {
  threshold: number;
  latest: number;
  slopePerDay: number;
  r2: number;
  /** Days until ECe reaches the crop threshold (null when not rising or already above). */
  daysToThreshold: number | null;
  ece30: number;
  yieldLossNow: number;
  yieldLoss30: number;
}

export interface FarmAnalytics {
  asOf: string | null;
  trends: MetricTrend[];
  spread: ProbeSpread[];
  correlations: Correlation[];
  salinity: SalinityOutlook | null;
  quality: DataQuality;
  /** Plain-language findings, most important first. */
  highlights: Array<{ tone: "bad" | "warn" | "good" | "info"; text: string }>;
}

export const ANALYTICS_METRICS: MetricKey[] = ["ece", "moisture", "deficit", "ph", "temperature", "n", "p", "k", "et0", "etc", "yieldLoss"];

const CORRELATION_PAIRS: Array<[MetricKey, MetricKey]> = [
  ["moisture", "ece"],
  ["et0", "deficit"],
  ["temperature", "moisture"],
  ["moisture", "k"],
];

/** Detrended z-score of day `at` against a line fitted to the ANOMALY_BASELINE_DAYS days before it. */
function detrendedZ(bundle: FarmBundle, key: MetricKey, at: number): number | null {
  const d = bundle.days[at];
  const value = d ? METRICS[key].farmValue(d) : null;
  if (value == null || !Number.isFinite(value)) return null;
  const base = series(bundle, key, at - 1, ANOMALY_BASELINE_DAYS);
  const reg = linearRegression(base);
  if (!reg || base.length < 7) return null;
  const residuals = base.map(([x, y]) => y - (reg.intercept + reg.slope * x));
  const sd = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / Math.max(1, residuals.length - 2));
  // A near-perfect fit would turn tiny sensor noise into huge z-scores.
  const floor = Math.max(1e-6, Math.abs(reg.intercept + reg.slope * at) * 0.01);
  return (value - (reg.intercept + reg.slope * at)) / Math.max(sd, floor);
}

function trendFor(bundle: FarmBundle, dates: string[], key: MetricKey, end: number, checkAt: number): MetricTrend {
  const metric = METRICS[key];
  const last30 = series(bundle, key, end, 30).map(([, v]) => v);
  const last7 = series(bundle, key, end, 7).map(([, v]) => v);
  const reg = linearRegression(series(bundle, key, end, TREND_DAYS));
  const latestDay = bundle.days[end];
  const latest = latestDay ? metric.farmValue(latestDay) : null;
  const z = ANOMALY_METRICS.has(key) && checkAt >= 0 ? detrendedZ(bundle, key, checkAt) : null;
  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  const spark: MetricTrend["spark"] = [];
  for (let i = Math.max(0, end - 29); i <= end; i++) {
    const d = bundle.days[i];
    spark.push({ date: dates[i], value: d ? metric.farmValue(d) : null });
  }
  return {
    key,
    latest,
    mean7: avg(last7),
    mean30: avg(last30),
    min30: last30.length ? Math.min(...last30) : null,
    max30: last30.length ? Math.max(...last30) : null,
    slopePerDay: reg?.slope ?? null,
    r2: reg?.r2 ?? null,
    zScore: z,
    anomaly: z != null && Math.abs(z) >= ANOMALY_Z ? (z > 0 ? "high" : "low") : null,
    checkedDate: z != null ? dates[checkAt] : null,
  spark,
  };
}

function spreadFor(day: FarmDay, key: MetricKey): ProbeSpread | null {
  const metric = METRICS[key];
  const values = day.sensors
    .map((s) => ({ id: s.id, value: metric.sensorValue(s, day) }))
    .filter((v): v is { id: string; value: number } => v.value != null && Number.isFinite(v.value));
  if (values.length < 2) return null;
  const stats = meanSd(values.map((v) => v.value));
  if (!stats || Math.abs(stats.mean) < 1e-9) return null;
  const sorted = [...values].sort((a, b) => a.value - b.value);
  return { key, cvPct: (stats.sd / Math.abs(stats.mean)) * 100, low: sorted[0], high: sorted[sorted.length - 1], probes: values.length };
}

const fmt = (v: number, d = 1) => v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

export function farmAnalytics(bundle: FarmBundle, dates: string[], index = dates.length - 1): FarmAnalytics {
  const end = lastDataIndex(bundle, index);
  const day = end >= 0 ? bundle.days[end] : null;

  // Data quality over the whole window, even before the first reading.
  let daysWithData30 = 0;
  for (let i = Math.max(0, index - 29); i <= index; i++) if (bundle.days[i]) daysWithData30++;
  const readings7: DataQuality["readings7"] = [];
  for (let i = Math.max(0, index - 6); i <= index; i++) readings7.push({ date: dates[i], count: bundle.days[i]?.readings ?? 0 });
  const quality: DataQuality = {
    daysWithData30,
    readings7,
    probesReporting: day?.sensors.length ?? 0,
    probesTotal: bundle.sensors.length,
    lastDataDate: day?.date ?? null,
  };

  if (!day) return { asOf: null, trends: [], spread: [], correlations: [], salinity: null, quality, highlights: [] };

  // Today is still filling up (a morning mean is not a daily mean): check anomalies on the last complete day.
  const checkAt = end === dates.length - 1 && end > 0 && bundle.days[end - 1] ? end - 1 : end;
  const trends = ANALYTICS_METRICS.map((key) => trendFor(bundle, dates, key, end, checkAt));
  const spread = (["ece", "moisture", "ph", "k"] as MetricKey[])
    .map((key) => spreadFor(day, key))
    .filter((s): s is ProbeSpread => s !== null);

  const correlations: Correlation[] = [];
  for (const [a, b] of CORRELATION_PAIRS) {
    const pairs: Array<[number, number]> = [];
    for (let i = Math.max(0, end - 29); i <= end; i++) {
      const d = bundle.days[i];
      const va = d ? METRICS[a].farmValue(d) : null;
      const vb = d ? METRICS[b].farmValue(d) : null;
      if (va != null && vb != null && Number.isFinite(va) && Number.isFinite(vb)) pairs.push([va, vb]);
    }
    const r = pearson(pairs);
    if (r != null) correlations.push({ a, b, r, n: pairs.length });
  }

  // Salinity outlook: where the 14-day ECe trend leads over the next 30 days.
  const crop = CROPS[bundle.farm.main_crop];
  const { threshold_dS_per_m: threshold, slope_pct_per_dS_per_m: lossSlope } = crop.salinity;
  const eceTrend = trends.find((t) => t.key === "ece");
  let salinity: SalinityOutlook | null = null;
  if (eceTrend?.latest != null && eceTrend.slopePerDay != null && eceTrend.r2 != null) {
    const latest = eceTrend.latest;
    const slope = eceTrend.slopePerDay;
    const ece30 = Math.max(0, latest + slope * 30);
    salinity = {
      threshold,
      latest,
      slopePerDay: slope,
      r2: eceTrend.r2,
      daysToThreshold: slope > 1e-6 && latest < threshold ? (threshold - latest) / slope : null,
      ece30,
      yieldLossNow: yieldLoss_pct(latest, threshold, lossSlope),
      yieldLoss30: yieldLoss_pct(ece30, threshold, lossSlope),
    };
  }

  // Findings.
  const highlights: FarmAnalytics["highlights"] = [];
  if (salinity) {
    const confident = salinity.r2 >= 0.5;
    if (salinity.yieldLossNow >= 1) {
      highlights.push({
        tone: "bad",
        text: `ECe ${fmt(salinity.latest)} dS/m is above the ${fmt(threshold)} dS/m ${crop.name.toLowerCase()} threshold — predicted yield loss ${fmt(salinity.yieldLossNow, 0)}%${confident && salinity.slopePerDay > 0.005 ? `, heading for ${fmt(salinity.yieldLoss30, 0)}% in 30 days at the current trend` : ""}.`,
      });
    } else if (salinity.latest >= threshold * 0.95) {
      highlights.push({
        tone: "warn",
        text: `ECe ${fmt(salinity.latest)} dS/m is at the ${fmt(threshold)} dS/m ${crop.name.toLowerCase()} threshold — any further rise costs yield.`,
      });
    } else if (salinity.daysToThreshold != null && confident && salinity.daysToThreshold <= 60) {
      highlights.push({
        tone: salinity.daysToThreshold <= 21 ? "bad" : "warn",
        text: `ECe is rising ${fmt(salinity.slopePerDay, 3)} dS/m per day (R² ${fmt(salinity.r2, 2)}): it reaches the ${fmt(threshold)} dS/m threshold in about ${fmt(salinity.daysToThreshold, 0)} days.`,
      });
    } else if (salinity.slopePerDay <= 0.001) {
      highlights.push({ tone: "good", text: `Salinity is steady or falling (ECe ${fmt(salinity.latest)} dS/m, below the ${fmt(threshold)} dS/m threshold).` });
    }
  }
  if (day.deficitPct != null) {
    if (day.deficitPct > 100) {
      highlights.push({ tone: "bad", text: `The root zone has used ${fmt(day.deficitPct, 0)}% of its readily available water — the crop is water-stressed (Ks ${fmt(day.ks ?? 1, 2)}).` });
    } else if (day.daysToIrrigation != null) {
      highlights.push({
        tone: day.daysToIrrigation < 1 ? "warn" : "info",
        text: `Next irrigation due ${day.daysToIrrigation < 0.5 ? "today" : `in about ${fmt(day.daysToIrrigation, 1)} days`} (depletion ${fmt(day.deficitPct, 0)}% of RAW).`,
      });
    }
  }
  for (const t of trends) {
    if (!t.anomaly || t.zScore == null || !t.checkedDate) continue;
    const m = METRICS[t.key];
    const checked = bundle.days[dates.indexOf(t.checkedDate)];
    const value = checked ? m.farmValue(checked) : null;
    if (value == null) continue;
    const when = t.checkedDate === dates[dates.length - 1] ? "today" : t.checkedDate === dates[dates.length - 2] ? "yesterday" : `on ${t.checkedDate}`;
    highlights.push({
      tone: "warn",
      text: `${m.label} was unusually ${t.anomaly} ${when}: ${fmt(value, m.decimals)}${m.unit === "pH" ? "" : ` ${m.unit}`}, ${fmt(Math.abs(t.zScore), 1)} σ ${t.anomaly === "high" ? "above" : "below"} its 14-day trend — check the probe and the irrigation that day.`,
    });
  }
  const worstSpread = spread.filter((s) => s.key === "ece" || s.key === "moisture").sort((a, b) => b.cvPct - a.cvPct)[0];
  if (worstSpread && worstSpread.cvPct >= 20) {
    const m = METRICS[worstSpread.key];
    highlights.push({
      tone: "warn",
      text: `Probes disagree on ${m.label.toLowerCase()} (CV ${fmt(worstSpread.cvPct, 0)}%): ${worstSpread.high.id} reads ${fmt(worstSpread.high.value, m.decimals)} vs ${worstSpread.low.id} ${fmt(worstSpread.low.value, m.decimals)} ${m.unit} — check irrigation uniformity there.`,
    });
  }
  if (quality.probesTotal > quality.probesReporting) {
    highlights.push({
      tone: "warn",
      text: `${quality.probesTotal - quality.probesReporting} of ${quality.probesTotal} probes sent nothing on ${day.date === dates[index] ? "the latest day" : day.date}.`,
    });
  }
  if (daysWithData30 < Math.min(30, index + 1) && daysWithData30 < 7) {
    highlights.push({ tone: "info", text: `Only ${daysWithData30} day${daysWithData30 === 1 ? "" : "s"} of readings so far — trends firm up after a week or two.` });
  }
  const order = { bad: 0, warn: 1, info: 2, good: 3 } as const;
  highlights.sort((a, b) => order[a.tone] - order[b.tone]);

  return { asOf: day.date, trends, spread, correlations, salinity, quality, highlights };
}

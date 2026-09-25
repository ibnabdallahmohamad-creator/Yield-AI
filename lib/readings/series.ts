/**
 * Every probe reading, bucketed for charts. Readings can arrive every few seconds, so a range is cut
 * into at most ~360 equal time buckets; each bucket keeps count, sum, min and max per metric and per
 * probe, so the chart can draw the mean line with the min–max band and still show every extreme.
 * Buckets merge losslessly (sum/count/min/max), which lets storage cache fine buckets per day and
 * re-bin them for long ranges. Client-safe: no Node or server imports.
 */
import type { SensorReading } from "../types";

export const SERIES_METRICS = ["moisture", "temperature", "ec", "ph", "n", "p", "k", "air_temp", "air_humidity"] as const;
export type SeriesMetric = (typeof SERIES_METRICS)[number];

export interface SeriesMetricDef {
  key: SeriesMetric;
  label: string;
  short: string;
  unit: string;
  decimals: number;
}

export const SERIES_METRIC_DEFS: Record<SeriesMetric, SeriesMetricDef> = {
  moisture: { key: "moisture", label: "Soil moisture", short: "Moisture", unit: "% VWC", decimals: 1 },
  temperature: { key: "temperature", label: "Soil temperature", short: "Soil temp", unit: "°C", decimals: 1 },
  ec: { key: "ec", label: "Bulk EC", short: "EC", unit: "dS/m", decimals: 3 },
  ph: { key: "ph", label: "Soil pH", short: "pH", unit: "", decimals: 2 },
  n: { key: "n", label: "Nitrogen (N)", short: "N", unit: "mg/kg", decimals: 0 },
  p: { key: "p", label: "Phosphorus (P)", short: "P", unit: "mg/kg", decimals: 0 },
  k: { key: "k", label: "Potassium (K)", short: "K", unit: "mg/kg", decimals: 0 },
  air_temp: { key: "air_temp", label: "Air temperature", short: "Air temp", unit: "°C", decimals: 1 },
  air_humidity: { key: "air_humidity", label: "Air humidity", short: "Humidity", unit: "%", decimals: 0 },
};

export interface Stat {
  n: number;
  sum: number;
  min: number;
  max: number;
  /** Time (ms) of the minimum and maximum, for "max 41.2 °C at 14:05". */
  minT: number;
  maxT: number;
  /** Latest value in the bucket and its time. */
  last: number;
  lastT: number;
}

/** One probe, one bucket: how many readings, when the first and last arrived, and stats per metric. */
export type BucketStats = { count: number; firstT: number; lastT: number } & Partial<Record<SeriesMetric, Stat>>;
/** sensor id → bucket start (ms) → stats */
export type BucketMap = Map<string, Map<number, BucketStats>>;

/** Bucket sizes a range can use, seconds. */
export const BUCKET_STEPS_S = [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400] as const;
export const MAX_POINTS = 360;

/** The smallest step that keeps the range within `maxPoints` buckets (and no finer than the device interval). */
export function chooseBucketSeconds(rangeMs: number, minStepS = 1, maxPoints = MAX_POINTS): number {
  const need = rangeMs / 1000 / maxPoints;
  for (const s of BUCKET_STEPS_S) if (s >= need && s >= minStepS) return s;
  return BUCKET_STEPS_S[BUCKET_STEPS_S.length - 1];
}

const bucketStart = (t: number, bucketMs: number, originMs: number) => originMs + Math.floor((t - originMs) / bucketMs) * bucketMs;

function addValue(b: BucketStats, metric: SeriesMetric, v: number, t: number): void {
  const s = b[metric];
  if (!s) {
    b[metric] = { n: 1, sum: v, min: v, max: v, minT: t, maxT: t, last: v, lastT: t };
    return;
  }
  s.n++;
  s.sum += v;
  if (v < s.min) {
    s.min = v;
    s.minT = t;
  }
  if (v > s.max) {
    s.max = v;
    s.maxT = t;
  }
  if (t >= s.lastT) {
    s.last = v;
    s.lastT = t;
  }
}

function mergeStat(into: BucketStats, metric: SeriesMetric, s: Stat): void {
  const t = into[metric];
  if (!t) {
    into[metric] = { ...s };
    return;
  }
  t.n += s.n;
  t.sum += s.sum;
  if (s.min < t.min) {
    t.min = s.min;
    t.minT = s.minT;
  }
  if (s.max > t.max) {
    t.max = s.max;
    t.maxT = s.maxT;
  }
  if (s.lastT >= t.lastT) {
    t.last = s.last;
    t.lastT = s.lastT;
  }
}

function bucketFor(map: BucketMap, sensor: string, start: number): BucketStats {
  let bySensor = map.get(sensor);
  if (!bySensor) {
    bySensor = new Map();
    map.set(sensor, bySensor);
  }
  let b = bySensor.get(start);
  if (!b) {
    b = { count: 0, firstT: Infinity, lastT: -Infinity };
    bySensor.set(start, b);
  }
  return b;
}

/** Add readings to `map` in buckets of `bucketMs` aligned to `originMs` (readings outside [from, to) are skipped). */
export function addReadings(
  map: BucketMap,
  readings: Iterable<Pick<SensorReading, "sensor_id" | "timestamp"> & Partial<Record<SeriesMetric, number | null | undefined>>>,
  bucketMs: number,
  originMs: number,
  fromMs = -Infinity,
  toMs = Infinity,
): void {
  for (const r of readings) {
    const t = Date.parse(r.timestamp);
    if (!Number.isFinite(t) || t < fromMs || t >= toMs) continue;
    const b = bucketFor(map, r.sensor_id, bucketStart(t, bucketMs, originMs));
    b.count++;
    if (t < b.firstT) b.firstT = t;
    if (t > b.lastT) b.lastT = t;
    for (const m of SERIES_METRICS) {
      const v = r[m];
      if (typeof v === "number" && Number.isFinite(v)) addValue(b, m, v, t);
    }
  }
}

/** Re-bin buckets from `source` (any finer, aligned step) into `map` at `bucketMs`, keeping [from, to). */
export function mergeBuckets(map: BucketMap, source: BucketMap, bucketMs: number, originMs: number, fromMs = -Infinity, toMs = Infinity): void {
  for (const [sensor, buckets] of source) {
    for (const [start, stats] of buckets) {
      if (start < fromMs || start >= toMs) continue;
      const b = bucketFor(map, sensor, bucketStart(start, bucketMs, originMs));
      b.count += stats.count;
      if (stats.firstT < b.firstT) b.firstT = stats.firstT;
      if (stats.lastT > b.lastT) b.lastT = stats.lastT;
      for (const m of SERIES_METRICS) {
        const s = stats[m];
        if (s) mergeStat(b, m, s);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The API shape (GET /api/readings/series) and building it
// ---------------------------------------------------------------------------

/** [time ms, mean, min, max, readings] — farm-wide across probes. */
export type SeriesPoint = [number, number | null, number | null, number | null, number];

export interface MetricSummary {
  count: number;
  mean: number | null;
  min: { t: number; value: number } | null;
  max: { t: number; value: number } | null;
  latest: { t: number; value: number } | null;
  /** Mean of the last bucket minus the mean of the first one. */
  change: number | null;
}

export interface MetricSeries {
  points: SeriesPoint[];
  /** Per-probe bucket means aligned with `points` (null where the probe sent nothing). */
  bySensor: Record<string, Array<number | null>>;
  summary: MetricSummary;
}

export interface ReadingSeries {
  farm_id: string;
  from: string;
  to: string;
  bucket_s: number;
  /** True when each bucket holds at most one reading per probe: the chart shows raw readings. */
  raw: boolean;
  sensors: string[];
  /** Total readings in the range (all probes). */
  readings: number;
  first_reading: string | null;
  last_reading: string | null;
  /** Only metrics that have at least one value in the range. */
  metrics: Partial<Record<SeriesMetric, MetricSeries>>;
}

const roundTo = (v: number, d: number) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

/**
 * Bucket starts with an empty bucket inserted wherever the probes went quiet (a gap of more than
 * three times the usual spacing), so chart lines break there instead of bridging the outage.
 */
export function withGaps(times: number[], bucketMs: number): number[] {
  if (times.length < 3) return times;
  const diffs = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const usual = diffs[Math.floor(diffs.length / 2)];
  const threshold = Math.max(bucketMs * 2.5, usual * 3);
  const out: number[] = [times[0]];
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > threshold) out.push(times[i - 1] + bucketMs);
    out.push(times[i]);
  }
  return out;
}

/** Turn a bucket map into the chart payload: buckets with data, plus empty buckets marking outages. */
export function buildSeries(farmId: string, map: BucketMap, fromMs: number, toMs: number, bucketMs: number): ReadingSeries {
  const sensors = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const starts = new Set<number>();
  let readings = 0;
  let maxPerBucket = 0;
  let firstT = Infinity;
  let lastT = -Infinity;
  for (const buckets of map.values()) {
    for (const [start, b] of buckets) {
      starts.add(start);
      readings += b.count;
      maxPerBucket = Math.max(maxPerBucket, b.count);
      firstT = Math.min(firstT, b.firstT);
      lastT = Math.max(lastT, b.lastT);
    }
  }
  const times = withGaps(Array.from(starts).sort((a, b) => a - b), bucketMs);

  const metrics: ReadingSeries["metrics"] = {};
  for (const m of SERIES_METRICS) {
    const d = SERIES_METRIC_DEFS[m].decimals + 1;
    const points: SeriesPoint[] = [];
    const bySensor: Record<string, Array<number | null>> = Object.fromEntries(sensors.map((s) => [s, []]));
    let count = 0;
    let sum = 0;
    let min: MetricSummary["min"] = null;
    let max: MetricSummary["max"] = null;
    let latest: MetricSummary["latest"] = null;
    let firstMean: number | null = null;
    let lastMean: number | null = null;
    for (const t of times) {
      let n = 0;
      let s = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (const sensor of sensors) {
        const st = map.get(sensor)?.get(t)?.[m];
        bySensor[sensor].push(st ? roundTo(st.sum / st.n, d) : null);
        if (!st) continue;
        n += st.n;
        s += st.sum;
        lo = Math.min(lo, st.min);
        hi = Math.max(hi, st.max);
        if (!min || st.min < min.value) min = { t: st.minT, value: st.min };
        if (!max || st.max > max.value) max = { t: st.maxT, value: st.max };
        if (!latest || st.lastT >= latest.t) latest = { t: st.lastT, value: st.last };
      }
      if (n > 0) {
        firstMean ??= s / n;
        lastMean = s / n;
      }
      count += n;
      sum += s;
      points.push(n > 0 ? [t, roundTo(s / n, d), roundTo(lo, d), roundTo(hi, d), n] : [t, null, null, null, 0]);
    }
    if (count === 0) continue;
    metrics[m] = {
      points,
      bySensor,
      summary: {
        count,
        mean: roundTo(sum / count, d),
        min,
        max,
        latest,
        // First bucket to last bucket, both means, so one noisy reading doesn't swing it.
        change: firstMean != null && lastMean != null && times.length > 1 ? roundTo(lastMean - firstMean, d) : null,
      },
    };
  }

  return {
    farm_id: farmId,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    bucket_s: Math.round(bucketMs / 1000),
    raw: maxPerBucket <= 1,
    sensors,
    readings,
    first_reading: Number.isFinite(firstT) ? new Date(firstT).toISOString() : null,
    last_reading: Number.isFinite(lastT) ? new Date(lastT).toISOString() : null,
    metrics,
  };
}

// ---------------------------------------------------------------------------
// Ranges offered by the chart
// ---------------------------------------------------------------------------

export const SERIES_RANGES = [
  { key: "1h", label: "1 h", ms: 3_600_000 },
  { key: "6h", label: "6 h", ms: 6 * 3_600_000 },
  { key: "24h", label: "24 h", ms: 24 * 3_600_000 },
  { key: "7d", label: "7 d", ms: 7 * 86_400_000 },
  { key: "30d", label: "30 d", ms: 30 * 86_400_000 },
  { key: "90d", label: "90 d", ms: 90 * 86_400_000 },
] as const;
export type SeriesRangeKey = (typeof SERIES_RANGES)[number]["key"];

export function isSeriesRange(v: unknown): v is SeriesRangeKey {
  return typeof v === "string" && SERIES_RANGES.some((r) => r.key === v);
}

/** Longest window one request may ask for. */
export const MAX_SERIES_RANGE_MS = 366 * 86_400_000;

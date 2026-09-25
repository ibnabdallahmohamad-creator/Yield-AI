/**
 * High-resolution reading series for the readings explorer: raw probe readings, or means over
 * fixed time buckets so any range stays around 700 points per probe. The same bucketing runs in
 * SQL (`readings_series` in supabase/migrations/0002_accounts_devices.sql) for Supabase data.
 */
import type { SensorReading } from "../types";

export const SERIES_FIELDS = ["moisture", "temperature", "ec", "ph", "n", "p", "k", "air_temp", "air_humidity"] as const;
export type SeriesField = (typeof SERIES_FIELDS)[number];

export const SERIES_RANGES = {
  "1h": { label: "1 hour", ms: 3_600_000, bucketS: 0 },
  "6h": { label: "6 hours", ms: 6 * 3_600_000, bucketS: 30 },
  "24h": { label: "24 hours", ms: 86_400_000, bucketS: 120 },
  "7d": { label: "7 days", ms: 7 * 86_400_000, bucketS: 900 },
  "30d": { label: "30 days", ms: 30 * 86_400_000, bucketS: 3600 },
  "60d": { label: "60 days", ms: 60 * 86_400_000, bucketS: 7200 },
} as const satisfies Record<string, { label: string; ms: number; bucketS: number }>;
export type SeriesRangeKey = keyof typeof SERIES_RANGES;
export const SERIES_RANGE_KEYS = Object.keys(SERIES_RANGES) as SeriesRangeKey[];

export function isSeriesRange(value: unknown): value is SeriesRangeKey {
  return typeof value === "string" && value in SERIES_RANGES;
}

/** One probe, one bucket (or one raw reading when the bucket size is 0). */
export type SeriesRow = { sensor_id: string; t: string; count: number } & Record<SeriesField, number | null>;

const DECIMALS: Record<SeriesField, number> = {
  moisture: 2,
  temperature: 2,
  ec: 4,
  ph: 3,
  n: 1,
  p: 1,
  k: 1,
  air_temp: 2,
  air_humidity: 1,
};

const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Bucket start (ms) for an instant, aligned to the Unix epoch like the SQL version. */
export function bucketStart(ms: number, bucketS: number): number {
  if (bucketS <= 0) return ms;
  const size = bucketS * 1000;
  return Math.floor(ms / size) * size;
}

/** Mean of every field per probe and bucket, for readings in [fromMs, toMs). */
export function bucketReadings(readings: SensorReading[], fromMs: number, toMs: number, bucketS: number): SeriesRow[] {
  type Acc = { sensor_id: string; t: number; count: number; sums: number[]; counts: number[] };
  const groups = new Map<string, Acc>();
  for (const r of readings) {
    const ms = Date.parse(r.timestamp);
    if (!(ms >= fromMs && ms < toMs)) continue;
    const t = bucketStart(ms, bucketS);
    const key = `${r.sensor_id}|${t}`;
    let acc = groups.get(key);
    if (!acc) {
      acc = { sensor_id: r.sensor_id, t, count: 0, sums: SERIES_FIELDS.map(() => 0), counts: SERIES_FIELDS.map(() => 0) };
      groups.set(key, acc);
    }
    acc.count++;
    SERIES_FIELDS.forEach((f, i) => {
      const v = r[f];
      if (typeof v === "number" && Number.isFinite(v)) {
        acc.sums[i] += v;
        acc.counts[i]++;
      }
    });
  }
  const rows: SeriesRow[] = [];
  for (const a of groups.values()) {
    const row = { sensor_id: a.sensor_id, t: new Date(a.t).toISOString(), count: a.count } as SeriesRow;
    SERIES_FIELDS.forEach((f, i) => {
      row[f] = a.counts[i] > 0 ? a.sums[i] / a.counts[i] : null;
    });
    rows.push(row);
  }
  return rows.sort((a, b) => a.t.localeCompare(b.t) || a.sensor_id.localeCompare(b.sensor_id));
}

/** GET /api/series response: columnar so a few thousand points stay small. */
export interface SeriesResponse {
  farm_id: string;
  range: SeriesRangeKey;
  /** 0 = raw readings. */
  bucket_s: number;
  from: string;
  to: string;
  sensors: string[];
  /** Bucket (or reading) times, ms since the epoch, ascending — shared by every probe. */
  t: number[];
  /** values[field][probe][time]; null where that probe has no reading in the bucket. */
  values: Record<SeriesField, Array<Array<number | null>>>;
  /** Readings behind each point: counts[probe][time]. */
  counts: number[][];
  total_readings: number;
}

export function toSeriesResponse(
  farmId: string,
  range: SeriesRangeKey,
  bucketS: number,
  fromMs: number,
  toMs: number,
  rows: SeriesRow[],
): SeriesResponse {
  const sensors = Array.from(new Set(rows.map((r) => r.sensor_id))).sort();
  const times = Array.from(new Set(rows.map((r) => Date.parse(r.t)))).sort((a, b) => a - b);
  const sIndex = new Map(sensors.map((s, i) => [s, i]));
  const tIndex = new Map(times.map((t, i) => [t, i]));
  const empty = () => sensors.map(() => times.map((): number | null => null));
  const values = Object.fromEntries(SERIES_FIELDS.map((f) => [f, empty()])) as SeriesResponse["values"];
  const counts = sensors.map(() => times.map(() => 0));
  let total = 0;
  for (const row of rows) {
    const si = sIndex.get(row.sensor_id)!;
    const ti = tIndex.get(Date.parse(row.t))!;
    counts[si][ti] = row.count;
    total += row.count;
    for (const f of SERIES_FIELDS) {
      const v = row[f];
      values[f][si][ti] = v == null || !Number.isFinite(v) ? null : roundTo(v, DECIMALS[f]);
    }
  }
  return {
    farm_id: farmId,
    range,
    bucket_s: bucketS,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    sensors,
    t: times,
    values,
    counts,
    total_readings: total,
  };
}

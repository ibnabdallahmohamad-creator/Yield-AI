/**
 * Daily aggregation of raw probe readings per sensor and local (Asia/Qatar) day.
 * Mirrors the `sensor_daily` SQL view in `supabase/migrations/0001_init.sql`.
 */
import type { SensorDaily, SensorReading } from "../types";
import { qatarDateString } from "./time";

type Field = "moisture" | "temperature" | "ec" | "ph" | "n" | "p" | "k";
const MEAN_FIELDS: Field[] = ["moisture", "temperature", "ec", "ph", "n", "p", "k"];

interface Acc {
  farm_id: string;
  sensor_id: string;
  day: string;
  lat: number;
  lng: number;
  count: number;
  sums: Record<Field, number>;
  counts: Record<Field, number>;
  airMax: number;
  airMin: number;
  rhMax: number;
  rhMin: number;
  first: string;
  last: string;
}

export function aggregateDaily(readings: SensorReading[]): SensorDaily[] {
  const groups = new Map<string, Acc>();
  for (const r of readings) {
    const day = qatarDateString(r.timestamp);
    const key = `${r.farm_id}|${r.sensor_id}|${day}`;
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        farm_id: r.farm_id,
        sensor_id: r.sensor_id,
        day,
        lat: r.lat,
        lng: r.lng,
        count: 0,
        sums: { moisture: 0, temperature: 0, ec: 0, ph: 0, n: 0, p: 0, k: 0 },
        counts: { moisture: 0, temperature: 0, ec: 0, ph: 0, n: 0, p: 0, k: 0 },
        airMax: -Infinity,
        airMin: Infinity,
        rhMax: -Infinity,
        rhMin: Infinity,
        first: r.timestamp,
        last: r.timestamp,
      };
      groups.set(key, acc);
    }
    acc.count++;
    for (const f of MEAN_FIELDS) {
      const v = r[f];
      if (typeof v === "number" && Number.isFinite(v)) {
        acc.sums[f] += v;
        acc.counts[f]++;
      }
    }
    if (typeof r.air_temp === "number") {
      acc.airMax = Math.max(acc.airMax, r.air_temp);
      acc.airMin = Math.min(acc.airMin, r.air_temp);
    }
    if (typeof r.air_humidity === "number") {
      acc.rhMax = Math.max(acc.rhMax, r.air_humidity);
      acc.rhMin = Math.min(acc.rhMin, r.air_humidity);
    }
    if (r.timestamp < acc.first) acc.first = r.timestamp;
    if (r.timestamp >= acc.last) {
      acc.last = r.timestamp;
      acc.lat = r.lat;
      acc.lng = r.lng;
    }
  }
  const out: SensorDaily[] = [];
  for (const a of groups.values()) {
    const mean = (f: Field) => (a.counts[f] > 0 ? a.sums[f] / a.counts[f] : null);
    out.push({
      farm_id: a.farm_id,
      sensor_id: a.sensor_id,
      day: a.day,
      lat: a.lat,
      lng: a.lng,
      n_readings: a.count,
      moisture: mean("moisture"),
      temperature: mean("temperature"),
      ec: mean("ec"),
      ph: mean("ph"),
      n: mean("n"),
      p: mean("p"),
      k: mean("k"),
      air_tmax: Number.isFinite(a.airMax) ? a.airMax : null,
      air_tmin: Number.isFinite(a.airMin) ? a.airMin : null,
      rh_max: Number.isFinite(a.rhMax) ? a.rhMax : null,
      rh_min: Number.isFinite(a.rhMin) ? a.rhMin : null,
      first_ts: a.first,
      last_ts: a.last,
    });
  }
  return out;
}

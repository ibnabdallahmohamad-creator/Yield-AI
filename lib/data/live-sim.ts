/**
 * Demo live feed: while no real probe data is arriving, one farm "reports" every 5 seconds
 * (round-robin), each probe sending a reading close to its latest one. Stateless and
 * deterministic in time, so every server instance produces the same feed.
 */
import type { Farm, Sensor, SensorReading } from "../types";
import { gaussian, rngFor, round } from "./random";

export const LIVE_INTERVAL_MS = 5000;

export const liveSlotAt = (ms: number) => Math.floor(ms / LIVE_INTERVAL_MS);

export function slotFarm(slot: number, farms: Farm[]): Farm | null {
  if (farms.length === 0) return null;
  return farms[((slot % farms.length) + farms.length) % farms.length];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Readings for one 5-second slot. `latest` maps `${farm_id}|${sensor_id}` → that probe's latest reading. */
export function simulateSlot(
  slot: number,
  farms: Farm[],
  sensorsByFarm: Record<string, Sensor[]>,
  latest: Map<string, SensorReading>,
): SensorReading[] {
  const farm = slotFarm(slot, farms);
  if (!farm) return [];
  const timestamp = new Date(slot * LIVE_INTERVAL_MS).toISOString();
  const out: SensorReading[] = [];
  for (const sensor of sensorsByFarm[farm.id] ?? []) {
    const base = latest.get(`${farm.id}|${sensor.id}`);
    if (!base) continue;
    const rng = rngFor("live", farm.id, sensor.id, slot);
    const jitter = (sigma: number) => gaussian(rng) * sigma;
    const scale = (v: number | null | undefined, rel: number, d: number) =>
      v == null ? null : round(v * (1 + jitter(rel)), d);
    out.push({
      farm_id: farm.id,
      sensor_id: sensor.id,
      lat: sensor.lat,
      lng: sensor.lng,
      timestamp,
      moisture: scale(base.moisture, 0.015, 1),
      temperature: base.temperature == null ? null : round(base.temperature + jitter(0.15), 1),
      ec: scale(base.ec, 0.01, 3),
      ph: base.ph == null ? null : round(base.ph + jitter(0.015), 2),
      n: scale(base.n, 0.02, 0),
      p: scale(base.p, 0.02, 0),
      k: scale(base.k, 0.015, 0),
      air_temp: base.air_temp == null ? null : round(base.air_temp + jitter(0.2), 1),
      air_humidity: base.air_humidity == null ? null : Math.round(clamp(base.air_humidity + jitter(1), 5, 100)),
    });
  }
  return out;
}

/** Latest reading per `${farm_id}|${sensor_id}`. */
export function latestBySensor(readings: SensorReading[]): Map<string, SensorReading> {
  const map = new Map<string, SensorReading>();
  for (const r of readings) {
    const key = `${r.farm_id}|${r.sensor_id}`;
    const prev = map.get(key);
    if (!prev || r.timestamp > prev.timestamp) map.set(key, r);
  }
  return map;
}

export interface LiveCursor {
  id: number;
  slot: number;
}

export function encodeCursor(c: LiveCursor): string {
  return `${c.id}.${c.slot}`;
}

export function decodeCursor(value: string | null | undefined): LiveCursor | null {
  const m = /^(\d{1,15})\.(\d{1,15})$/.exec(value ?? "");
  return m ? { id: Number(m[1]), slot: Number(m[2]) } : null;
}

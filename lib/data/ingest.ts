/**
 * Probe ingest formats (POST /api/readings), documented in the README:
 *
 *  - Device payload, sent by an ESP32 with its own device key: one measurement, or
 *    `{ readings: [...] }` for readings buffered while Wi-Fi was down, plus the device's signal
 *    strength, firmware and last error. No measurement at all is a heartbeat.
 *  - Bulk payload, sent with the server-wide INGEST_API_KEY: readings for any farm and probe.
 *
 * EC is accepted in dS/m (= mS/cm) as `ec`, or in µS/cm as `ec_us_cm` as most 7-in-1 probes report it.
 */
import { z } from "zod";
import type { Device, DeviceSnapshot, Farm, Sensor, SensorReading } from "../types";

const num = z.coerce.number().refine(Number.isFinite, "must be a number");

/** ISO 8601 with offset, or Unix time in seconds or milliseconds (what an ESP32 has after NTP). */
const timestampField = z
  .union([z.iso.datetime({ offset: true }), z.number().positive()])
  .transform((v) => (typeof v === "number" ? new Date(v > 1e12 ? v : v * 1000).toISOString() : new Date(v).toISOString()));

const measurement = {
  timestamp: timestampField.nullish(),
  moisture: num.min(0).max(100).nullish(),
  temperature: num.min(-40).max(80).nullish(),
  ec: num.min(0).max(100).nullish(),
  ec_us_cm: num.min(0).max(100_000).nullish(),
  ph: num.min(0).max(14).nullish(),
  n: num.min(0).max(5000).nullish(),
  p: num.min(0).max(5000).nullish(),
  k: num.min(0).max(10_000).nullish(),
  air_temp: num.min(-40).max(70).nullish(),
  air_humidity: num.min(0).max(100).nullish(),
};

type Measurement = z.infer<z.ZodObject<typeof measurement>>;

const MEASURED: Array<keyof Measurement> = ["moisture", "temperature", "ec", "ec_us_cm", "ph", "n", "p", "k", "air_temp", "air_humidity"];
const hasMeasurement = (m: Measurement) => MEASURED.some((k) => m[k] != null);

// ---------------------------------------------------------------------------
// Bulk (INGEST_API_KEY)
// ---------------------------------------------------------------------------

export const IngestReadingSchema = z
  .object({
    farm_id: z.string().min(1).max(64),
    sensor_id: z.string().min(1).max(64),
    lat: num.min(-90).max(90).optional(),
    lng: num.min(-180).max(180).optional(),
    ...measurement,
  })
  .refine(hasMeasurement, {
    message: "Send at least one measurement (moisture, temperature, ec/ec_us_cm, ph, n, p, k, air_temp or air_humidity).",
  });

export const IngestPayloadSchema = z.union([
  IngestReadingSchema,
  z.array(IngestReadingSchema).min(1).max(1000),
  z.object({ readings: z.array(IngestReadingSchema).min(1).max(1000) }),
]);

export type IngestReading = z.infer<typeof IngestReadingSchema>;

export function normalizeIngestPayload(payload: z.infer<typeof IngestPayloadSchema>): IngestReading[] {
  if (Array.isArray(payload)) return payload;
  if ("readings" in payload) return payload.readings;
  return [payload];
}

/** Future timestamps beyond this are rejected (device clocks drift a little). */
const MAX_CLOCK_AHEAD_MS = 5 * 60_000;

function toReading(
  m: Measurement,
  base: Pick<SensorReading, "farm_id" | "sensor_id" | "lat" | "lng">,
  timestamp: string,
): SensorReading {
  return {
    ...base,
    timestamp,
    moisture: m.moisture ?? null,
    temperature: m.temperature ?? null,
    ec: m.ec ?? (m.ec_us_cm != null ? m.ec_us_cm / 1000 : null),
    ph: m.ph ?? null,
    n: m.n ?? null,
    p: m.p ?? null,
    k: m.k ?? null,
    air_temp: m.air_temp ?? null,
    air_humidity: m.air_humidity ?? null,
  };
}

/** Resolve defaults (timestamp, position, EC units) against the known farms and probes. */
export function toSensorReadings(
  items: IngestReading[],
  farms: Farm[],
  sensorsByFarm: Record<string, Sensor[]>,
  now = new Date(),
): { readings: SensorReading[]; errors: string[] } {
  const readings: SensorReading[] = [];
  const errors: string[] = [];
  const farmById = new Map(farms.map((f) => [f.id, f]));
  items.forEach((item, i) => {
    const farm = farmById.get(item.farm_id);
    if (!farm) {
      errors.push(`readings[${i}]: unknown farm_id "${item.farm_id}"`);
      return;
    }
    const known = sensorsByFarm[farm.id]?.find((s) => s.id === item.sensor_id);
    const ts = item.timestamp ? new Date(item.timestamp) : now;
    if (ts.getTime() > now.getTime() + MAX_CLOCK_AHEAD_MS) {
      errors.push(`readings[${i}]: timestamp is in the future`);
      return;
    }
    readings.push(
      toReading(
        item,
        {
          farm_id: farm.id,
          sensor_id: item.sensor_id,
          lat: item.lat ?? known?.lat ?? farm.lat,
          lng: item.lng ?? known?.lng ?? farm.lng,
        },
        ts.toISOString(),
      ),
    );
  });
  return { readings, errors };
}

// ---------------------------------------------------------------------------
// Device (per-device key)
// ---------------------------------------------------------------------------

const DeviceMeasurementSchema = z.object(measurement);

export const DevicePayloadSchema = z.object({
  ...measurement,
  /** Readings buffered while the device was offline, oldest first. */
  readings: z.array(DeviceMeasurementSchema).max(500).optional(),
  rssi: num.min(-127).max(0).nullish(),
  fw: z.string().trim().max(40).nullish(),
  firmware: z.string().trim().max(40).nullish(),
  uptime_s: num.min(0).nullish(),
  /** Set by the firmware when the probe did not answer (e.g. "probe timeout"). */
  error: z.string().trim().max(200).nullish(),
});
export type DevicePayload = z.infer<typeof DevicePayloadSchema>;

/** Buffered readings older than this are dropped (the dashboard shows 60 days). */
const MAX_BACKFILL_MS = 60 * 86_400_000;

export interface DeviceIngest {
  readings: SensorReading[];
  /** Readings that could not be used, with the reason. */
  skipped: string[];
  latest: DeviceSnapshot | null;
}

/** Readings from a device payload, stored under the device's farm and probe id. */
export function deviceReadings(payload: DevicePayload, device: Pick<Device, "farm_id" | "sensor_id" | "lat" | "lng">, now = new Date()): DeviceIngest {
  const items: Measurement[] = [...(payload.readings ?? [])];
  const { readings: _buffered, rssi: _rssi, fw: _fw, firmware: _firmware, uptime_s: _uptime, error: _error, ...single } = payload;
  if (hasMeasurement(single)) items.push(single);

  const base = { farm_id: device.farm_id, sensor_id: device.sensor_id, lat: device.lat, lng: device.lng };
  const readings: SensorReading[] = [];
  const skipped: string[] = [];
  const nowMs = now.getTime();
  items.forEach((m, i) => {
    if (!hasMeasurement(m)) {
      skipped.push(`readings[${i}]: no measurement`);
      return;
    }
    let ts = m.timestamp ? Date.parse(m.timestamp) : nowMs;
    // A clock that never synced reports 1970: treat the reading as "now" rather than losing it.
    if (ts < Date.UTC(2020, 0, 1)) ts = nowMs;
    if (ts > nowMs + MAX_CLOCK_AHEAD_MS) {
      skipped.push(`readings[${i}]: timestamp is in the future`);
      return;
    }
    if (nowMs - ts > MAX_BACKFILL_MS) {
      skipped.push(`readings[${i}]: older than 60 days`);
      return;
    }
    readings.push(toReading(m, base, new Date(ts).toISOString()));
  });

  const newest = readings.reduce<SensorReading | null>((a, r) => (!a || r.timestamp >= a.timestamp ? r : a), null);
  const latest: DeviceSnapshot | null = newest
    ? {
        timestamp: newest.timestamp,
        moisture: newest.moisture,
        temperature: newest.temperature,
        ec: newest.ec,
        ph: newest.ph,
        n: newest.n,
        p: newest.p,
        k: newest.k,
        air_temp: newest.air_temp ?? null,
        air_humidity: newest.air_humidity ?? null,
      }
    : null;
  return { readings, skipped, latest };
}

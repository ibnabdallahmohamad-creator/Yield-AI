/**
 * Probe ingest format (POST /api/readings). Accepts one reading or an array; `ec` in dS/m
 * (= mS/cm) or `ec_us_cm` in µS/cm as most 7-in-1 probes report it. Documented in the README.
 */
import { z } from "zod";
import { normalizeDeviceUnits } from "../ai/esp32-units";
import type { Farm, Sensor, SensorReading } from "../types";

const num = z.coerce.number().refine(Number.isFinite, "must be a number");

export const IngestReadingSchema = z.preprocess(
  normalizeDeviceUnits,
  z
  .object({
    farm_id: z.string().min(1).max(64),
    sensor_id: z.string().min(1).max(64),
    timestamp: z.iso.datetime({ offset: true }).optional(),
    lat: num.min(-90).max(90).optional(),
    lng: num.min(-180).max(180).optional(),
    moisture: num.min(0).max(100).nullish(),
    temperature: num.min(-20).max(80).nullish(),
    ec: num.min(0).max(100).nullish(),
    ec_us_cm: num.min(0).max(100000).nullish(),
    ph: num.min(0).max(14).nullish(),
    n: num.min(0).max(5000).nullish(),
    p: num.min(0).max(5000).nullish(),
    k: num.min(0).max(10000).nullish(),
    air_temp: num.min(-20).max(70).nullish(),
    air_humidity: num.min(0).max(100).nullish(),
  })
  .refine((r) => [r.moisture, r.temperature, r.ec, r.ec_us_cm, r.ph, r.n, r.p, r.k].some((v) => v != null), {
    message: "Send at least one measurement (moisture, temperature, ec/ec_us_cm, ph, n, p or k).",
  }),
);

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
    if (ts.getTime() > now.getTime() + 5 * 60_000) {
      errors.push(`readings[${i}]: timestamp is in the future`);
      return;
    }
    readings.push({
      farm_id: farm.id,
      sensor_id: item.sensor_id,
      lat: item.lat ?? known?.lat ?? farm.lat,
      lng: item.lng ?? known?.lng ?? farm.lng,
      timestamp: ts.toISOString(),
      moisture: item.moisture ?? null,
      temperature: item.temperature ?? null,
      ec: item.ec ?? (item.ec_us_cm != null ? item.ec_us_cm / 1000 : null),
      ph: item.ph ?? null,
      n: item.n ?? null,
      p: item.p ?? null,
      k: item.k ?? null,
      air_temp: item.air_temp ?? null,
      air_humidity: item.air_humidity ?? null,
    });
  });
  return { readings, errors };
}

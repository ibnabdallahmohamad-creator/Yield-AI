/**
 * Supabase queries. Row shapes mirror supabase/migrations/0001_init.sql; rows are validated
 * so one malformed farm or insight cannot take the dashboard down.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CROP_IDS } from "../agronomy-tables";
import { parseInsight, type AiInsight } from "../ai/contract";
import type { Farm, SensorDaily, SensorReading } from "../types";
import { qatarLocalToUtc } from "./time";

const PAGE_SIZE = 1000;

const numeric = z.coerce.number().refine(Number.isFinite);
const nullableNumeric = z.preprocess((v) => (v === null || v === undefined || v === "" ? null : v), numeric.nullable());

const PolygonSchema = z.preprocess(
  (v) => (typeof v === "string" ? JSON.parse(v) : v),
  z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.tuple([numeric, numeric]).rest(z.unknown()))).min(1),
  }),
);

const FarmRowSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  owner: z.string().nullish().transform((v) => v ?? ""),
  lat: numeric,
  lng: numeric,
  area_ha: numeric,
  main_crop: z.enum(CROP_IDS as [string, ...string[]]),
  polygon: PolygonSchema,
  region: z.string().nullish().transform((v) => v ?? ""),
  planting_date: z.string(),
  soil_type: z.enum(["sand", "loamy_sand"]).catch("sand"),
  theta_fc: nullableNumeric.optional().transform((v) => v ?? null),
  theta_wp: nullableNumeric.optional().transform((v) => v ?? null),
  elevation_m: numeric.catch(10),
  ec_calibration_factor: numeric.catch(3),
  irrigation_water_ec: numeric.catch(1.5),
});

export function parseFarmRow(row: unknown): Farm | null {
  const parsed = FarmRowSchema.safeParse(row);
  if (!parsed.success) {
    console.warn("[supabase] Skipping malformed farm row:", parsed.error.issues[0]?.message);
    return null;
  }
  const f = parsed.data;
  return {
    ...f,
    main_crop: f.main_crop as Farm["main_crop"],
    polygon: { type: "Polygon", coordinates: f.polygon.coordinates.map((ring) => ring.map((p) => [p[0], p[1]])) } as Farm["polygon"],
    planting_date: f.planting_date.slice(0, 10),
  };
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDaily(row: Record<string, unknown>): SensorDaily {
  return {
    farm_id: String(row.farm_id),
    sensor_id: String(row.sensor_id),
    day: String(row.day).slice(0, 10),
    lat: toNum(row.lat) ?? 0,
    lng: toNum(row.lng) ?? 0,
    n_readings: toNum(row.n_readings) ?? 0,
    moisture: toNum(row.moisture),
    temperature: toNum(row.temperature),
    ec: toNum(row.ec),
    ph: toNum(row.ph),
    n: toNum(row.n),
    p: toNum(row.p),
    k: toNum(row.k),
    air_tmax: toNum(row.air_tmax),
    air_tmin: toNum(row.air_tmin),
    rh_max: toNum(row.rh_max),
    rh_min: toNum(row.rh_min),
    first_ts: String(row.first_ts),
    last_ts: String(row.last_ts),
  };
}

export function toReading(row: Record<string, unknown>): SensorReading & { id: number } {
  return {
    id: toNum(row.id) ?? 0,
    farm_id: String(row.farm_id),
    sensor_id: String(row.sensor_id),
    lat: toNum(row.lat) ?? 0,
    lng: toNum(row.lng) ?? 0,
    timestamp: new Date(String(row.timestamp)).toISOString(),
    moisture: toNum(row.moisture),
    temperature: toNum(row.temperature),
    ec: toNum(row.ec),
    ph: toNum(row.ph),
    n: toNum(row.n),
    p: toNum(row.p),
    k: toNum(row.k),
    air_temp: toNum(row.air_temp),
    air_humidity: toNum(row.air_humidity),
  };
}

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "unknown error"}`);
}

export async function fetchFarms(client: SupabaseClient): Promise<Farm[]> {
  const { data, error } = await client.from("farms").select("*").order("name");
  if (error) fail("farms", error);
  return (data ?? []).map(parseFarmRow).filter((f): f is Farm => f !== null);
}

/** Daily per-probe aggregates from the `sensor_daily` view, paged past PostgREST's row limit. */
export async function fetchDaily(client: SupabaseClient, fromDay: string): Promise<SensorDaily[]> {
  const rows: SensorDaily[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from("sensor_daily")
      .select("*")
      .gte("day", fromDay)
      .order("day")
      .order("farm_id")
      .order("sensor_id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) fail("sensor_daily", error);
    rows.push(...(data ?? []).map((r) => toDaily(r as Record<string, unknown>)));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function fetchInsights(client: SupabaseClient): Promise<AiInsight[]> {
  const { data, error } = await client.from("ai_insights").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) fail("ai_insights", error);
  return (data ?? []).map(parseInsight).filter((i): i is AiInsight => i !== null);
}

export async function fetchReadingsSince(client: SupabaseClient, afterId: number, limit = 500) {
  const { data, error } = await client
    .from("sensor_readings")
    .select("*")
    .gt("id", afterId)
    .order("id", { ascending: true })
    .limit(limit);
  if (error) fail("sensor_readings", error);
  return (data ?? []).map((r) => toReading(r as Record<string, unknown>));
}

export async function fetchLatestReading(client: SupabaseClient) {
  const { data, error } = await client
    .from("sensor_readings")
    .select("id, timestamp")
    .order("id", { ascending: false })
    .limit(1);
  if (error) fail("sensor_readings", error);
  const row = data?.[0] as { id: number; timestamp: string } | undefined;
  return row ? { id: Number(row.id), timestamp: new Date(row.timestamp).toISOString() } : null;
}

/** A farm's readings for one local day plus its most recent readings (for the live feed). */
export async function fetchFarmRecent(client: SupabaseClient, farmId: string, day: string) {
  const since = qatarLocalToUtc(day, 0).toISOString();
  const [todayRes, recentRes] = await Promise.all([
    client.from("sensor_readings").select("*").eq("farm_id", farmId).gte("timestamp", since).order("timestamp").limit(5000),
    client.from("sensor_readings").select("*").eq("farm_id", farmId).order("timestamp", { ascending: false }).limit(100),
  ]);
  if (todayRes.error) fail("sensor_readings", todayRes.error);
  if (recentRes.error) fail("sensor_readings", recentRes.error);
  return {
    today: (todayRes.data ?? []).map((r) => toReading(r as Record<string, unknown>)),
    recent: (recentRes.data ?? []).map((r) => toReading(r as Record<string, unknown>)),
  };
}

export async function insertReadings(client: SupabaseClient, readings: SensorReading[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < readings.length; i += PAGE_SIZE) {
    const chunk = readings.slice(i, i + PAGE_SIZE);
    const { error, count } = await client
      .from("sensor_readings")
      .upsert(chunk, { onConflict: "sensor_id,timestamp", ignoreDuplicates: true, count: "exact" });
    if (error) fail("insert sensor_readings", error);
    inserted += count ?? chunk.length;
  }
  return inserted;
}

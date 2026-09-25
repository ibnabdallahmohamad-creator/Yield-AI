/**
 * Supabase implementation of the account data store. Row shapes mirror
 * supabase/migrations/0001_init.sql and 0002_accounts_devices.sql; rows are validated so one
 * malformed farm or insight cannot take the dashboard down.
 *
 * Reads and writes use the service role when SUPABASE_SERVICE_ROLE_KEY is set (after the app's
 * own sign-in check, and always filtered by owner), otherwise the signed-in user's session with
 * row-level security. Device ingest and the shared cache need the service role.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CROP_IDS } from "../agronomy-tables";
import { parseInsight, type AiInsight } from "../ai/contract";
import { SERIES_FIELDS, type SeriesRow } from "../data/series";
import { qatarLocalToUtc, addDays } from "../data/time";
import { createSupabaseAdminClient, createSupabaseDataClient, withTimeout } from "../supabase/server";
import type { Device, DeviceSnapshot, Farm, SensorDaily, SensorReading, UserSettings } from "../types";
import {
  DEFAULT_SETTINGS,
  StoreError,
  type CachedValue,
  type DataStore,
  type DeviceContact,
  type DevicePatch,
  type FarmPatch,
  type StoredReading,
} from "./types";

const PAGE_SIZE = 1000;
const QUERY_TIMEOUT_MS = 10_000;

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
  owner_id: z.string().nullish().transform((v) => v ?? null),
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

const toIso = (v: unknown): string | null => (v == null || v === "" ? null : new Date(String(v)).toISOString());

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

export function toReading(row: Record<string, unknown>): StoredReading {
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

function toSnapshot(value: unknown): DeviceSnapshot | null {
  const v = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!v || typeof v !== "object") return null;
  const row = v as Record<string, unknown>;
  const timestamp = toIso(row.timestamp);
  if (!timestamp) return null;
  return {
    timestamp,
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

export function toDevice(row: Record<string, unknown>): Device {
  let lastReading: DeviceSnapshot | null = null;
  try {
    lastReading = toSnapshot(row.last_reading);
  } catch {
    lastReading = null;
  }
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    farm_id: String(row.farm_id),
    name: String(row.name ?? ""),
    sensor_id: String(row.sensor_id),
    lat: toNum(row.lat) ?? 0,
    lng: toNum(row.lng) ?? 0,
    token_hint: String(row.token_hint ?? ""),
    created_at: toIso(row.created_at) ?? new Date(0).toISOString(),
    last_seen_at: toIso(row.last_seen_at),
    last_reading_at: toIso(row.last_reading_at),
    last_ip: row.last_ip == null ? null : String(row.last_ip),
    rssi: toNum(row.rssi),
    firmware: row.firmware == null ? null : String(row.firmware),
    last_error: row.last_error == null ? null : String(row.last_error),
    last_reading: lastReading,
  };
}

const DEVICE_COLUMNS =
  "id, owner_id, farm_id, name, sensor_id, lat, lng, token_hint, created_at, last_seen_at, last_reading_at, last_ip, rssi, firmware, last_error, last_reading";

function fail(what: string, error: { message: string } | null): never {
  throw new StoreError(`${what}: ${error?.message ?? "unknown error"}`);
}

/** Supabase calls must never hang a page. */
const timed = <T>(promise: PromiseLike<T>, label: string) => withTimeout(promise, QUERY_TIMEOUT_MS, label);

export class SupabaseStore implements DataStore {
  readonly kind = "supabase" as const;

  private async client(): Promise<SupabaseClient> {
    const client = await createSupabaseDataClient();
    if (!client) throw new StoreError("Supabase is not configured");
    return client;
  }

  private admin(what: string): SupabaseClient {
    const admin = createSupabaseAdminClient();
    if (!admin) throw new StoreError(`${what} needs SUPABASE_SERVICE_ROLE_KEY on the server`);
    return admin;
  }

  // ---------------------------------------------------------------------------
  // Farms
  // ---------------------------------------------------------------------------

  async listFarms(ownerId: string): Promise<Farm[]> {
    const client = await this.client();
    const { data, error } = await timed(client.from("farms").select("*").eq("owner_id", ownerId).order("name"), "farms");
    if (error) fail("farms", error);
    return (data ?? []).map(parseFarmRow).filter((f): f is Farm => f !== null);
  }

  async insertFarm(farm: Farm & { owner_id: string }): Promise<void> {
    const client = await this.client();
    const { error } = await timed(client.from("farms").insert(farm), "insert farm");
    if (error) fail("insert farm", error);
  }

  async updateFarm(ownerId: string, farmId: string, patch: FarmPatch): Promise<Farm | null> {
    const client = await this.client();
    const { data, error } = await timed(
      client.from("farms").update(patch).eq("id", farmId).eq("owner_id", ownerId).select("*").maybeSingle(),
      "update farm",
    );
    if (error) fail("update farm", error);
    return data ? parseFarmRow(data) : null;
  }

  async deleteFarm(ownerId: string, farmId: string): Promise<boolean> {
    const client = await this.client();
    const { data, error } = await timed(
      client.from("farms").delete().eq("id", farmId).eq("owner_id", ownerId).select("id"),
      "delete farm",
    );
    if (error) fail("delete farm", error);
    return (data ?? []).length > 0;
  }

  async findFarmForIngest(farmId: string): Promise<Farm | null> {
    const admin = this.admin("Probe ingest");
    const { data, error } = await timed(admin.from("farms").select("*").eq("id", farmId).maybeSingle(), "farm");
    if (error) fail("farm", error);
    return data ? parseFarmRow(data) : null;
  }

  async listAllFarms(): Promise<Farm[]> {
    const admin = createSupabaseAdminClient();
    if (!admin) return [];
    const { data, error } = await timed(admin.from("farms").select("*").not("owner_id", "is", null).limit(5000), "all farms");
    if (error) fail("all farms", error);
    return (data ?? []).map(parseFarmRow).filter((f): f is Farm => f !== null);
  }

  // ---------------------------------------------------------------------------
  // Devices
  // ---------------------------------------------------------------------------

  async listDevices(ownerId: string): Promise<Device[]> {
    const client = await this.client();
    const { data, error } = await timed(
      client.from("devices").select(DEVICE_COLUMNS).eq("owner_id", ownerId).order("created_at"),
      "devices",
    );
    if (error) fail("devices", error);
    return (data ?? []).map((row) => toDevice(row as Record<string, unknown>));
  }

  async insertDevice(device: Device, tokenHash: string): Promise<void> {
    const client = await this.client();
    const { error } = await timed(client.from("devices").insert({ ...device, token_hash: tokenHash }), "insert device");
    if (error) fail("insert device", error);
  }

  async updateDevice(ownerId: string, deviceId: string, patch: DevicePatch): Promise<Device | null> {
    const client = await this.client();
    const { data, error } = await timed(
      client.from("devices").update(patch).eq("id", deviceId).eq("owner_id", ownerId).select(DEVICE_COLUMNS).maybeSingle(),
      "update device",
    );
    if (error) fail("update device", error);
    return data ? toDevice(data as Record<string, unknown>) : null;
  }

  async setDeviceToken(ownerId: string, deviceId: string, tokenHash: string, tokenHint: string): Promise<Device | null> {
    const client = await this.client();
    const { data, error } = await timed(
      client
        .from("devices")
        .update({ token_hash: tokenHash, token_hint: tokenHint })
        .eq("id", deviceId)
        .eq("owner_id", ownerId)
        .select(DEVICE_COLUMNS)
        .maybeSingle(),
      "rotate device key",
    );
    if (error) fail("rotate device key", error);
    return data ? toDevice(data as Record<string, unknown>) : null;
  }

  async deleteDevice(ownerId: string, deviceId: string): Promise<boolean> {
    const client = await this.client();
    const { data, error } = await timed(
      client.from("devices").delete().eq("id", deviceId).eq("owner_id", ownerId).select("id"),
      "delete device",
    );
    if (error) fail("delete device", error);
    return (data ?? []).length > 0;
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<Device | null> {
    const admin = this.admin("Device ingest");
    const { data, error } = await timed(
      admin.from("devices").select(DEVICE_COLUMNS).eq("token_hash", tokenHash).maybeSingle(),
      "device lookup",
    );
    if (error) fail("device lookup", error);
    return data ? toDevice(data as Record<string, unknown>) : null;
  }

  async recordDeviceContact(deviceId: string, contact: DeviceContact): Promise<void> {
    const admin = this.admin("Device ingest");
    const patch: Record<string, unknown> = { last_seen_at: contact.at, last_ip: contact.ip, last_error: contact.error };
    if (contact.rssi != null) patch.rssi = Math.round(contact.rssi);
    if (contact.firmware) patch.firmware = contact.firmware;
    if (contact.reading) {
      patch.last_reading_at = contact.reading.timestamp;
      patch.last_reading = contact.reading;
    }
    const { error } = await timed(admin.from("devices").update(patch).eq("id", deviceId), "device contact");
    if (error) fail("device contact", error);
  }

  // ---------------------------------------------------------------------------
  // Readings
  // ---------------------------------------------------------------------------

  async insertReadings(readings: SensorReading[]): Promise<number> {
    const admin = this.admin("Probe ingest");
    let inserted = 0;
    for (let i = 0; i < readings.length; i += PAGE_SIZE) {
      const chunk = readings.slice(i, i + PAGE_SIZE);
      const { error, count } = await timed(
        admin
          .from("sensor_readings")
          .upsert(chunk, { onConflict: "farm_id,sensor_id,timestamp", ignoreDuplicates: true, count: "exact" }),
        "insert readings",
      );
      if (error) fail("insert readings", error);
      inserted += count ?? chunk.length;
    }
    return inserted;
  }

  async dailyAggregates(farmIds: string[], fromDay: string): Promise<SensorDaily[]> {
    if (farmIds.length === 0) return [];
    const client = await this.client();
    const rows: SensorDaily[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await timed(
        client
          .from("sensor_daily")
          .select("*")
          .in("farm_id", farmIds)
          .gte("day", fromDay)
          .order("day")
          .order("farm_id")
          .order("sensor_id")
          .range(from, from + PAGE_SIZE - 1),
        "sensor_daily",
      );
      if (error) fail("sensor_daily", error);
      rows.push(...(data ?? []).map((r) => toDaily(r as Record<string, unknown>)));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return rows;
  }

  async readingsForDay(farmId: string, day: string): Promise<SensorReading[]> {
    const client = await this.client();
    const from = qatarLocalToUtc(day, 0).toISOString();
    const to = qatarLocalToUtc(addDays(day, 1), 0).toISOString();
    const rows: SensorReading[] = [];
    for (let offset = 0; offset < 50_000; offset += PAGE_SIZE) {
      const { data, error } = await timed(
        client
          .from("sensor_readings")
          .select("*")
          .eq("farm_id", farmId)
          .gte("timestamp", from)
          .lt("timestamp", to)
          .order("id")
          .range(offset, offset + PAGE_SIZE - 1),
        "readings",
      );
      if (error) fail("readings", error);
      rows.push(...(data ?? []).map((r) => toReading(r as Record<string, unknown>)));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return rows;
  }

  async readingsSince(farmIds: string[], afterId: number, limit: number): Promise<StoredReading[]> {
    if (farmIds.length === 0) return [];
    const client = await this.client();
    const { data, error } = await timed(
      client
        .from("sensor_readings")
        .select("*")
        .in("farm_id", farmIds)
        .gt("id", afterId)
        .order("id", { ascending: true })
        .limit(limit),
      "new readings",
    );
    if (error) fail("new readings", error);
    return (data ?? []).map((r) => toReading(r as Record<string, unknown>));
  }

  async maxReadingId(farmIds: string[]): Promise<number> {
    if (farmIds.length === 0) return 0;
    const client = await this.client();
    const { data, error } = await timed(
      client.from("sensor_readings").select("id").in("farm_id", farmIds).order("id", { ascending: false }).limit(1),
      "latest reading",
    );
    if (error) fail("latest reading", error);
    return toNum((data?.[0] as { id?: unknown } | undefined)?.id) ?? 0;
  }

  async series(farmId: string, fromIso: string, toIso: string, bucketS: number): Promise<SeriesRow[]> {
    const client = await this.client();
    const rows: SeriesRow[] = [];
    if (bucketS <= 0) {
      for (let offset = 0; offset < 20_000; offset += PAGE_SIZE) {
        const { data, error } = await timed(
          client
            .from("sensor_readings")
            .select("sensor_id, timestamp, " + SERIES_FIELDS.join(", "))
            .eq("farm_id", farmId)
            .gte("timestamp", fromIso)
            .lt("timestamp", toIso)
            .order("timestamp")
            .range(offset, offset + PAGE_SIZE - 1),
          "readings",
        );
        if (error) fail("readings", error);
        for (const raw of (data ?? []) as unknown as Array<Record<string, unknown>>) {
          const row = { sensor_id: String(raw.sensor_id), t: new Date(String(raw.timestamp)).toISOString(), count: 1 } as SeriesRow;
          for (const f of SERIES_FIELDS) row[f] = toNum(raw[f]);
          rows.push(row);
        }
        if (!data || data.length < PAGE_SIZE) break;
      }
      return rows;
    }
    for (let offset = 0; offset < 50_000; offset += PAGE_SIZE) {
      const { data, error } = await timed(
        client
          .rpc("readings_series", { p_farm_id: farmId, p_from: fromIso, p_to: toIso, p_bucket_s: bucketS })
          .range(offset, offset + PAGE_SIZE - 1),
        "readings_series",
      );
      if (error) fail("readings_series (apply supabase/migrations/0002_accounts_devices.sql)", error);
      for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
        const row = { sensor_id: String(raw.sensor_id), t: new Date(String(raw.t)).toISOString(), count: toNum(raw.count) ?? 0 } as SeriesRow;
        for (const f of SERIES_FIELDS) row[f] = toNum(raw[f]);
        rows.push(row);
      }
      if (!data || data.length < PAGE_SIZE) break;
    }
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Settings, insights, cache
  // ---------------------------------------------------------------------------

  async getSettings(ownerId: string): Promise<UserSettings> {
    const client = await this.client();
    const { data, error } = await timed(
      client.from("user_settings").select("reading_interval_s").eq("user_id", ownerId).maybeSingle(),
      "settings",
    );
    if (error) fail("settings", error);
    const interval = toNum((data as { reading_interval_s?: unknown } | null)?.reading_interval_s);
    return { ...DEFAULT_SETTINGS, ...(interval ? { reading_interval_s: interval } : {}) };
  }

  async saveSettings(ownerId: string, settings: UserSettings): Promise<void> {
    const client = await this.client();
    const { error } = await timed(
      client
        .from("user_settings")
        .upsert({ user_id: ownerId, reading_interval_s: settings.reading_interval_s, updated_at: new Date().toISOString() }),
      "save settings",
    );
    if (error) fail("save settings", error);
  }

  async listInsights(farmIds: string[]): Promise<AiInsight[]> {
    if (farmIds.length === 0) return [];
    const client = await this.client();
    const { data, error } = await timed(
      client.from("ai_insights").select("*").in("farm_id", farmIds).order("created_at", { ascending: false }).limit(500),
      "ai_insights",
    );
    if (error) fail("ai_insights", error);
    return (data ?? []).map(parseInsight).filter((i): i is AiInsight => i !== null);
  }

  async getCached(key: string): Promise<CachedValue | null> {
    const admin = createSupabaseAdminClient();
    if (!admin) return null;
    const { data, error } = await timed(admin.from("app_cache").select("fetched_at, payload").eq("key", key).maybeSingle(), "cache");
    if (error) fail("cache", error);
    const row = data as { fetched_at?: string; payload?: unknown } | null;
    return row?.fetched_at ? { fetched_at: new Date(row.fetched_at).toISOString(), payload: row.payload } : null;
  }

  async putCached(key: string, value: CachedValue): Promise<void> {
    const admin = createSupabaseAdminClient();
    if (!admin) return;
    const { error } = await timed(
      admin.from("app_cache").upsert({ key, fetched_at: value.fetched_at, payload: value.payload }),
      "cache write",
    );
    if (error) fail("cache write", error);
  }
}

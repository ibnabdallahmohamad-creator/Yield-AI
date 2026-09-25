/**
 * Farms, ESP32 devices and readings for Supabase accounts (supabase/migrations/0004_accounts_devices.sql).
 * Reads and writes use the service-role client with an explicit owner filter when the server has
 * SUPABASE_SERVICE_ROLE_KEY, otherwise the user's own session (row-level security does ownership).
 * Devices have no user session, so pairing and ingest need the service role.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient, createSupabaseDataClient, withTimeout } from "../supabase/server";
import { fetchDaily, insertReadings, parseFarmRow, toReading } from "../data/supabase-source";
import { addReadings, SERIES_METRICS, type BucketMap, type BucketStats } from "../readings/series";
import type { Farm, SensorDaily, SensorReading } from "../types";
import type { StoredDevice } from "./types";
import {
  AccountStoreError,
  type AccountStore,
  type DeviceMeta,
  type DeviceRegistry,
  type DeviceUpdate,
  type NewDevice,
  type StoredReading,
} from "./core";
import { QATAR_ORIGIN_MS } from "./local-store";

const TIMEOUT_MS = 8000;
const PAGE = 1000;
const DEVICE_COLUMNS =
  "id, owner_id, farm_id, name, sensor_id, lat, lng, interval_s, token_hash, token_hint, pairing_code, pairing_expires_at, created_at, paired_at, last_seen_at, firmware, rssi, local_ip, readings_count";
const FARM_COLUMNS =
  "id, name, owner, lat, lng, area_ha, main_crop, polygon, region, planting_date, soil_type, theta_fc, theta_wp, elevation_m, ec_calibration_factor, irrigation_water_ec";
/** Postgres undefined_column / undefined_table / undefined_function: migration 0004 isn't applied. */
const MISSING = new Set(["42703", "42P01", "42883", "PGRST202", "PGRST205"]);

type Row = Record<string, unknown>;
interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

function toDevice(r: Row): StoredDevice {
  return {
    id: String(r.id),
    owner_id: String(r.owner_id),
    farm_id: String(r.farm_id),
    name: str(r.name) ?? "ESP32 probe",
    sensor_id: String(r.sensor_id),
    lat: num(r.lat),
    lng: num(r.lng),
    interval_s: num(r.interval_s) ?? 10,
    token_hash: str(r.token_hash) ?? "",
    token_hint: str(r.token_hint) ?? "",
    pairing_code: str(r.pairing_code),
    pairing_expires_at: iso(r.pairing_expires_at),
    created_at: iso(r.created_at) ?? new Date().toISOString(),
    paired_at: iso(r.paired_at),
    last_seen_at: iso(r.last_seen_at),
    firmware: str(r.firmware),
    rssi: num(r.rssi),
    local_ip: str(r.local_ip),
    readings_count: num(r.readings_count) ?? 0,
  };
}

async function exec(label: string, query: PromiseLike<Result>): Promise<unknown> {
  let res: Result;
  try {
    res = await withTimeout(query, TIMEOUT_MS, `Supabase ${label}`);
  } catch (error) {
    throw new AccountStoreError(error instanceof Error ? error.message : String(error));
  }
  if (res.error) {
    if (res.error.code && MISSING.has(res.error.code)) {
      throw new AccountStoreError(`${label}: the database is missing migration 0004_accounts_devices.sql (${res.error.message})`);
    }
    throw new AccountStoreError(`${label}: ${res.error.message}`);
  }
  return res.data;
}

const rows = (data: unknown): Row[] => (Array.isArray(data) ? (data as Row[]) : []);
const one = (data: unknown): Row | null => (Array.isArray(data) ? ((data[0] as Row) ?? null) : data && typeof data === "object" ? (data as Row) : null);

/** Process-local change counter; Supabase versions also roll every 10 s so other writers show up. */
const localVersions = new Map<string, number>();
const bump = (owner: string) => localVersions.set(owner, (localVersions.get(owner) ?? 0) + 1);

export class SupabaseAccountStore implements AccountStore {
  constructor(readonly ownerId: string) {}

  private async client(): Promise<{ db: SupabaseClient; admin: boolean }> {
    const admin = createSupabaseAdminClient();
    if (admin) return { db: admin, admin: true };
    const db = await createSupabaseDataClient();
    if (!db) throw new AccountStoreError("Supabase is not configured");
    return { db, admin: false };
  }

  async version(): Promise<string> {
    return `supabase:${localVersions.get(this.ownerId) ?? 0}:${Math.floor(Date.now() / 10_000)}`;
  }

  async listFarms(): Promise<Farm[]> {
    const { db } = await this.client();
    const data = await exec("farms", db.from("farms").select(FARM_COLUMNS).eq("owner_id", this.ownerId).order("created_at"));
    return rows(data).map(parseFarmRow).filter((f): f is Farm => f !== null);
  }

  async insertFarm(farm: Farm): Promise<Farm> {
    const { db } = await this.client();
    const data = await exec("insert farm", db.from("farms").insert({ ...farm, owner_id: this.ownerId }).select(FARM_COLUMNS));
    bump(this.ownerId);
    const saved = parseFarmRow(one(data));
    if (!saved) throw new AccountStoreError("The saved farm could not be read back");
    return saved;
  }

  async updateFarm(id: string, patch: Partial<Farm>): Promise<Farm | null> {
    const { db } = await this.client();
    const { id: _id, ...rest } = patch;
    const data = await exec("update farm", db.from("farms").update(rest).eq("id", id).eq("owner_id", this.ownerId).select(FARM_COLUMNS));
    bump(this.ownerId);
    const row = one(data);
    return row ? parseFarmRow(row) : null;
  }

  async deleteFarm(id: string): Promise<boolean> {
    const { db } = await this.client();
    const data = await exec("delete farm", db.from("farms").delete().eq("id", id).eq("owner_id", this.ownerId).select("id"));
    bump(this.ownerId);
    return rows(data).length > 0;
  }

  async listDevices(): Promise<StoredDevice[]> {
    const { db } = await this.client();
    const data = await exec("devices", db.from("devices").select(DEVICE_COLUMNS).eq("owner_id", this.ownerId).order("created_at"));
    return rows(data).map(toDevice);
  }

  async insertDevice(device: NewDevice): Promise<StoredDevice> {
    const { db } = await this.client();
    const data = await exec("insert device", db.from("devices").insert({ ...device, owner_id: this.ownerId }).select(DEVICE_COLUMNS));
    bump(this.ownerId);
    const row = one(data);
    if (!row) throw new AccountStoreError("The saved device could not be read back");
    return toDevice(row);
  }

  async updateDevice(id: string, patch: DeviceUpdate): Promise<StoredDevice | null> {
    const { db } = await this.client();
    const data = await exec("update device", db.from("devices").update(patch).eq("id", id).eq("owner_id", this.ownerId).select(DEVICE_COLUMNS));
    bump(this.ownerId);
    const row = one(data);
    return row ? toDevice(row) : null;
  }

  async updateAllDevices(patch: Pick<DeviceUpdate, "interval_s">): Promise<number> {
    const { db } = await this.client();
    const data = await exec("update devices", db.from("devices").update(patch).eq("owner_id", this.ownerId).select("id"));
    bump(this.ownerId);
    return rows(data).length;
  }

  async deleteDevice(id: string): Promise<boolean> {
    const { db } = await this.client();
    const data = await exec("delete device", db.from("devices").delete().eq("id", id).eq("owner_id", this.ownerId).select("id"));
    bump(this.ownerId);
    return rows(data).length > 0;
  }

  async dailyAggregates(fromDay: string, farmIds: string[]): Promise<SensorDaily[]> {
    if (farmIds.length === 0) return [];
    const { db } = await this.client();
    try {
      return await withTimeout(fetchDaily(db, fromDay, farmIds), TIMEOUT_MS * 2, "Supabase sensor_daily");
    } catch (error) {
      throw new AccountStoreError(error instanceof Error ? error.message : String(error));
    }
  }

  async readingsSince(afterId: number, farmIds: string[], limit = 500): Promise<StoredReading[]> {
    if (farmIds.length === 0) return [];
    const { db } = await this.client();
    const data = await exec(
      "live readings",
      db.from("sensor_readings").select("*").in("farm_id", farmIds).gt("id", afterId).order("id", { ascending: true }).limit(limit),
    );
    return rows(data).map(toReading);
  }

  async latestReadingId(farmIds: string[]): Promise<number> {
    if (farmIds.length === 0) return 0;
    const { db } = await this.client();
    const data = await exec("latest reading", db.from("sensor_readings").select("id").in("farm_id", farmIds).order("id", { ascending: false }).limit(1));
    return num(one(data)?.id) ?? 0;
  }

  async readingsBetween(farmId: string, fromMs: number, toMs: number): Promise<SensorReading[]> {
    const { db } = await this.client();
    const out: SensorReading[] = [];
    for (let from = 0; from < 50_000; from += PAGE) {
      const data = await exec(
        "readings",
        db
          .from("sensor_readings")
          .select("*")
          .eq("farm_id", farmId)
          .gte("timestamp", new Date(fromMs).toISOString())
          .lt("timestamp", new Date(toMs).toISOString())
          .order("timestamp")
          .range(from, from + PAGE - 1),
      );
      const page = rows(data);
      out.push(...page.map(toReading));
      if (page.length < PAGE) break;
    }
    return out;
  }

  async bucketSeries(farmId: string, fromMs: number, toMs: number, bucketMs: number): Promise<BucketMap> {
    const { db } = await this.client();
    try {
      const data = await exec(
        "reading_series",
        db.rpc("reading_series", {
          p_farm_id: farmId,
          p_from: new Date(fromMs).toISOString(),
          p_to: new Date(toMs).toISOString(),
          p_bucket_seconds: Math.max(1, Math.round(bucketMs / 1000)),
        }),
      );
      return bucketsFromRpc(rows(data));
    } catch (error) {
      // Older databases without the function: bucket raw readings here instead.
      console.warn("[account] reading_series unavailable, bucketing in the app:", error instanceof Error ? error.message : error);
      const map: BucketMap = new Map();
      addReadings(map, await this.readingsBetween(farmId, fromMs, toMs), bucketMs, QATAR_ORIGIN_MS, fromMs, toMs);
      return map;
    }
  }

  async firstReadingAt(farmId: string): Promise<number | null> {
    const { db } = await this.client();
    const data = await exec("first reading", db.from("sensor_readings").select("timestamp").eq("farm_id", farmId).order("timestamp").limit(1));
    const ts = iso(one(data)?.timestamp);
    return ts ? Date.parse(ts) : null;
  }
}

function bucketsFromRpc(list: Row[]): BucketMap {
  const map: BucketMap = new Map();
  for (const r of list) {
    const sensor = String(r.sensor_id);
    const start = Date.parse(String(r.bucket));
    const firstT = Date.parse(String(r.first_ts));
    const lastT = Date.parse(String(r.last_ts));
    const stats: BucketStats = { count: num(r.n) ?? 0, firstT, lastT };
    for (const m of SERIES_METRICS) {
      const n = num(r[`${m}_n`]) ?? 0;
      const avg = num(r[`${m}_avg`]);
      const min = num(r[`${m}_min`]);
      const max = num(r[`${m}_max`]);
      if (n === 0 || avg == null || min == null || max == null) continue;
      // The database gives mean/min/max per bucket, not when they happened: the bucket's own times stand in.
      stats[m] = { n, sum: avg * n, min, max, minT: start, maxT: start, last: avg, lastT };
    }
    let bySensor = map.get(sensor);
    if (!bySensor) {
      bySensor = new Map();
      map.set(sensor, bySensor);
    }
    bySensor.set(start, stats);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

function admin(): SupabaseClient {
  const client = createSupabaseAdminClient();
  if (!client) throw new AccountStoreError("ESP32 devices need SUPABASE_SERVICE_ROLE_KEY on the server");
  return client;
}

function metaColumns(meta: DeviceMeta): Row {
  const out: Row = {};
  if (meta.firmware) out.firmware = meta.firmware.slice(0, 40);
  if (typeof meta.rssi === "number" && Number.isFinite(meta.rssi)) out.rssi = Math.round(meta.rssi);
  if (meta.local_ip) out.local_ip = meta.local_ip.slice(0, 45);
  return out;
}

export const supabaseDeviceRegistry: DeviceRegistry = {
  async findByToken(tokenHash) {
    const data = await exec("device", admin().from("devices").select(DEVICE_COLUMNS).eq("token_hash", tokenHash).limit(1));
    const row = one(data);
    return row ? toDevice(row) : null;
  },

  async claimPairingCode(code, token, meta) {
    const now = new Date().toISOString();
    const data = await exec(
      "pair device",
      admin()
        .from("devices")
        .update({ token_hash: token.hash, token_hint: token.hint, pairing_code: null, pairing_expires_at: null, paired_at: now, ...metaColumns(meta) })
        .eq("pairing_code", code)
        .gt("pairing_expires_at", now)
        .select(DEVICE_COLUMNS),
    );
    const row = one(data);
    if (!row) return null;
    const device = toDevice(row);
    bump(device.owner_id);
    return device;
  },

  async recordReadings(device, readings, meta) {
    const db = admin();
    let stored: number;
    try {
      stored = await withTimeout(insertReadings(db, readings), TIMEOUT_MS * 2, "Supabase insert readings");
    } catch (error) {
      throw new AccountStoreError(error instanceof Error ? error.message : String(error));
    }
    const now = new Date().toISOString();
    await exec(
      "device seen",
      db
        .from("devices")
        .update({
          last_seen_at: now,
          paired_at: device.paired_at ?? now,
          pairing_code: null,
          pairing_expires_at: null,
          readings_count: device.readings_count + stored,
          ...metaColumns(meta),
        })
        .eq("id", device.id),
    );
    bump(device.owner_id);
    return stored;
  },
};

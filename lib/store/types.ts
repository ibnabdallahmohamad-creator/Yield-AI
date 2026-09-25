/**
 * Storage for accounts' own data: farms, ESP32 devices, probe readings, settings, insights and
 * cached weather. Two implementations share this interface — Supabase (`supabase.ts`) and a
 * file-backed local store (`local.ts`) used when Supabase is not configured.
 *
 * Every owner-scoped method filters by `ownerId` itself, so callers can never read another
 * account's farms by passing a farm id.
 */
import type { AiInsight } from "../ai/contract";
import type { SeriesRow } from "../data/series";
import type { Device, DeviceSnapshot, Farm, SensorDaily, SensorReading, UserSettings } from "../types";

export const DEFAULT_SETTINGS: UserSettings = { reading_interval_s: 10 };

/** Reading intervals offered in the app (seconds). */
export const READING_INTERVALS_S = [5, 10, 15, 30, 60, 300, 900, 1800, 3600] as const;

export interface StoredReading extends SensorReading {
  id: number;
}

export type FarmPatch = Partial<
  Pick<
    Farm,
    | "name"
    | "owner"
    | "region"
    | "main_crop"
    | "planting_date"
    | "soil_type"
    | "irrigation_water_ec"
    | "ec_calibration_factor"
    | "elevation_m"
    | "polygon"
    | "lat"
    | "lng"
    | "area_ha"
  >
>;

export type DevicePatch = Partial<Pick<Device, "name" | "lat" | "lng">>;

/** What a device request tells us about the device itself. */
export interface DeviceContact {
  at: string;
  ip: string | null;
  rssi: number | null;
  firmware: string | null;
  error: string | null;
  /** Present when the request carried a measurement. */
  reading: DeviceSnapshot | null;
}

export interface CachedValue {
  fetched_at: string;
  payload: unknown;
}

export interface DataStore {
  readonly kind: "supabase" | "local";

  listFarms(ownerId: string): Promise<Farm[]>;
  insertFarm(farm: Farm & { owner_id: string }): Promise<void>;
  updateFarm(ownerId: string, farmId: string, patch: FarmPatch): Promise<Farm | null>;
  /** Deletes the farm with its devices, readings and insights. */
  deleteFarm(ownerId: string, farmId: string): Promise<boolean>;
  /** Any farm by id, whatever its owner — for the legacy INGEST_API_KEY bulk import only. */
  findFarmForIngest(farmId: string): Promise<Farm | null>;
  /** Every account's farms — for server jobs (the 12-hourly weather refresh) only. */
  listAllFarms(): Promise<Farm[]>;

  listDevices(ownerId: string): Promise<Device[]>;
  insertDevice(device: Device, tokenHash: string): Promise<void>;
  updateDevice(ownerId: string, deviceId: string, patch: DevicePatch): Promise<Device | null>;
  setDeviceToken(ownerId: string, deviceId: string, tokenHash: string, tokenHint: string): Promise<Device | null>;
  deleteDevice(ownerId: string, deviceId: string): Promise<boolean>;
  /** Device authentication: look a device up by the SHA-256 of its key (any owner). */
  findDeviceByTokenHash(tokenHash: string): Promise<Device | null>;
  recordDeviceContact(deviceId: string, contact: DeviceContact): Promise<void>;

  /** Stores readings, skipping duplicates of (farm, probe, timestamp). Returns how many were new. */
  insertReadings(readings: SensorReading[]): Promise<number>;
  /** Daily means per probe (Asia/Qatar days) from `fromDay` on — the `sensor_daily` view. */
  dailyAggregates(farmIds: string[], fromDay: string): Promise<SensorDaily[]>;
  readingsForDay(farmId: string, day: string): Promise<SensorReading[]>;
  readingsSince(farmIds: string[], afterId: number, limit: number): Promise<StoredReading[]>;
  maxReadingId(farmIds: string[]): Promise<number>;
  /** Readings in [fromIso, toIso), raw (bucketS = 0) or averaged per bucket. */
  series(farmId: string, fromIso: string, toIso: string, bucketS: number): Promise<SeriesRow[]>;

  getSettings(ownerId: string): Promise<UserSettings>;
  saveSettings(ownerId: string, settings: UserSettings): Promise<void>;

  listInsights(farmIds: string[]): Promise<AiInsight[]>;

  /** Small shared cache (e.g. the 12-hourly weather forecast). */
  getCached(key: string): Promise<CachedValue | null>;
  putCached(key: string, value: CachedValue): Promise<void>;
}

export class StoreError extends Error {}

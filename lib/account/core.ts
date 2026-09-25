/**
 * Storage contract for a real account's farms, ESP32 devices and readings. Two implementations:
 * Supabase (tables from migration 0004, when Supabase is configured) and local JSON / NDJSON files
 * in `.data/` (local accounts). The device side (token lookup, pairing, ingest) is not tied to a
 * signed-in user, so it lives on `DeviceRegistry`.
 */
import "server-only";
import type { Farm, SensorDaily, SensorReading } from "../types";
import type { BucketMap } from "../readings/series";
import type { StoredDevice } from "./types";

export interface StoredReading extends SensorReading {
  id: number;
}

export class AccountStoreError extends Error {}
export class NotFoundError extends Error {}

export interface NewDevice {
  id: string;
  farm_id: string;
  name: string;
  sensor_id: string;
  lat: number | null;
  lng: number | null;
  interval_s: number;
  token_hash: string;
  token_hint: string;
  pairing_code: string;
  pairing_expires_at: string;
}

export type DeviceUpdate = Partial<
  Pick<
    StoredDevice,
    | "name"
    | "farm_id"
    | "sensor_id"
    | "interval_s"
    | "lat"
    | "lng"
    | "token_hash"
    | "token_hint"
    | "pairing_code"
    | "pairing_expires_at"
    | "paired_at"
  >
>;

export interface AccountStore {
  readonly ownerId: string;
  /** Changes whenever the account's farms, devices or readings change (cache key). */
  version(): Promise<string>;

  listFarms(): Promise<Farm[]>;
  insertFarm(farm: Farm): Promise<Farm>;
  updateFarm(id: string, patch: Partial<Farm>): Promise<Farm | null>;
  /** Deletes the farm with its devices and readings. */
  deleteFarm(id: string): Promise<boolean>;

  listDevices(): Promise<StoredDevice[]>;
  insertDevice(device: NewDevice): Promise<StoredDevice>;
  updateDevice(id: string, patch: DeviceUpdate): Promise<StoredDevice | null>;
  updateAllDevices(patch: Pick<DeviceUpdate, "interval_s">): Promise<number>;
  deleteDevice(id: string): Promise<boolean>;

  /** Daily per-probe aggregates (Asia/Qatar days) from `fromDay` on, for the account's farms. */
  dailyAggregates(fromDay: string, farmIds: string[]): Promise<SensorDaily[]>;
  /** Readings stored after `afterId` for these farms, oldest first (live mode). */
  readingsSince(afterId: number, farmIds: string[], limit?: number): Promise<StoredReading[]>;
  /** The newest reading id for these farms (0 when none): the starting live cursor. */
  latestReadingId(farmIds: string[]): Promise<number>;
  /** A farm's readings in [from, to), for the live re-derivation of today. */
  readingsBetween(farmId: string, fromMs: number, toMs: number): Promise<SensorReading[]>;
  /** A farm's readings bucketed for charts. */
  bucketSeries(farmId: string, fromMs: number, toMs: number, bucketMs: number): Promise<BucketMap>;
  /** Time of a farm's first stored reading (the "All" range starts there). */
  firstReadingAt(farmId: string): Promise<number | null>;
}

export interface DeviceRegistry {
  findByToken(tokenHash: string): Promise<StoredDevice | null>;
  /** Claim a pairing code: sets the new token and `paired_at`, clears the code. Null when unknown or expired. */
  claimPairingCode(code: string, token: { hash: string; hint: string }, meta: DeviceMeta): Promise<StoredDevice | null>;
  /** Store a device's readings and mark it seen. Returns how many were stored. */
  recordReadings(device: StoredDevice, readings: SensorReading[], meta: DeviceMeta): Promise<number>;
}

export interface DeviceMeta {
  firmware?: string | null;
  rssi?: number | null;
  local_ip?: string | null;
}

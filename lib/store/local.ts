/**
 * File-backed store for accounts' data when Supabase is not configured (or USE_MOCK=true).
 *
 *   .data/store.json      farms, devices, settings, insights (rewritten atomically on change)
 *   .data/readings.jsonl  probe readings, one JSON object per line (appended as they arrive)
 *   .data/cache.json      small shared cache (the 12-hourly weather forecast)
 *
 * Readings keep full resolution for 48 hours; older ones are thinned to one per probe every
 * 10 minutes and dropped after 120 days, so a device reporting every 10 s stays at a few MB.
 * On a read-only file system everything keeps working in memory.
 */
import "server-only";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AiInsight } from "../ai/contract";
import { aggregateDaily } from "../data/aggregate";
import { bucketReadings, type SeriesRow } from "../data/series";
import { qatarDateString } from "../data/time";
import type { Device, Farm, SensorDaily, SensorReading, UserSettings } from "../types";
import {
  DEFAULT_SETTINGS,
  type CachedValue,
  type DataStore,
  type DeviceContact,
  type DevicePatch,
  type FarmPatch,
  type StoredReading,
} from "./types";

const RAW_RETENTION_MS = 48 * 3_600_000;
const THINNED_SLOT_MS = 10 * 60_000;
const MAX_AGE_MS = 120 * 86_400_000;
const COMPACT_EVERY_MS = 60 * 60_000;
/** Device contact (last seen, signal) is saved lazily; a crash loses at most this much of it. */
const CONTACT_FLUSH_MS = 3000;

interface StoredDevice extends Device {
  token_hash: string;
}

interface Persisted {
  version: 1;
  farms: Farm[];
  devices: StoredDevice[];
  settings: Record<string, UserSettings>;
  insights: AiInsight[];
}

interface State extends Persisted {
  cache: Record<string, CachedValue>;
  readings: StoredReading[];
  byFarm: Map<string, StoredReading[]>;
  seen: Set<string>;
  nextId: number;
  lastCompaction: number;
}

const readingKey = (r: SensorReading) => `${r.farm_id}|${r.sensor_id}|${r.timestamp}`;
const publicDevice = ({ token_hash: _hash, ...device }: StoredDevice): Device => device;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class LocalStore implements DataStore {
  readonly kind = "local" as const;
  private state: State | null = null;
  private loading: Promise<State> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private persistent = true;
  private contactTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private file(name: string) {
    return path.join(this.dir, name);
  }

  // ---------------------------------------------------------------------------
  // Loading and persistence
  // ---------------------------------------------------------------------------

  private async load(): Promise<State> {
    if (this.state) return this.state;
    this.loading ??= this.readFromDisk().then(
      (state) => {
        this.state = state;
        return state;
      },
      (error) => {
        this.loading = null; // let the next call try again
        throw error;
      },
    );
    return this.loading;
  }

  private async readFromDisk(): Promise<State> {
    let persisted: Persisted = { version: 1, farms: [], devices: [], settings: {}, insights: [] };
    try {
      const parsed = JSON.parse(await readFile(this.file("store.json"), "utf8")) as unknown;
      if (isRecord(parsed)) {
        persisted = {
          version: 1,
          farms: Array.isArray(parsed.farms) ? (parsed.farms as Farm[]) : [],
          devices: Array.isArray(parsed.devices) ? (parsed.devices as StoredDevice[]) : [],
          settings: isRecord(parsed.settings) ? (parsed.settings as Record<string, UserSettings>) : {},
          insights: Array.isArray(parsed.insights) ? (parsed.insights as AiInsight[]) : [],
        };
      }
    } catch {
      // First run (or unreadable file): start empty.
    }

    let cache: Record<string, CachedValue> = {};
    try {
      const parsed = JSON.parse(await readFile(this.file("cache.json"), "utf8")) as unknown;
      if (isRecord(parsed)) cache = parsed as Record<string, CachedValue>;
    } catch {
      // No cache yet.
    }

    const readings: StoredReading[] = [];
    try {
      const text = await readFile(this.file("readings.jsonl"), "utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as StoredReading;
          if (typeof r.id === "number" && typeof r.farm_id === "string" && typeof r.timestamp === "string") readings.push(r);
        } catch {
          // Skip a torn last line (e.g. the process stopped mid-write).
        }
      }
    } catch {
      // No readings yet.
    }

    const state: State = {
      ...persisted,
      cache,
      readings: readings.sort((a, b) => a.id - b.id),
      byFarm: new Map(),
      seen: new Set(),
      nextId: 1,
      lastCompaction: 0,
    };
    const dropped = this.compact(state);
    if (dropped > 0) await this.rewriteReadings(state);
    return state;
  }

  private reindex(state: State) {
    state.byFarm = new Map();
    state.seen = new Set();
    for (const r of state.readings) {
      const list = state.byFarm.get(r.farm_id);
      if (list) list.push(r);
      else state.byFarm.set(r.farm_id, [r]);
      state.seen.add(readingKey(r));
    }
    state.nextId = Math.max(state.nextId, (state.readings.at(-1)?.id ?? 0) + 1);
  }

  /** Thin and expire old readings; returns how many were dropped. */
  private compact(state: State): number {
    const now = this.now();
    const rawCutoff = now - RAW_RETENTION_MS;
    const ageCutoff = now - MAX_AGE_MS;
    const before = state.readings.length;
    const slots = new Set<string>();
    const keep = new Set<number>();
    const byTime = [...state.readings].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    for (const r of byTime) {
      const ms = Date.parse(r.timestamp);
      if (!(ms >= ageCutoff)) continue;
      if (ms < rawCutoff) {
        const slot = `${r.farm_id}|${r.sensor_id}|${Math.floor(ms / THINNED_SLOT_MS)}`;
        if (slots.has(slot)) continue;
        slots.add(slot);
      }
      keep.add(r.id);
    }
    state.readings = state.readings.filter((r) => keep.has(r.id));
    state.lastCompaction = now;
    this.reindex(state);
    return before - state.readings.length;
  }

  /** Serialise file writes so they never interleave. */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.chain.then(async () => {
      if (!this.persistent) return;
      try {
        await mkdir(this.dir, { recursive: true });
        await task();
      } catch (error) {
        this.persistent = false;
        console.warn(
          `[store] Could not write to ${this.dir} — keeping data in memory only:`,
          error instanceof Error ? error.message : error,
        );
      }
    });
    this.chain = run;
    return run;
  }

  private async writeAtomic(name: string, content: string) {
    const target = this.file(name);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, target);
  }

  private saveState(state: State): Promise<void> {
    if (this.contactTimer) {
      clearTimeout(this.contactTimer);
      this.contactTimer = null;
    }
    const snapshot: Persisted = {
      version: 1,
      farms: state.farms,
      devices: state.devices,
      settings: state.settings,
      insights: state.insights,
    };
    const json = JSON.stringify(snapshot, null, 1);
    return this.enqueue(() => this.writeAtomic("store.json", json));
  }

  private rewriteReadings(state: State): Promise<void> {
    const text = state.readings.map((r) => JSON.stringify(r)).join("\n") + (state.readings.length ? "\n" : "");
    return this.enqueue(() => this.writeAtomic("readings.jsonl", text));
  }

  // ---------------------------------------------------------------------------
  // Farms
  // ---------------------------------------------------------------------------

  async listFarms(ownerId: string): Promise<Farm[]> {
    const state = await this.load();
    return state.farms.filter((f) => f.owner_id === ownerId).sort((a, b) => a.name.localeCompare(b.name));
  }

  async insertFarm(farm: Farm & { owner_id: string }): Promise<void> {
    const state = await this.load();
    if (state.farms.some((f) => f.id === farm.id)) throw new Error(`Farm ${farm.id} already exists`);
    state.farms.push(farm);
    await this.saveState(state);
  }

  async updateFarm(ownerId: string, farmId: string, patch: FarmPatch): Promise<Farm | null> {
    const state = await this.load();
    const farm = state.farms.find((f) => f.id === farmId && f.owner_id === ownerId);
    if (!farm) return null;
    Object.assign(farm, patch);
    await this.saveState(state);
    return farm;
  }

  async deleteFarm(ownerId: string, farmId: string): Promise<boolean> {
    const state = await this.load();
    const farm = state.farms.find((f) => f.id === farmId && f.owner_id === ownerId);
    if (!farm) return false;
    state.farms = state.farms.filter((f) => f !== farm);
    state.devices = state.devices.filter((d) => d.farm_id !== farmId);
    state.insights = state.insights.filter((i) => i.farm_id !== farmId);
    const hadReadings = state.byFarm.has(farmId);
    if (hadReadings) {
      state.readings = state.readings.filter((r) => r.farm_id !== farmId);
      this.reindex(state);
      await this.rewriteReadings(state);
    }
    await this.saveState(state);
    return true;
  }

  async findFarmForIngest(farmId: string): Promise<Farm | null> {
    const state = await this.load();
    return state.farms.find((f) => f.id === farmId) ?? null;
  }

  async listAllFarms(): Promise<Farm[]> {
    const state = await this.load();
    return [...state.farms];
  }

  // ---------------------------------------------------------------------------
  // Devices
  // ---------------------------------------------------------------------------

  async listDevices(ownerId: string): Promise<Device[]> {
    const state = await this.load();
    return state.devices
      .filter((d) => d.owner_id === ownerId)
      .map(publicDevice)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async insertDevice(device: Device, tokenHash: string): Promise<void> {
    const state = await this.load();
    if (state.devices.some((d) => d.id === device.id)) throw new Error(`Device ${device.id} already exists`);
    if (state.devices.some((d) => d.farm_id === device.farm_id && d.sensor_id === device.sensor_id)) {
      throw new Error(`Probe ${device.sensor_id} already exists on this farm`);
    }
    state.devices.push({ ...device, token_hash: tokenHash });
    await this.saveState(state);
  }

  async updateDevice(ownerId: string, deviceId: string, patch: DevicePatch): Promise<Device | null> {
    const state = await this.load();
    const device = state.devices.find((d) => d.id === deviceId && d.owner_id === ownerId);
    if (!device) return null;
    Object.assign(device, patch);
    await this.saveState(state);
    return publicDevice(device);
  }

  async setDeviceToken(ownerId: string, deviceId: string, tokenHash: string, tokenHint: string): Promise<Device | null> {
    const state = await this.load();
    const device = state.devices.find((d) => d.id === deviceId && d.owner_id === ownerId);
    if (!device) return null;
    device.token_hash = tokenHash;
    device.token_hint = tokenHint;
    await this.saveState(state);
    return publicDevice(device);
  }

  async deleteDevice(ownerId: string, deviceId: string): Promise<boolean> {
    const state = await this.load();
    const before = state.devices.length;
    state.devices = state.devices.filter((d) => !(d.id === deviceId && d.owner_id === ownerId));
    if (state.devices.length === before) return false;
    await this.saveState(state);
    return true;
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<Device | null> {
    const state = await this.load();
    const device = state.devices.find((d) => d.token_hash === tokenHash);
    return device ? publicDevice(device) : null;
  }

  async recordDeviceContact(deviceId: string, contact: DeviceContact): Promise<void> {
    const state = await this.load();
    const device = state.devices.find((d) => d.id === deviceId);
    if (!device) return;
    device.last_seen_at = contact.at;
    device.last_ip = contact.ip;
    if (contact.rssi != null) device.rssi = contact.rssi;
    if (contact.firmware) device.firmware = contact.firmware;
    device.last_error = contact.error;
    if (contact.reading) {
      device.last_reading_at = contact.reading.timestamp > (device.last_reading_at ?? "") ? contact.reading.timestamp : device.last_reading_at;
      if (!device.last_reading || contact.reading.timestamp >= device.last_reading.timestamp) device.last_reading = contact.reading;
    }
    // Contact updates arrive every few seconds per device: save them in batches.
    if (!this.contactTimer) {
      this.contactTimer = setTimeout(() => {
        this.contactTimer = null;
        void this.saveState(state);
      }, CONTACT_FLUSH_MS);
      this.contactTimer.unref?.();
    }
  }

  // ---------------------------------------------------------------------------
  // Readings
  // ---------------------------------------------------------------------------

  async insertReadings(readings: SensorReading[]): Promise<number> {
    const state = await this.load();
    const fresh: StoredReading[] = [];
    for (const r of readings) {
      const key = readingKey(r);
      if (state.seen.has(key)) continue;
      state.seen.add(key);
      const stored: StoredReading = { ...r, id: state.nextId++ };
      fresh.push(stored);
      state.readings.push(stored);
      const list = state.byFarm.get(r.farm_id);
      if (list) list.push(stored);
      else state.byFarm.set(r.farm_id, [stored]);
    }
    if (fresh.length > 0) {
      const lines = fresh.map((r) => JSON.stringify(r)).join("\n") + "\n";
      await this.enqueue(() => appendFile(this.file("readings.jsonl"), lines, "utf8"));
    }
    if (this.now() - state.lastCompaction > COMPACT_EVERY_MS && this.compact(state) > 0) {
      await this.rewriteReadings(state);
    }
    return fresh.length;
  }

  private farmReadings(state: State, farmIds: string[]): StoredReading[] {
    return farmIds.flatMap((id) => state.byFarm.get(id) ?? []);
  }

  async dailyAggregates(farmIds: string[], fromDay: string): Promise<SensorDaily[]> {
    const state = await this.load();
    const rows = this.farmReadings(state, farmIds).filter((r) => qatarDateString(r.timestamp) >= fromDay);
    return aggregateDaily(rows);
  }

  async readingsForDay(farmId: string, day: string): Promise<SensorReading[]> {
    const state = await this.load();
    return (state.byFarm.get(farmId) ?? []).filter((r) => qatarDateString(r.timestamp) === day);
  }

  async readingsSince(farmIds: string[], afterId: number, limit: number): Promise<StoredReading[]> {
    const state = await this.load();
    const ids = new Set(farmIds);
    const out: StoredReading[] = [];
    for (const r of state.readings) {
      if (r.id > afterId && ids.has(r.farm_id)) {
        out.push(r);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  async maxReadingId(farmIds: string[]): Promise<number> {
    const state = await this.load();
    let max = 0;
    for (const r of this.farmReadings(state, farmIds)) if (r.id > max) max = r.id;
    return max;
  }

  async series(farmId: string, fromIso: string, toIso: string, bucketS: number): Promise<SeriesRow[]> {
    const state = await this.load();
    return bucketReadings(state.byFarm.get(farmId) ?? [], Date.parse(fromIso), Date.parse(toIso), bucketS);
  }

  // ---------------------------------------------------------------------------
  // Settings, insights, cache
  // ---------------------------------------------------------------------------

  async getSettings(ownerId: string): Promise<UserSettings> {
    const state = await this.load();
    return { ...DEFAULT_SETTINGS, ...state.settings[ownerId] };
  }

  async saveSettings(ownerId: string, settings: UserSettings): Promise<void> {
    const state = await this.load();
    state.settings[ownerId] = settings;
    await this.saveState(state);
  }

  async listInsights(farmIds: string[]): Promise<AiInsight[]> {
    const state = await this.load();
    const ids = new Set(farmIds);
    return state.insights.filter((i) => ids.has(i.farm_id));
  }

  async getCached(key: string): Promise<CachedValue | null> {
    const state = await this.load();
    return state.cache[key] ?? null;
  }

  async putCached(key: string, value: CachedValue): Promise<void> {
    const state = await this.load();
    state.cache[key] = value;
    const json = JSON.stringify(state.cache);
    await this.enqueue(() => this.writeAtomic("cache.json", json));
  }

  /** Wait for pending writes (tests). */
  async flush(): Promise<void> {
    if (this.contactTimer && this.state) await this.saveState(this.state);
    await this.chain;
  }
}

const globalStores = globalThis as unknown as { __yieldLocalStores?: Map<string, LocalStore> };

/** One store per data folder per process (route handlers and pages share it). */
export function getLocalStore(dir: string): LocalStore {
  globalStores.__yieldLocalStores ??= new Map();
  let store = globalStores.__yieldLocalStores.get(dir);
  if (!store) {
    store = new LocalStore(dir);
    globalStores.__yieldLocalStores.set(dir, store);
  }
  return store;
}

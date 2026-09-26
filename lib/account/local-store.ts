/**
 * Farms, ESP32 devices and readings for local accounts (no Supabase), in `.data/` (git-ignored):
 *
 *   accounts/<owner>.json                       farms and devices (atomic writes)
 *   readings/<owner>/<farm>/<YYYY-MM-DD>.ndjson  one reading per line, appended as it arrives
 *
 * Day files are Asia/Qatar days. Past days never change, so their daily aggregates and one-minute
 * chart buckets are computed once and cached; today's file is read incrementally (only the bytes
 * appended since the last read). On read-only file systems everything falls back to memory.
 */
import "server-only";
import { appendFile, mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { aggregateDaily } from "../data/aggregate";
import { addDays, qatarDateString } from "../data/time";
import { addReadings, mergeBuckets, type BucketMap } from "../readings/series";
import { dataRoot, errorCode, fileKey, isReadOnlyError, messageOf, writeAtomic } from "../storage/files";
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

const RECENT_LIMIT = 5000;
const RAW_CACHE_FILES = 8;
const META_FLUSH_MS = 30_000;
/** Buckets line up with Asia/Qatar clock time (UTC+3). */
export const QATAR_ORIGIN_MS = -3 * 3_600_000;
const MINUTE_MS = 60_000;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.ndjson$/;

interface AccountData {
  farms: Farm[];
  devices: StoredDevice[];
}

interface OwnerState {
  key: string;
  data: AccountData;
  loaded: boolean;
  queue: Promise<unknown>;
  version: number;
  /** Newest readings (live mode), oldest first. */
  recent: StoredReading[];
  flushTimer: ReturnType<typeof setTimeout> | null;
}

interface RawFile {
  size: number;
  readings: StoredReading[];
  usedAt: number;
}

interface Shared {
  owners: Map<string, OwnerState>;
  registry: Promise<void> | null;
  tokenOwner: Map<string, string>;
  codeOwner: Map<string, string>;
  raw: Map<string, RawFile>;
  daily: Map<string, { sig: string; rows: SensorDaily[] }>;
  minutes: Map<string, { sig: string; buckets: BucketMap }>;
  memoryFiles: Map<string, StoredReading[]>;
  memoryOnly: boolean;
  lastId: number;
}

/** Shared through globalThis so every route bundle (and dev reloads) see the same state. */
const g = globalThis as typeof globalThis & { __yieldAccounts?: Shared };
const shared: Shared = (g.__yieldAccounts ??= {
  owners: new Map(),
  registry: null,
  tokenOwner: new Map(),
  codeOwner: new Map(),
  raw: new Map(),
  daily: new Map(),
  minutes: new Map(),
  memoryFiles: new Map(),
  memoryOnly: false,
  lastId: 0,
});

/** Forget every cache (tests simulate a fresh process). */
export function resetLocalAccountCache(): void {
  for (const s of shared.owners.values()) if (s.flushTimer) clearTimeout(s.flushTimer);
  shared.owners.clear();
  shared.registry = null;
  shared.tokenOwner.clear();
  shared.codeOwner.clear();
  shared.raw.clear();
  shared.daily.clear();
  shared.minutes.clear();
  shared.memoryFiles.clear();
  shared.memoryOnly = false;
}

const accountsDir = () => path.join(dataRoot(), "accounts");
const accountFile = (key: string) => path.join(accountsDir(), `${key}.json`);
const farmDir = (key: string, farmId: string) => path.join(dataRoot(), "readings", key, fileKey(farmId));
const dayFile = (key: string, farmId: string, day: string) => path.join(farmDir(key, farmId), `${day}.ndjson`);

/** Reading ids grow with time (ms × 100 + a counter), so they stay ordered across restarts. */
function nextId(): number {
  shared.lastId = Math.max(shared.lastId + 1, Date.now() * 100);
  return shared.lastId;
}

let warnedMemory = false;
function goMemoryOnly(error: unknown): void {
  shared.memoryOnly = true;
  if (!warnedMemory) {
    warnedMemory = true;
    console.warn("[account] The file system is read-only; farms, devices and readings are kept in memory only:", messageOf(error));
  }
}

// ---------------------------------------------------------------------------
// Account files
// ---------------------------------------------------------------------------

async function readAccount(key: string): Promise<AccountData> {
  let text: string;
  try {
    text = await readFile(accountFile(key), "utf8");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") console.warn("[account] Could not read the account file:", messageOf(error));
    return { farms: [], devices: [] };
  }
  try {
    const parsed = JSON.parse(text) as Partial<AccountData> | null;
    return {
      farms: Array.isArray(parsed?.farms) ? parsed.farms : [],
      devices: Array.isArray(parsed?.devices) ? parsed.devices : [],
    };
  } catch (error) {
    throw new AccountStoreError(`The account file is corrupt: ${messageOf(error)}`);
  }
}

function ownerState(key: string): OwnerState {
  let state = shared.owners.get(key);
  if (!state) {
    state = { key, data: { farms: [], devices: [] }, loaded: false, queue: Promise.resolve(), version: 1, recent: [], flushTimer: null };
    shared.owners.set(key, state);
  }
  return state;
}

/** Run `fn` after every earlier operation on this owner (loads the file first). */
function run<T>(state: OwnerState, fn: () => Promise<T> | T): Promise<T> {
  const next = state.queue.then(async () => {
    if (!state.loaded) {
      state.data = await readAccount(state.key);
      state.loaded = true;
      reindex(state);
    }
    return fn();
  });
  state.queue = next.catch(() => undefined);
  return next;
}

async function persist(state: OwnerState): Promise<void> {
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  if (shared.memoryOnly) return;
  try {
    await writeAtomic(accountFile(state.key), JSON.stringify(state.data, null, 1));
  } catch (error) {
    if (isReadOnlyError(error)) goMemoryOnly(error);
    else throw new AccountStoreError(`Could not save the account: ${messageOf(error)}`);
  }
}

/** Device "last seen" changes every few seconds; write it at most every 30 s. */
function scheduleFlush(state: OwnerState): void {
  if (state.flushTimer || shared.memoryOnly) return;
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    void run(state, () => persist(state)).catch((error) => console.warn("[account] Could not save device status:", messageOf(error)));
  }, META_FLUSH_MS);
  state.flushTimer.unref?.();
}

/** Point the token and pairing-code indexes at this owner's current devices. */
function reindex(state: OwnerState): void {
  for (const [hash, owner] of shared.tokenOwner) if (owner === state.key) shared.tokenOwner.delete(hash);
  for (const [code, owner] of shared.codeOwner) if (owner === state.key) shared.codeOwner.delete(code);
  for (const d of state.data.devices) {
    if (d.token_hash) shared.tokenOwner.set(d.token_hash, state.key);
    if (d.pairing_code) shared.codeOwner.set(d.pairing_code, state.key);
  }
}

/** Load every account once so a device token can be matched to its owner. */
function ensureRegistry(): Promise<void> {
  shared.registry ??= (async () => {
    let files: string[] = [];
    try {
      files = await readdir(accountsDir());
    } catch (error) {
      if (errorCode(error) !== "ENOENT") console.warn("[account] Could not list accounts:", messageOf(error));
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const state = ownerState(file.slice(0, -5));
      await run(state, () => undefined).catch((error) => console.warn(`[account] Skipping ${file}:`, messageOf(error)));
    }
  })();
  return shared.registry;
}

// ---------------------------------------------------------------------------
// Reading files
// ---------------------------------------------------------------------------

function parseLines(text: string, into: StoredReading[]): void {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as StoredReading;
      if (typeof r.timestamp === "string" && typeof r.sensor_id === "string") into.push(r);
    } catch {
      // A torn line (crash mid-append) is skipped.
    }
  }
}

async function fileSig(file: string): Promise<{ sig: string; size: number } | null> {
  try {
    const info = await stat(file);
    return { sig: `${info.size}:${info.mtimeMs}`, size: info.size };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

/** Today's and yesterday's files: cached and read incrementally as they grow. */
async function recentFileReadings(file: string): Promise<StoredReading[]> {
  const info = await fileSig(file);
  const memory = shared.memoryFiles.get(file) ?? [];
  if (!info) return memory;
  let entry = shared.raw.get(file);
  if (!entry || info.size < entry.size) entry = { size: 0, readings: [], usedAt: Date.now() };
  if (info.size > entry.size) {
    const fh = await open(file, "r");
    try {
      const buf = Buffer.alloc(info.size - entry.size);
      const { bytesRead } = await fh.read(buf, 0, buf.length, entry.size);
      const end = buf.subarray(0, bytesRead).lastIndexOf(0x0a);
      if (end >= 0) {
        parseLines(buf.subarray(0, end + 1).toString("utf8"), entry.readings);
        entry.size += end + 1;
      }
    } finally {
      await fh.close();
    }
  }
  entry.usedAt = Date.now();
  shared.raw.set(file, entry);
  if (shared.raw.size > RAW_CACHE_FILES) {
    const oldest = [...shared.raw.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)[0];
    if (oldest && oldest[0] !== file) shared.raw.delete(oldest[0]);
  }
  return memory.length ? [...entry.readings, ...memory] : entry.readings;
}

/** Older files: parsed on demand, not kept (their aggregates and minute buckets are). */
async function fileReadings(file: string): Promise<StoredReading[]> {
  const out: StoredReading[] = [];
  try {
    parseLines(await readFile(file, "utf8"), out);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  const memory = shared.memoryFiles.get(file);
  return memory ? [...out, ...memory] : out;
}

const isRecent = (day: string) => day >= addDays(qatarDateString(Date.now()), -1);
const dayReadings = (file: string, day: string) => (isRecent(day) ? recentFileReadings(file) : fileReadings(file));

/** The days (YYYY-MM-DD) that have a reading file for this farm, oldest first. */
async function listDays(key: string, farmId: string): Promise<string[]> {
  const dir = farmDir(key, farmId);
  const days = new Set<string>();
  try {
    for (const name of await readdir(dir)) {
      const m = DAY_FILE.exec(name);
      if (m) days.add(m[1]);
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  for (const file of shared.memoryFiles.keys()) {
    if (path.dirname(file) !== dir) continue;
    const m = DAY_FILE.exec(path.basename(file));
    if (m) days.add(m[1]);
  }
  return [...days].sort();
}

async function minuteBuckets(file: string, day: string): Promise<BucketMap> {
  const info = await fileSig(file);
  const sig = `${info?.sig ?? "none"}|${shared.memoryFiles.get(file)?.length ?? 0}`;
  const cached = shared.minutes.get(file);
  if (cached && cached.sig === sig) return cached.buckets;
  const buckets: BucketMap = new Map();
  addReadings(buckets, await dayReadings(file, day), MINUTE_MS, QATAR_ORIGIN_MS);
  shared.minutes.set(file, { sig, buckets });
  return buckets;
}

function forgetFarmCaches(dir: string): void {
  for (const map of [shared.raw, shared.daily, shared.minutes, shared.memoryFiles] as Map<string, unknown>[]) {
    for (const file of map.keys()) if (file.startsWith(dir)) map.delete(file);
  }
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export class LocalAccountStore implements AccountStore {
  private readonly state: OwnerState;

  constructor(readonly ownerId: string) {
    this.state = ownerState(fileKey(ownerId));
  }

  async version(): Promise<string> {
    return run(this.state, () => `local:${this.state.version}`);
  }

  listFarms(): Promise<Farm[]> {
    return run(this.state, () => this.state.data.farms.map((f) => ({ ...f })));
  }

  insertFarm(farm: Farm): Promise<Farm> {
    return run(this.state, async () => {
      if (this.state.data.farms.some((f) => f.id === farm.id)) throw new AccountStoreError("A farm with this id already exists.");
      this.state.data.farms.push({ ...farm });
      this.state.version++;
      await persist(this.state);
      return { ...farm };
    });
  }

  updateFarm(id: string, patch: Partial<Farm>): Promise<Farm | null> {
    return run(this.state, async () => {
      const farm = this.state.data.farms.find((f) => f.id === id);
      if (!farm) return null;
      Object.assign(farm, patch, { id });
      this.state.version++;
      await persist(this.state);
      return { ...farm };
    });
  }

  deleteFarm(id: string): Promise<boolean> {
    return run(this.state, async () => {
      const before = this.state.data.farms.length;
      this.state.data.farms = this.state.data.farms.filter((f) => f.id !== id);
      if (this.state.data.farms.length === before) return false;
      this.state.data.devices = this.state.data.devices.filter((d) => d.farm_id !== id);
      this.state.recent = this.state.recent.filter((r) => r.farm_id !== id);
      this.state.version++;
      reindex(this.state);
      await persist(this.state);
      const dir = farmDir(this.state.key, id);
      forgetFarmCaches(dir);
      await rm(dir, { recursive: true, force: true }).catch((error) => console.warn("[account] Could not delete readings:", messageOf(error)));
      return true;
    });
  }

  listDevices(): Promise<StoredDevice[]> {
    return run(this.state, () => this.state.data.devices.map((d) => ({ ...d })));
  }

  insertDevice(input: NewDevice): Promise<StoredDevice> {
    return run(this.state, async () => {
      const device: StoredDevice = {
        ...input,
        owner_id: this.ownerId,
        created_at: new Date().toISOString(),
        paired_at: null,
        last_seen_at: null,
        firmware: null,
        rssi: null,
        local_ip: null,
        readings_count: 0,
      };
      this.state.data.devices.push(device);
      this.state.version++;
      reindex(this.state);
      await persist(this.state);
      return { ...device };
    });
  }

  updateDevice(id: string, patch: DeviceUpdate): Promise<StoredDevice | null> {
    return run(this.state, async () => {
      const device = this.state.data.devices.find((d) => d.id === id);
      if (!device) return null;
      Object.assign(device, patch, { id });
      this.state.version++;
      reindex(this.state);
      await persist(this.state);
      return { ...device };
    });
  }

  updateAllDevices(patch: Pick<DeviceUpdate, "interval_s">): Promise<number> {
    return run(this.state, async () => {
      for (const d of this.state.data.devices) Object.assign(d, patch);
      this.state.version++;
      await persist(this.state);
      return this.state.data.devices.length;
    });
  }

  deleteDevice(id: string): Promise<boolean> {
    return run(this.state, async () => {
      const before = this.state.data.devices.length;
      this.state.data.devices = this.state.data.devices.filter((d) => d.id !== id);
      if (this.state.data.devices.length === before) return false;
      this.state.version++;
      reindex(this.state);
      await persist(this.state);
      return true;
    });
  }

  insertReadings(readings: SensorReading[], seen: Array<{ id: string; count: number }> = []): Promise<number> {
    return run(this.state, async () => {
      const farms = new Set(this.state.data.farms.map((f) => f.id));
      const stored = await appendReadings(this.state, readings.filter((r) => farms.has(r.farm_id)));
      const now = new Date().toISOString();
      for (const { id, count } of seen) {
        const d = this.state.data.devices.find((x) => x.id === id);
        if (!d) continue;
        d.last_seen_at = now;
        d.paired_at ??= now;
        d.readings_count += count;
      }
      this.state.version++;
      scheduleFlush(this.state);
      return stored.length;
    });
  }

  async dailyAggregates(fromDay: string, farmIds: string[]): Promise<SensorDaily[]> {
    const out: SensorDaily[] = [];
    for (const farmId of farmIds) {
      for (const day of await listDays(this.state.key, farmId)) {
        if (day < fromDay) continue;
        const file = dayFile(this.state.key, farmId, day);
        if (isRecent(day)) {
          out.push(...aggregateDaily(await recentFileReadings(file)).filter((r) => r.day === day));
          continue;
        }
        const info = await fileSig(file);
        const sig = `${info?.sig ?? "none"}|${shared.memoryFiles.get(file)?.length ?? 0}`;
        let cached = shared.daily.get(file);
        if (!cached || cached.sig !== sig) {
          cached = { sig, rows: aggregateDaily(await fileReadings(file)).filter((r) => r.day === day) };
          shared.daily.set(file, cached);
        }
        out.push(...cached.rows);
      }
    }
    return out;
  }

  async readingsSince(afterId: number, farmIds: string[], limit = 500): Promise<StoredReading[]> {
    const farms = new Set(farmIds);
    return this.state.recent.filter((r) => r.id > afterId && farms.has(r.farm_id)).slice(0, limit);
  }

  async latestReadingId(farmIds: string[]): Promise<number> {
    const farms = new Set(farmIds);
    for (let i = this.state.recent.length - 1; i >= 0; i--) if (farms.has(this.state.recent[i].farm_id)) return this.state.recent[i].id;
    return 0;
  }

  async readingsBetween(farmId: string, fromMs: number, toMs: number): Promise<SensorReading[]> {
    const first = qatarDateString(fromMs);
    const last = qatarDateString(toMs - 1);
    const out: SensorReading[] = [];
    for (const day of await listDays(this.state.key, farmId)) {
      if (day < first || day > last) continue;
      for (const r of await dayReadings(dayFile(this.state.key, farmId, day), day)) {
        const t = Date.parse(r.timestamp);
        if (t >= fromMs && t < toMs) out.push(r);
      }
    }
    return out;
  }

  async bucketSeries(farmId: string, fromMs: number, toMs: number, bucketMs: number): Promise<BucketMap> {
    const first = qatarDateString(fromMs);
    const last = qatarDateString(toMs - 1);
    const map: BucketMap = new Map();
    const coarse = bucketMs >= MINUTE_MS && bucketMs % MINUTE_MS === 0;
    for (const day of await listDays(this.state.key, farmId)) {
      if (day < first || day > last) continue;
      const file = dayFile(this.state.key, farmId, day);
      if (coarse && !isRecent(day)) mergeBuckets(map, await minuteBuckets(file, day), bucketMs, QATAR_ORIGIN_MS, fromMs, toMs);
      else addReadings(map, await dayReadings(file, day), bucketMs, QATAR_ORIGIN_MS, fromMs, toMs);
    }
    return map;
  }

  async firstReadingAt(farmId: string): Promise<number | null> {
    for (const day of await listDays(this.state.key, farmId)) {
      const readings = await dayReadings(dayFile(this.state.key, farmId, day), day);
      let min = Infinity;
      for (const r of readings) min = Math.min(min, Date.parse(r.timestamp));
      if (Number.isFinite(min)) return min;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Devices (no signed-in user: matched by token or pairing code)
// ---------------------------------------------------------------------------

function compact(r: StoredReading): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (v !== null && v !== undefined) out[k] = v;
  return JSON.stringify(out);
}

function applyMeta(device: StoredDevice, meta: DeviceMeta): void {
  if (meta.firmware) device.firmware = meta.firmware.slice(0, 40);
  if (typeof meta.rssi === "number" && Number.isFinite(meta.rssi)) device.rssi = Math.round(meta.rssi);
  if (meta.local_ip) device.local_ip = meta.local_ip.slice(0, 45);
}

/** Append readings to their day files (or memory on a read-only disk). Call inside run(). */
async function appendReadings(state: OwnerState, readings: SensorReading[]): Promise<StoredReading[]> {
  const stored = readings.map((r) => ({ ...r, id: nextId() }));
  const byFile = new Map<string, StoredReading[]>();
  for (const r of stored) {
    const file = dayFile(state.key, r.farm_id, qatarDateString(r.timestamp));
    const list = byFile.get(file);
    if (list) list.push(r);
    else byFile.set(file, [r]);
  }
  for (const [file, list] of byFile) {
    if (!shared.memoryOnly) {
      try {
        await mkdir(path.dirname(file), { recursive: true });
        await appendFile(file, list.map(compact).join("\n") + "\n", "utf8");
        continue;
      } catch (error) {
        if (!isReadOnlyError(error)) throw new AccountStoreError(`Could not store readings: ${messageOf(error)}`);
        goMemoryOnly(error);
      }
    }
    const mem = shared.memoryFiles.get(file);
    if (mem) mem.push(...list);
    else shared.memoryFiles.set(file, [...list]);
  }
  state.recent.push(...stored);
  if (state.recent.length > RECENT_LIMIT) state.recent.splice(0, state.recent.length - RECENT_LIMIT);
  return stored;
}

export const localDeviceRegistry: DeviceRegistry = {
  async findByToken(tokenHash) {
    await ensureRegistry();
    const key = shared.tokenOwner.get(tokenHash);
    if (!key) return null;
    const state = ownerState(key);
    return run(state, () => {
      const d = state.data.devices.find((x) => x.token_hash === tokenHash);
      return d ? { ...d } : null;
    });
  },

  async claimPairingCode(code, token, meta) {
    await ensureRegistry();
    const key = shared.codeOwner.get(code);
    if (!key) return null;
    const state = ownerState(key);
    return run(state, async () => {
      const d = state.data.devices.find((x) => x.pairing_code === code);
      if (!d || !d.pairing_expires_at || Date.parse(d.pairing_expires_at) < Date.now()) return null;
      d.token_hash = token.hash;
      d.token_hint = token.hint;
      d.pairing_code = null;
      d.pairing_expires_at = null;
      d.paired_at = new Date().toISOString();
      applyMeta(d, meta);
      state.version++;
      reindex(state);
      await persist(state);
      return { ...d };
    });
  },

  async recordReadings(device, readings, meta) {
    const state = ownerState(fileKey(device.owner_id));
    return run(state, async () => {
      const d = state.data.devices.find((x) => x.id === device.id);
      if (!d) return 0;
      const stored = await appendReadings(state, readings);

      const firstContact = !d.paired_at || d.pairing_code !== null;
      d.last_seen_at = new Date().toISOString();
      d.readings_count += stored.length;
      d.paired_at ??= d.last_seen_at;
      d.pairing_code = null;
      d.pairing_expires_at = null;
      applyMeta(d, meta);
      state.version++;
      if (firstContact) {
        reindex(state);
        await persist(state);
      } else scheduleFlush(state);
      return stored.length;
    });
  },
};

/**
 * The app's data entry point.
 *
 *  - The shared demo account (and the public landing page) sees the built-in demo dataset.
 *  - Every other account sees only its own farms, ESP32 devices and readings — a new account
 *    starts empty and never sees demo data.
 */
import "server-only";
import { env } from "../env";
import { hashDeviceKey } from "../device-keys";
import { storeFor, deviceStores, type DataStore } from "../store";
import { DEFAULT_SETTINGS } from "../store/types";
import type { DashboardData, Device, Farm, FarmBundle, LiveReading, LiveUpdate, Sensor, SensorReading, UserSettings } from "../types";
import { aggregateDaily } from "./aggregate";
import { buildDashboardData, deriveFarmDay } from "./derive";
import { HISTORY_DAYS } from "./generate";
import { deviceReadings, toSensorReadings, type DevicePayload, type IngestReading } from "./ingest";
import { generateInsights } from "./insights";
import { decodeCursor, encodeCursor, liveSlotAt, simulateSlot } from "./live-sim";
import { getMockState, mockReadingsForDay } from "./mock-store";
import { bucketReadings, SERIES_RANGES, toSeriesResponse, type SeriesRangeKey, type SeriesResponse } from "./series";
import { dateRangeEnding, qatarDateString } from "./time";
import { getWeatherForFarms } from "./weather";

/** Who is asking: the signed-in user (see lib/auth/session.ts). */
export interface Viewer {
  id: string;
  provider: "supabase" | "local";
  demo: boolean;
}

const DEMO_TTL_MS = 60_000;
/** Accounts' dashboards are rebuilt at least this often (and right after new readings arrive). */
const USER_TTL_MS = 15_000;
/** An ESP32 posting faster than this gets 429 and the interval to use. */
const MIN_DEVICE_GAP_MS = 2000;

interface CacheEntry {
  key: string;
  at: number;
  promise: Promise<DashboardData>;
}

const globalCache = globalThis as unknown as {
  __yieldDemoCache?: CacheEntry;
  __yieldUserCache?: Map<string, CacheEntry>;
  __yieldDeviceGap?: Map<string, number>;
};

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 160 ? `${message.slice(0, 157)}…` : message;
}

/** The hour the insight job "ran" — insights are generated for the latest data. */
function insightTimestamp(now = new Date()): string {
  const t = new Date(now);
  t.setUTCMinutes(0, 0, 0);
  return t.toISOString();
}

/**
 * Farms without an AI insight get one from the rule engine. The demo's "job" runs on the hour; an
 * account's insight is computed from its latest readings now.
 */
function withRuleInsights(data: DashboardData, createdAt = insightTimestamp()): DashboardData {
  const generated = generateInsights(data, createdAt);
  for (const bundle of data.farms) {
    bundle.insight ??= generated.find((i) => i.farm_id === bundle.farm.id) ?? null;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Demo dataset
// ---------------------------------------------------------------------------

async function buildDemoDashboard(): Promise<DashboardData> {
  const state = getMockState();
  const weather = await getWeatherForFarms(state.farms);
  const data = buildDashboardData({
    farms: state.farms,
    daily: aggregateDaily(state.readings),
    weather,
    insights: [],
    source: "demo",
    sourceNote: null,
    dates: dateRangeEnding(state.today, HISTORY_DAYS),
    sensorsByFarm: state.sensorsByFarm,
  });
  return withRuleInsights(data);
}

/** The built-in demo dataset (demo account and the public landing page). Never reads accounts' data. */
export async function getDemoDashboard(): Promise<DashboardData> {
  const key = `demo:${getMockState().version}`;
  const cached = globalCache.__yieldDemoCache;
  if (cached && cached.key === key && Date.now() - cached.at < DEMO_TTL_MS) return cached.promise;
  const promise = buildDemoDashboard();
  globalCache.__yieldDemoCache = { key, at: Date.now(), promise };
  promise.catch(() => {
    if (globalCache.__yieldDemoCache?.promise === promise) globalCache.__yieldDemoCache = undefined;
  });
  return promise;
}

// ---------------------------------------------------------------------------
// Accounts' own data
// ---------------------------------------------------------------------------

function sensorsFromDevices(devices: Device[]): Record<string, Sensor[]> {
  const out: Record<string, Sensor[]> = {};
  for (const d of devices) (out[d.farm_id] ??= []).push({ id: d.sensor_id, lat: d.lat, lng: d.lng });
  return out;
}

async function buildUserDashboard(viewer: Viewer): Promise<DashboardData> {
  const store = storeFor(viewer);
  const today = qatarDateString(new Date());
  const dates = dateRangeEnding(today, HISTORY_DAYS);
  const [farms, devices] = await Promise.all([store.listFarms(viewer.id), store.listDevices(viewer.id)]);
  const farmIds = farms.map((f) => f.id);
  const [daily, insights, weather] = await Promise.all([
    store.dailyAggregates(farmIds, dates[0]),
    store.listInsights(farmIds),
    getWeatherForFarms(farms),
  ]);
  const data = buildDashboardData({
    farms,
    daily,
    weather,
    insights,
    source: store.kind,
    sourceNote: null,
    dates,
    sensorsByFarm: sensorsFromDevices(devices),
    devices,
  });
  return withRuleInsights(data, new Date().toISOString());
}

function emptyDashboard(source: DashboardData["source"], note: string): DashboardData {
  const today = qatarDateString(new Date());
  return {
    generatedAt: new Date().toISOString(),
    source,
    sourceNote: note,
    weather: { source: "unavailable", note: null },
    dates: dateRangeEnding(today, HISTORY_DAYS),
    farms: [],
    devices: [],
  };
}
/**
 * The viewer's farms × 60 days with FAO-56 derived values and the latest insights.
 * `allowStale` serves a cached copy even after new readings arrived (the live feed only needs the
 * farm list and re-derives today itself), instead of rebuilding 60 days on every poll.
 */
export async function getDashboardData(viewer: Viewer, { allowStale = false } = {}): Promise<DashboardData> {
  if (viewer.demo) return getDemoDashboard();
  const cache = (globalCache.__yieldUserCache ??= new Map());
  const cached = cache.get(viewer.id);
  if (cached && (allowStale || Date.now() - cached.at < USER_TTL_MS)) return cached.promise;
  const promise: Promise<DashboardData> = buildUserDashboard(viewer).catch((error) => {
    console.warn("[data] Could not load the account's farms:", shortError(error));
    if (cache.get(viewer.id)?.promise === promise) cache.delete(viewer.id);
    return emptyDashboard(storeFor(viewer).kind, `We couldn't load your farms (${shortError(error)}). Try again in a moment.`);
  });
  cache.set(viewer.id, { key: viewer.id, at: Date.now(), promise });
  return promise;
}

/** Mark an account's cached dashboard as out of date (new readings, farms or devices). */
export function invalidateViewer(ownerId: string): void {
  const entry = globalCache.__yieldUserCache?.get(ownerId);
  if (entry) entry.at = 0;
}

/** Forget an account's cached dashboard entirely (its farms or devices changed). */
export function forgetViewer(ownerId: string): void {
  globalCache.__yieldUserCache?.delete(ownerId);
}

export async function getFarmBundle(viewer: Viewer, farmId: string): Promise<{ data: DashboardData; bundle: FarmBundle } | null> {
  const data = await getDashboardData(viewer);
  const bundle = data.farms.find((b) => b.farm.id === farmId);
  return bundle ? { data, bundle } : null;
}

export async function getViewerSettings(viewer: Viewer): Promise<UserSettings> {
  if (viewer.demo) return DEFAULT_SETTINGS;
  try {
    return await storeFor(viewer).getSettings(viewer.id);
  } catch (error) {
    console.warn("[data] Could not read settings:", shortError(error));
    return DEFAULT_SETTINGS;
  }
}

// ---------------------------------------------------------------------------
// Readings explorer
// ---------------------------------------------------------------------------

export async function getSeries(viewer: Viewer, farmId: string, range: SeriesRangeKey, now = Date.now()): Promise<SeriesResponse | null> {
  const { ms, bucketS } = SERIES_RANGES[range];
  const toMs = now + 1000;
  const fromMs = toMs - ms;
  if (viewer.demo) {
    const state = getMockState();
    if (!state.farms.some((f) => f.id === farmId)) return null;
    const rows = bucketReadings(
      state.readings.filter((r) => r.farm_id === farmId),
      fromMs,
      toMs,
      bucketS,
    );
    return toSeriesResponse(farmId, range, bucketS, fromMs, toMs, rows);
  }
  const store = storeFor(viewer);
  const farms = await store.listFarms(viewer.id);
  if (!farms.some((f) => f.id === farmId)) return null;
  const rows = await store.series(farmId, new Date(fromMs).toISOString(), new Date(toMs).toISOString(), bucketS);
  return toSeriesResponse(farmId, range, bucketS, fromMs, toMs, rows);
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/** Demo account: one demo farm "reports" every 5 s (round-robin) so the demo never looks idle. */
async function getDemoLiveUpdate(cursorParam: string | null): Promise<LiveUpdate> {
  const data = await getDemoDashboard();
  const now = Date.now();
  const slot = liveSlotAt(now);
  const today = qatarDateString(now);
  const cursor = decodeCursor(cursorParam);
  const farms: Farm[] = data.farms.map((b) => b.farm);
  const sensors = Object.fromEntries(data.farms.map((b) => [b.farm.id, b.sensors]));
  const mock = getMockState();

  const simulate = env.liveSimulation !== "off";
  const slots = !simulate ? [] : cursor ? range(Math.max(cursor.slot + 1, slot - 1), slot) : [slot];
  const simulated: SensorReading[] = slots.flatMap((s) => simulateSlot(s, farms, sensors, mock.latest));

  const weather = await getWeatherForFarms(farms);
  const farmDays: LiveUpdate["farms"] = {};
  for (const farmId of new Set(simulated.map((r) => r.farm_id))) {
    const bundle = data.farms.find((b) => b.farm.id === farmId);
    if (!bundle) continue;
    const rows = aggregateDaily([
      ...mockReadingsForDay(mock, farmId, today),
      ...simulated.filter((r) => r.farm_id === farmId),
    ]).filter((row) => row.day === today);
    const day = deriveFarmDay(bundle.farm, today, rows, weather.byFarm[farmId]?.[today], bundle.kcAdjusted);
    if (day) farmDays[farmId] = day;
  }

  const readings: LiveReading[] = simulated
    .map((r) => ({ ...r, simulated: true }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return {
    serverTime: new Date(now).toISOString(),
    cursor: encodeCursor({ id: 0, slot: Math.max(slot, cursor?.slot ?? 0) }),
    feed: simulated.length > 0 ? "simulated" : "idle",
    devices: [],
    date: today,
    readings: readings.slice(0, 50),
    farms: farmDays,
  };
}

/** Accounts: the readings their ESP32s sent since the last poll, and today re-derived for those farms. */
async function getUserLiveUpdate(viewer: Viewer, cursorParam: string | null): Promise<LiveUpdate> {
  const store = storeFor(viewer);
  const data = await getDashboardData(viewer, { allowStale: true });
  const now = Date.now();
  const today = qatarDateString(now);
  const farmIds = data.farms.map((b) => b.farm.id);
  const cursor = decodeCursor(cursorParam);

  const [maxId, devices] = await Promise.all([store.maxReadingId(farmIds), store.listDevices(viewer.id)]);
  // First poll starts from "now"; a cursor beyond the newest id means the store was reset.
  const from = cursor && cursor.id <= maxId ? cursor.id : maxId;
  const fresh = cursor ? await store.readingsSince(farmIds, from, 500) : [];
  const nextId = fresh.reduce((m, r) => Math.max(m, r.id), from);

  const farmDays: LiveUpdate["farms"] = {};
  const affected = new Set(fresh.map((r) => r.farm_id));
  if (affected.size > 0) {
    const weather = await getWeatherForFarms(data.farms.map((b) => b.farm));
    for (const farmId of affected) {
      const bundle = data.farms.find((b) => b.farm.id === farmId);
      if (!bundle) continue;
      const rows = aggregateDaily(await store.readingsForDay(farmId, today)).filter((row) => row.day === today);
      const day = deriveFarmDay(bundle.farm, today, rows, weather.byFarm[farmId]?.[today], bundle.kcAdjusted);
      if (day) farmDays[farmId] = day;
    }
  }

  const readings: LiveReading[] = fresh
    .map(({ id: _id, ...r }) => ({ ...r, simulated: false }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const recentlySeen = devices.some((d) => d.last_seen_at && now - Date.parse(d.last_seen_at) < 5 * 60_000);
  return {
    serverTime: new Date(now).toISOString(),
    cursor: encodeCursor({ id: nextId, slot: 0 }),
    feed: fresh.length > 0 || recentlySeen ? "probe" : "idle",
    devices,
    date: today,
    readings: readings.slice(0, 50),
    farms: farmDays,
  };
}

export function getLiveUpdate(viewer: Viewer, cursorParam: string | null): Promise<LiveUpdate> {
  return viewer.demo ? getDemoLiveUpdate(cursorParam) : getUserLiveUpdate(viewer, cursorParam);
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export class IngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string[] = [],
    readonly retryAfterS?: number,
  ) {
    super(message);
  }
}

async function findDevice(key: string): Promise<{ device: Device; store: DataStore } | null> {
  const hash = hashDeviceKey(key);
  let lastError: unknown = null;
  for (const store of deviceStores()) {
    try {
      const device = await store.findDeviceByTokenHash(hash);
      if (device) return { device, store };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw new IngestError(`Device lookup failed: ${shortError(lastError)}`, 503);
  return null;
}

export interface DeviceIngestResult {
  stored: number;
  skipped: string[];
  interval_s: number;
  device: { id: string; name: string; farm_id: string; sensor_id: string };
}

/** POST /api/readings with a device key: store the ESP32's readings and note that it checked in. */
export async function ingestFromDevice(key: string, payload: DevicePayload, ip: string | null): Promise<DeviceIngestResult> {
  const found = await findDevice(key);
  if (!found) throw new IngestError("Unknown device key. Copy it again from Farms & devices, or rotate it.", 401);
  const { device, store } = found;

  const settings = await store.getSettings(device.owner_id).catch(() => DEFAULT_SETTINGS);
  const now = Date.now();
  const gaps = (globalCache.__yieldDeviceGap ??= new Map());
  const last = gaps.get(device.id);
  if (last && now - last < MIN_DEVICE_GAP_MS) {
    throw new IngestError("Too many requests from this device.", 429, [], settings.reading_interval_s);
  }
  gaps.set(device.id, now);

  const { readings, skipped, latest } = deviceReadings(payload, device, new Date(now));
  let stored = 0;
  try {
    if (readings.length > 0) stored = await store.insertReadings(readings);
    await store.recordDeviceContact(device.id, {
      at: new Date(now).toISOString(),
      ip,
      rssi: payload.rssi ?? null,
      firmware: payload.fw ?? payload.firmware ?? null,
      error: payload.error ?? null,
      reading: latest,
    });
  } catch (error) {
    throw new IngestError(`Could not store the readings: ${shortError(error)}`, 502);
  }
  invalidateViewer(device.owner_id);
  return {
    stored,
    skipped,
    interval_s: settings.reading_interval_s,
    device: { id: device.id, name: device.name, farm_id: device.farm_id, sensor_id: device.sensor_id },
  };
}

/** POST /api/readings with INGEST_API_KEY: bulk import into any farm, by farm id and probe id. */
export async function ingestBulk(items: IngestReading[]): Promise<{ inserted: number; target: DataStore["kind"] }> {
  const farmIds = Array.from(new Set(items.map((i) => i.farm_id)));
  const stores = deviceStores();
  // Every farm of a batch must live in the same store.
  for (const store of stores) {
    let farms: Farm[];
    try {
      farms = (await Promise.all(farmIds.map((id) => store.findFarmForIngest(id)))).filter((f): f is Farm => f !== null);
    } catch (error) {
      throw new IngestError(`Farm lookup failed: ${shortError(error)}`, 503);
    }
    if (farms.length === 0) continue;
    const { readings, errors } = toSensorReadings(items, farms, {});
    if (errors.length > 0) throw new IngestError("Some readings were rejected", 422, errors);
    try {
      const inserted = await store.insertReadings(readings);
      for (const farm of farms) if (farm.owner_id) invalidateViewer(farm.owner_id);
      return { inserted, target: store.kind };
    } catch (error) {
      throw new IngestError(`Could not store the readings: ${shortError(error)}`, 502);
    }
  }
  throw new IngestError("Some readings were rejected", 422, farmIds.map((id) => `unknown farm_id "${id}"`));
}

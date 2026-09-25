/**
 * The app's single data entry point, scoped to who is asking (lib/farms/scope.ts):
 *  - the demo account sees the demo farms — Supabase when configured, falling back to the
 *    built-in demo dataset whenever Supabase is off, empty or unreachable;
 *  - every other account sees only the farms it created (lib/farms/store.ts), starting empty.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";
import { DEMO_SCOPE, scopeKey, type DataScope } from "../farms/scope";
import { farmStore, type FarmStore } from "../farms/store";
import { createSupabaseAdminClient, createSupabaseDataClient, withTimeout } from "../supabase/server";
import type { DashboardData, Farm, FarmBundle, LiveReading, LiveUpdate, Sensor, SensorReading } from "../types";
import { aggregateDaily } from "./aggregate";
import { buildDashboardData, deriveFarmDay } from "./derive";
import { HISTORY_DAYS } from "./generate";
import { toSensorReadings, type IngestReading } from "./ingest";
import { generateInsights } from "./insights";
import {
  decodeCursor,
  encodeCursor,
  latestBySensor,
  liveSlotAt,
  simulateSlot,
} from "./live-sim";
import {
  getMockState,
  mockIngest,
  mockIngestedForFarms,
  mockIngestedSince,
  mockMaxIngestedId,
  mockReadings,
  mockReadingsForDay,
} from "./mock-store";
import {
  fetchDaily,
  fetchFarmRecent,
  fetchFarms,
  fetchInsights,
  fetchLatestReading,
  fetchReadingsSince,
  insertReadings,
} from "./supabase-source";
import { dateRangeEnding, qatarDateString } from "./time";
import { getWeatherForFarms, type WeatherResult } from "./weather";

const DASHBOARD_TTL_MS = 60_000;
const SUPABASE_BUDGET_MS = 12_000;
/** Real probe data counts as "flowing" if a reading arrived within this window. */
const REAL_FEED_WINDOW_MS = 2 * 60_000;
const MAX_CACHED_SCOPES = 200;

interface CacheEntry {
  key: string;
  at: number;
  promise: Promise<DashboardData>;
}
const globalCache = globalThis as unknown as { __yieldDashboardCache?: Map<string, CacheEntry> };

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 140 ? `${message.slice(0, 137)}…` : message;
}

/** The hour the insight job "ran" — insights are generated for the latest data. */
function insightTimestamp(now = new Date()): string {
  const t = new Date(now);
  t.setUTCMinutes(0, 0, 0);
  return t.toISOString();
}

function attachGeneratedInsights(data: DashboardData, onlyMissing: boolean): DashboardData {
  const insights = generateInsights(data, insightTimestamp());
  for (const bundle of data.farms) {
    if (onlyMissing && bundle.insight) continue;
    bundle.insight = insights.find((i) => i.farm_id === bundle.farm.id) ?? null;
  }
  return data;
}

async function buildMockDashboard(sourceNote: string | null): Promise<DashboardData> {
  const state = getMockState();
  const daily = aggregateDaily(mockReadings(state));
  const weather = await getWeatherForFarms(state.farms);
  const data = buildDashboardData({
    farms: state.farms,
    daily,
    weather,
    insights: [],
    source: "mock",
    sourceNote,
    dates: dateRangeEnding(state.today, HISTORY_DAYS),
    sensorsByFarm: state.sensorsByFarm,
  });
  return attachGeneratedInsights(data, false);
}

async function buildSupabaseDashboard(client: SupabaseClient): Promise<DashboardData> {
  const today = qatarDateString(new Date());
  const dates = dateRangeEnding(today, HISTORY_DAYS);
  const farms = await fetchFarms(client);
  if (farms.length === 0) throw new Error("No farms in Supabase yet — run `npm run seed`");
  const ids = farms.map((f) => f.id);
  const [daily, insights, weather] = await Promise.all([
    fetchDaily(client, dates[0], ids),
    fetchInsights(client, ids),
    getWeatherForFarms(farms),
  ]);
  return buildDashboardData({ farms, daily, weather, insights, source: "supabase", sourceNote: null, dates });
}

async function loadDemoDashboard(): Promise<DashboardData> {
  if (env.useMock) return buildMockDashboard(null);
  try {
    const client = await createSupabaseDataClient();
    if (!client) throw new Error("Supabase client unavailable");
    return await withTimeout(buildSupabaseDashboard(client), SUPABASE_BUDGET_MS, "Supabase");
  } catch (error) {
    console.warn("[data] Falling back to demo data:", shortError(error));
    return buildMockDashboard(`Supabase unavailable (${shortError(error)}). Showing the built-in demo data.`);
  }
}

const NO_WEATHER: WeatherResult = { byFarm: {}, source: "open-meteo", note: null };

/** A user's own farms with their registered sensors, readings, weather and insights. */
async function loadOwnerDashboard(ownerId: string): Promise<DashboardData> {
  const store = farmStore();
  const today = qatarDateString(new Date());
  const dates = dateRangeEnding(today, HISTORY_DAYS);
  const source = store.kind === "supabase" ? "supabase" : "local";
  try {
    const farms = await store.listFarms(ownerId);
    const ids = farms.map((f) => f.id);
    const registered = await store.listSensors(ids);

    let daily: ReturnType<typeof aggregateDaily> = [];
    let insights: Awaited<ReturnType<typeof fetchInsights>> = [];
    let readingsNote: string | null = null;
    if (ids.length > 0) {
      if (store.kind === "supabase") {
        const admin = createSupabaseAdminClient();
        if (admin) {
          try {
            [daily, insights] = await withTimeout(
              Promise.all([fetchDaily(admin, dates[0], ids), fetchInsights(admin, ids)]),
              SUPABASE_BUDGET_MS,
              "Supabase readings",
            );
          } catch (error) {
            readingsNote = `Probe readings could not be loaded (${shortError(error)}).`;
          }
        }
      } else {
        daily = aggregateDaily(mockIngestedForFarms(new Set(ids)));
      }
    }

    const sensorsByFarm: Record<string, Sensor[]> = Object.fromEntries(ids.map((id) => [id, [] as Sensor[]]));
    for (const s of registered) sensorsByFarm[s.farm_id]?.push({ id: s.id, lat: s.lat, lng: s.lng });
    // Probes that post readings without being registered still show up, at their reported position.
    for (const row of daily) {
      const list = sensorsByFarm[row.farm_id];
      if (list && !list.some((s) => s.id === row.sensor_id)) list.push({ id: row.sensor_id, lat: row.lat, lng: row.lng });
    }

    const weather = farms.length ? await getWeatherForFarms(farms) : NO_WEATHER;
    const data = buildDashboardData({
      farms: farms.map(({ owner_id: _o, created_at: _c, ...farm }) => farm),
      daily,
      weather,
      insights,
      source,
      sourceNote: readingsNote,
      dates,
      sensorsByFarm,
    });
    return attachGeneratedInsights(data, true);
  } catch (error) {
    console.error("[data] Could not load the user's farms:", shortError(error));
    return {
      generatedAt: new Date().toISOString(),
      source,
      sourceNote: `Your farms could not be loaded (${shortError(error)}).`,
      weather: { source: NO_WEATHER.source, note: null },
      dates,
      farms: [],
    };
  }
}

function cacheKeyFor(scope: DataScope, store: FarmStore): string {
  if (scope.kind === "demo") return env.useMock ? `demo:mock:${getMockState().version}` : "demo:supabase";
  return `${scopeKey(scope)}:${store.kind}:${store.version()}:${getMockState().version}`;
}

function cache(): Map<string, CacheEntry> {
  globalCache.__yieldDashboardCache ??= new Map();
  return globalCache.__yieldDashboardCache;
}

/** All farms in the scope × 60 days with FAO-56 derived values and the latest insights. Cached for a minute. */
export async function getDashboardData(scope: DataScope = DEMO_SCOPE): Promise<DashboardData> {
  const map = cache();
  const slot = scopeKey(scope);
  const key = cacheKeyFor(scope, farmStore());
  const cached = map.get(slot);
  if (cached && cached.key === key && Date.now() - cached.at < DASHBOARD_TTL_MS) return cached.promise;
  const promise = scope.kind === "demo" ? loadDemoDashboard() : loadOwnerDashboard(scope.ownerId);
  map.delete(slot);
  map.set(slot, { key, at: Date.now(), promise });
  if (map.size > MAX_CACHED_SCOPES) map.delete(map.keys().next().value!);
  promise.catch(() => {
    if (map.get(slot)?.promise === promise) map.delete(slot);
  });
  return promise;
}

/** Drop cached dashboards: one scope's, or all of them. */
export function invalidateDashboardCache(scope?: DataScope): void {
  if (scope) cache().delete(scopeKey(scope));
  else cache().clear();
}

const SHOWCASE_TTL_MS = 10 * 60_000;
const showcaseCache = globalThis as unknown as { __yieldShowcaseCache?: CacheEntry };

/**
 * The built-in demo dataset for the public landing page. Never reads Supabase, so real farm
 * data is only ever shown to signed-in users.
 */
export async function getShowcaseDashboard(): Promise<DashboardData> {
  if (env.useMock) return getDashboardData(DEMO_SCOPE);
  const key = `showcase:${getMockState().version}`;
  const cached = showcaseCache.__yieldShowcaseCache;
  if (cached && cached.key === key && Date.now() - cached.at < SHOWCASE_TTL_MS) return cached.promise;
  const promise = buildMockDashboard(null);
  showcaseCache.__yieldShowcaseCache = { key, at: Date.now(), promise };
  promise.catch(() => {
    if (showcaseCache.__yieldShowcaseCache?.promise === promise) showcaseCache.__yieldShowcaseCache = undefined;
  });
  return promise;
}

export async function getFarmBundle(
  scope: DataScope,
  farmId: string,
): Promise<{ data: DashboardData; bundle: FarmBundle } | null> {
  const data = await getDashboardData(scope);
  const bundle = data.farms.find((b) => b.farm.id === farmId);
  return bundle ? { data, bundle } : null;
}

function sensorsOf(data: DashboardData): Record<string, Sensor[]> {
  return Object.fromEntries(data.farms.map((b) => [b.farm.id, b.sensors]));
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------

/**
 * New readings since `cursor` and the re-derived day for every farm that received some.
 * Real probe data is used when it is arriving; for the demo farms (LIVE_SIMULATION=auto) the demo
 * feed reports one farm every 5 seconds so the dashboard never looks dead. Users' own farms only
 * ever show real readings.
 */
export async function getLiveUpdate(scope: DataScope, cursorParam: string | null): Promise<LiveUpdate> {
  const data = await getDashboardData(scope);
  const now = Date.now();
  const slot = liveSlotAt(now);
  const today = qatarDateString(now);
  const cursor = decodeCursor(cursorParam);
  const farms: Farm[] = data.farms.map((b) => b.farm);
  const farmIds = farms.map((f) => f.id);
  const inScope = new Set(farmIds);
  const sensors = sensorsOf(data);
  const readsMock = data.source === "mock" || data.source === "local";

  let client: SupabaseClient | null = null;
  if (data.source === "supabase" && farms.length > 0) {
    try {
      client = scope.kind === "demo" ? await createSupabaseDataClient() : createSupabaseAdminClient();
    } catch {
      client = null;
    }
  }

  // 1. Real readings.
  let real: Array<SensorReading & { id: number }> = [];
  let maxId = cursor?.id ?? 0;
  let realFlowing = false;
  try {
    if (client) {
      if (cursor) {
        real = await withTimeout(fetchReadingsSince(client, cursor.id, farmIds), 5000, "live readings");
      }
      const latest = await withTimeout(fetchLatestReading(client, farmIds), 5000, "latest reading");
      if (latest) {
        maxId = Math.max(maxId, latest.id);
        realFlowing = now - Date.parse(latest.timestamp) < REAL_FEED_WINDOW_MS;
      }
    } else if (readsMock) {
      real = cursor ? mockIngestedSince(cursor.id, inScope) : [];
      maxId = Math.max(maxId, mockMaxIngestedId());
      const newest = getMockState().ingested.filter((r) => inScope.has(r.farm_id)).at(-1);
      realFlowing = Boolean(newest && now - Date.parse(newest.timestamp) < REAL_FEED_WINDOW_MS);
    }
  } catch (error) {
    console.warn("[live] Could not read probe data:", shortError(error));
  }
  real = real.filter((r) => inScope.has(r.farm_id));
  for (const r of real) maxId = Math.max(maxId, r.id);

  // 2. Demo feed (demo farms only).
  const simulate =
    scope.kind === "demo" &&
    (env.liveSimulation === "on" || (env.liveSimulation === "auto" && !realFlowing && real.length === 0));
  const slots = !simulate ? [] : cursor ? range(Math.max(cursor.slot + 1, slot - 1), slot) : [slot];

  // Latest reading per probe, as the base for simulated values.
  const mock = readsMock ? getMockState() : null;
  const simulated: SensorReading[] = [];
  const recentByFarm = new Map<string, { today: SensorReading[]; latest: Map<string, SensorReading> }>();
  for (const s of slots) {
    const farm = farms[((s % farms.length) + farms.length) % farms.length];
    if (!farm) continue;
    let recent = recentByFarm.get(farm.id);
    if (!recent) {
      recent = await farmRecent(farm.id, today, client, mock);
      recentByFarm.set(farm.id, recent);
    }
    simulated.push(...simulateSlot(s, farms, sensors, recent.latest));
  }

  // 3. Re-derive today for every farm that received readings.
  const affected = new Set<string>([...real.map((r) => r.farm_id), ...simulated.map((r) => r.farm_id)]);
  const weather = affected.size > 0 ? await getWeatherForFarms(farms) : NO_WEATHER;
  const farmDays: LiveUpdate["farms"] = {};
  for (const farmId of affected) {
    const bundle = data.farms.find((b) => b.farm.id === farmId);
    if (!bundle) continue;
    let recent = recentByFarm.get(farmId);
    if (!recent) {
      recent = await farmRecent(farmId, today, client, mock);
      recentByFarm.set(farmId, recent);
    }
    const rows = aggregateDaily([...recent.today, ...simulated.filter((r) => r.farm_id === farmId)]).filter(
      (row) => row.day === today,
    );
    const day = deriveFarmDay(bundle.farm, today, rows, weather.byFarm[farmId]?.[today], bundle.kcAdjusted);
    if (day) farmDays[farmId] = day;
  }

  const readings: LiveReading[] = [
    ...real.map(({ id: _id, ...r }) => ({ ...r, simulated: false })),
    ...simulated.map((r) => ({ ...r, simulated: true })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    serverTime: new Date(now).toISOString(),
    cursor: encodeCursor({ id: maxId, slot: Math.max(slot, cursor?.slot ?? 0) }),
    feed: real.length > 0 || realFlowing ? "probe" : simulated.length > 0 ? "simulated" : "idle",
    date: today,
    readings: readings.slice(0, 50),
    farms: farmDays,
  };
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

async function farmRecent(
  farmId: string,
  today: string,
  client: SupabaseClient | null,
  mock: ReturnType<typeof getMockState> | null,
): Promise<{ today: SensorReading[]; latest: Map<string, SensorReading> }> {
  if (mock) {
    const rows = mockReadingsForDay(mock, farmId, today);
    const latest = new Map<string, SensorReading>();
    for (const [key, reading] of mock.latest) if (key.startsWith(`${farmId}|`)) latest.set(key, reading);
    return { today: rows, latest };
  }
  if (client) {
    try {
      const { today: rows, recent } = await withTimeout(fetchFarmRecent(client, farmId, today), 5000, "farm readings");
      return { today: rows, latest: latestBySensor(recent) };
    } catch (error) {
      console.warn("[live] Could not read farm readings:", shortError(error));
    }
  }
  return { today: [], latest: new Map() };
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export class IngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

/**
 * Store probe readings for the demo farms or any user's farm. Readings for farms in the local
 * farm store go to the in-memory store; everything else to Supabase when it is configured.
 */
export async function ingestReadings(items: IngestReading[]): Promise<{ inserted: number; target: "supabase" | "mock" }> {
  const demo = await getDashboardData(DEMO_SCOPE);
  const farms: Farm[] = demo.farms.map((b) => b.farm);
  const sensorsByFarm = sensorsOf(demo);
  const known = new Set(farms.map((f) => f.id));
  const store = farmStore();
  const userFarmIds = new Set<string>();
  for (const id of new Set(items.map((i) => i.farm_id))) {
    if (known.has(id)) continue;
    const farm = await store.findFarm(id).catch(() => null);
    if (!farm) continue;
    const { owner_id: _o, created_at: _c, ...plain } = farm;
    farms.push(plain);
    known.add(id);
    userFarmIds.add(id);
    const registered = await store.listSensors([id]);
    sensorsByFarm[id] = registered.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng }));
  }

  const { readings, errors } = toSensorReadings(items, farms, sensorsByFarm);
  if (errors.length > 0) throw new IngestError("Some readings were rejected", 422, errors);

  // Demo farms live in Supabase unless USE_MOCK is on; users' farms live wherever the farm store is.
  const inSupabase = (r: SensorReading) => !env.useMock && (!userFarmIds.has(r.farm_id) || store.kind === "supabase");
  const remote = readings.filter(inSupabase);
  const local = readings.filter((r) => !inSupabase(r));
  let inserted = 0;
  if (remote.length > 0) {
    const admin = createSupabaseAdminClient();
    if (!admin) throw new IngestError("Ingest into Supabase needs SUPABASE_SERVICE_ROLE_KEY on the server", 503);
    try {
      inserted += await withTimeout(insertReadings(admin, remote), 10_000, "insert readings");
    } catch (error) {
      throw new IngestError(`Supabase insert failed: ${shortError(error)}`, 502);
    }
  }
  if (local.length > 0) inserted += mockIngest(local).length;
  invalidateDashboardCache();
  return { inserted, target: remote.length > 0 ? "supabase" : "mock" };
}

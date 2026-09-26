/**
 * The app's single data entry point. Reads Supabase when configured and falls back to the
 * built-in demo dataset whenever Supabase is off, empty or unreachable — the dashboard always
 * renders something real-looking, and says which source it is showing.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccountDashboard, getAccountLiveUpdate } from "../account/dashboard";
import { prepareTesterAccount } from "../account/tester";
import { isDemoUser } from "../account/store";
import { DEFAULT_INTERVAL_S } from "../account/types";
import type { AppUser } from "../auth/session";
import { env } from "../env";
import { createSupabaseAdminClient, createSupabaseDataClient, withTimeout } from "../supabase/server";
import type { DashboardData, Farm, FarmBundle, LiveReading, LiveUpdate, Sensor, SensorReading } from "../types";
import { aggregateDaily } from "./aggregate";
import { buildDashboardData, deriveFarmDay } from "./derive";
import { getNext12hForecasts } from "./forecast";
import { HISTORY_DAYS } from "./generate";
import { toSensorReadings, type IngestReading } from "./ingest";
import { generateInsights, replayRiskHistory, withReportSections } from "./insights";
import {
  decodeCursor,
  encodeCursor,
  latestBySensor,
  liveSlotAt,
  simulateSlot,
} from "./live-sim";
import { getMockState, mockIngest, mockIngestedSince, mockMaxIngestedId, mockReadings, mockReadingsForDay } from "./mock-store";
import {
  fetchDaily,
  fetchDemoFarms,
  fetchFarmRecent,
  fetchInsights,
  fetchLatestReading,
  fetchReadingsSince,
  insertReadings,
} from "./supabase-source";
import { dateRangeEnding, qatarDateString } from "./time";
import { getWeatherForFarms } from "./weather";

const DASHBOARD_TTL_MS = 60_000;
const RISK_HISTORY_DAYS = 30;
const SUPABASE_BUDGET_MS = 12_000;
/** Real probe data counts as "flowing" if a reading arrived within this window. */
const REAL_FEED_WINDOW_MS = 2 * 60_000;

interface CacheEntry {
  key: string;
  at: number;
  promise: Promise<DashboardData>;
}
const globalCache = globalThis as unknown as { __yieldDashboardCache?: CacheEntry };

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

/** Attach the next-12-hour forecast (downloaded every 12 hours) to every farm. */
async function withForecasts(data: DashboardData): Promise<DashboardData> {
  const forecasts = await getNext12hForecasts(data.farms.map((b) => b.farm));
  for (const bundle of data.farms) bundle.next12h = forecasts[bundle.farm.id] ?? null;
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
  const insights = generateInsights(data, insightTimestamp());
  for (const bundle of data.farms) {
    bundle.insight = insights.find((i) => i.farm_id === bundle.farm.id) ?? null;
    // Demo mode has no stored insight history: replay the insight rules for each of the last 30 days.
    bundle.riskHistory = replayRiskHistory(bundle, data.dates, RISK_HISTORY_DAYS);
  }
  return withForecasts(data);
}

async function buildSupabaseDashboard(client: SupabaseClient): Promise<DashboardData> {
  const today = qatarDateString(new Date());
  const dates = dateRangeEnding(today, HISTORY_DAYS);
  const farms = await fetchDemoFarms(client);
  if (farms.length === 0) throw new Error("No demo farms in Supabase yet — run `npm run seed`");
  const ids = farms.map((f) => f.id);
  const [daily, insights] = await Promise.all([fetchDaily(client, dates[0], ids), fetchInsights(client, ids)]);
  const weather = await getWeatherForFarms(farms);
  const data = buildDashboardData({ farms, daily, weather, insights, source: "supabase", sourceNote: null, dates });
  for (const bundle of data.farms) bundle.insight = withReportSections(bundle);
  return withForecasts(data);
}

async function loadDashboard(): Promise<DashboardData> {
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

function cacheKey(): string {
  return env.useMock ? `mock:${getMockState().version}` : "supabase";
}

/**
 * The shared demo dataset: all demo farms × 60 days with FAO-56 derived values and the latest
 * insights. Cached for a minute. Only the demo account (and the public landing page) see it; pages
 * use `getDashboardFor(user)`.
 */
export async function getDemoDashboard(): Promise<DashboardData> {
  const key = cacheKey();
  const cached = globalCache.__yieldDashboardCache;
  if (cached && cached.key === key && Date.now() - cached.at < DASHBOARD_TTL_MS) return cached.promise;
  const promise = loadDashboard();
  globalCache.__yieldDashboardCache = { key, at: Date.now(), promise };
  promise.catch(() => {
    if (globalCache.__yieldDashboardCache?.promise === promise) globalCache.__yieldDashboardCache = undefined;
  });
  return promise;
}

export function invalidateDashboardCache(): void {
  globalCache.__yieldDashboardCache = undefined;
}

const SHOWCASE_TTL_MS = 10 * 60_000;
const showcaseCache = globalThis as unknown as { __yieldShowcaseCache?: CacheEntry };

/**
 * The built-in demo dataset for the public landing page. Never reads Supabase, so real farm
 * data is only ever shown to signed-in users.
 */
export async function getShowcaseDashboard(): Promise<DashboardData> {
  if (env.useMock) return getDemoDashboard();
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

/**
 * What this signed-in user may see: the demo dataset for the shared demo account, and only the
 * account's own farms (none for a new account) for everyone else.
 */
export async function getDashboardFor(user: AppUser): Promise<DashboardData> {
  if (isDemoUser(user)) return getDemoDashboard();
  await prepareTesterAccount(user);
  return getAccountDashboard(user);
}

export async function getFarmBundleFor(user: AppUser, farmId: string): Promise<{ data: DashboardData; bundle: FarmBundle } | null> {
  const data = await getDashboardFor(user);
  const bundle = data.farms.find((b) => b.farm.id === farmId);
  return bundle ? { data, bundle } : null;
}

function sensorsOf(data: DashboardData): Record<string, Sensor[]> {
  return Object.fromEntries(data.farms.map((b) => [b.farm.id, b.sensors]));
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------

/** Live mode for this user: their own devices' readings, or the demo feed for the demo account. */
export async function getLiveUpdateFor(user: AppUser, cursorParam: string | null): Promise<LiveUpdate> {
  if (isDemoUser(user)) return getLiveUpdate(cursorParam);
  await prepareTesterAccount(user);
  return getAccountLiveUpdate(user, cursorParam);
}

/**
 * Demo account: new readings since `cursor` and the re-derived day for every farm that received some.
 * Real probe data (sent to the demo farms with INGEST_API_KEY) is used when it is arriving; otherwise
 * (LIVE_SIMULATION=auto) the demo feed reports one farm every few seconds so the demo never looks dead.
 */
export async function getLiveUpdate(cursorParam: string | null): Promise<LiveUpdate> {
  const data = await getDemoDashboard();
  const now = Date.now();
  const slot = liveSlotAt(now);
  const today = qatarDateString(now);
  const cursor = decodeCursor(cursorParam);
  const farms: Farm[] = data.farms.map((b) => b.farm);
  const sensors = sensorsOf(data);

  let client: SupabaseClient | null = null;
  if (data.source === "supabase") {
    try {
      client = await createSupabaseDataClient();
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
        real = await withTimeout(fetchReadingsSince(client, cursor.id, farms.map((f) => f.id)), 5000, "live readings");
      }
      const latest = await withTimeout(fetchLatestReading(client, farms.map((f) => f.id)), 5000, "latest reading");
      if (latest) {
        maxId = Math.max(maxId, latest.id);
        realFlowing = now - Date.parse(latest.timestamp) < REAL_FEED_WINDOW_MS;
      }
    } else if (data.source === "mock") {
      real = cursor ? mockIngestedSince(cursor.id) : [];
      maxId = Math.max(maxId, mockMaxIngestedId());
      const newest = getMockState().ingested.at(-1);
      realFlowing = Boolean(newest && now - Date.parse(newest.timestamp) < REAL_FEED_WINDOW_MS);
    }
  } catch (error) {
    console.warn("[live] Could not read probe data:", shortError(error));
  }
  for (const r of real) maxId = Math.max(maxId, r.id);

  // 2. Demo feed.
  const simulate =
    env.liveSimulation === "on" || (env.liveSimulation === "auto" && !realFlowing && real.length === 0);
  const slots = !simulate ? [] : cursor ? range(Math.max(cursor.slot + 1, slot - 1), slot) : [slot];

  // Latest reading per probe, as the base for simulated values.
  const mock = data.source === "mock" ? getMockState() : null;
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
  const weather = await getWeatherForFarms(farms);
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
    interval_s: DEFAULT_INTERVAL_S,
    devices: null,
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

/** INGEST_API_KEY ingest (the hardware team's shared key): readings for the demo farms only. */
export async function ingestReadings(items: IngestReading[]): Promise<{ inserted: number; target: "supabase" | "mock" }> {
  const data = await getDemoDashboard();
  const { readings, errors } = toSensorReadings(items, data.farms.map((b) => b.farm), sensorsOf(data));
  if (errors.length > 0) throw new IngestError("Some readings were rejected", 422, errors);

  if (!env.useMock) {
    const admin = createSupabaseAdminClient();
    if (!admin) throw new IngestError("Ingest into Supabase needs SUPABASE_SERVICE_ROLE_KEY on the server", 503);
    try {
      const inserted = await withTimeout(insertReadings(admin, readings), 10_000, "insert readings");
      invalidateDashboardCache();
      return { inserted, target: "supabase" };
    } catch (error) {
      throw new IngestError(`Supabase insert failed: ${shortError(error)}`, 502);
    }
  }
  const stored = mockIngest(readings);
  invalidateDashboardCache();
  return { inserted: stored.length, target: "mock" };
}

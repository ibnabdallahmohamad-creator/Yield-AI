/**
 * A real account's dashboard: its own farms, the daily aggregates of what its ESP32s sent, weather
 * and rule-based insights. Nothing here ever reads the demo dataset or simulates a reading.
 */
import "server-only";
import type { AppUser } from "../auth/session";
import { lastDataIndex } from "../ai/analysis";
import { buildDashboardData, deriveFarmDay } from "../data/derive";
import { getNext12hForecasts } from "../data/forecast";
import { HISTORY_DAYS } from "../data/generate";
import { generateInsight, replayRiskHistory } from "../data/insights";
import { decodeCursor, encodeCursor } from "../data/live-sim";
import { dateRangeEnding, qatarDateString } from "../data/time";
import { getWeatherForFarms } from "../data/weather";
import type { DashboardData, Farm, LiveReading, LiveUpdate, Sensor, SensorDaily } from "../types";
import { getAccountStore, type AccountStore } from "./store";
import { DEFAULT_INTERVAL_S, publicDevice, type StoredDevice } from "./types";

const TTL_MS = 60_000;
const MAX_CACHED = 200;

interface CacheEntry {
  key: string;
  at: number;
  promise: Promise<DashboardData>;
}
const g = globalThis as typeof globalThis & { __yieldAccountDashboards?: Map<string, CacheEntry> };
const cache = (g.__yieldAccountDashboards ??= new Map());

const shortError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 160 ? `${message.slice(0, 157)}…` : message;
};

/** Probes per farm: every device (placed where the user put it, else the farm centre) plus probes seen only in old readings. */
export function sensorsFor(farms: Farm[], devices: StoredDevice[], daily: SensorDaily[]): Record<string, Sensor[]> {
  const out: Record<string, Sensor[]> = {};
  for (const farm of farms) {
    const list: Sensor[] = devices
      .filter((d) => d.farm_id === farm.id)
      .map((d) => ({ id: d.sensor_id, lat: d.lat ?? farm.lat, lng: d.lng ?? farm.lng }));
    const known = new Set(list.map((s) => s.id));
    const latest = daily
      .filter((r) => r.farm_id === farm.id && !known.has(r.sensor_id))
      .sort((a, b) => a.last_ts.localeCompare(b.last_ts));
    const extra = new Map<string, Sensor>();
    for (const r of latest) extra.set(r.sensor_id, { id: r.sensor_id, lat: r.lat, lng: r.lng });
    out[farm.id] = [...list, ...extra.values()].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  }
  return out;
}

export function accountInterval(devices: Array<Pick<StoredDevice, "interval_s">>): number {
  return devices.length ? Math.min(...devices.map((d) => d.interval_s)) : DEFAULT_INTERVAL_S;
}

function insightTimestamp(now = new Date()): string {
  const t = new Date(now);
  t.setUTCMinutes(0, 0, 0);
  return t.toISOString();
}

async function buildAccountDashboard(store: AccountStore): Promise<DashboardData> {
  const today = qatarDateString(new Date());
  const dates = dateRangeEnding(today, HISTORY_DAYS);
  const [farms, devices] = await Promise.all([store.listFarms(), store.listDevices()]);
  const daily = await store.dailyAggregates(dates[0], farms.map((f) => f.id));
  const [weather, forecasts] = await Promise.all([getWeatherForFarms(farms), getNext12hForecasts(farms)]);
  const data = buildDashboardData({
    farms,
    daily,
    weather,
    insights: [],
    source: "account",
    sourceNote: null,
    dates,
    sensorsByFarm: sensorsFor(farms, devices, daily),
    account: { devices: devices.map(publicDevice), interval_s: accountInterval(devices), error: null },
  });
  const createdAt = insightTimestamp();
  for (const bundle of data.farms) {
    bundle.insight = generateInsight(bundle, lastDataIndex(bundle), createdAt);
    bundle.riskHistory = replayRiskHistory(bundle, dates);
    bundle.next12h = forecasts[bundle.farm.id] ?? null;
  }
  return data;
}

/** An empty dashboard that says why the account's farms couldn't be loaded (never demo data). */
function unavailable(error: unknown): DashboardData {
  const note = `Your farms couldn't be loaded (${shortError(error)}). Try again in a minute.`;
  return {
    generatedAt: new Date().toISOString(),
    source: "account",
    sourceNote: note,
    account: { devices: [], interval_s: DEFAULT_INTERVAL_S, error: note },
    weather: { source: "unavailable", note: null },
    dates: dateRangeEnding(qatarDateString(new Date()), HISTORY_DAYS),
    farms: [],
  };
}

/** The account's dashboard, cached for a minute or until its farms, devices or readings change. */
export async function getAccountDashboard(user: Pick<AppUser, "id" | "provider">): Promise<DashboardData> {
  const store = getAccountStore(user);
  let version: string;
  try {
    version = await store.version();
  } catch (error) {
    return unavailable(error);
  }
  const key = `${user.provider}:${user.id}`;
  const cached = cache.get(key);
  if (cached && cached.key === version && Date.now() - cached.at < TTL_MS) return cached.promise;
  const promise = buildAccountDashboard(store).catch((error) => {
    console.warn("[account] Could not load the account's farms:", shortError(error));
    if (cache.get(key)?.promise === promise) cache.delete(key);
    return unavailable(error);
  });
  cache.set(key, { key: version, at: Date.now(), promise });
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
  return promise;
}

export function invalidateAccountDashboard(user: Pick<AppUser, "id" | "provider">): void {
  cache.delete(`${user.provider}:${user.id}`);
}

/**
 * Live mode for a real account: readings its devices stored since `cursor`, today re-derived for
 * every farm that received some, and every device's status. Never simulates anything.
 */
export async function getAccountLiveUpdate(user: Pick<AppUser, "id" | "provider">, cursorParam: string | null): Promise<LiveUpdate> {
  const now = Date.now();
  const today = qatarDateString(now);
  const store = getAccountStore(user);
  const data = await getAccountDashboard(user);
  const farms = data.farms.map((b) => b.farm);
  const farmIds = farms.map((f) => f.id);
  const cursor = decodeCursor(cursorParam);

  const devices = await store.listDevices();
  const readings = cursor ? await store.readingsSince(cursor.id, farmIds) : [];
  let maxId = cursor ? cursor.id : await store.latestReadingId(farmIds);
  for (const r of readings) maxId = Math.max(maxId, r.id);

  const affected = [...new Set(readings.map((r) => r.farm_id))];
  const farmDays: LiveUpdate["farms"] = {};
  if (affected.length > 0) {
    const [rows, weather] = await Promise.all([store.dailyAggregates(today, affected), getWeatherForFarms(farms)]);
    for (const farmId of affected) {
      const bundle = data.farms.find((b) => b.farm.id === farmId);
      if (!bundle) continue;
      const day = deriveFarmDay(
        bundle.farm,
        today,
        rows.filter((r) => r.farm_id === farmId && r.day === today),
        weather.byFarm[farmId]?.[today],
        bundle.kcAdjusted,
      );
      if (day) farmDays[farmId] = day;
    }
  }

  const live: LiveReading[] = readings
    .map(({ id: _id, ...r }) => ({ ...r, simulated: false }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 50);
  const anyOnline = devices.some((d) => d.last_seen_at && now - Date.parse(d.last_seen_at) < Math.max(45_000, d.interval_s * 3000));

  return {
    serverTime: new Date(now).toISOString(),
    cursor: encodeCursor({ id: maxId, slot: 0 }),
    feed: live.length > 0 || anyOnline ? "probe" : "idle",
    interval_s: accountInterval(devices),
    devices: devices.map(publicDevice),
    date: today,
    readings: live,
    farms: farmDays,
  };
}

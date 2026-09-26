/**
 * The ready-made test account ("Tester" / "Tester", lib/env.ts TESTER_ACCOUNT). It is a real account —
 * its farms, devices and readings live where every account's do (Supabase, or `.data/` locally), it can
 * add farms and pair real ESP32s — but it never starts empty: on first use it gets three farms in
 * northern Qatar, each with three test probes, and 30 days of readings.
 *
 * The test probes ("dev_sim_…") keep reporting whenever the account is looked at: every request tops
 * their readings up to now (hourly for old gaps, every 10 minutes for the last day, then at the probe's
 * interval), so the dashboard is always live. Values are a deterministic function of probe and time
 * (irrigation cycles, daily heat, a slow salinity trend on one farm), so two server instances that top
 * up at once write identical rows, which the database de-duplicates.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import type { CropId } from "../agronomy-tables";
import type { AppUser } from "../auth/session";
import { hashString } from "../data/random";
import { TESTER_ACCOUNT } from "../env";
import type { Farm, SensorReading } from "../types";
import { getAccountStore, type AccountStore } from "./store";
import { squareFieldPolygon, type StoredDevice } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const BACKFILL_DAYS = 30;
const SIM_INTERVAL_S = 30;
/** Upper bound of readings one top-up writes per probe. */
const MAX_PER_PROBE = 1200;

export const SIM_DEVICE_PREFIX = "dev_sim_";
export const isSimDevice = (d: Pick<StoredDevice, "id">) => d.id.startsWith(SIM_DEVICE_PREFIX);

export function isTesterUser(user: Pick<AppUser, "email">): boolean {
  return user.email.trim().toLowerCase() === TESTER_ACCOUNT.email.toLowerCase();
}

/** How each test farm behaves over time. */
interface Profile {
  /** Mean volumetric water content, %. */
  moisture: number;
  /** Rise after each irrigation, % VWC. */
  pulse: number;
  /** Bulk EC today, dS/m, and its change per day. */
  ec: number;
  ecPerDay: number;
  ph: number;
  n: number;
  p: number;
  k: number;
}

interface TestFarm {
  key: string;
  name: string;
  lat: number;
  lng: number;
  area_ha: number;
  crop: CropId;
  /** Days before today it was planted. */
  plantedDaysAgo: number;
  region: string;
  water_ec: number;
  soil: Farm["soil_type"];
  profile: Profile;
  /** Probe offsets from the centre, metres east / north. */
  probes: Array<[number, number]>;
}

/** Three real farming areas of northern Qatar, with three probes each. */
const TEST_FARMS: TestFarm[] = [
  {
    key: "alkhor",
    name: "Al Khor Tomato Farm",
    lat: 25.6512,
    lng: 51.4386,
    area_ha: 4,
    crop: "tomato",
    plantedDaysAgo: 24,
    region: "Al Khor",
    water_ec: 2.2,
    soil: "sand",
    profile: { moisture: 12.5, pulse: 3.2, ec: 0.95, ecPerDay: 0.004, ph: 7.8, n: 38, p: 21, k: 175 },
    probes: [
      [-55, 40],
      [45, 25],
      [-10, -55],
    ],
  },
  {
    key: "ummsalal",
    name: "Umm Salal Cucumber Greenhouses",
    lat: 25.4165,
    lng: 51.3985,
    area_ha: 2,
    crop: "cucumber",
    plantedDaysAgo: 16,
    region: "Umm Salal",
    water_ec: 1.4,
    soil: "loamy_sand",
    profile: { moisture: 16.5, pulse: 2.6, ec: 0.7, ecPerDay: 0.001, ph: 7.5, n: 44, p: 26, k: 190 },
    probes: [
      [-35, 20],
      [30, 30],
      [0, -40],
    ],
  },
  {
    key: "sheehaniya",
    name: "Al Sheehaniya Alfalfa Field",
    lat: 25.3812,
    lng: 51.2206,
    area_ha: 6,
    crop: "alfalfa",
    plantedDaysAgo: 200,
    region: "Al Sheehaniya",
    water_ec: 3.1,
    soil: "sand",
    // Brackish well water: salinity creeping up, and the field runs dry between irrigations.
    profile: { moisture: 9.5, pulse: 2.8, ec: 1.45, ecPerDay: 0.012, ph: 8.1, n: 30, p: 15, k: 150 },
    probes: [
      [-80, 60],
      [70, 10],
      [-5, -75],
    ],
  },
];

const farmId = (userId: string, f: TestFarm) => `tester-${f.key}-${userId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase()}`;
const deviceId = (fid: string, i: number) => `${SIM_DEVICE_PREFIX}${fid.slice(7)}-${i + 1}`;

function isoDay(offsetDays: number, now = Date.now()): string {
  return new Date(now + 3 * HOUR - offsetDays * DAY).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Deterministic probe values
// ---------------------------------------------------------------------------

/** A repeatable pseudo-random number in [-1, 1] for (key, t). */
function noise(key: string, t: number): number {
  return ((hashString(`${key}|${t}`) % 20001) / 10000) - 1;
}

/** Hours since the last irrigation (05:00 and 17:00 Qatar time). */
function hoursSinceIrrigation(t: number): number {
  const qatarHour = (((t + 3 * HOUR) % DAY) / HOUR + 24) % 24;
  return qatarHour >= 17 ? qatarHour - 17 : qatarHour >= 5 ? qatarHour - 5 : qatarHour + 7;
}

/** 0 at dawn (05:00), 1 in mid-afternoon (14:00): 9 hours warming, 15 hours cooling. */
function heat(t: number): number {
  const qatarHour = (((t + 3 * HOUR) % DAY) / HOUR + 24) % 24;
  if (qatarHour >= 5 && qatarHour < 14) return 0.5 - 0.5 * Math.cos((Math.PI * (qatarHour - 5)) / 9);
  return 0.5 + 0.5 * Math.cos((Math.PI * ((qatarHour - 14 + 24) % 24)) / 15);
}

export function simulateReading(f: TestFarm, fid: string, sensorId: string, probe: number, lat: number, lng: number, t: number, now = Date.now()): SensorReading {
  const p = f.profile;
  const key = `${fid}|${sensorId}`;
  const offset = [0.6, -0.4, -1.1][probe % 3];
  const daysAgo = (now - t) / DAY;
  const h = Math.min(1, Math.max(0, heat(t)));
  const since = hoursSinceIrrigation(t);
  // A 1–2-day wet/dry swing on top of the twice-daily irrigation pulses.
  const slow = Math.sin((t / DAY) * 2 * Math.PI * 0.6 + probe) * 0.8;
  const moisture = p.moisture + offset + slow + p.pulse * Math.exp(-since / 4) - 0.9 * (since / 12) + noise(key, Math.floor(t / (10 * MIN))) * 0.25;
  const airTemp = 29.5 + 11 * h - 0.05 * Math.max(0, daysAgo) + noise(`${key}|air`, Math.floor(t / (15 * MIN))) * 0.4;
  const humidity = 68 - 42 * h + noise(`${key}|rh`, Math.floor(t / (15 * MIN))) * 3;
  const ec = Math.max(0.2, p.ec - p.ecPerDay * daysAgo + offset * 0.08 + noise(`${key}|ec`, Math.floor(t / HOUR)) * 0.03);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    farm_id: fid,
    sensor_id: sensorId,
    lat,
    lng,
    timestamp: new Date(t).toISOString(),
    moisture: r1(Math.min(40, Math.max(2, moisture))),
    temperature: r1(28 + 6.5 * heat(t - 2 * HOUR) + noise(`${key}|st`, Math.floor(t / (15 * MIN))) * 0.3),
    ec: r2(ec),
    ph: r2(p.ph + offset * 0.05 + noise(`${key}|ph`, Math.floor(t / HOUR)) * 0.05),
    n: Math.round(p.n + offset * 2 - daysAgo * 0.05 + noise(`${key}|n`, Math.floor(t / (3 * HOUR))) * 2),
    p: Math.round(p.p + offset + noise(`${key}|p`, Math.floor(t / (3 * HOUR))) * 1.5),
    k: Math.round(p.k + offset * 5 + noise(`${key}|k`, Math.floor(t / (3 * HOUR))) * 6),
    air_temp: r1(airTemp),
    air_humidity: Math.round(Math.min(100, Math.max(5, humidity))),
  };
}

/** Reading times after `from` up to `to`: hourly for old gaps, 10-minutely in the last day, then every `intervalMs`. */
export function simTimes(from: number, to: number, intervalMs: number): number[] {
  const out: number[] = [];
  const stepAt = (t: number) => (to - t > DAY ? HOUR : to - t > HOUR ? 10 * MIN : intervalMs);
  let t = from;
  while (true) {
    const step = stepAt(t);
    t = (Math.floor(t / step) + 1) * step; // aligned to the step, so repeated top-ups hit the same times
    if (t > to) break;
    out.push(t);
  }
  return out.length > MAX_PER_PROBE ? out.slice(-MAX_PER_PROBE) : out;
}

// ---------------------------------------------------------------------------
// Provisioning and top-up
// ---------------------------------------------------------------------------

/** Adds whichever test farms and probes are missing (so an interrupted first run completes later). Returns how many it added. */
async function provision(store: AccountStore, user: AppUser): Promise<number> {
  const now = Date.now();
  const farms = new Set((await store.listFarms()).map((f) => f.id));
  const devices = new Set((await store.listDevices()).map((d) => d.id));
  let added = 0;
  for (const f of TEST_FARMS) {
    const id = farmId(user.id, f);
    if (!farms.has(id)) {
      await store.insertFarm({
        id,
        name: f.name,
        owner: user.name,
        lat: f.lat,
        lng: f.lng,
        area_ha: f.area_ha,
        main_crop: f.crop,
        polygon: squareFieldPolygon(f.lat, f.lng, f.area_ha),
        region: f.region,
        planting_date: isoDay(f.plantedDaysAgo, now),
        soil_type: f.soil,
        theta_fc: null,
        theta_wp: null,
        elevation_m: 10,
        ec_calibration_factor: 3,
        irrigation_water_ec: f.water_ec,
      });
      added++;
    }
    for (const [i, [east, north]] of f.probes.entries()) {
      if (devices.has(deviceId(id, i))) continue;
      const lat = f.lat + north / 110_574;
      const lng = f.lng + east / (111_320 * Math.cos((f.lat * Math.PI) / 180));
      const hash = randomBytes(32).toString("hex");
      const dev = await store.insertDevice({
        id: deviceId(id, i),
        farm_id: id,
        name: `Test probe ${String.fromCharCode(65 + i)}`,
        sensor_id: `ESP32-${i + 1}`,
        lat: Math.round(lat * 1e6) / 1e6,
        lng: Math.round(lng * 1e6) / 1e6,
        interval_s: SIM_INTERVAL_S,
        token_hash: hash,
        token_hint: "test",
        pairing_code: `SIM${hash.slice(0, 5).toUpperCase()}`,
        pairing_expires_at: new Date(now - MIN).toISOString(),
      });
      await store.updateDevice(dev.id, { pairing_code: null, pairing_expires_at: null, paired_at: new Date(now - BACKFILL_DAYS * DAY).toISOString() });
      added++;
    }
  }
  return added;
}

async function topUp(store: AccountStore, now = Date.now()): Promise<number> {
  const farms = await store.listFarms();
  const devices = await store.listDevices();
  const readings: SensorReading[] = [];
  const seen: Array<{ id: string; count: number }> = [];
  for (const d of devices.filter(isSimDevice)) {
    const farm = farms.find((f) => f.id === d.farm_id);
    const def = TEST_FARMS.find((f) => farm && farm.id.startsWith(`tester-${f.key}-`));
    if (!farm || !def) continue;
    const last = d.last_seen_at ? Date.parse(d.last_seen_at) : now - BACKFILL_DAYS * DAY;
    const times = simTimes(Math.max(last, now - BACKFILL_DAYS * DAY), now, Math.max(5, d.interval_s) * 1000);
    if (!times.length) continue;
    const probe = Number(d.sensor_id.replace(/\D/g, "")) - 1 || 0;
    for (const t of times) readings.push(simulateReading(def, farm.id, d.sensor_id, probe, d.lat ?? farm.lat, d.lng ?? farm.lng, t, now));
    seen.push({ id: d.id, count: times.length });
  }
  if (!readings.length) return 0;
  return store.insertReadings(readings, seen);
}

const g = globalThis as typeof globalThis & {
  __harvestarTesterRuns?: Map<string, { at: number; done: boolean; promise: Promise<void> }>;
  __harvestarTesterReady?: Set<string>;
};
const runs = (g.__harvestarTesterRuns ??= new Map());
/** Accounts whose test farms and probes this process has seen complete. */
const provisioned = (g.__harvestarTesterReady ??= new Set());
/** At most one provisioning / top-up per account and process every few seconds. */
const MIN_GAP_MS = 4000;
/** How long a page waits for the top-up before rendering what is stored (the rest keeps running). */
const WAIT_BUDGET_MS = 3500;

/** Keep a serverless function alive until `promise` settles, when called inside a request. */
async function keepAlive(promise: Promise<void>): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(() => promise);
  } catch {
    // Outside a request (tests, scripts): nothing to extend.
  }
}

function withBudget(promise: Promise<void>): Promise<void> {
  return Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, WAIT_BUDGET_MS))]);
}

/**
 * Make sure the test account has its farms, and bring its test probes' readings up to now. Never
 * throws, and waits at most a few seconds: the dashboard loads with what is stored while a long
 * backfill finishes in the background.
 */
export function prepareTesterAccount(user: AppUser): Promise<void> {
  if (!isTesterUser(user)) return Promise.resolve();
  const key = `${user.provider}:${user.id}`;
  const prev = runs.get(key);
  if (prev && (!prev.done || Date.now() - prev.at < MIN_GAP_MS)) return prev.done ? prev.promise : withBudget(prev.promise);
  const run = { at: Date.now(), done: false, promise: Promise.resolve() };
  run.promise = (async () => {
    const store = getAccountStore(user);
    try {
      if (!provisioned.has(key)) {
        const added = await provision(store, user);
        if (added) console.info(`[tester] Added ${added} test farms and probes`);
        provisioned.add(key);
      }
      const stored = await topUp(store);
      if (stored > 200) console.info(`[tester] Backfilled ${stored} test-probe readings`);
    } catch (error) {
      console.warn("[tester] Could not prepare the test account:", error instanceof Error ? error.message : error);
    } finally {
      run.done = true;
      run.at = Date.now();
    }
  })();
  runs.set(key, run);
  void keepAlive(run.promise);
  return withBudget(run.promise);
}

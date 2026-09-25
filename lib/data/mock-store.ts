/**
 * In-memory demo data for mock mode: the deterministic 60-day dataset (rebuilt as new 3-hourly
 * readings become due) plus anything posted to /api/readings while the server runs.
 */
import "server-only";
import type { Farm, Sensor, SensorReading } from "../types";
import { generateDemoDataset, READING_HOURS_LOCAL } from "./generate";
import { latestBySensor } from "./live-sim";
import { qatarDateString, qatarHour } from "./time";

export interface StoredReading extends SensorReading {
  id: number;
}

interface MockState {
  key: string;
  today: string;
  farms: Farm[];
  sensorsByFarm: Record<string, Sensor[]>;
  base: SensorReading[];
  byFarmDay: Map<string, SensorReading[]>;
  latest: Map<string, SensorReading>;
  ingested: StoredReading[];
  nextId: number;
  version: number;
}

const globalStore = globalThis as unknown as { __yieldMockStore?: MockState };

/** Changes whenever a new scheduled 3-hourly reading becomes due. */
function slotKey(now: Date): string {
  const hour = qatarHour(now);
  const due = READING_HOURS_LOCAL.filter((h) => h <= hour).at(-1) ?? 0;
  return `${qatarDateString(now)}@${due}`;
}

const farmDayKey = (farmId: string, day: string) => `${farmId}|${day}`;

function indexReadings(readings: SensorReading[]): Map<string, SensorReading[]> {
  const map = new Map<string, SensorReading[]>();
  for (const r of readings) {
    const key = farmDayKey(r.farm_id, qatarDateString(r.timestamp));
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  return map;
}

export function getMockState(now = new Date()): MockState {
  const key = slotKey(now);
  const current = globalStore.__yieldMockStore;
  if (current && current.key === key) return current;

  const dataset = generateDemoDataset(now);
  const firstDay = qatarDateString(dataset.readings[0]?.timestamp ?? now);
  const ingested = (current?.ingested ?? []).filter((r) => qatarDateString(r.timestamp) >= firstDay);
  const all = [...dataset.readings, ...ingested];
  const state: MockState = {
    key,
    today: dataset.today,
    farms: dataset.farms,
    sensorsByFarm: dataset.sensorsByFarm,
    base: dataset.readings,
    byFarmDay: indexReadings(all),
    latest: latestBySensor(all),
    ingested,
    nextId: current?.nextId ?? 1,
    version: (current?.version ?? 0) + 1,
  };
  globalStore.__yieldMockStore = state;
  return state;
}

export function mockReadings(state: MockState): SensorReading[] {
  return state.ingested.length ? [...state.base, ...state.ingested] : state.base;
}

export function mockReadingsForDay(state: MockState, farmId: string, day: string): SensorReading[] {
  return state.byFarmDay.get(farmDayKey(farmId, day)) ?? [];
}

export function mockIngest(readings: SensorReading[]): StoredReading[] {
  const state = getMockState();
  const stored = readings.map((r) => ({ ...r, id: state.nextId++ }));
  for (const r of stored) {
    state.ingested.push(r);
    const key = farmDayKey(r.farm_id, qatarDateString(r.timestamp));
    const list = state.byFarmDay.get(key);
    if (list) list.push(r);
    else state.byFarmDay.set(key, [r]);
    const sensorKey = `${r.farm_id}|${r.sensor_id}`;
    const prev = state.latest.get(sensorKey);
    if (!prev || r.timestamp >= prev.timestamp) state.latest.set(sensorKey, r);
    if (!state.sensorsByFarm[r.farm_id]?.some((s) => s.id === r.sensor_id)) {
      state.sensorsByFarm[r.farm_id] = [...(state.sensorsByFarm[r.farm_id] ?? []), { id: r.sensor_id, lat: r.lat, lng: r.lng }];
    }
  }
  state.version++;
  return stored;
}

export function mockIngestedSince(id: number, farmIds?: Set<string>): StoredReading[] {
  return getMockState().ingested.filter((r) => r.id > id && (!farmIds || farmIds.has(r.farm_id)));
}

/** Readings posted for the given farms (users' own farms in local mode). */
export function mockIngestedForFarms(farmIds: Set<string>): StoredReading[] {
  return getMockState().ingested.filter((r) => farmIds.has(r.farm_id));
}

export function mockMaxIngestedId(): number {
  const state = getMockState();
  return state.ingested.at(-1)?.id ?? 0;
}

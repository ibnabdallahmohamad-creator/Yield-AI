/**
 * The built-in demo dataset, in memory: the deterministic 60-day dataset shown to the demo
 * account and on the landing page, rebuilt as new 3-hourly readings become due. It never mixes
 * with accounts' own data.
 */
import "server-only";
import type { Farm, Sensor, SensorReading } from "../types";
import { generateDemoDataset, READING_HOURS_LOCAL } from "./generate";
import { latestBySensor } from "./live-sim";
import { qatarDateString, qatarHour } from "./time";

interface MockState {
  key: string;
  today: string;
  farms: Farm[];
  sensorsByFarm: Record<string, Sensor[]>;
  readings: SensorReading[];
  byFarmDay: Map<string, SensorReading[]>;
  latest: Map<string, SensorReading>;
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
  const state: MockState = {
    key,
    today: dataset.today,
    farms: dataset.farms,
    sensorsByFarm: dataset.sensorsByFarm,
    readings: dataset.readings,
    byFarmDay: indexReadings(dataset.readings),
    latest: latestBySensor(dataset.readings),
    version: (current?.version ?? 0) + 1,
  };
  globalStore.__yieldMockStore = state;
  return state;
}

export function mockReadingsForDay(state: MockState, farmId: string, day: string): SensorReading[] {
  return state.byFarmDay.get(farmDayKey(farmId, day)) ?? [];
}

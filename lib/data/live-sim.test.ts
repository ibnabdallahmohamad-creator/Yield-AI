import { describe, expect, it } from "vitest";
import { generateDemoDataset } from "./generate";
import { decodeCursor, encodeCursor, latestBySensor, simulateSlot, slotFarm } from "./live-sim";

const ds = generateDemoDataset(new Date("2026-09-24T12:00:00Z"));
const latest = latestBySensor(ds.readings);

describe("demo live feed", () => {
  it("reports one farm per slot, round-robin", () => {
    const seen = new Set<string>();
    for (let slot = 1000; slot < 1000 + ds.farms.length; slot++) seen.add(slotFarm(slot, ds.farms)!.id);
    expect(seen.size).toBe(ds.farms.length);
  });

  it("is deterministic and stays close to each probe's latest reading", () => {
    const a = simulateSlot(123456, ds.farms, ds.sensorsByFarm, latest);
    const b = simulateSlot(123456, ds.farms, ds.sensorsByFarm, latest);
    expect(a).toEqual(b);
    expect(a.length).toBe(ds.sensorsByFarm[a[0].farm_id].length);
    for (const r of a) {
      const base = latest.get(`${r.farm_id}|${r.sensor_id}`)!;
      expect(Math.abs(r.moisture! - base.moisture!)).toBeLessThan(base.moisture! * 0.1);
      expect(Math.abs(r.ec! - base.ec!)).toBeLessThan(base.ec! * 0.08);
      expect(Math.abs(r.ph! - base.ph!)).toBeLessThan(0.1);
    }
  });

  it("round-trips the poll cursor and rejects junk", () => {
    expect(decodeCursor(encodeCursor({ id: 42, slot: 351234567 }))).toEqual({ id: 42, slot: 351234567 });
    expect(decodeCursor("nope")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });
});

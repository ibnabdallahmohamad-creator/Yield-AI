import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashDeviceKey } from "../device-keys";
import type { Device, Farm, SensorReading } from "../types";
import { LocalStore } from "./local";

const NOW = Date.parse("2026-09-25T09:00:00Z");

function farm(id: string, ownerId: string): Farm & { owner_id: string } {
  return {
    id,
    owner_id: ownerId,
    name: `Farm ${id}`,
    owner: "Owner",
    lat: 25.6,
    lng: 51.4,
    area_ha: 2,
    main_crop: "tomato",
    polygon: { type: "Polygon", coordinates: [[[51.4, 25.6], [51.41, 25.6], [51.41, 25.61], [51.4, 25.6]]] },
    region: "",
    planting_date: "2026-09-01",
    soil_type: "sand",
    theta_fc: null,
    theta_wp: null,
    elevation_m: 10,
    ec_calibration_factor: 3,
    irrigation_water_ec: 1.5,
  };
}

function device(id: string, farmId: string, ownerId: string, sensorId = "P-01"): Device {
  return {
    id,
    owner_id: ownerId,
    farm_id: farmId,
    name: "Probe",
    sensor_id: sensorId,
    lat: 25.605,
    lng: 51.405,
    token_hint: "abcd",
    created_at: new Date(NOW).toISOString(),
    last_seen_at: null,
    last_reading_at: null,
    last_ip: null,
    rssi: null,
    firmware: null,
    last_error: null,
    last_reading: null,
  };
}

function reading(farmId: string, ms: number, moisture: number, sensorId = "P-01"): SensorReading {
  return {
    farm_id: farmId,
    sensor_id: sensorId,
    lat: 25.605,
    lng: 51.405,
    timestamp: new Date(ms).toISOString(),
    moisture,
    temperature: 28,
    ec: 1.2,
    ph: 7.9,
    n: 30,
    p: 20,
    k: 150,
    air_temp: null,
    air_humidity: null,
  };
}

describe("LocalStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "yield-store-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps every account's farms and devices to itself", async () => {
    const store = new LocalStore(dir, () => NOW);
    await store.insertFarm(farm("a", "alice"));
    await store.insertFarm(farm("b", "bob"));
    await store.insertDevice(device("d1", "a", "alice"), "hash-a");

    expect((await store.listFarms("alice")).map((f) => f.id)).toEqual(["a"]);
    expect((await store.listFarms("bob")).map((f) => f.id)).toEqual(["b"]);
    expect(await store.listDevices("bob")).toEqual([]);
    expect(await store.updateFarm("bob", "a", { name: "Hijacked" })).toBeNull();
    expect(await store.deleteFarm("bob", "a")).toBe(false);
    expect(await store.deleteDevice("bob", "d1")).toBe(false);
    // The key hash never leaves the store.
    expect(await store.listDevices("alice")).toEqual([expect.not.objectContaining({ token_hash: expect.anything() })]);
    expect((await store.findDeviceByTokenHash("hash-a"))?.id).toBe("d1");
    expect(await store.findDeviceByTokenHash("nope")).toBeNull();
  });

  it("authenticates a device by its key and stores its report", async () => {
    const store = new LocalStore(dir, () => NOW);
    await store.insertFarm(farm("a", "alice"));
    const key = "yai_local-test-key-0123456789";
    await store.insertDevice(device("d1", "a", "alice"), hashDeviceKey(key));
    await store.saveSettings("alice", { reading_interval_s: 30 });

    const found = await store.authenticateDevice(key);
    expect(found?.device.id).toBe("d1");
    expect(found?.settings.reading_interval_s).toBe(30);
    expect(await store.authenticateDevice("yai_wrong-key-0123456789")).toBeNull();

    const contact = { at: new Date(NOW).toISOString(), ip: "10.0.0.7", rssi: -55, firmware: "1.2.0", error: null, reading: null };
    expect(await store.saveDeviceReport(key, "d1", [reading("a", NOW - 5_000, 14)], contact)).toBe(1);
    expect(await store.saveDeviceReport(key, "d1", [], { ...contact, error: "probe timeout" })).toBe(0); // heartbeat
    const [d] = await store.listDevices("alice");
    expect(d.last_ip).toBe("10.0.0.7");
    expect(d.last_error).toBe("probe timeout");
    expect(await store.maxReadingId(["a"])).toBe(1);
  });

  it("stores readings once, pages them by id and survives a restart", async () => {
    const store = new LocalStore(dir, () => NOW);
    await store.insertFarm(farm("a", "alice"));
    const r1 = reading("a", NOW - 20_000, 12);
    const r2 = reading("a", NOW - 10_000, 13);
    expect(await store.insertReadings([r1, r2])).toBe(2);
    expect(await store.insertReadings([r2])).toBe(0); // duplicate (farm, probe, timestamp)
    expect(await store.maxReadingId(["a"])).toBe(2);
    expect((await store.readingsSince(["a"], 1, 10)).map((r) => r.moisture)).toEqual([13]);
    expect(await store.readingsSince(["other"], 0, 10)).toEqual([]);
    await store.flush();

    const reopened = new LocalStore(dir, () => NOW);
    expect((await reopened.listFarms("alice")).length).toBe(1);
    expect(await reopened.maxReadingId(["a"])).toBe(2);
    const daily = await reopened.dailyAggregates(["a"], "2026-09-01");
    expect(daily).toHaveLength(1);
    expect(daily[0].moisture).toBeCloseTo(12.5);
  });

  it("buckets series and records device contact", async () => {
    const store = new LocalStore(dir, () => NOW);
    await store.insertFarm(farm("a", "alice"));
    await store.insertDevice(device("d1", "a", "alice"), "h");
    const base = Date.parse("2026-09-25T08:00:00Z");
    await store.insertReadings([reading("a", base + 10_000, 10), reading("a", base + 20_000, 12), reading("a", base + 70_000, 20)]);
    const rows = await store.series("a", new Date(base).toISOString(), new Date(base + 120_000).toISOString(), 60);
    expect(rows.map((r) => [r.count, r.moisture])).toEqual([
      [2, 11],
      [1, 20],
    ]);

    await store.recordDeviceContact("d1", {
      at: new Date(NOW).toISOString(),
      ip: "10.0.0.5",
      rssi: -60,
      firmware: "1.0.0",
      error: null,
      reading: { timestamp: new Date(NOW).toISOString(), moisture: 11, temperature: 27, ec: 1.1, ph: 8, n: 1, p: 2, k: 3, air_temp: null, air_humidity: null },
    });
    const [d] = await store.listDevices("alice");
    expect(d.last_seen_at).toBe(new Date(NOW).toISOString());
    expect(d.rssi).toBe(-60);
    expect(d.last_reading?.moisture).toBe(11);
    await store.flush();
    const saved = JSON.parse(readFileSync(path.join(dir, "store.json"), "utf8"));
    expect(saved.devices[0].firmware).toBe("1.0.0");
  });

  it("thins readings older than 48 h to one per probe every 10 minutes and drops them after 120 days", async () => {
    let now = NOW;
    const store = new LocalStore(dir, () => now);
    await store.insertFarm(farm("a", "alice"));
    const old = NOW - 3 * 86_400_000;
    const slot = Math.floor(old / 600_000) * 600_000;
    await store.insertReadings([
      reading("a", slot + 10_000, 1),
      reading("a", slot + 20_000, 2),
      reading("a", slot + 30_000, 3),
      reading("a", NOW - 200 * 86_400_000, 9),
      reading("a", NOW - 60_000, 5),
    ]);
    // Compaction runs at most hourly; move the clock on.
    now = NOW + 2 * 3_600_000;
    await store.insertReadings([reading("a", now - 1000, 6)]);
    const all = await store.readingsSince(["a"], 0, 100);
    expect(all.map((r) => r.moisture)).toEqual([1, 5, 6]);
  });

  it("deleting a farm removes its devices and readings", async () => {
    const store = new LocalStore(dir, () => NOW);
    await store.insertFarm(farm("a", "alice"));
    await store.insertDevice(device("d1", "a", "alice"), "h");
    await store.insertReadings([reading("a", NOW - 1000, 10)]);
    expect(await store.deleteFarm("alice", "a")).toBe(true);
    expect(await store.listDevices("alice")).toEqual([]);
    expect(await store.readingsSince(["a"], 0, 10)).toEqual([]);
  });

  it("refuses a second probe with the same id on one farm", async () => {
    const store = new LocalStore(dir, () => NOW);
    await store.insertFarm(farm("a", "alice"));
    await store.insertDevice(device("d1", "a", "alice", "P-01"), "h1");
    await expect(store.insertDevice(device("d2", "a", "alice", "P-01"), "h2")).rejects.toThrow(/already exists/);
  });
});

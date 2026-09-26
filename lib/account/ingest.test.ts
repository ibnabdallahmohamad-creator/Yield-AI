import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../auth/session";
import { authenticateDevice, pairDevice, parseDevicePayload, rateLimited, toDeviceReadings } from "./ingest";
import { resetLocalAccountCache } from "./local-store";
import { createDevice, createFarm, listDevices, listFarms, setAllIntervals } from "./manage";
import { getAccountStore } from "./store";
import { DEFAULT_INTERVAL_S, DeviceCreateSchema, FarmCreateSchema, FarmPatchSchema, formatPairingCode, normalizePairingCode } from "./types";

vi.mock("server-only", () => ({}));

const NOW = Date.parse("2026-09-25T09:00:00Z");
const device = { farm_id: "farm-1", sensor_id: "ESP32-1", lat: null, lng: null };
const farm = { lat: 25.68, lng: 51.5 };

describe("parseDevicePayload", () => {
  it("accepts one reading, an array, or { readings } with device info", () => {
    expect(parseDevicePayload({ moisture: 21.5, rssi: -60 }).readings).toHaveLength(1);
    expect(parseDevicePayload([{ moisture: 20 }, { moisture: 21 }]).readings).toHaveLength(2);
    const batch = parseDevicePayload({ readings: [{ moisture: 20 }, { ph: 7.8 }], rssi: -58, firmware: "1.0.0", ip: "192.168.1.7" });
    expect(batch.readings).toHaveLength(2);
    expect(batch.meta).toEqual({ rssi: -58, firmware: "1.0.0", local_ip: "192.168.1.7" });
  });

  it("understands common sketch field names and numbers sent as strings", () => {
    const [r] = parseDevicePayload({ soil_moisture: "23.4", soil_temp: 27, nitrogen: 40, humidity: 35 }).readings;
    expect(r).toMatchObject({ moisture: 23.4, temperature: 27, n: 40, air_humidity: 35 });
  });

  it("rejects bad readings one by one and says which", () => {
    const out = parseDevicePayload({ readings: [{ moisture: 20 }, { moisture: 140 }, { firmware: "x" }] });
    expect(out.readings).toHaveLength(1);
    expect(out.errors.some((e) => e.startsWith("readings[1].moisture"))).toBe(true);
    expect(out.errors.some((e) => e.startsWith("readings[2]") && e.includes("at least one measurement"))).toBe(true);
  });

  it("refuses empty, oversized and non-object bodies", () => {
    expect(parseDevicePayload({ readings: [] }).errors).toEqual(["`readings` is empty."]);
    expect(parseDevicePayload({ readings: Array.from({ length: 501 }, () => ({ moisture: 1 })) }).errors[0]).toMatch(/at most 500/);
    expect(parseDevicePayload("hello").readings).toHaveLength(0);
  });

  it("ignores device info it can't use instead of failing the reading", () => {
    const out = parseDevicePayload({ moisture: 20, rssi: "strong", firmware: 12 });
    expect(out.readings).toHaveLength(1);
    expect(out.meta).toEqual({ rssi: null, firmware: null, local_ip: null });
  });
});

describe("toDeviceReadings", () => {
  const parse = (body: unknown) => parseDevicePayload(body).readings;

  it("files readings under the device's farm and probe, at the farm centre by default", () => {
    const { readings } = toDeviceReadings(parse({ moisture: 20, ec_us_cm: 1850 }), device, farm, NOW);
    expect(readings[0]).toMatchObject({ farm_id: "farm-1", sensor_id: "ESP32-1", lat: 25.68, lng: 51.5, ec: 1.85, timestamp: new Date(NOW).toISOString() });
  });

  it("reads Unix seconds, milliseconds, ISO times and age_s", () => {
    const at = NOW - 60_000;
    const { readings } = toDeviceReadings(
      parse([
        { moisture: 1, timestamp: at / 1000 },
        { moisture: 2, timestamp: at },
        { moisture: 3, timestamp: new Date(at).toISOString() },
        { moisture: 4, age_s: 60 },
      ]),
      device,
      farm,
      NOW,
    );
    expect(readings.map((r) => r.timestamp)).toEqual(Array(4).fill(new Date(at).toISOString()));
  });

  it("uses the server's time when the device clock was never set or runs ahead", () => {
    const unset = toDeviceReadings(parse({ moisture: 1, timestamp: 12 }), device, farm, NOW);
    expect(unset.readings[0].timestamp).toBe(new Date(NOW).toISOString());
    expect(unset.warnings[0]).toMatch(/clock isn't set/);
    const ahead = toDeviceReadings(parse({ moisture: 1, timestamp: (NOW + 3_600_000) / 1000 }), device, farm, NOW);
    expect(ahead.warnings[0]).toMatch(/ahead/);
  });

  it("refuses readings older than 30 days", () => {
    const out = toDeviceReadings(parse({ moisture: 1, timestamp: (NOW - 31 * 86_400_000) / 1000 }), device, farm, NOW);
    expect(out.readings).toHaveLength(0);
    expect(out.errors).toEqual(["reading: older than 30 days"]);
  });
});

describe("rateLimited", () => {
  it("allows the limit per minute, then says how long to wait", () => {
    for (let i = 0; i < 3; i++) expect(rateLimited("test-key", 3, 60_000, NOW + i)).toBeNull();
    expect(rateLimited("test-key", 3, 60_000, NOW + 30_000)).toBe(30);
    expect(rateLimited("test-key", 3, 60_000, NOW + 60_000)).toBeNull();
  });
});

describe("pairing codes", () => {
  it("accepts codes typed any way", () => {
    expect(normalizePairingCode(" k8a3-bnsq ")).toBe("K8A3BNSQ");
    expect(formatPairingCode("k8a3bnsq")).toBe("K8A3-BNSQ");
  });
});

describe("farm schemas", () => {
  it("fills defaults when adding a farm but never when changing one", () => {
    const created = FarmCreateSchema.parse({ name: "Plot", lat: 25.3, lng: 51.2, area_ha: 2, main_crop: "tomato", planting_date: "2026-09-01" });
    expect(created).toMatchObject({ soil_type: "sand", irrigation_water_ec: 1.5 });
    expect(FarmPatchSchema.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
  });
});

describe("a real account's ESP32, end to end (local store)", () => {
  let dir: string;
  const grower: AppUser = { id: "grower-1", email: "grower@example.com", name: "Grower", provider: "local" };
  const neighbour: AppUser = { id: "grower-2", email: "other@example.com", name: "Other", provider: "local" };
  const demo: AppUser = { id: "local-demo", email: "demo@harvestar.ai", name: "Demo", provider: "local" };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yai-accounts-"));
    vi.stubEnv("HARVESTAR_DATA_DIR", dir);
    resetLocalAccountCache();
  });

  afterEach(async () => {
    resetLocalAccountCache();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it("starts empty, pairs once with the code, stores readings and follows the interval", async () => {
    expect(await listFarms(grower)).toEqual([]);

    const f = await createFarm(grower, FarmCreateSchema.parse({ name: "Al Khor Greenhouse", lat: 25.68, lng: 51.5, area_ha: 3, main_crop: "tomato", planting_date: "2026-09-01" }));
    const { device: created } = await createDevice(grower, DeviceCreateSchema.parse({ farm_id: f.id }));
    expect(created.interval_s).toBe(DEFAULT_INTERVAL_S);
    expect(created.pairing_code).toMatch(/^[0-9A-Z]{8}$/);

    const paired = await pairDevice(formatPairingCode(created.pairing_code!).toLowerCase(), { firmware: "1.0.0", local_ip: "192.168.1.7", rssi: -60 });
    expect(paired?.token).toMatch(/^yd_/);
    expect(await pairDevice(created.pairing_code!, { firmware: null, local_ip: null, rssi: null })).toBeNull(); // single use

    const found = await authenticateDevice(paired!.token);
    expect(found?.device.id).toBe(created.id);
    expect(await authenticateDevice("yd_not-a-real-token-at-all")).toBeNull();

    const now = Date.now();
    const payload = parseDevicePayload({ readings: [{ moisture: 20, age_s: 20 }, { moisture: 21, age_s: 10 }, { moisture: 22 }], rssi: -58 });
    const { readings } = toDeviceReadings(payload.readings, found!.device, f, now);
    expect(await found!.registry.recordReadings(found!.device, readings, payload.meta)).toBe(3);

    const stored = await getAccountStore(grower).readingsBetween(f.id, now - 60_000, now + 60_000);
    expect(stored.map((r) => r.moisture)).toEqual([20, 21, 22]);
    expect(stored.every((r) => r.sensor_id === created.sensor_id)).toBe(true);

    const [listed] = await listDevices(grower);
    expect(listed.last_seen_at).not.toBeNull();
    expect(listed.rssi).toBe(-58);

    await setAllIntervals(grower, 30);
    expect((await authenticateDevice(paired!.token))?.device.interval_s).toBe(30);

    // Nobody else sees this account's farms or devices.
    expect(await listFarms(neighbour)).toEqual([]);
    expect(await listDevices(neighbour)).toEqual([]);
  });

  it("keeps the demo account read-only", async () => {
    await expect(createFarm(demo, FarmCreateSchema.parse({ name: "Plot", lat: 25.3, lng: 51.2, area_ha: 1, main_crop: "tomato", planting_date: "2026-09-01" }))).rejects.toMatchObject({ status: 403 });
    expect(await listFarms(demo)).toEqual([]);
  });
});

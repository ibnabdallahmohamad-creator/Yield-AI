import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../auth/session";
import { isInQatar } from "../qatar/location";
import { resetLocalAccountCache } from "./local-store";
import { getAccountStore } from "./store";
import { isSimDevice, isTesterUser, prepareTesterAccount, simTimes } from "./tester";

vi.mock("server-only", () => ({}));

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("test-probe reading times", () => {
  const now = Date.parse("2026-09-25T09:00:00Z");

  it("is hourly for old gaps, 10-minutely in the last day and at the probe's interval in the last hour", () => {
    const times = simTimes(now - 3 * DAY, now, 30_000);
    const steps = times.slice(1).map((t, i) => t - times[i]!);
    expect(steps[0]).toBe(HOUR);
    expect(steps.at(-1)).toBe(30_000);
    expect(steps).toContain(10 * MIN);
    expect(times.at(-1)).toBeLessThanOrEqual(now);
    expect(new Set(times).size).toBe(times.length);
  });

  it("lands on the same aligned times however often it is called, and caps a long gap", () => {
    const a = simTimes(now - 2 * HOUR, now, 30_000);
    const b = simTimes(now - HOUR - 7_000, now, 30_000);
    expect(a.slice(-b.length)).toEqual(b);
    expect(simTimes(now - 90 * DAY, now, 10_000).length).toBeLessThanOrEqual(1200);
    expect(simTimes(now, now, 30_000)).toEqual([]);
  });
});

describe("the Tester account (local store)", () => {
  let dir: string;
  const tester: AppUser = { id: "local-tester", email: "tester@harvestar.ai", name: "Tester", provider: "local" };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "harvestar-tester-"));
    vi.stubEnv("HARVESTAR_DATA_DIR", dir);
    resetLocalAccountCache();
  });

  afterEach(async () => {
    resetLocalAccountCache();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it("is recognised by email only", () => {
    expect(isTesterUser(tester)).toBe(true);
    expect(isTesterUser({ email: " Tester@Harvestar.AI " })).toBe(true);
    expect(isTesterUser({ email: "grower@example.com" })).toBe(false);
  });

  it("gets three farms in Qatar, three paired test probes each, and readings up to now", async () => {
    await prepareTesterAccount(tester);
    const store = getAccountStore(tester);
    const farms = await store.listFarms();
    const devices = await store.listDevices();
    expect(farms).toHaveLength(3);
    expect(farms.every((f) => isInQatar(f.lat, f.lng))).toBe(true);
    expect(devices).toHaveLength(9);
    expect(devices.every((d) => isSimDevice(d) && d.pairing_code === null && d.paired_at && d.last_seen_at)).toBe(true);

    const farm = farms[0]!;
    const recent = await store.readingsBetween(farm.id, Date.now() - HOUR, Date.now() + MIN);
    expect(new Set(recent.map((r) => r.sensor_id)).size).toBe(3);
    for (const r of recent) {
      expect(r.moisture).toBeGreaterThan(2);
      expect(r.moisture).toBeLessThan(40);
      expect(r.ec).toBeGreaterThan(0);
      expect(r.air_temp).toBeGreaterThan(20);
    }

    // Other accounts are untouched.
    const other: AppUser = { id: "grower-9", email: "grower@example.com", name: "Grower", provider: "local" };
    await prepareTesterAccount(other);
    expect(await getAccountStore(other).listFarms()).toEqual([]);
  });

  it("does nothing for other accounts", async () => {
    const other: AppUser = { id: "grower-1", email: "grower@example.com", name: "Grower", provider: "local" };
    await prepareTesterAccount(other);
    expect(await getAccountStore(other).listFarms()).toEqual([]);
  });
});

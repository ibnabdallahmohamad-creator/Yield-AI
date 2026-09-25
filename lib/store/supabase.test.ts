import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SensorReading } from "../types";

// ESP32 calls must work with the publishable key alone: no service role, no user session.
const rpc = vi.fn();
vi.mock("../supabase/server", () => ({
  createSupabaseAdminClient: () => null,
  createSupabaseAnonClient: () => ({ rpc }),
  createSupabaseDataClient: async () => null,
  withTimeout: <T>(promise: PromiseLike<T>) => Promise.resolve(promise),
}));

const { SupabaseStore } = await import("./supabase");
const { StoreError } = await import("./types");

function respond(result: { data: unknown; error: { message: string } | null }) {
  const promise = Promise.resolve(result);
  return Object.assign(promise, { maybeSingle: () => promise });
}

const deviceRow = {
  id: "dev_1",
  owner_id: "6f1c1b7e-8a55-4d3e-9d0b-2a2f7d1c9e01",
  farm_id: "farm-a",
  name: "North probe",
  sensor_id: "NOR-01",
  lat: 25.61,
  lng: 51.41,
  token_hint: "wxyz",
  created_at: "2026-09-25T08:00:00+00:00",
  last_seen_at: null,
  last_reading_at: null,
  last_ip: null,
  rssi: null,
  firmware: null,
  last_error: null,
  last_reading: null,
  reading_interval_s: 30,
};

const reading: SensorReading = {
  farm_id: "farm-a",
  sensor_id: "NOR-01",
  lat: 25.61,
  lng: 51.41,
  timestamp: "2026-09-25T08:59:50.000Z",
  moisture: 21.5,
  temperature: 27.3,
  ec: 1.8,
  ph: 7.4,
  n: 40,
  p: 12,
  k: 180,
  air_temp: null,
  air_humidity: null,
};

describe("SupabaseStore device path", () => {
  beforeEach(() => rpc.mockReset());

  it("authenticates a key through device_for_key", async () => {
    rpc.mockReturnValue(respond({ data: deviceRow, error: null }));
    const found = await new SupabaseStore().authenticateDevice("  yai_key-0123456789abcdef \n");
    expect(rpc).toHaveBeenCalledWith("device_for_key", { p_key: "yai_key-0123456789abcdef" });
    expect(found?.device).toMatchObject({ id: "dev_1", farm_id: "farm-a", sensor_id: "NOR-01", lat: 25.61 });
    expect(found?.device.created_at).toBe("2026-09-25T08:00:00.000Z");
    expect(found?.settings).toEqual({ reading_interval_s: 30 });
  });

  it("returns null for an unknown key", async () => {
    rpc.mockReturnValue(respond({ data: null, error: null }));
    expect(await new SupabaseStore().authenticateDevice("yai_unknown-0123456789")).toBeNull();
  });

  it("sends only the measurement and the contact to device_report", async () => {
    rpc.mockReturnValue(respond({ data: 1, error: null }));
    const stored = await new SupabaseStore().saveDeviceReport("yai_key-0123456789abcdef", "dev_1", [reading], {
      at: "2026-09-25T09:00:00.000Z",
      ip: "203.0.113.7",
      rssi: -61,
      firmware: "1.2.0",
      error: null,
      reading: null,
    });
    expect(stored).toBe(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("device_report");
    // Farm and probe come from the key in the database, never from the request.
    expect(args.p_readings).toEqual([
      { timestamp: reading.timestamp, moisture: 21.5, temperature: 27.3, ec: 1.8, ph: 7.4, n: 40, p: 12, k: 180, air_temp: null, air_humidity: null },
    ]);
    expect(args.p_contact).toEqual({ ip: "203.0.113.7", rssi: -61, firmware: "1.2.0", error: null });
  });

  it("surfaces database errors", async () => {
    rpc.mockReturnValue(respond({ data: null, error: { message: "unknown device key" } }));
    await expect(new SupabaseStore().saveDeviceReport("yai_key-0123456789abcdef", "dev_1", [], {
      at: "2026-09-25T09:00:00.000Z",
      ip: null,
      rssi: null,
      firmware: null,
      error: null,
      reading: null,
    })).rejects.toBeInstanceOf(StoreError);
  });
});

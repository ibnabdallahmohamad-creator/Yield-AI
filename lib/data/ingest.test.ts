import { describe, expect, it } from "vitest";
import { generateDemoDataset } from "./generate";
import { DevicePayloadSchema, deviceReadings, IngestPayloadSchema, normalizeIngestPayload, toSensorReadings } from "./ingest";

const now = new Date("2026-09-24T12:00:00Z");
const ds = generateDemoDataset(now);

describe("probe ingest", () => {
  it("accepts a single reading, converts µS/cm and fills in the probe position", () => {
    const payload = IngestPayloadSchema.parse({ farm_id: "khor-north", sensor_id: "KN-01", ec_us_cm: "1850", moisture: 11.2 });
    const { readings, errors } = toSensorReadings(normalizeIngestPayload(payload), ds.farms, ds.sensorsByFarm, now);
    expect(errors).toEqual([]);
    expect(readings[0].ec).toBeCloseTo(1.85, 6);
    const known = ds.sensorsByFarm["khor-north"].find((s) => s.id === "KN-01")!;
    expect(readings[0]).toMatchObject({ lat: known.lat, lng: known.lng, timestamp: now.toISOString() });
  });

  it("accepts arrays and { readings: [...] }", () => {
    const one = { farm_id: "khor-north", sensor_id: "KN-01", ph: 7.9 };
    expect(normalizeIngestPayload(IngestPayloadSchema.parse([one, one]))).toHaveLength(2);
    expect(normalizeIngestPayload(IngestPayloadSchema.parse({ readings: [one] }))).toHaveLength(1);
  });

  it("rejects readings without measurements, unknown farms and future timestamps", () => {
    expect(IngestPayloadSchema.safeParse({ farm_id: "khor-north", sensor_id: "KN-01" }).success).toBe(false);
    const { errors } = toSensorReadings(
      [
        { farm_id: "nowhere", sensor_id: "X", ph: 7 },
        { farm_id: "khor-north", sensor_id: "KN-01", ph: 7, timestamp: "2026-09-25T12:00:00Z" },
      ],
      ds.farms,
      ds.sensorsByFarm,
      now,
    );
    expect(errors).toHaveLength(2);
  });
});

describe("device payloads", () => {
  const device = { farm_id: "f1", sensor_id: "AKN-01", lat: 25.6, lng: 51.4 };
  const now = new Date("2026-09-25T09:00:00Z");
  const parse = (body: unknown) => DevicePayloadSchema.parse(body);

  it("stores one measurement under the device's farm and probe, at arrival time by default", () => {
    const { readings, latest, skipped } = deviceReadings(parse({ moisture: 12.3, ec_us_cm: 1850, rssi: -60, fw: "1.0.0" }), device, now);
    expect(skipped).toEqual([]);
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ farm_id: "f1", sensor_id: "AKN-01", lat: 25.6, lng: 51.4, moisture: 12.3, ec: 1.85, timestamp: now.toISOString() });
    expect(latest?.moisture).toBe(12.3);
  });

  it("accepts Unix seconds, ISO and null timestamps, and treats an unsynced clock as now", () => {
    const { readings } = deviceReadings(
      parse({
        readings: [
          { timestamp: Math.floor(now.getTime() / 1000) - 600, moisture: 10 },
          { timestamp: "2026-09-25T08:55:00Z", moisture: 11 },
          { timestamp: null, moisture: 12 },
          { timestamp: 3600, moisture: 13 },
        ],
      }),
      device,
      now,
    );
    expect(readings.map((r) => r.timestamp)).toEqual([
      "2026-09-25T08:50:00.000Z",
      "2026-09-25T08:55:00.000Z",
      now.toISOString(),
      now.toISOString(),
    ]);
  });

  it("skips readings from the future or older than 60 days, and a heartbeat stores nothing", () => {
    const { readings, skipped } = deviceReadings(
      parse({ readings: [{ timestamp: "2026-09-25T10:00:00Z", moisture: 1 }, { timestamp: "2026-06-01T00:00:00Z", moisture: 2 }] }),
      device,
      now,
    );
    expect(readings).toEqual([]);
    expect(skipped).toHaveLength(2);
    const heartbeat = deviceReadings(parse({ rssi: -70, error: "probe not responding" }), device, now);
    expect(heartbeat.readings).toEqual([]);
    expect(heartbeat.latest).toBeNull();
  });

  it("rejects out-of-range values", () => {
    expect(DevicePayloadSchema.safeParse({ moisture: 140 }).success).toBe(false);
    expect(DevicePayloadSchema.safeParse({ ph: 15 }).success).toBe(false);
  });
});

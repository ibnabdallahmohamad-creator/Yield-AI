import { describe, expect, it } from "vitest";
import { generateDemoDataset } from "./generate";
import { IngestPayloadSchema, normalizeIngestPayload, toSensorReadings } from "./ingest";

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

import { describe, expect, it } from "vitest";
import { addReadings, buildSeries, chooseBucketSeconds, mergeBuckets, withGaps, type BucketMap } from "./series";

const T0 = Date.parse("2026-09-25T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** One reading every `stepS` seconds for `count` readings from T0. */
function readings(sensor: string, count: number, stepS: number, value: (i: number) => number, from = T0) {
  return Array.from({ length: count }, (_, i) => ({ sensor_id: sensor, timestamp: iso(from + i * stepS * 1000), moisture: value(i) }));
}

describe("chooseBucketSeconds", () => {
  it("keeps a range within the point budget", () => {
    expect(chooseBucketSeconds(3_600_000)).toBe(10); // 1 h / 360 = 10 s
    expect(chooseBucketSeconds(24 * 3_600_000)).toBe(300); // 24 h / 360 = 240 s → 5 min
    expect(chooseBucketSeconds(7 * 86_400_000)).toBe(1800);
  });

  it("is never finer than the device interval", () => {
    expect(chooseBucketSeconds(600_000, 10)).toBe(10); // 10 min would allow 2 s buckets
  });

  it("caps at one day", () => {
    expect(chooseBucketSeconds(10 * 366 * 86_400_000)).toBe(86400);
  });
});

describe("addReadings / buildSeries", () => {
  it("shows raw readings when each bucket holds one", () => {
    const map: BucketMap = new Map();
    addReadings(map, readings("ESP32-1", 6, 10, (i) => 20 + i), 10_000, T0);
    const s = buildSeries("farm", map, T0, T0 + 60_000, 10_000);
    expect(s.raw).toBe(true);
    expect(s.readings).toBe(6);
    expect(s.sensors).toEqual(["ESP32-1"]);
    const m = s.metrics.moisture!;
    expect(m.points.map((p) => p[1])).toEqual([20, 21, 22, 23, 24, 25]);
    expect(m.summary).toMatchObject({ count: 6, mean: 22.5, change: 5 });
    expect(m.summary.min).toEqual({ t: T0, value: 20 });
    expect(m.summary.max).toEqual({ t: T0 + 50_000, value: 25 });
    expect(m.summary.latest).toEqual({ t: T0 + 50_000, value: 25 });
    expect(s.first_reading).toBe(iso(T0));
    expect(s.last_reading).toBe(iso(T0 + 50_000));
  });

  it("keeps every extreme inside a bucket (mean, min and max)", () => {
    const map: BucketMap = new Map();
    addReadings(map, readings("A", 6, 10, (i) => [10, 30, 20, 20, 20, 20][i]), 60_000, T0);
    const s = buildSeries("farm", map, T0, T0 + 60_000, 60_000);
    expect(s.raw).toBe(false);
    expect(s.metrics.moisture!.points).toEqual([[T0, 20, 10, 30, 6]]);
  });

  it("averages probes farm-wide and keeps each probe's own line", () => {
    const map: BucketMap = new Map();
    addReadings(map, readings("ESP32-2", 3, 60, () => 30), 60_000, T0);
    addReadings(map, readings("ESP32-1", 3, 60, () => 10), 60_000, T0);
    const s = buildSeries("farm", map, T0, T0 + 180_000, 60_000);
    expect(s.sensors).toEqual(["ESP32-1", "ESP32-2"]);
    const m = s.metrics.moisture!;
    expect(m.points.map((p) => [p[1], p[2], p[3], p[4]])).toEqual([
      [20, 10, 30, 2],
      [20, 10, 30, 2],
      [20, 10, 30, 2],
    ]);
    expect(m.bySensor).toEqual({ "ESP32-1": [10, 10, 10], "ESP32-2": [30, 30, 30] });
  });

  it("skips readings outside the window and metrics without values", () => {
    const map: BucketMap = new Map();
    addReadings(map, [...readings("A", 3, 60, () => 5), { sensor_id: "A", timestamp: "not a date", moisture: 99 }], 60_000, T0, T0 + 60_000, T0 + 180_000);
    const s = buildSeries("farm", map, T0 + 60_000, T0 + 180_000, 60_000);
    expect(s.readings).toBe(2);
    expect(Object.keys(s.metrics)).toEqual(["moisture"]);
  });

  it("has no metrics and no first reading when nothing arrived", () => {
    const s = buildSeries("farm", new Map(), T0, T0 + 3_600_000, 10_000);
    expect(s).toMatchObject({ readings: 0, sensors: [], first_reading: null, last_reading: null, metrics: {} });
  });
});

describe("gaps", () => {
  it("breaks the line where the probes went quiet", () => {
    const step = 10_000;
    const times = [0, 1, 2, 3, 20, 21].map((i) => T0 + i * step);
    expect(withGaps(times, step)).toEqual([0, 1, 2, 3, 4, 20, 21].map((i) => T0 + i * step));
  });

  it("does not break a steady series", () => {
    const times = [0, 1, 2, 3, 4].map((i) => T0 + i * 10_000);
    expect(withGaps(times, 10_000)).toEqual(times);
  });

  it("shows the outage as an empty point in the payload", () => {
    const map: BucketMap = new Map();
    addReadings(map, [...readings("A", 4, 10, () => 20), ...readings("A", 2, 10, () => 22, T0 + 600_000)], 10_000, T0);
    const points = buildSeries("farm", map, T0, T0 + 620_000, 10_000).metrics.moisture!.points;
    expect(points).toHaveLength(7);
    expect(points[4]).toEqual([T0 + 40_000, null, null, null, 0]);
  });
});

describe("mergeBuckets", () => {
  it("re-bins fine buckets without losing anything", () => {
    const fine: BucketMap = new Map();
    const direct: BucketMap = new Map();
    const data = readings("A", 60, 10, (i) => Math.sin(i / 5) * 10 + 20);
    addReadings(fine, data, 10_000, T0);
    addReadings(direct, data, 300_000, T0);
    const merged: BucketMap = new Map();
    mergeBuckets(merged, fine, 300_000, T0);
    expect(buildSeries("farm", merged, T0, T0 + 600_000, 300_000)).toEqual(buildSeries("farm", direct, T0, T0 + 600_000, 300_000));
  });
});

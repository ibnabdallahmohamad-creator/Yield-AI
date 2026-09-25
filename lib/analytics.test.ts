import { beforeAll, describe, expect, it } from "vitest";
import { farmAnalytics, linearRegression, pearson } from "./analytics";
import { aggregateDaily } from "./data/aggregate";
import { buildDashboardData } from "./data/derive";
import { generateDemoDataset } from "./data/generate";
import type { DashboardData, FarmBundle } from "./types";

let data: DashboardData;
const farm = (id: string): FarmBundle => data.farms.find((b) => b.farm.id === id)!;

beforeAll(() => {
  const ds = generateDemoDataset(new Date("2026-09-24T12:00:00Z"));
  data = buildDashboardData({
    farms: ds.farms,
    daily: aggregateDaily(ds.readings),
    weather: { byFarm: {}, source: "unavailable", note: null },
    insights: [],
    source: "demo",
    sourceNote: null,
    sensorsByFarm: ds.sensorsByFarm,
  });
});

describe("statistics", () => {
  it("fits a least-squares line", () => {
    const reg = linearRegression([
      [0, 1],
      [1, 3],
      [2, 5],
      [3, 7],
    ])!;
    expect(reg.slope).toBeCloseTo(2);
    expect(reg.intercept).toBeCloseTo(1);
    expect(reg.r2).toBeCloseTo(1);
    expect(linearRegression([[0, 1], [1, 2]])).toBeNull();
  });

  it("computes Pearson r", () => {
    const up: Array<[number, number]> = [1, 2, 3, 4, 5, 6].map((x) => [x, 2 * x + 1]);
    const down: Array<[number, number]> = [1, 2, 3, 4, 5, 6].map((x) => [x, -x]);
    expect(pearson(up)).toBeCloseTo(1);
    expect(pearson(down)).toBeCloseTo(-1);
    expect(pearson(up.slice(0, 4))).toBeNull();
  });
});

describe("farm analytics on the demo farms", () => {
  it("sees rising salinity on Al Khor North and projects the yield loss", () => {
    const a = farmAnalytics(farm("khor-north"), data.dates);
    const ece = a.trends.find((t) => t.key === "ece")!;
    expect(ece.slopePerDay).toBeGreaterThan(0.01);
    expect(a.salinity!.ece30).toBeGreaterThan(a.salinity!.latest);
    expect(a.salinity!.yieldLoss30).toBeGreaterThanOrEqual(a.salinity!.yieldLossNow);
    expect(a.highlights[0].tone).toBe("bad");
    expect(a.highlights.map((h) => h.text).join(" ")).toMatch(/ECe/);
    expect(ece.spark).toHaveLength(30);
  });

  it("reports the drying farm's water stress", () => {
    const a = farmAnalytics(farm("sheehaniya-west"), data.dates);
    expect(a.highlights.some((h) => /water-stressed|irrigation/.test(h.text))).toBe(true);
  });

  it("measures probe spread, correlations and data quality", () => {
    const a = farmAnalytics(farm("khor-north"), data.dates);
    const ece = a.spread.find((s) => s.key === "ece")!;
    expect(ece.probes).toBeGreaterThanOrEqual(4);
    expect(ece.high.value).toBeGreaterThanOrEqual(ece.low.value);
    expect(a.correlations.length).toBeGreaterThan(0);
    for (const c of a.correlations) expect(Math.abs(c.r)).toBeLessThanOrEqual(1);
    expect(a.quality.daysWithData30).toBe(30);
    expect(a.quality.readings7).toHaveLength(7);
  });

  it("returns an empty analysis for a farm without readings", () => {
    const bundle = farm("khor-north");
    const empty: FarmBundle = { ...bundle, days: bundle.days.map(() => null) };
    const a = farmAnalytics(empty, data.dates);
    expect(a.asOf).toBeNull();
    expect(a.trends).toEqual([]);
    expect(a.quality.daysWithData30).toBe(0);
  });
});

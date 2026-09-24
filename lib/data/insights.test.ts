import { beforeAll, describe, expect, it } from "vitest";
import type { AiInsight } from "../ai/contract";
import type { DashboardData } from "../types";
import { aggregateDaily } from "./aggregate";
import { buildDashboardData } from "./derive";
import { generateDemoDataset } from "./generate";
import { generateInsights } from "./insights";

let data: DashboardData;
let byFarm: Map<string, AiInsight>;

beforeAll(() => {
  const ds = generateDemoDataset(new Date("2026-09-24T12:00:00Z"));
  data = buildDashboardData({
    farms: ds.farms,
    daily: aggregateDaily(ds.readings),
    weather: { byFarm: {}, source: "unavailable", note: null }, // fully offline (probe air data only)
    insights: [],
    source: "mock",
    sourceNote: null,
    sensorsByFarm: ds.sensorsByFarm,
  });
  byFarm = new Map(generateInsights(data, "2026-09-24T09:00:00.000Z").map((i) => [i.farm_id, i]));
});

describe("seed insights", () => {
  it("flags the two salinising farms and the dry farm as high risk", () => {
    expect(byFarm.get("khor-north")?.risk_level).toBe("high");
    expect(byFarm.get("shamal-greenhouses")?.risk_level).toBe("high");
    expect(byFarm.get("sheehaniya-west")?.risk_level).toBe("high");
  });

  it("keeps the healthy farms in the low band", () => {
    for (const id of ["khor-pivot", "shamal-east", "ummsalal-east", "sheehaniya-south"]) {
      expect(byFarm.get(id)?.risk_level).toBe("low");
    }
  });

  it("quotes the farm's actual numbers and sorts recommendations by priority", () => {
    const bundle = data.farms.find((b) => b.farm.id === "khor-north")!;
    const today = bundle.days.at(-1)!;
    const insight = byFarm.get("khor-north")!;
    expect(insight.summary).toContain(`${today.ece!.toFixed(1)} dS/m`);
    expect(insight.summary).toContain("tomato");
    const order = { high: 0, medium: 1, low: 2 };
    const priorities = insight.recommendations.map((r) => order[r.priority]);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    expect(insight.recommendations[0].title).toMatch(/leaching/i);
  });

  it("tells the dry farm to irrigate and names the driest probe", () => {
    const insight = byFarm.get("sheehaniya-west")!;
    expect(insight.recommendations[0].title).toMatch(/^Irrigate today/);
    expect(insight.summary).toMatch(/water-stressed/);
    expect(insight.summary).toMatch(/HW-\d\d/);
  });

  it("suggests a crop with a reason and a market note for every farm", () => {
    for (const insight of byFarm.values()) {
      expect(insight.crop_suggestion?.crop).toBeTruthy();
      expect(insight.crop_suggestion?.reason.length).toBeGreaterThan(20);
      expect(insight.crop_suggestion?.market_note.length).toBeGreaterThan(10);
    }
  });
});

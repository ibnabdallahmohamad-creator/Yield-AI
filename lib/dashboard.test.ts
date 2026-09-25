import { beforeAll, describe, expect, it } from "vitest";
import { lastDataIndex } from "./ai/analysis";
import { farmFacts, farmValueAt, hasPreviousPeriod, probeSamples, rankFarms, suggestedQuestions } from "./dashboard";
import { aggregateDaily } from "./data/aggregate";
import { buildDashboardData } from "./data/derive";
import { generateDemoDataset } from "./data/generate";
import { generateInsights } from "./data/insights";
import { METRICS } from "./metrics";
import type { DashboardData, FarmBundle, FarmDay } from "./types";

let data: DashboardData;

beforeAll(() => {
  const ds = generateDemoDataset(new Date("2026-09-24T12:00:00Z"));
  const base = buildDashboardData({
    farms: ds.farms,
    daily: aggregateDaily(ds.readings),
    weather: { byFarm: {}, source: "unavailable", note: null },
    insights: [],
    source: "demo",
    sourceNote: null,
    sensorsByFarm: ds.sensorsByFarm,
  });
  const insights = new Map(generateInsights(base, "2026-09-24T09:00:00.000Z").map((i) => [i.farm_id, i]));
  data = { ...base, farms: base.farms.map((b) => ({ ...b, insight: insights.get(b.farm.id) ?? null })) };
});

const bundleOf = (id: string): FarmBundle => data.farms.find((b) => b.farm.id === id)!;
const latestDay = (b: FarmBundle): FarmDay => b.days[lastDataIndex(b)]!;

describe("dashboard helpers", () => {
  it("ranks farms by risk score, highest first, with un-scored farms last", () => {
    const ranked = rankFarms(data.farms);
    const scores = ranked.map((b) => b.insight!.risk_score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    const withoutInsight = { ...ranked[0], insight: null };
    expect(rankFarms([withoutInsight, ...ranked.slice(1)]).at(-1)).toBe(withoutInsight);
  });

  it("gives one farm value per day and one sample per reporting probe", () => {
    const b = bundleOf("khor-north");
    const i = lastDataIndex(b);
    expect(farmValueAt(b, METRICS.ece, i)).toBe(b.days[i]!.ece);
    const samples = probeSamples(b, METRICS.ece, i);
    expect(samples.length).toBe(b.days[i]!.sensors.length);
    expect(samples.every((s) => Number.isFinite(s.value) && Number.isFinite(s.lat) && Number.isFinite(s.lng))).toBe(true);
  });

  it("opens the chat with the question that matches the farm's main problem", () => {
    expect(suggestedQuestions(latestDay(bundleOf("khor-north")))[0]).toBe("Why is salinity rising?");
    expect(suggestedQuestions(latestDay(bundleOf("sheehaniya-west")))[0]).toBe("Why is the soil so dry?");
    expect(suggestedQuestions(latestDay(bundleOf("shamal-east")))[0]).toBe("What is the biggest risk right now?");
    expect(suggestedQuestions(null)).toHaveLength(3);
  });

  it("summarises a farm in one line with crop, area, soil, probes and growth stage", () => {
    const b = bundleOf("khor-north");
    const day = latestDay(b);
    const facts = farmFacts(b, day);
    expect(facts).toContain("Tomato");
    expect(facts).toContain(`${b.sensors.length} probes`);
    expect(facts).toMatch(new RegExp(`day ${day.dap}$`));
    expect(farmFacts(b, null)).not.toContain("day");
  });

  it("only offers a previous period when the window before it fits in the data", () => {
    expect(hasPreviousPeriod(30, 59)).toBe(true); // days 0–29 precede a 30-day window ending today
    expect(hasPreviousPeriod(0, 59)).toBe(false);
    expect(hasPreviousPeriod(53, 59)).toBe(true);
  });
});

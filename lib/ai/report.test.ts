import { beforeAll, describe, expect, it } from "vitest";
import { aggregateDaily } from "../data/aggregate";
import { buildDashboardData } from "../data/derive";
import { generateDemoDataset } from "../data/generate";
import { generateInsights } from "../data/insights";
import { addDays } from "../data/time";
import type { WeatherResult } from "../data/weather";
import type { DashboardData, WeatherDay } from "../types";
import { buildChatContext } from "./context";
import type { AiInsight, ChatContext } from "./contract";
import { answerOffline, detectTopics } from "./offline";
import { formatDays } from "./report";

const TODAY = "2026-09-24";
let data: DashboardData;
let insights: Map<string, AiInsight>;

/** Hot weather for 60 past days and a 7-day forecast with humid nights and one strong-wind day. */
function syntheticWeather(farmIds: string[]): WeatherResult {
  const byFarm: WeatherResult["byFarm"] = {};
  for (const id of farmIds) {
    const days: Record<string, WeatherDay> = {};
    for (let i = -60; i <= 7; i++) {
      const date = addDays(TODAY, i);
      days[date] = {
        date,
        tmax: i > 0 ? 43 : 40,
        tmin: 29,
        tmean: 35,
        precip: 0,
        precipProb: i > 0 ? 0 : null,
        rhMax: i > 0 ? 92 : 70,
        rhMin: 25,
        wind10: i === 3 ? 9 : 3,
        rs: 22,
        et0: 6.5,
      };
    }
    byFarm[id] = days;
  }
  return { byFarm, source: "open-meteo", note: null };
}

beforeAll(() => {
  const ds = generateDemoDataset(new Date(`${TODAY}T12:00:00Z`));
  data = buildDashboardData({
    farms: ds.farms,
    daily: aggregateDaily(ds.readings),
    weather: syntheticWeather(ds.farms.map((f) => f.id)),
    insights: [],
    source: "mock",
    sourceNote: null,
    sensorsByFarm: ds.sensorsByFarm,
  });
  insights = new Map(generateInsights(data, `${TODAY}T09:00:00.000Z`).map((i) => [i.farm_id, i]));
  for (const b of data.farms) b.insight = insights.get(b.farm.id) ?? null;
});

const contextOf = (id: string): ChatContext => buildChatContext(data.farms.find((b) => b.farm.id === id)!, data)!;

describe("report sections", () => {
  it("writes every section for every farm", () => {
    expect(insights.size).toBe(8);
    for (const ins of insights.values()) {
      expect(ins.insights.length).toBeGreaterThan(0);
      expect(ins.forecast?.days).toHaveLength(7);
      expect(ins.economics?.lines.map((l) => l.label)).toContain("Expected harvest");
      expect(ins.harvest?.summary).toBeTruthy();
      expect(ins.warnings.length).toBeLessThanOrEqual(6);
    }
  });

  it("orders warnings most severe first and flags the dry farm as critical", () => {
    const order = { critical: 0, warning: 1, watch: 2 };
    for (const ins of insights.values()) {
      const ranks = ins.warnings.map((w) => order[w.severity]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
    expect(insights.get("sheehaniya-west")?.warnings[0]?.severity).toBe("critical");
  });

  it("warns about the forecast heat, strong wind and humid nights", () => {
    const titles = insights.get("khor-north")!.warnings.map((w) => w.title).join(" | ");
    expect(titles).toMatch(/heat/i);
    expect(titles).toMatch(/wind|dust/i);
    expect(titles).toMatch(/humid nights/i);
  });

  it("gives a perennial stand no next crops", () => {
    expect(insights.get("khor-pivot")?.harvest?.next_crops).toEqual([]);
    expect(insights.get("khor-north")?.harvest?.next_crops.length).toBeGreaterThan(0);
  });

  it("formats day runs compactly", () => {
    expect(formatDays(["2026-09-25", "2026-09-26", "2026-09-27"])).toBe("Fri 25 – Sun 27 Sep");
    expect(formatDays(["2026-09-25", "2026-09-28"])).toBe("Fri 25 Sep, Mon 28 Sep");
  });
});

describe("chat context", () => {
  it("carries the location, outlook, economics and goals", () => {
    const ctx = contextOf("khor-north");
    expect(ctx.location.municipality).toBe("Al Khor");
    expect(ctx.outlook?.days).toHaveLength(7);
    expect(ctx.outlook?.strong_wind_days).toHaveLength(1);
    expect(ctx.economics.currency).toBe("QAR");
    expect(ctx.national_goals.length).toBeGreaterThan(0);
    expect(ctx.market.season).toMatch(/summer/);
  });
});

describe("offline answers", () => {
  it("routes questions to the right topic", () => {
    expect(detectTopics("Where is the farm?")[0]).toBe("location");
    expect(detectTopics("Where are the problem spots?")[0]).toBe("hotspots");
    expect(detectTopics("When can I spray?")[0]).toBe("forecast");
    expect(detectTopics("How much will this crop earn?")[0]).toBe("economics");
    expect(detectTopics("When is the harvest?")[0]).toBe("harvest");
    expect(detectTopics("What should I plant next season?")[0]).toBe("crop");
    expect(detectTopics("How much should I irrigate?")[0]).toBe("irrigation");
  });

  it("opens with a bold direct answer and uses only the known sections, in order", () => {
    const order = ["Why", "Do now", "Warnings", "Next 7 days", "Cost", "Harvest & next crop"];
    const ctx = contextOf("khor-north");
    const questions = [
      "Why is salinity rising?",
      "How much should I irrigate?",
      "What does the next week look like?",
      "How much will this crop earn?",
      "When is the harvest?",
      "Where is the farm?",
    ];
    for (const q of questions) {
      const answer = answerOffline(q, ctx);
      const [lead] = answer.split("\n\n");
      expect(lead, q).toMatch(/\*\*[^*]+\*\*/);
      expect(lead.startsWith("###"), q).toBe(false);
      const positions = [...answer.matchAll(/^### (.+)$/gm)].map((m) => order.indexOf(m[1]));
      expect(positions.every((p) => p >= 0), q).toBe(true);
      expect(positions, q).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it("plans irrigation with the same depth as the 7-day outlook", () => {
    const ctx = contextOf("khor-north");
    const answer = answerOffline("How much should I irrigate?", ctx);
    expect(answer).toMatch(/\d+ mm/);
    const first = ctx.outlook!.days.find((d) => (d.irrigate_mm ?? 0) > 0);
    if (first && (ctx.derived.water_deficit_pct_of_raw ?? 0) <= 100) expect(answer).toContain(`${Math.round(first.irrigate_mm!)} mm gross`);
  });

  it("says so when a farm has only the four basic sensors", () => {
    const ctx = contextOf("khor-north");
    const basic: ChatContext = {
      ...ctx,
      derived: { ...ctx.derived, ece_dS_m: null, salinity_class: null, predicted_yield_loss_pct: null },
      latest_readings: { ...ctx.latest_readings, ph: null, n_mg_kg: null, p_mg_kg: null, k_mg_kg: null, bulk_ec_dS_m: null },
    };
    expect(answerOffline("Why is salinity rising?", basic)).toMatch(/no salinity sensor/i);
    expect(answerOffline("What's the pH situation?", basic)).toMatch(/no pH sensor/i);
    expect(answerOffline("Should I add nitrogen?", basic)).toMatch(/no nutrient \(NPK\) sensor/i);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import type { Conversation } from "./ai/contract";
import { weatherSummary } from "./ai/context";
import { asOfLabel, followUps, groupConversations, starterPrompts } from "./assistant";
import { aggregateDaily } from "./data/aggregate";
import { buildDashboardData } from "./data/derive";
import { generateDemoDataset } from "./data/generate";
import { generateInsights } from "./data/insights";
import type { DashboardData, FarmBundle, WeatherDay } from "./types";

const conv = (id: string, updated_at: string, pinned = false): Conversation => ({
  id,
  farm_id: "f",
  title: id,
  pinned,
  created_at: updated_at,
  updated_at,
  preview: "",
  message_count: 2,
});

describe("groupConversations", () => {
  it("puts pinned chats first and groups the rest by Qatar day, newest first", () => {
    const list = [
      conv("old", "2026-08-01T10:00:00Z"),
      conv("today-early", "2026-09-24T05:00:00Z"),
      conv("pinned-old", "2026-07-01T10:00:00Z", true),
      // 22:30 UTC on the 23rd is already the 24th in Qatar (UTC+3).
      conv("today-late-utc", "2026-09-23T22:30:00Z"),
      conv("yesterday", "2026-09-23T08:00:00Z"),
      conv("week", "2026-09-19T08:00:00Z"),
    ];
    const { pinned, groups } = groupConversations(list, "2026-09-24");
    expect(pinned.map((c) => c.id)).toEqual(["pinned-old"]);
    expect(groups.map((g) => [g.label, g.items.map((c) => c.id)])).toEqual([
      ["Today", ["today-early", "today-late-utc"]],
      ["Yesterday", ["yesterday"]],
      ["Previous 7 days", ["week"]],
      ["Older", ["old"]],
    ]);
  });

  it("drops empty groups", () => {
    expect(groupConversations([], "2026-09-24")).toEqual({ pinned: [], groups: [] });
  });
});

describe("followUps", () => {
  it("suggests questions about the same topic and never repeats an asked one", () => {
    const asked = ["Why is salinity rising?", "How much extra water does leaching need"];
    const next = followUps("Why is salinity rising?", asked);
    expect(next).toHaveLength(3);
    expect(next).not.toContain("How much extra water does leaching need?");
    expect(next[0]).toBe("Which probe is the saltiest, and why?");
  });

  it("falls back to general questions", () => {
    expect(followUps("Hello", [])).toEqual(["What should I do first this week?", "Which probe needs attention?", "How much should I irrigate?"]);
  });
});

describe("asOfLabel", () => {
  it("names today and yesterday, and dates otherwise", () => {
    expect(asOfLabel("2026-09-24", "2026-09-24")).toBe("Today");
    expect(asOfLabel("2026-09-23", "2026-09-24")).toBe("Yesterday");
    expect(asOfLabel("2026-09-01", "2026-09-24")).toBe("1 Sep");
  });
});

describe("weatherSummary", () => {
  const day = (date: string, tmax: number, precip: number, precipProb: number | null = null): WeatherDay => ({
    date,
    tmax,
    tmin: tmax - 12,
    tmean: tmax - 6,
    precip,
    precipProb,
    rhMax: null,
    rhMin: null,
    wind10: null,
    rs: null,
    et0: null,
  });
  const bundle = {
    farm: { main_crop: "tomato" },
    weatherDays: [
      day("2026-09-20", 34, 0),
      day("2026-09-21", 38, 2.4),
      day("2026-09-22", 36, 0),
      day("2026-09-23", 33, 0.2),
      day("2026-09-24", 37, 0),
      day("2026-09-25", 39, 0, 10),
      day("2026-09-26", 33, 3, 60),
    ],
  } as unknown as Pick<FarmBundle, "farm" | "weatherDays">;

  it("summarises rain and heat up to the day, and the forecast only for today", () => {
    const w = weatherSummary(bundle, "2026-09-24", "2026-09-24", 30)!;
    expect(w.window_days).toBe(5);
    expect(w.rain_total_mm).toBe(2.6);
    expect(w.rain_days).toBe(1);
    expect(w.last_rain_date).toBe("2026-09-21");
    expect(w.air_tmax_c).toBe(37);
    expect(w.heat_stress_threshold_c).toBe(35);
    expect(w.days_above_heat_threshold).toBe(3);
    expect(w.forecast.map((f) => f.date)).toEqual(["2026-09-25", "2026-09-26"]);
    expect(w.forecast_rain_total_mm).toBe(3);
    expect(w.forecast_days_above_heat_threshold).toBe(1);

    const past = weatherSummary(bundle, "2026-09-22", "2026-09-24", 2)!;
    expect(past.window_days).toBe(2);
    expect(past.forecast).toEqual([]);
    expect(past.forecast_rain_total_mm).toBeNull();
  });

  it("is null without weather", () => {
    expect(weatherSummary({ ...bundle, weatherDays: [] }, "2026-09-24", "2026-09-24")).toBeNull();
  });
});

describe("starterPrompts", () => {
  let data: DashboardData;
  beforeAll(() => {
    const ds = generateDemoDataset(new Date("2026-09-24T12:00:00Z"));
    const base = buildDashboardData({
      farms: ds.farms,
      daily: aggregateDaily(ds.readings),
      weather: { byFarm: {}, source: "unavailable", note: null },
      insights: [],
      source: "mock",
      sourceNote: null,
      sensorsByFarm: ds.sensorsByFarm,
    });
    const insights = new Map(generateInsights(base, "2026-09-24T09:00:00.000Z").map((i) => [i.farm_id, i]));
    data = { ...base, farms: base.farms.map((b) => ({ ...b, insight: insights.get(b.farm.id) ?? null })) };
  });

  it("gives four distinct prompts, the last about the farm's first action", () => {
    for (const b of data.farms) {
      const prompts = starterPrompts(b);
      expect(prompts).toHaveLength(4);
      expect(new Set(prompts).size).toBe(4);
      if (b.insight?.recommendations.length) expect(prompts[3]).toMatch(/^Walk me through the first action: /);
    }
  });
});

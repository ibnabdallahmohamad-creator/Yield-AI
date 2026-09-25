import { describe, expect, it } from "vitest";
import { aggregateDaily } from "../data/aggregate";
import { buildDashboardData } from "../data/derive";
import { generateDemoDataset } from "../data/generate";
import { dateRangeEnding } from "../data/time";
import { knowledgeFor, landContextAt, regionNotesFor } from "../land/context";
import type { ChatContext, WeatherContext } from "./contract";
import { buildChatContext } from "./context";
import { answerOffline, detectTopics } from "./offline";

const now = new Date("2026-09-24T12:00:00Z");
const ds = generateDemoDataset(now);
const farm = ds.farms.find((f) => f.id === "khor-north")!;
const dates = dateRangeEnding(ds.today, 60);
const weatherNone = { byFarm: {}, source: "unavailable" as const, note: null };

/** A brand-new farm: registered, no probe readings yet. */
const empty = buildDashboardData({
  farms: [{ ...farm, id: "new-farm-abc123", name: "Green Valley Farm" }],
  daily: [],
  weather: weatherNone,
  insights: [],
  source: "local",
  sourceNote: null,
  dates,
  sensorsByFarm: { "new-farm-abc123": [] },
});

const withReadings = buildDashboardData({
  farms: [farm],
  daily: aggregateDaily(ds.readings.filter((r) => r.farm_id === farm.id)),
  weather: weatherNone,
  insights: [],
  source: "mock",
  sourceNote: null,
  dates,
});

const forecast: WeatherContext = {
  sources: ["WeatherAPI.com", "Open-Meteo"],
  current: { observed_at: now.toISOString(), temp_c: 36, feels_like_c: 39, humidity_pct: 45, wind_kph: 22, gust_kph: 35, wind_dir: "NW", precip_mm: 0, condition: "Sunny" },
  forecast_7d: dates.slice(-7).map((date, i) => ({
    date,
    tmax_c: 40 + i,
    tmin_c: 30,
    rh_min_pct: 25,
    rh_max_pct: 70,
    wind_mean_kph: 15,
    wind_max_kph: i === 2 ? 42 : 25,
    wind_dir: "NW",
    precip_mm: i === 4 ? 3 : 0,
    chance_of_rain_pct: 0,
    et0_mm: 7,
    condition: "Sunny",
    source: "weatherapi",
  })),
  alerts: [],
  note: null,
};

function grounded(ctx: ChatContext, question: string): ChatContext {
  return {
    ...ctx,
    land: landContextAt(farm.lat, farm.lng),
    weather: forecast,
    knowledge: knowledgeFor(question),
    region_notes: regionNotesFor(question),
  };
}

describe("chat context for a farm without readings", () => {
  it("still builds a context from the farm settings", () => {
    const ctx = buildChatContext(empty.farms[0], empty);
    expect(ctx.has_readings).toBe(false);
    expect(ctx.latest_readings.probes).toBe(0);
    expect(ctx.derived.taw_mm).toBeGreaterThan(0);
    expect(ctx.derived.kc).not.toBeNull();
    expect(ctx.farm.name).toBe("Green Valley Farm");
    expect(buildChatContext(withReadings.farms[0], withReadings).has_readings).toBe(true);
  });

  it("answers salinity questions from the land atlas, not invented readings", () => {
    const q = "Why is salinity rising?";
    const answer = answerOffline(q, grounded(buildChatContext(empty.farms[0], empty), q));
    expect(answer).toMatch(/no probe readings yet/i);
    expect(answer).toMatch(/groundwater/i);
    expect(answer).toMatch(/leaching requirement/i);
    expect(answer).not.toMatch(/—\s*(dS\/m|mm|%)/); // no missing-value placeholders
  });

  it("plans irrigation from the forecast until the probes report", () => {
    const q = "How much should I irrigate?";
    const answer = answerOffline(q, grounded(buildChatContext(empty.farms[0], empty), q));
    expect(answer).toMatch(/Next 7 days/);
    expect(answer).toMatch(/mm\/day/);
  });
});

describe("land and weather answers", () => {
  it("routes questions to the new topics", () => {
    expect(detectTopics("What's the weather this week?")).toContain("weather");
    expect(detectTopics("Is the soil here fertile?")).toContain("land");
    expect(detectTopics("How much rainfall does this area get?")).toContain("land");
    expect(detectTopics("Why is the soil so dry?")).not.toContain("land");
  });

  it("describes the land with the atlas numbers and research", () => {
    const q = "How fertile is the land here and what grows well?";
    const answer = answerOffline(q, grounded(buildChatContext(withReadings.farms[0], withReadings), q));
    expect(answer).toMatch(/atlas cell QA-R\d{2}-C\d{2}/);
    expect(answer).toMatch(/Fertility is \*\*/);
    expect(answer).toMatch(/Groundwater/);
    expect(answer).toMatch(/Barley/);
  });

  it("summarises the forecast with heat, wind and rain advice", () => {
    const q = "What's the weather forecast?";
    const answer = answerOffline(q, grounded(buildChatContext(withReadings.farms[0], withReadings), q));
    expect(answer).toMatch(/Now at Al Khor North Farm/);
    expect(answer).toMatch(/Strong wind/);
    expect(answer).toMatch(/Rain expected/);
    expect(answer).toMatch(/Crop water use this week/);
  });
});

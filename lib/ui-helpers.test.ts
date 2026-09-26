import { beforeAll, describe, expect, it } from "vitest";
import { lastDataIndex } from "./ai/analysis";
import type { AiInsight, Recommendation } from "./ai/contract";
import { chartForAction, layerForTab, soilRows, tabAlert, tabForLayer, weatherRows } from "./charts";
import { aggregateDaily } from "./data/aggregate";
import { buildDashboardData } from "./data/derive";
import { generateDemoDataset } from "./data/generate";
import { generateInsights } from "./data/insights";
import { cropChoice, daysSinceReading, irrigationPlan, plainHeadline, riskReason, riskTrend, sortedActions, weeklyActions } from "./dashboard";
import { compassPoint, plural, splitFirstSentence } from "./format";
import { farmRow } from "./portfolio";
import type { DashboardData, FarmBundle, FarmDay, WeatherDay } from "./types";

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

const bundleOf = (id: string): FarmBundle => data.farms.find((b) => b.farm.id === id)!;
const rec = (priority: Recommendation["priority"], title: string, detail = "Do it."): Recommendation => ({ priority, title, detail });

describe("riskReason", () => {
  it("names the demo farms' problems in words", () => {
    expect(riskReason(bundleOf("sheehaniya-west"))).toMatchObject({ label: "Drying out", tone: "bad", driver: "water" });
    expect(riskReason(bundleOf("shamal-greenhouses"))).toMatchObject({ label: "Salt rising", driver: "salinity" });
    expect(riskReason(bundleOf("shamal-east"))).toMatchObject({ label: "Healthy", tone: "ok", driver: "none" });
  });

  it("shows a farm whose probes went quiet as quiet, not by its old readings", () => {
    const b = bundleOf("sheehaniya-west");
    const silent = (n: number): FarmBundle => ({ ...b, days: b.days.map((d, i) => (i >= b.days.length - n ? null : d)) });
    expect(riskReason(silent(3))).toEqual({ label: "No readings for 3 days", tone: "warn", driver: "none" });
    expect(plainHeadline(silent(3))).toBe("The probes have sent nothing for 3 days, so these numbers are from 21 Sep. Check their power and Wi-Fi.");
    expect(daysSinceReading(silent(3))).toBe(3);
    // Yesterday's reading still counts, and its irrigation plan moves up a day.
    expect(riskReason(silent(1)).label).toBe("Drying out");
    const today = farmRow(b, data.dates).irrigation;
    const dayOld = farmRow(silent(1), data.dates);
    expect(dayOld.staleDays).toBe(1);
    expect(dayOld.irrigation.status).toBe("now");
    expect(today.status).toBe("now");
    expect(farmRow(silent(2), data.dates).irrigation.status).toBe("unknown");
  });

  it("says so when there are no readings", () => {
    const b = bundleOf("khor-north");
    expect(riskReason({ ...b, days: b.days.map(() => null) })).toEqual({ label: "No readings", tone: "none", driver: "none" });
  });
});

describe("irrigationPlan", () => {
  const day = (over: Partial<FarmDay>) => ({ date: "2026-09-24", daysToIrrigation: 3, grossDepth: 15.4, netDepth: 11.2, ...over }) as FarmDay;

  it("phrases when and how much once, with the salt share", () => {
    const plan = irrigationPlan(day({}), ["2026-09-24"], 0);
    expect(plan).toMatchObject({ status: "later", when: "Sun", grossMm: 15, netMm: 11, leachMm: 4 });
    expect(plan.sentence).toBe("Irrigate 15 mm on Sun: 11 mm for the crop plus 4 mm to wash salt below the roots.");
  });

  it("says now, today and tomorrow", () => {
    expect(irrigationPlan(day({ daysToIrrigation: 0 }), ["2026-09-24"], 0)).toMatchObject({ status: "now", when: "Now" });
    expect(irrigationPlan(day({ daysToIrrigation: 0.4 }), ["2026-09-24"], 0)).toMatchObject({ status: "soon", when: "Today" });
    expect(irrigationPlan(day({ daysToIrrigation: 1, netDepth: 15.4 }), ["2026-09-24"], 0).sentence).toBe("Irrigate 15 mm tomorrow.");
  });

  it("has nothing to plan without readings", () => {
    expect(irrigationPlan(null, [], 0)).toMatchObject({ status: "unknown", grossMm: null });
  });
});

describe("cropChoice", () => {
  it("follows the written suggestion so the headline matches its reason", () => {
    for (const b of data.farms) {
      const choice = cropChoice(b);
      const suggested = b.insight?.crop_suggestion?.crop;
      if (!choice || !suggested) continue;
      expect(choice.best.name).toBe(suggested);
    }
  });

  it("offers a better-selling alternative only when the crop's market is oversupplied", () => {
    for (const b of data.farms) {
      const choice = cropChoice(b);
      if (!choice?.alternative) continue;
      expect(choice.best.market).toBe("oversupplied");
      expect(choice.alternative.market).not.toBe("oversupplied");
    }
  });
});

describe("actions", () => {
  const insight = (recommendations: Recommendation[]) => ({ recommendations }) as AiInsight;

  it("sorts one farm's actions by priority, keeping the written order within a priority", () => {
    const list = [rec("low", "a"), rec("high", "b"), rec("medium", "c"), rec("high", "d")];
    expect(sortedActions(insight(list)).map((r) => r.title)).toEqual(["b", "d", "c", "a"]);
    expect(sortedActions(null)).toEqual([]);
  });

  it("lists every farm's actions, most urgent first, then the riskier farm", () => {
    const all = weeklyActions(data.farms);
    expect(all).toHaveLength(data.farms.reduce((n, b) => n + (b.insight?.recommendations.length ?? 0), 0));
    const rank = { high: 0, medium: 1, low: 2 } as const;
    for (let i = 1; i < all.length; i++) {
      const [a, b] = [all[i - 1], all[i]];
      expect(rank[a.rec.priority]).toBeLessThanOrEqual(rank[b.rec.priority]);
      if (a.rec.priority === b.rec.priority) expect(a.farm.riskScore ?? -1).toBeGreaterThanOrEqual(b.farm.riskScore ?? -1);
    }
  });

  it("finds the chart that explains an action", () => {
    expect(chartForAction(rec("high", "Apply a leaching irrigation (+26% water)"))).toBe("salinity");
    expect(chartForAction(rec("high", "Inspect the hotspot", "ECe there is 8.1 dS/m."))).toBe("salinity");
    expect(chartForAction(rec("medium", "Top up potassium through fertigation"))).toBe("npk");
    expect(chartForAction(rec("low", "Check the soil pH", "pH is 8.2."))).toBe("npk");
    expect(chartForAction(rec("medium", "Shade the seedlings", "A heat wave is forecast."))).toBe("temperature");
    expect(chartForAction(rec("high", "Irrigate today: 22 mm net"))).toBe("moisture");
    // Whole words only: "graphs" and "deceased" aren't pH or ECe.
    expect(chartForAction(rec("low", "Print the graphs", "The deceased plants were removed."))).toBe("moisture");
  });
});

describe("riskTrend", () => {
  const pts = (...scores: number[]) => scores.map((score, i) => ({ date: `2026-09-${String(10 + i).padStart(2, "0")}`, score }));

  it("reads rising, falling and steady, counting days inclusively", () => {
    expect(riskTrend(pts(40, 50, 62))).toEqual({ first: 40, last: 62, change: 22, days: 3, word: "Rising" });
    expect(riskTrend(pts(70, 60))).toMatchObject({ change: -10, word: "Falling" });
    expect(riskTrend(pts(30, 34))).toMatchObject({ word: "Steady" });
    expect(riskTrend(pts(30))).toBeNull();
  });
});

describe("splitFirstSentence", () => {
  it("splits after the first sentence, not inside numbers", () => {
    expect(splitFirstSentence("Irrigate 15 mm at the next cycle. Then check the drains.")).toEqual(["Irrigate 15 mm at the next cycle.", "Then check the drains."]);
    expect(splitFirstSentence("ECe is 6.7 dS/m against 4.5 dS/m.")).toEqual(["ECe is 6.7 dS/m against 4.5 dS/m.", ""]);
    expect(splitFirstSentence("")).toEqual(["", ""]);
  });
});

describe("chart tabs and map layers", () => {
  it("maps layers to the tab that explains them", () => {
    expect(tabForLayer("yieldLoss")).toBe("salinity");
    expect(tabForLayer("etc")).toBe("moisture");
    expect(tabForLayer("ph")).toBe("npk");
    expect(tabForLayer("temperature")).toBeNull();
  });

  it("keeps the current layer when it belongs to the new tab", () => {
    expect(layerForTab("salinity", "yieldLoss")).toBe("yieldLoss");
    expect(layerForTab("salinity", "moisture")).toBe("ece");
    expect(layerForTab("npk", "ece", "k")).toBe("k");
    expect(layerForTab("temperature", "ece")).toBeNull();
    expect(layerForTab("rain", "moisture")).toBeNull();
  });

  it("puts a dot only on tabs in a risk class", () => {
    const dry = bundleOf("sheehaniya-west");
    expect(tabAlert(dry, "moisture")).toBe("bad");
    expect(tabAlert(dry, "rain")).toBe("none");
    expect(tabAlert(bundleOf("shamal-greenhouses"), "salinity")).toBe("bad");
  });
});

describe("chart rows", () => {
  it("gives the farm mean, the probe range and each probe", () => {
    const b = bundleOf("khor-north");
    const end = lastDataIndex(b);
    const rows = soilRows(b, data.dates, end - 6, end, (d) => d.ece, (s) => s.ece);
    expect(rows).toHaveLength(7);
    const last = rows.at(-1)!;
    expect(last.value).not.toBeNull();
    const [lo, hi] = last.range!;
    expect(lo).toBeLessThanOrEqual(last.value!);
    expect(hi).toBeGreaterThanOrEqual(last.value!);
    expect(Object.keys(last).filter((k) => k.startsWith("p:"))).toHaveLength(b.sensors.length);
  });

  it("adds the forecast only when the range ends today", () => {
    const b = bundleOf("khor-north");
    const dates = data.dates;
    const today = dates[dates.length - 1];
    const w = (date: string, tmax: number): WeatherDay => ({ date, tmax, tmin: tmax - 10, tmean: tmax - 5, precip: 0, precipProb: 10 }) as WeatherDay;
    const withWeather = { ...b, weatherDays: [w(dates[dates.length - 2], 40), w(today, 41), w("2099-01-01", 42), w("2099-01-02", 43)] };

    const rows = weatherRows(withWeather, dates, dates.length - 2, dates.length - 1);
    expect(rows.map((r) => r.forecast)).toEqual([false, false, true, true]);
    // Today starts both the past and the forecast band so the lines join.
    expect(rows[1].band).toEqual([31, 41]);
    expect(rows[1].bandForecast).toEqual([31, 41]);
    expect(rows[2].band).toBeNull();

    expect(weatherRows(withWeather, dates, 0, dates.length - 2).some((r) => r.forecast)).toBe(false);
  });
});

describe("plural / compassPoint", () => {
  it("counts in words", () => {
    expect(plural(1, "probe")).toBe("1 probe");
    expect(plural(0, "probe")).toBe("0 probes");
    expect(plural(6, "probe")).toBe("6 probes");
    expect(plural(2, "reading", "readings")).toBe("2 readings");
  });

  it("names the nearest compass point for a wind direction", () => {
    expect([0, 44, 46, 180, 315, 338, 359, 360, -45].map(compassPoint)).toEqual(["N", "NE", "NE", "S", "NW", "N", "N", "N", "NW"]);
  });
});

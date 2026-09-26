import { describe, expect, it } from "vitest";
import type { CropId } from "../agronomy-tables";
import { rngFor } from "../data/random";
import { addDays } from "../data/time";
import { growableCrops } from "./crops";
import { buildFarmExample, ET_FACTOR, type FarmFocus, type GrowingSystem } from "./farm-analysis";
import { parseInsight } from "../ai/contract";
import { insightFromModelReply, parseModelReply, riskFromWarnings, toFarmReport, toLandResearch } from "../ai/model-output";
import { checkExample, hasIssues, ungroundedNumbers } from "./grounding";
import { buildLandExample, type LandFocus, type LandInterest } from "./land-analysis";
import { formatUserMessage, INPUT_KEYS, OUTPUT_KEYS, type ModelInput, type ModelOutput } from "./schema";
import { LAND_CELLS, soilTypeOf } from "./site";
import { bareSoilSurvey, robotSurvey, simulateRootZone } from "./soil";
import { LIBRARY } from "./sources";
import { weatherWindow, type WeatherDaily, type WeatherSeries } from "./weather";

/** Two years of smooth, Qatar-like synthetic weather, so the tests don't need the downloaded archive. */
function syntheticSeries(lat: number, lng: number): WeatherSeries {
  const days: WeatherDaily[] = [];
  for (let i = 0; i < 760; i++) {
    const date = addDays("2024-09-01", i);
    const doy = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${date.slice(0, 4)}-01-01T00:00:00Z`)) / 86_400_000;
    const season = Math.sin(((doy - 110) / 365) * 2 * Math.PI); // +1 in late July, −1 in late January
    days.push({
      date,
      tmax: Math.round((33 + 11 * season + (i % 5) * 0.4) * 10) / 10,
      tmin: Math.round((22 + 9 * season) * 10) / 10,
      rh_max: Math.round(80 - 10 * season),
      rh_min: Math.round(30 - 12 * season),
      wind_mean: 3.5 + (i % 7) * 0.5,
      wind_max: 6 + (i % 7),
      wind_dir: (i * 37) % 360,
      rain: season < -0.5 && i % 11 === 0 ? 6.4 : 0,
      et0: Math.round((6 + 4 * season) * 10) / 10,
      rs: 20 + 6 * season,
    });
  }
  return { lat, lng, elevation_m: 20, source: "synthetic", days };
}

const cell = LAND_CELLS[Math.floor(LAND_CELLS.length / 2)];
const series = syntheticSeries(cell.lat, cell.lng);
const byDate = new Map(series.days.map((d) => [d.date, d]));

function landExample(asOf: string, opts: { focus?: LandFocus; interest?: LandInterest; source?: "groundwater" | "desalinated" | "tse"; ec?: number | null } = {}) {
  const rng = rngFor("test-land", asOf, opts.focus ?? "overall", opts.interest ?? "any", opts.source ?? "groundwater");
  const window = weatherWindow(series, asOf)!;
  const pastYear = Array.from({ length: 365 }, (_, k) => byDate.get(addDays(asOf, -365 + k))!);
  const rain30 = window.past30.reduce((a, d) => a + d.rain, 0);
  const rain7 = window.past.reduce((a, d) => a + d.rain, 0);
  return buildLandExample({
    asOf,
    time: "08:30",
    lat: cell.lat,
    lng: cell.lng,
    areaHa: 5,
    budget: "medium",
    water: { source: opts.source ?? "groundwater", ec: opts.ec === undefined ? 2.4 : opts.ec },
    weather: window,
    pastYear,
    elevation: 20,
    robot: bareSoilSurvey(soilTypeOf(cell), rain30, rain7, rng),
    question: "What is the best use for this land?",
    focus: opts.focus ?? "overall",
    interest: opts.interest ?? "any",
    pick: rng,
  });
}

type Water = { source: "groundwater" | "desalinated" | "tse"; ec: number };

function farmExample(asOf: string, crop: CropId, system: GrowingSystem, dap: number, focus: FarmFocus = "overall", withRobot = true, water?: Water) {
  const rng = rngFor("test-farm", asOf, crop, system, focus);
  const plantingDate = addDays(asOf, -dap);
  const simStart = plantingDate < addDays(asOf, -150) ? addDays(asOf, -150) : plantingDate;
  const rootZone = simulateRootZone({
    days: byDate,
    crop,
    plantingDate: simStart,
    asOf,
    soil: soilTypeOf(cell),
    etFactor: ET_FACTOR[system],
    habit: { trigger: 1, refill: 1, skip: 0.1 },
    rng,
  });
  return buildFarmExample({
    asOf,
    time: "07:45",
    lat: cell.lat,
    lng: cell.lng,
    crop,
    plantingDate,
    system,
    areaHa: 2,
    water: { ...(water ?? (crop === "alfalfa" ? { source: "tse", ec: 1.8 } : { source: "groundwater", ec: 2.2 })), measured: true },
    weather: weatherWindow(series, asOf)!,
    rootZone,
    robot: withRobot ? robotSurvey(rootZone, asOf, rng) : null,
    question: "How is my crop doing today?",
    focus,
    pick: rng,
  });
}

function expectClean({ input, output }: { input: ModelInput; output: ModelOutput }) {
  const issues = checkExample(input, output);
  expect(issues).toEqual({ schema: [], keys: [], citations: [], numbers: [], region: [] });
  expect(hasIssues(issues)).toBe(false);
  expect(Object.keys(output)).toEqual([...OUTPUT_KEYS]);
  expect(Object.keys(input.inputs)).toEqual([...INPUT_KEYS]);
}

describe("dataset schema", () => {
  it("has nine inputs and a fixed output order", () => {
    expect(INPUT_KEYS).toEqual(["latitude", "longitude", "ecosystem", "growable_crops", "air_temperature", "relative_humidity", "wind", "rain", "soil_moisture"]);
    expect(OUTPUT_KEYS).toEqual(["task", "summary", "insights", "warnings", "forecast", "economic_advice", "recommendations", "crop_plan", "sources", "data_gaps"]);
  });

  it("tags land questions Q1 and farm questions Q2, then gives the input as JSON", () => {
    const land = landExample("2026-06-15").input;
    const farm = farmExample("2026-02-20", "tomato", "cooled greenhouse", 80).input;
    for (const [input, tag] of [[land, "Q1"], [farm, "Q2"]] as const) {
      const [first, blank, json, ...rest] = formatUserMessage(input).split("\n");
      expect(first).toBe(`${tag}: ${input.question}`);
      expect(blank).toBe("");
      expect(rest).toEqual([]);
      const parsed = JSON.parse(json);
      expect(parsed.task).toBe(input.task);
      expect(parsed.question).toBeUndefined();
      expect(Object.keys(parsed.inputs)).toEqual([...INPUT_KEYS]);
    }
  });
});

describe("land analysis examples", () => {
  const focuses: LandFocus[] = ["overall", "market", "farm type", "risk", "budget"];
  it.each(focuses)("builds a clean %s answer", (focus) => {
    expectClean(landExample("2026-06-15", { focus }));
  });

  it.each<LandInterest>(["crops", "livestock", "aquaculture"])("puts the owner's interest (%s) first when it is viable", (interest) => {
    const { output } = landExample("2026-03-10", { interest, source: "groundwater", ec: 1.2 });
    expect(output.summary).toMatch(/^For /);
    expectClean(landExample("2026-03-10", { interest, source: "groundwater", ec: 1.2 }));
  });

  it("says so when the owner's interest can't work on this water", () => {
    const ex = landExample("2026-03-10", { interest: "aquaculture", source: "tse", ec: 1.8 });
    expect(ex.output.summary).toMatch(/^Fish farming won't work here/);
    expectClean(ex);
  });

  it("covers every water source, including an unmeasured well", () => {
    expectClean(landExample("2025-12-01", { source: "desalinated", ec: 0.4 }));
    expectClean(landExample("2025-12-01", { source: "tse", ec: null }));
    expectClean(landExample("2025-12-01", { source: "groundwater", ec: null }));
  });

  it("never shows evidence published after the example's date", () => {
    const asOf = "2025-09-01";
    const { input } = landExample(asOf);
    for (const e of input.evidence) {
      const lib = LIBRARY.find((s) => s.id === e.id)!;
      expect(lib.available_from <= asOf).toBe(true);
    }
    expect(input.evidence.map((e) => e.id)).not.toContain("N6"); // the September 2026 tariff decree
    expect(JSON.stringify(input.derived)).not.toContain("import_tariff_now");
  });
});

describe("farm analysis examples", () => {
  it.each<[CropId, GrowingSystem, number]>([
    ["tomato", "cooled greenhouse", 80],
    ["cucumber", "net house", 30],
    ["zucchini", "open field", 20],
    ["alfalfa", "open field", 200],
  ])("builds a clean answer for %s in a %s", (crop, system, dap) => {
    expectClean(farmExample("2026-02-20", crop, system, dap));
  });

  it.each<FarmFocus>(["overall", "irrigation", "risks", "economics", "next crop"])("answers the %s question", (focus) => {
    expectClean(farmExample("2025-11-15", "sweet_pepper", "net house", 45, focus));
  });

  it("works without a robot survey and reports the gap", () => {
    const ex = farmExample("2025-11-15", "eggplant", "open field", 45, "irrigation", false);
    expectClean(ex);
    expect(ex.input.inputs.soil_moisture).toMatchObject({ source: "field robot probe" });
  });

  it("never recommends and avoids the same crop, judging salinity on the farm's own water", () => {
    for (const water of [{ source: "desalinated", ec: 0.4 }, { source: "groundwater", ec: 3.5 }] as Water[]) {
      const ex = farmExample("2026-01-10", "cucumber", "cooled greenhouse", 40, "next crop", true, water);
      expectClean(ex);
      for (const a of ex.output.crop_plan.avoid) expect(a.why).toContain(`ECw ${water.ec} dS/m`);
      const recommended = new Set(ex.output.crop_plan.recommended.map((c) => c.crop));
      for (const a of ex.output.crop_plan.avoid) expect(recommended.has(a.crop)).toBe(false);
    }
  });
});

describe("growable crops", () => {
  it("follows FAO-29: fresher water never lowers yield, and date palm tolerates brackish water", () => {
    const fresh = new Map(growableCrops(1, 44).map((c) => [c.crop, c.relative_yield_pct]));
    for (const c of growableCrops(4, 44)) expect(c.relative_yield_pct).toBeLessThanOrEqual(fresh.get(c.crop)!);
    const brackish = growableCrops(4, 44);
    expect(brackish.find((c) => c.crop === "Date palm")!.relative_yield_pct).toBeGreaterThan(90);
    expect(brackish.find((c) => c.crop === "Strawberry")!.suitability).toBe("not with this water");
  });
});

describe("Qatar only", () => {
  it("rejects a site outside Qatar", () => {
    const { input, output } = landExample("2026-06-15");
    const abroad = { ...input, inputs: { ...input.inputs, latitude: 24.45, longitude: 54.4 } }; // Abu Dhabi
    expect(checkExample(abroad, output).region).toEqual(["site 24.45,54.4 is outside Qatar"]);
  });

  it("rejects an answer about another country", () => {
    const { input, output } = farmExample("2026-02-20", "tomato", "cooled greenhouse", 80);
    const tampered = { ...output, summary: `${output.summary} Prices in Saudi Arabia are higher.` };
    expect(checkExample(input, tampered).region).toEqual(["answer mentions Saudi"]);
  });
});

describe("display sections", () => {
  it("gives a dated chip for each of the seven forecast days and a harvest window on farms", () => {
    const { input, output } = farmExample("2026-02-20", "tomato", "cooled greenhouse", 80);
    expect(output.forecast.days.map((d) => d.date)).toEqual(input.forecast_dates);
    expect(output.crop_plan.harvest).toMatchObject({ status: expect.any(String), start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(landExample("2026-06-15").output.crop_plan.harvest).toBeNull();
    for (const w of output.warnings) expect(w.when).toBeTruthy();
  });

  it("flags a date the input doesn't contain and multi-line text", () => {
    const { input, output } = farmExample("2026-02-20", "tomato", "cooled greenhouse", 80);
    const badDate = { ...output, crop_plan: { ...output.crop_plan, harvest: { status: "growing" as const, start: "2031-01-01", end: null } } };
    expect(checkExample(input, badDate).numbers).toContain("2031-01-01");
    const markdown = { ...output, summary: "**Irrigate now**\nThen check the valves." };
    expect(checkExample(input, markdown).schema.length).toBeGreaterThan(0);
  });
});

describe("grounding", () => {
  it("flags a number the input doesn't contain", () => {
    const { input, output } = landExample("2026-06-15");
    const tampered = { ...output, summary: `${output.summary} Expect QAR 987,654 in the first year.` };
    expect(ungroundedNumbers(input, tampered)).toContain("987654");
    expect(hasIssues(checkExample(input, tampered))).toBe(true);
  });

  it("flags a citation that isn't in the evidence", () => {
    const { input, output } = farmExample("2026-02-20", "tomato", "cooled greenhouse", 80);
    const tampered = { ...output, insights: [{ ...output.insights[0], sources: ["X99"] }, ...output.insights.slice(1)] };
    expect(checkExample(input, tampered).citations.length).toBeGreaterThan(0);
  });
});

describe("website sections (lib/ai/model-output.ts)", () => {
  const farm = farmExample("2026-02-20", "tomato", "cooled greenhouse", 80);
  const land = landExample("2026-06-15", { interest: "crops", source: "groundwater", ec: 1.2 });

  it("parses a raw reply, even with a code fence or an empty think block around it", () => {
    const json = JSON.stringify(farm.output);
    for (const reply of [json, "```json\n" + json + "\n```", "<think>\n\n</think>\n\n" + json]) {
      const parsed = parseModelReply(reply);
      expect(parsed.ok && parsed.answer).toEqual(farm.output);
    }
    expect(parseModelReply("Sorry, I can't help.")).toMatchObject({ ok: false });
    expect(parseModelReply(json.replace('"summary":', '"overview":'))).toMatchObject({ ok: false });
  });

  it("turns a Q2 answer into the Insights page's sections", () => {
    const report = toFarmReport(farm.output);
    expect(report.summary).toBe(farm.output.summary);
    expect(report.forecast?.days).toHaveLength(7);
    expect(report.warnings.map((w) => w.when)).toEqual(farm.output.warnings.map((w) => w.when));
    expect(report.harvest?.window?.start).toBe(farm.output.crop_plan.harvest?.start);
    expect(report.crop_suggestion?.crop).toBe(farm.output.crop_plan.recommended[0].crop);
    const row = insightFromModelReply(JSON.stringify(farm.output), { id: "1", farm_id: "f", created_at: "2026-02-20T05:00:00Z" });
    expect(parseInsight(row)).toEqual(row);
  });

  it("turns a Q1 answer into the land planner's research panel", () => {
    const research = toLandResearch(land.output, { model: "harvestar-ai-4b", at: "2026-06-15T05:00:00Z" });
    expect(research.headline).toBe(land.output.summary);
    expect(research.caveats).toEqual(land.output.data_gaps);
    expect(research.highlights.length).toBe(land.output.insights.length + land.output.warnings.length);
  });

  it("sets the risk badge from the warnings alone", () => {
    const w = (severity: "critical" | "warning" | "watch") => ({ severity, title: "t", when: "Today", detail: "d", action: "a" });
    expect(riskFromWarnings([])).toEqual({ risk_score: 10, risk_level: "low" });
    expect(riskFromWarnings([w("watch")]).risk_level).toBe("low");
    expect(riskFromWarnings([w("warning"), w("watch")])).toEqual({ risk_score: 50, risk_level: "medium" });
    expect(riskFromWarnings([w("critical")]).risk_level).toBe("high");
  });
});

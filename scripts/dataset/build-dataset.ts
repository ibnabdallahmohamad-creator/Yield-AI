/**
 * Builds the Unsloth fine-tuning dataset: chat-format JSONL (system / user / assistant), half Land
 * Analysis and half Farm Analysis, from real archive weather (fetch-weather.ts), the FAO site grid
 * (extract_site_grid.py), the reference library (lib/dataset/sources.ts) and the app's agronomy.
 *
 *   npx tsx scripts/dataset/build-dataset.ts [--land 1500] [--farm 1500] [--seed 7]
 *
 * Writes the whole dataset to one file, data/dataset/unsloth/yield-ai-qatar.jsonl, plus sample.jsonl and
 * stats.json. Each user turn starts with "Q1: <question>" (land suitability) or "Q2: <question>" (an
 * inquiry about a growing farm), then the JSON input.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CROPS, type CropId } from "../../lib/agronomy-tables";
import { rngFor } from "../../lib/data/random";
import { addDays, daysBetween } from "../../lib/data/time";
import { buildFarmExample, ET_FACTOR, type FarmFocus, type GrowingSystem } from "../../lib/dataset/farm-analysis";
import { parseModelReply, toFarmReport, toLandResearch } from "../../lib/ai/model-output";
import { checkExample, hasIssues } from "../../lib/dataset/grounding";
import { buildLandExample, type LandFocus, type LandInterest } from "../../lib/dataset/land-analysis";
import { formatUserMessage, SYSTEM_PROMPT, type ModelInput, type ModelOutput } from "../../lib/dataset/schema";
import { nearestCell, soilTypeOf } from "../../lib/dataset/site";
import { bareSoilSurvey, robotSurvey, simulateRootZone } from "../../lib/dataset/soil";
import { weatherWindow, type WeatherDaily, type WeatherSeries } from "../../lib/dataset/weather";
import type { Level, WaterSource } from "../../lib/land/options";
import { describeLocation, isInQatar } from "../../lib/qatar/location";
import { OPEN_FIELD_PLANTING } from "../../lib/qatar/market";

const ROOT = process.cwd();
const CACHE = join(ROOT, "data", "dataset", "cache", "weather");
const OUT = join(ROOT, "data", "dataset", "unsloth");
/** The whole dataset in one file, ready for `load_dataset("json", data_files=...)`. */
const DATASET_FILE = "yield-ai-qatar.jsonl";
/** The national goal figures (NATIONAL_GOALS) are as of mid-2025, so land examples start when they were published. */
const LAND_FROM = "2025-08-25";
const FARM_FROM = "2023-08-01";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

type Rng = () => number;
const pick = <T,>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length) % xs.length];
function weighted<T>(rng: Rng, items: Array<[T, number]>): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let x = rng() * total;
  for (const [v, w] of items) if ((x -= w) < 0) return v;
  return items[items.length - 1][0];
}
const r1 = (v: number) => Math.round(v * 10) / 10;
const between = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);
const randomDate = (rng: Rng, from: string, to: string) => addDays(from, Math.floor(rng() * (daysBetween(from, to) + 1)));
const clock = (rng: Rng) => `${String(6 + Math.floor(rng() * 4)).padStart(2, "0")}:${String(Math.floor(rng() * 12) * 5).padStart(2, "0")}`;

interface Site {
  key: string;
  series: WeatherSeries;
  byDate: Map<string, WeatherDaily>;
  first: string;
  last: string;
}

function loadSites(): Site[] {
  if (!existsSync(CACHE)) throw new Error("No weather cache: run scripts/dataset/fetch-weather.ts first.");
  return readdirSync(CACHE)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const series = JSON.parse(readFileSync(join(CACHE, f), "utf8")) as WeatherSeries & { cell: { lat: number; lng: number } };
      return {
        key: `${series.cell.lat.toFixed(2)},${series.cell.lng.toFixed(2)}`,
        series: { ...series, lat: series.cell.lat, lng: series.cell.lng },
        byDate: new Map(series.days.map((d) => [d.date, d])),
        first: series.days[0].date,
        last: series.days[series.days.length - 1].date,
      };
    });
}

/** A point in the site's 0.1° cell that is on Qatar land. */
function pointIn(site: Site, rng: Rng): { lat: number; lng: number } {
  for (let i = 0; i < 25; i++) {
    const lat = Math.round((site.series.lat + between(rng, -0.05, 0.05)) * 10000) / 10000;
    const lng = Math.round((site.series.lng + between(rng, -0.05, 0.05)) * 10000) / 10000;
    if (isInQatar(lat, lng)) return { lat, lng };
  }
  return { lat: site.series.lat, lng: site.series.lng };
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

const LAND_QUESTIONS: Record<LandFocus, string[]> = {
  overall: [
    "What is the best use for this land?",
    "Analyse this plot for me: what should I grow here and what kind of farm should I build?",
    "I have {area} ha here with {water}. What should I do with it?",
    "Give me a full land analysis for this location.",
    "What would you farm on this land, and why?",
  ],
  market: [
    "Which crop has the best market in Qatar for this land right now?",
    "Looking at prices, imports and what Qatar is short of, what should I produce here?",
    "What is scarce in Qatar that this land could supply?",
    "With the trade situation and the national food goals, what's the smartest product for this plot?",
  ],
  "farm type": [
    "Should I build greenhouses, go hydroponic or farm the open field here?",
    "What type of farm suits this land best?",
    "Is this land better for crops, livestock or fish?",
  ],
  risk: [
    "What are the risks of farming here, from water to import disruptions?",
    "How exposed would a farm here be to water problems and trade shocks?",
    "What could go wrong if I invest in a farm on this land?",
  ],
  budget: [
    "I have a {budget} budget. What's the best farm to build on {area} ha here?",
    "What gives the best return on this land for a {budget} budget?",
    "How should I spend a {budget} budget on this {area} ha plot?",
  ],
};

/** Owners who already know what kind of farm they want. */
const INTEREST_QUESTIONS: Record<Exclude<LandInterest, "any">, string[]> = {
  crops: [
    "I want to grow crops on this land: which crop, and in what type of farm?",
    "Which crop should I grow here, and should it be a greenhouse, hydroponics or the open field?",
    "What's the best crop for this {area} ha plot with {water}?",
    "I'd like to farm vegetables or fruit here. What do you advise?",
  ],
  livestock: [
    "I'd like to raise animals here. What kind, and how should the farm be set up?",
    "Is poultry or sheep the better choice on this land?",
  ],
  aquaculture: ["Could I farm fish on this land? What system would work?", "Is a fish farm a good idea on this {area} ha plot?"],
};

const FARM_QUESTIONS: Record<FarmFocus, string[]> = {
  overall: ["How is my {crop} doing today?", "Give me today's analysis for my {crop}.", "What's the status of the farm this morning?", "Anything I should know about my {crop} today?"],
  irrigation: ["Should I irrigate today, and how much?", "How much water does the {crop} need today?", "Is the soil too dry or too wet?", "When is the next irrigation due?"],
  risks: ["What risks should I watch this week?", "Is the weather this week a problem for my {crop}?", "Any warnings for the {crop} this week?"],
  economics: ["What will this {crop} crop earn, and when do I harvest?", "Is this season going to pay?", "When should I harvest and what prices can I expect?"],
  "next crop": ["What should I plant after this {crop}?", "What's the best crop for next season on this water?"],
};

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

function landExample(sites: Site[], seed: number, i: number) {
  const rng = rngFor("land", seed, i);
  const site = pick(rng, sites);
  const { lat, lng } = pointIn(site, rng);
  const asOf = randomDate(rng, LAND_FROM, addDays(site.last, -7));
  const window = weatherWindow(site.series, asOf);
  if (!window) return null;
  const pastYear = Array.from({ length: 365 }, (_, k) => site.byDate.get(addDays(asOf, -365 + k))).filter((d): d is WeatherDaily => d != null);
  if (pastYear.length < 330) return null;
  const loc = describeLocation([lng, lat]);
  const source = weighted<WaterSource>(rng, [["groundwater", 0.62], ["desalinated", 0.22], ["tse", 0.16]]);
  let ec: number | null = null;
  if (source === "groundwater" && rng() < 0.6) {
    const { low, high } = loc.typical_groundwater_ec_dS_m;
    ec = r1(Math.max(0.6, between(rng, low * 0.8, high * 1.2)));
  } else if (source === "desalinated" && rng() < 0.4) ec = r1(between(rng, 0.2, 0.7));
  else if (source === "tse" && rng() < 0.5) ec = r1(between(rng, 1.3, 2.5));
  const area = pick(rng, [0.5, 1, 2, 3, 4, 5, 8, 10, 12, 15, 20, 25, 30, 50]);
  const budget = rng() < 0.15 ? null : pick<Level>(rng, ["low", "medium", "medium", "high"]);
  const interest = weighted<LandInterest>(rng, [["any", 0.55], ["crops", 0.3], ["livestock", 0.08], ["aquaculture", 0.07]]);
  const focus =
    interest === "any"
      ? weighted<LandFocus>(rng, [["overall", 0.4], ["market", 0.2], ["farm type", 0.15], ["risk", 0.12], ["budget", 0.13]])
      : weighted<LandFocus>(rng, [["overall", 0.6], ["farm type", 0.4]]);
  const waterWords: Record<WaterSource, string> = { groundwater: "a well", desalinated: "a desalinated water connection", tse: "a TSE allocation" };
  const question = pick(rng, interest === "any" ? LAND_QUESTIONS[focus] : INTEREST_QUESTIONS[interest])
    .replace("{area}", String(area))
    .replace("{water}", waterWords[source])
    .replace("{budget}", budget ?? "medium");
  const soil = soilTypeOf(nearestCell(lat, lng));
  const past30 = window.past30.reduce((a, d) => a + d.rain, 0);
  const past7 = window.past.reduce((a, d) => a + d.rain, 0);
  const robot = rng() < 0.6 ? bareSoilSurvey(soil, past30, past7, rng) : null;
  return {
    site: site.key,
    meta: { task: "land_analysis", focus, water: source, interest },
    ...buildLandExample({
      asOf,
      time: clock(rng),
      lat,
      lng,
      areaHa: area,
      budget,
      water: { source, ec },
      weather: window,
      pastYear,
      elevation: site.series.elevation_m,
      robot,
      question,
      focus,
      interest,
      pick: rng,
    }),
  };
}

const TOTAL_DAYS = (c: CropId) => {
  const s = CROPS[c].stageLengths_days;
  return s.ini + s.dev + (s.mid ?? 0) + (s.late ?? 0);
};

function farmExample(sites: Site[], seed: number, i: number) {
  const rng = rngFor("farm", seed, i);
  const site = pick(rng, sites);
  const { lat, lng } = pointIn(site, rng);
  const asOf = randomDate(rng, FARM_FROM, addDays(site.last, -7));
  const window = weatherWindow(site.series, asOf);
  if (!window) return null;
  const crop = weighted<CropId>(rng, [["tomato", 0.22], ["cucumber", 0.2], ["sweet_pepper", 0.13], ["eggplant", 0.13], ["zucchini", 0.14], ["alfalfa", 0.18]]);
  let system: GrowingSystem = "open field";
  let dap: number;
  if (crop === "alfalfa") {
    dap = Math.floor(between(rng, 25, 700));
  } else {
    const total = TOTAL_DAYS(crop);
    dap = Math.floor(between(rng, 4, total - 2));
    const month = Number(addDays(asOf, -dap).slice(5, 7));
    system = OPEN_FIELD_PLANTING[crop].includes(month)
      ? weighted<GrowingSystem>(rng, [["open field", 0.65], ["net house", 0.2], ["cooled greenhouse", 0.15]])
      : weighted<GrowingSystem>(rng, [["cooled greenhouse", 0.7], ["net house", 0.3]]);
  }
  const plantingDate = addDays(asOf, -dap);
  const simStart = plantingDate < addDays(asOf, -150) ? addDays(asOf, -150) : plantingDate;
  if (simStart < site.first) return null;

  const loc = describeLocation([lng, lat]);
  let source: WaterSource;
  let ec: number;
  if (crop === "alfalfa") {
    source = rng() < 0.55 ? "tse" : "groundwater";
    ec = source === "tse" ? r1(between(rng, 1.3, 2.5)) : r1(between(rng, loc.typical_groundwater_ec_dS_m.low, loc.typical_groundwater_ec_dS_m.high));
  } else if (rng() < 0.58) {
    source = "groundwater";
    const { low, high } = loc.typical_groundwater_ec_dS_m;
    ec = r1(between(rng, Math.min(low, 1.5), Math.min(high, 4.5)));
  } else {
    source = "desalinated";
    ec = r1(between(rng, 0.2, 0.8));
  }
  const soil = soilTypeOf(nearestCell(lat, lng));
  const habit = { trigger: between(rng, 0.5, 1.7), refill: between(rng, 0.6, 1.25), skip: between(rng, 0, 0.25) };
  const rootZone = simulateRootZone({
    days: site.byDate,
    crop,
    plantingDate: simStart,
    asOf,
    soil,
    etFactor: ET_FACTOR[system],
    habit,
    rng,
  });
  // Kc follows the real planting date even when the balance starts later.
  const robot = rng() < 0.9 ? robotSurvey(rootZone, asOf, rng) : null;
  const focus = weighted<FarmFocus>(rng, [["overall", 0.35], ["irrigation", 0.25], ["risks", 0.18], ["economics", 0.12], ["next crop", crop === "alfalfa" ? 0.02 : 0.1]]);
  const question = pick(rng, FARM_QUESTIONS[focus]).replace("{crop}", CROPS[crop].name.toLowerCase());
  const area = r1(crop === "alfalfa" ? between(rng, 3, 40) : weighted(rng, [[between(rng, 0.2, 1), 0.4], [between(rng, 1, 5), 0.45], [between(rng, 5, 15), 0.15]]));
  return {
    site: site.key,
    meta: { task: "farm_analysis", focus, crop, system, water: source },
    ...buildFarmExample({
      asOf,
      time: clock(rng),
      lat,
      lng,
      crop,
      plantingDate,
      system,
      areaHa: Math.max(0.1, area),
      water: { source, ec, measured: rng() < 0.75 },
      weather: window,
      rootZone,
      robot,
      question,
      focus,
      pick: rng,
    }),
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function toChat(input: ModelInput, output: ModelOutput) {
  return JSON.stringify({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: formatUserMessage(input) },
      { role: "assistant", content: JSON.stringify(output) },
    ],
  });
}

function main() {
  const landCount = arg("land", 1500);
  const farmCount = arg("farm", 1500);
  const seed = arg("seed", 7);
  const sites = loadSites();
  const rows: string[] = [];
  const samples: string[] = [];
  const stats = {
    generated: new Date().toISOString(),
    seed,
    sites: sites.length,
    examples: { land_analysis: 0, farm_analysis: 0 },
    skipped: { no_weather: 0, failed_checks: 0 },
    failures: [] as Array<{ id: string; issues: unknown }>,
    by: {} as Record<string, Record<string, number>>,
    warnings: { critical: 0, warning: 0, watch: 0 },
    chars: { user_mean: 0, user_max: 0, assistant_mean: 0, assistant_max: 0 },
  };
  const count = (group: string, key: string) => {
    stats.by[group] ??= {};
    stats.by[group][key] = (stats.by[group][key] ?? 0) + 1;
  };
  let userChars = 0;
  let asstChars = 0;

  const jobs: Array<["land" | "farm", number]> = [
    ...Array.from({ length: landCount }, (_, i): ["land", number] => ["land", i]),
    ...Array.from({ length: farmCount }, (_, i): ["farm", number] => ["farm", i]),
  ];
  // Interleave so a truncated file still has both tasks.
  jobs.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

  for (const [task, i] of jobs) {
    let ex = task === "land" ? landExample(sites, seed, i) : farmExample(sites, seed, i);
    // Re-draw a few times when the date has no full weather window.
    for (let retry = 1; !ex && retry < 5; retry++) ex = task === "land" ? landExample(sites, seed, i + 100_000 * retry) : farmExample(sites, seed, i + 100_000 * retry);
    if (!ex) {
      stats.skipped.no_weather++;
      continue;
    }
    const issues = checkExample(ex.input, ex.output);
    // The answer must also split into the website's sections with plain code.
    const reply = parseModelReply(JSON.stringify(ex.output));
    if (!reply.ok) issues.schema.push(`website parser: ${reply.error}`);
    else {
      try {
        if (reply.answer.task === "farm_analysis") toFarmReport(reply.answer);
        else toLandResearch(reply.answer, { model: "check", at: ex.input.as_of });
      } catch (e) {
        issues.schema.push(`website sections: ${(e as Error).message}`);
      }
    }
    if (hasIssues(issues)) {
      stats.skipped.failed_checks++;
      if (stats.failures.length < 25) {
        const text = JSON.stringify(ex.output);
        const context = issues.numbers.map((num) => {
          const at = text.search(new RegExp(`(?<![\\d.,])${num.replace(".", "\\.")}(?![\\d]|\\.\\d)`));
          return at >= 0 ? text.slice(Math.max(0, at - 70), at + 30) : num;
        });
        stats.failures.push({ id: `${task}-${i}`, issues: { ...issues, context } });
      }
      continue;
    }
    const line = toChat(ex.input, ex.output);
    rows.push(line);
    if (samples.length < 4 && ((task === "land" && samples.length % 2 === 0) || (task === "farm" && samples.length % 2 === 1))) samples.push(line);
    stats.examples[ex.meta.task as "land_analysis" | "farm_analysis"]++;
    for (const [k, v] of Object.entries(ex.meta)) count(k, String(v));
    count("top_land_use", ex.output.task === "land_analysis" ? ex.output.crop_plan.recommended[0].crop : "(farm)");
    for (const w of ex.output.warnings) stats.warnings[w.severity]++;
    const u = JSON.stringify(ex.input).length;
    const a = JSON.stringify(ex.output).length;
    userChars += u;
    asstChars += a;
    stats.chars.user_max = Math.max(stats.chars.user_max, u);
    stats.chars.assistant_max = Math.max(stats.chars.assistant_max, a);
  }
  const total = stats.examples.land_analysis + stats.examples.farm_analysis;
  stats.chars.user_mean = Math.round(userChars / Math.max(1, total));
  stats.chars.assistant_mean = Math.round(asstChars / Math.max(1, total));
  delete stats.by.top_land_use?.["(farm)"];

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, DATASET_FILE), rows.join("\n") + "\n");
  writeFileSync(join(OUT, "sample.jsonl"), samples.join("\n") + "\n");
  writeFileSync(join(OUT, "stats.json"), JSON.stringify({ ...stats, file: DATASET_FILE, rows: rows.length }, null, 2));
  console.log(`${DATASET_FILE}: ${rows.length} rows (land ${stats.examples.land_analysis}, farm ${stats.examples.farm_analysis})`);
  console.log(`skipped: ${JSON.stringify(stats.skipped)}; chars user≈${stats.chars.user_mean} (max ${stats.chars.user_max}), assistant≈${stats.chars.assistant_mean} (max ${stats.chars.assistant_max})`);
  if (stats.failures.length) console.log("first failures:", JSON.stringify(stats.failures.slice(0, 3), null, 1));
  if (stats.skipped.failed_checks > total * 0.02) process.exitCode = 1;
}

main();

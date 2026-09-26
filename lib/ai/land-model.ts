/**
 * The fine-tuned model's land question (task land_analysis, "Q1"): "what should this land be used
 * for?". The input is built with the same code that built the training set
 * (lib/dataset/land-analysis.ts buildLandExample): the point, its FAO site grid, the last 12 months'
 * climate (Open-Meteo archive), the 30 past days and 7-day forecast, the water and budget, and — for a
 * farm with ESP32 probes — their soil-moisture survey. The answer goes to the land planner's research
 * panel (lib/ai/model-output.ts toLandResearch).
 */
import "server-only";
import { rngFor } from "../data/random";
import { addDays, qatarDateString, QATAR_TIMEZONE } from "../data/time";
import { buildLandExample, type LandInterest } from "../dataset/land-analysis";
import { archiveUrl, parseOpenMeteo, type WeatherDaily } from "../dataset/weather";
import type { LandResearch } from "../land/contract";
import type { Level, WaterSource } from "../land/options";
import type { RobotSurvey } from "../dataset/soil";
import { askModel, modelConfigured } from "./model-client";
import { toLandResearch } from "./model-output";
import { probeWording } from "./probe-wording";
import { getModelWeatherSeries, liveWeatherWindow } from "./model-weather";

const DAY_TTL_MS = 24 * 60 * 60_000;
const ARCHIVE_TIMEOUT_MS = 15_000;

type PastYearCache = Map<string, { at: number; promise: Promise<WeatherDaily[]> }>;
const g = globalThis as typeof globalThis & { __harvestarPastYear?: PastYearCache };
const pastYears: PastYearCache = (g.__harvestarPastYear ??= new Map());

/** The 365 days before `asOf` (archive, which lags ~5 days, topped up from the forecast's past days). Cached a day per ~5 km. */
async function pastYear(lat: number, lng: number, asOf: string, recent: WeatherDaily[]): Promise<WeatherDaily[]> {
  const key = `${lat.toFixed(1)},${lng.toFixed(1)}|${asOf}`;
  let hit = pastYears.get(key);
  if (!hit || Date.now() - hit.at > DAY_TTL_MS) {
    const promise = (async () => {
      const res = await fetch(archiveUrl(lat, lng, addDays(asOf, -365), addDays(asOf, -1)), { signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS), cache: "no-store" });
      if (!res.ok) throw new Error(`Open-Meteo archive HTTP ${res.status}`);
      return parseOpenMeteo(await res.json(), "open-meteo-archive").days;
    })();
    hit = { at: Date.now(), promise };
    pastYears.set(key, hit);
    promise.catch(() => pastYears.get(key) === hit && pastYears.delete(key));
  }
  const archive = await hit.promise;
  const byDate = new Map(archive.map((d) => [d.date, d]));
  for (const d of recent) if (d.date < asOf && !byDate.has(d.date)) byDate.set(d.date, d);
  return [...byDate.values()].filter((d) => d.date >= addDays(asOf, -365) && d.date < asOf).sort((a, b) => a.date.localeCompare(b.date));
}

export interface LandModelRequest {
  lat: number;
  lng: number;
  area_ha: number;
  budget: Level;
  water: { source: WaterSource; ec: number | null };
  /** The farm's ESP32 soil-moisture survey, when the land is a farm with probes. */
  robot: RobotSurvey | null;
  question?: string;
  interest?: LandInterest;
  now?: number;
}

export function landQuestion(areaHa: number): string {
  return `What is the best use for my ${Math.round(areaHa * 10) / 10} ha of land here?`;
}

/** Asks the model the land question. Null when AI_MODEL_URL isn't set; throws when the model or the data fails. */
export async function askModelAboutLand(req: LandModelRequest): Promise<LandResearch | null> {
  if (!modelConfigured()) return null;
  const now = req.now ?? Date.now();
  const asOf = qatarDateString(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: QATAR_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(now));
  const series = await getModelWeatherSeries(req.lat, req.lng);
  const { window } = liveWeatherWindow(series, asOf);
  if (!window) throw new Error("The weather service didn't return the days the land question needs.");
  const question = req.question?.trim() || landQuestion(req.area_ha);

  const { input } = buildLandExample({
    asOf,
    time,
    lat: req.lat,
    lng: req.lng,
    areaHa: req.area_ha,
    budget: req.budget,
    water: req.water,
    weather: window,
    pastYear: await pastYear(req.lat, req.lng, asOf, series.days),
    elevation: series.elevation_m,
    robot: req.robot,
    question,
    focus: "overall",
    interest: req.interest ?? "any",
    pick: rngFor("live-land", req.lat.toFixed(4), req.lng.toFixed(4), asOf, question),
  });
  const reply = await askModel(input);
  return probeWording(toLandResearch(reply.answer, { model: reply.model, at: new Date(now).toISOString() }));
}

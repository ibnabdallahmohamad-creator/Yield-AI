/**
 * The fine-tuned model's input for a live farm (task farm_analysis, "Q2"), built with the very code
 * that built the training set (lib/dataset/farm-analysis.ts buildFarmExample), so every key, unit,
 * rounding and derived number matches what the model learned:
 *
 *   inputs 1–2  latitude, longitude                 the farm
 *   inputs 3–4  ecosystem, growable_crops           FAO site grid for that point
 *   inputs 5–8  air_temperature, relative_humidity,  Open-Meteo daily, °C / % / m/s at 10 m / mm
 *               wind, rain                           (lib/ai/model-weather.ts)
 *   input 9     soil_moisture                        the farm's ESP32 probes, % VWC (lib/ai/esp32-units.ts)
 *
 * The same call also returns the built-in engine's answer in the model's exact output format: shown
 * when the model API isn't configured or doesn't answer, so the page always has every section.
 */
import "server-only";
import { schedulingRootDepth_m, totalAvailableWater_mm } from "../agronomy";
import { CROPS, SOILS } from "../agronomy-tables";
import { rngFor } from "../data/random";
import { qatarDateString, QATAR_TIMEZONE } from "../data/time";
import { buildFarmExample, type FarmFocus, type GrowingSystem } from "../dataset/farm-analysis";
import type { ModelInput, ModelOutput } from "../dataset/schema";
import type { Farm } from "../types";
import { moistureSurvey, type ProbeMoisture } from "./esp32-units";
import { getModelWeatherSeries, liveWeatherWindow } from "./model-weather";

export interface LiveFarmAnalysisInput {
  farm: Farm;
  /** Soil-moisture readings of the last ~8 days, % VWC, per probe. */
  moisture: ProbeMoisture[];
  question?: string;
  system?: GrowingSystem;
  now?: number;
}

export interface LiveFarmExample {
  input: ModelInput;
  /** The built-in engine's answer, in the model's output format. */
  engine: ModelOutput;
  /** What had to be assumed or filled in (shown with the answer). */
  notes: string[];
}

export function defaultQuestion(farm: Pick<Farm, "main_crop">): string {
  return `How is my ${CROPS[farm.main_crop].name.toLowerCase()} doing today?`;
}

/** Which part of the answer the question is about (the training set's `focus`). */
export function focusOf(question: string): FarmFocus {
  const q = question.toLowerCase();
  if (/irrigat|water(ing)?\b|how much water|mm\b|moist|dry/.test(q)) return "irrigation";
  if (/cost|price|money|profit|revenue|econom|market|sell|qar/.test(q)) return "economics";
  if (/next (crop|season)|plant next|what (should|to) (i )?plant|rotation|after (the )?harvest/.test(q)) return "next crop";
  if (/risk|warn|danger|heat|wind|salt|salin|problem|threat/.test(q)) return "risks";
  return "overall";
}

function qatarClock(now: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: QATAR_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(now));
}

function qatarStamp(iso: string): string {
  return `${qatarDateString(iso)} ${qatarClock(Date.parse(iso))}`;
}

export async function buildLiveFarmExample(opts: LiveFarmAnalysisInput): Promise<LiveFarmExample> {
  const { farm } = opts;
  const now = opts.now ?? Date.now();
  const asOf = qatarDateString(now);
  const time = qatarClock(now);
  const question = opts.question?.trim() || defaultQuestion(farm);
  const notes: string[] = [];

  const series = await getModelWeatherSeries(farm.lat, farm.lng);
  const { window, filled } = liveWeatherWindow(series, asOf);
  if (!window) throw new Error("The weather service didn't return the 30 past days and 7-day forecast this farm needs.");
  if (filled.length) notes.push(`Weather for ${filled.join(", ")} was missing and copied from the day next to it.`);

  const crop = CROPS[farm.main_crop];
  const soil = SOILS[farm.soil_type] ?? SOILS.sand;
  const thetaFc = farm.theta_fc ?? soil.thetaFc;
  const thetaWp = farm.theta_wp ?? soil.thetaWp;
  const zr = schedulingRootDepth_m(crop);
  const { survey, weekAgoKnown } = moistureSurvey(opts.moisture, now);
  if (!survey) notes.push("No probe reported soil moisture in the last 24 hours, so the water balance is unknown.");
  else if (!weekAgoKnown) notes.push("The probes have no readings from a week ago, so the 7-day moisture change is sent as 0.");

  const { input, output } = buildFarmExample({
    asOf,
    time,
    lat: farm.lat,
    lng: farm.lng,
    crop: farm.main_crop,
    plantingDate: farm.planting_date,
    system: opts.system ?? "open field",
    areaHa: farm.area_ha,
    water: { source: "groundwater", ec: farm.irrigation_water_ec, measured: true },
    weather: window,
    rootZone: { zr_m: zr, taw_mm: totalAvailableWater_mm(thetaFc, thetaWp, zr), theta_fc: thetaFc, theta_wp: thetaWp, dr_mm: new Map(), surplus_mm: new Map() },
    robot: survey
      ? {
          mean_vwc_pct: survey.mean_vwc_pct,
          min_vwc_pct: survey.min_vwc_pct,
          max_vwc_pct: survey.max_vwc_pct,
          readings: survey.readings,
          change_7d_pct_points: survey.change_7d_pct_points,
        }
      : null,
    question,
    focus: focusOf(question),
    pick: rngFor("live-analysis", farm.id, asOf, question),
  });

  // The survey time is when the probes last reported, not when the question was asked.
  if (survey) {
    const soilInput = input.inputs.soil_moisture as Record<string, unknown>;
    soilInput.measured_at = qatarStamp(survey.latest);
  }
  return { input, engine: output, notes };
}

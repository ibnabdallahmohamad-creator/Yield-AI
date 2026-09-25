/**
 * The field robot's soil-moisture survey (input 9), simulated for training from a FAO-56 daily
 * root-zone water balance driven by the real archive weather, so every reading is physically
 * consistent with the weather the model sees. Each simulated farmer irrigates with their own habits
 * (late or early trigger, under- or over-filling, missed days), which gives the dry, fine and
 * over-watered cases the model has to recognise.
 */
import { adjustedDepletionFraction, kcForDay, schedulingRootDepth_m, totalAvailableWater_mm } from "../agronomy";
import { CROPS, SOILS, type CropId, type SoilType } from "../agronomy-tables";
import { gaussian } from "../data/random";
import { addDays, daysBetween } from "../data/time";
import type { WeatherDaily } from "./weather";

export interface IrrigationHabit {
  /** Irrigate when depletion reaches this multiple of RAW (0.5 = early, 1.5 = late). */
  trigger: number;
  /** Fraction of the depletion refilled (below 1 = under-filling, above 1 = drainage losses). */
  refill: number;
  /** Chance of skipping an irrigation that was due. */
  skip: number;
}

export interface RootZoneState {
  zr_m: number;
  taw_mm: number;
  theta_fc: number;
  theta_wp: number;
  /** Depletion at dawn per date. */
  dr_mm: Map<string, number>;
  /** Water above field capacity at dawn (drains within a day or two), mm. */
  surplus_mm: Map<string, number>;
}

/** Runs the balance from planting (or a year before `asOf` for perennials) up to `asOf` at dawn. */
export function simulateRootZone(opts: {
  days: Map<string, WeatherDaily>;
  crop: CropId;
  plantingDate: string;
  asOf: string;
  soil: SoilType;
  /** Share of outdoor crop water use inside the structure (1 in the open field). */
  etFactor: number;
  habit: IrrigationHabit;
  rng: () => number;
}): RootZoneState {
  const crop = CROPS[opts.crop];
  const soil = SOILS[opts.soil];
  const zr = schedulingRootDepth_m(crop);
  const taw = totalAvailableWater_mm(soil.thetaFc, soil.thetaWp, zr);
  const dr = new Map<string, number>();
  const surplus = new Map<string, number>();
  let d = 0.2 * taw;
  let extra = 0;
  const start = opts.plantingDate;
  for (let date = start; date <= opts.asOf; date = addDays(date, 1)) {
    dr.set(date, d);
    surplus.set(date, extra);
    if (date === opts.asOf) break;
    const w = opts.days.get(date);
    if (!w) continue;
    const dap = daysBetween(opts.plantingDate, date);
    const kc = kcForDay(crop.kc, crop.stageLengths_days, dap).kc ?? crop.kc.ini;
    const etc = kc * w.et0 * opts.etFactor;
    const p = adjustedDepletionFraction(crop.depletionFraction_p, etc);
    const raw = p * taw;
    const ks = d <= raw ? 1 : Math.max(0, (taw - d) / (taw - raw));
    // Rain on the open field only (a greenhouse roof keeps it out); light showers wet only the surface.
    const rain = opts.etFactor >= 1 && w.rain > 2 ? w.rain : 0;
    d = d + etc * ks - rain;
    extra = Math.max(0, extra * 0.3);
    if (d > opts.habit.trigger * raw && opts.rng() > opts.habit.skip) {
      const applied = Math.max(0, d * opts.habit.refill * (1 + 0.08 * gaussian(opts.rng)));
      d -= applied;
    }
    if (d < 0) {
      extra += -d;
      d = 0;
    }
    d = Math.min(d, taw);
  }
  return { zr_m: zr, taw_mm: taw, theta_fc: soil.thetaFc, theta_wp: soil.thetaWp, dr_mm: dr, surplus_mm: surplus };
}

export interface RobotSurvey {
  mean_vwc_pct: number;
  min_vwc_pct: number;
  max_vwc_pct: number;
  readings: number;
  change_7d_pct_points: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The robot's morning survey on `date`: readings at 0–30 cm across the field. */
export function robotSurvey(state: RootZoneState, date: string, rng: () => number): RobotSurvey {
  const vwcOn = (day: string) => {
    const dr = state.dr_mm.get(day) ?? 0;
    const extra = state.surplus_mm.get(day) ?? 0;
    return 100 * (state.theta_fc - dr / (1000 * state.zr_m) + (0.5 * extra) / (1000 * state.zr_m));
  };
  const centre = vwcOn(date);
  const spread = 0.5 + rng() * 1.8;
  const n = 8 + Math.floor(rng() * 17);
  const samples = Array.from({ length: n }, () => Math.max(1.5, centre + spread * gaussian(rng)));
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const weekAgo = vwcOn(addDays(date, -7));
  return {
    mean_vwc_pct: r1(mean),
    min_vwc_pct: r1(Math.min(...samples)),
    max_vwc_pct: r1(Math.max(...samples)),
    readings: n,
    change_7d_pct_points: r1(mean - weekAgo),
  };
}

/**
 * A survey of bare, unirrigated land (Land Analysis): desert sand dries to near its wilting point
 * within days of rain.
 */
export function bareSoilSurvey(soil: SoilType, rainPast30: number, rainPast7: number, rng: () => number): RobotSurvey {
  const s = SOILS[soil];
  const wet = Math.min(1, rainPast7 / 15) * 0.6 + Math.min(1, rainPast30 / 40) * 0.2;
  const centre = 100 * (s.thetaWp * 0.55 + wet * (s.thetaFc - s.thetaWp * 0.55));
  const n = 6 + Math.floor(rng() * 10);
  const samples = Array.from({ length: n }, () => Math.max(0.5, centre + (0.3 + rng() * 0.6) * gaussian(rng)));
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  return {
    mean_vwc_pct: r1(mean),
    min_vwc_pct: r1(Math.min(...samples)),
    max_vwc_pct: r1(Math.max(...samples)),
    readings: n,
    change_7d_pct_points: r1(rainPast7 > 3 ? 1 + rng() * 3 : -rng() * 0.6),
  };
}

/**
 * Task 2, Farm Analysis: "how is my crop doing and what do I do now?". Builds the model input (the
 * nine inputs, context, derived numbers, evidence) and the reference answer in the fixed output format.
 *
 * Every number in the answer is computed here and placed in `derived` first, so the model learns to
 * read numbers, never to invent them. Methods: FAO-56 (ET, Kc, root-zone water balance), FAO-29 (salt
 * tolerance, leaching), the app's weather thresholds (lib/ai/farm-facts.ts) and market calendar.
 */
import {
  adjustedDepletionFraction,
  daysUntilIrrigation_d,
  irrigationDepthWithLeaching_mm,
  kcForDay,
  leachingRequirement_fraction,
  leachingTargetEce_dS_per_m,
  relativeYield_pct,
  rootZoneDepletion_mm,
  waterStressCoefficient,
} from "../agronomy";
import { CROPS, type CropId } from "../agronomy-tables";
import { nextCrops, EXTREME_HEAT_C, HUMID_RH_MAX, STRONG_WIND_M_S, WINDY_M_S } from "../ai/farm-facts";
import { HEAT_STRESS_C } from "../crop-guides";
import { addDays, daysBetween } from "../data/time";
import { CROP_ECONOMICS, GROUNDWATER_COST_QAR_PER_M3, monthsLabel, priceSignal, PRICE_SIGNAL_LABEL, qatarSeason, SEASON_LABEL } from "../qatar/market";
import { WATER_SOURCE_LABEL, type WaterSource } from "../land/options";
import { growableCrops } from "./crops";
import { forecastDay, whenDays } from "./display";
import type { DatasetWarning, EvidenceItem, Figure, Insight, ModelInput, ModelOutput, Recommendation } from "./schema";
import { ecosystemInput, growableInput } from "./site";
import type { RobotSurvey, RootZoneState } from "./soil";
import { LIBRARY, type LibrarySource } from "./sources";
import { weatherInputs, type WeatherWindow } from "./weather";

export type GrowingSystem = "open field" | "net house" | "cooled greenhouse";
export type FarmFocus = "overall" | "irrigation" | "risks" | "economics" | "next crop";

/** Share of open-field crop water use under cover (shade and humidity); options.ts uses 0.6 for greenhouses. */
export const ET_FACTOR: Record<GrowingSystem, number> = { "open field": 1, "net house": 0.8, "cooled greenhouse": 0.6 };

export interface FarmScenario {
  asOf: string;
  time: string;
  lat: number;
  lng: number;
  crop: CropId;
  plantingDate: string;
  system: GrowingSystem;
  areaHa: number;
  water: { source: WaterSource; ec: number; measured: boolean };
  weather: WeatherWindow;
  rootZone: RootZoneState;
  robot: RobotSurvey | null;
  question: string;
  focus: FarmFocus;
  pick: () => number;
}

const r0 = (v: number) => Math.round(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lcFirst = (t: string) => (/^[A-Z]{2}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));

export const dayLabel = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
};
const dateLabel = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const monthOf = (date: string) => Number(date.slice(5, 7));
const choose = <T,>(pick: () => number, xs: T[]): T => xs[Math.floor(pick() * xs.length) % xs.length];
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function toEvidence(s: LibrarySource): EvidenceItem {
  return { id: s.id, kind: s.kind, publisher: s.publisher, title: s.title, date: s.date, url: s.url, facts: s.facts };
}

function stageInfo(crop: CropId, plantingDate: string, asOf: string) {
  const c = CROPS[crop];
  const s = c.stageLengths_days;
  const dap = daysBetween(plantingDate, asOf);
  const { kc, stage } = kcForDay(c.kc, s, dap);
  const firstDap = s.ini + s.dev;
  const lastDap = s.mid != null && s.late != null ? s.ini + s.dev + s.mid + s.late : null;
  let status: "establishing" | "growing" | "harvesting" | "ending" | "cutting";
  let first = addDays(plantingDate, firstDap);
  const last = lastDap != null ? addDays(plantingDate, lastDap) : null;
  if (lastDap == null) {
    status = dap < firstDap ? "establishing" : "cutting";
    if (dap >= firstDap) {
      const since = (dap - firstDap) % 30;
      first = addDays(asOf, since === 0 ? 0 : 30 - since);
    }
  } else if (dap < firstDap) status = "growing";
  else if (dap <= lastDap - 14) status = "harvesting";
  else status = "ending";
  return { dap, kc: kc ?? c.kc.ini, stage, status, first, last };
}

type Flag = "heat" | "extreme heat" | "windy" | "strong wind" | "humid night" | "rain";

export function buildFarmExample(sc: FarmScenario): { input: ModelInput; output: ModelOutput } {
  const crop = CROPS[sc.crop];
  const cropName = crop.name.toLowerCase();
  const w = sc.weather;
  const weather = weatherInputs(w);
  const eco = ecosystemInput(sc.lat, sc.lng);
  const growable = growableInput(eco);
  const factor = ET_FACTOR[sc.system];
  const st = stageInfo(sc.crop, sc.plantingDate, sc.asOf);
  const heatLimit = HEAT_STRESS_C[sc.crop];
  const forecastDays = w.next.map((d) => dayLabel(d.date));

  // --- Water balance from the robot survey ---------------------------------------------------------
  const zr = sc.rootZone.zr_m;
  const taw = sc.rootZone.taw_mm;
  const fcPct = r1(sc.rootZone.theta_fc * 100);
  const wpPct = r1(sc.rootZone.theta_wp * 100);
  const et0 = r1(w.today.et0);
  const etc = r1(st.kc * w.today.et0 * factor);
  const p = adjustedDepletionFraction(crop.depletionFraction_p, etc);
  const raw = r1(p * taw);
  const robot = sc.robot;
  const theta = robot ? robot.mean_vwc_pct / 100 : null;
  const dr = theta != null ? r1(rootZoneDepletion_mm(sc.rootZone.theta_fc, theta, zr, taw)) : null;
  const depletionPct = dr != null ? r0((dr / raw) * 100) : null;
  const ks = dr != null ? r2(waterStressCoefficient(taw, raw, dr)) : null;
  const overWet = robot != null && robot.mean_vwc_pct > fcPct + 0.8;
  const daysToStress = dr != null ? Math.floor(daysUntilIrrigation_d(dr, raw, Math.max(0.1, etc))) : null;

  // --- Salinity (FAO-29) -----------------------------------------------------------------------------
  const ecw = sc.water.ec;
  const ece = r1(1.5 * ecw);
  const ry = r0(relativeYield_pct(ece, crop.salinity.threshold_dS_per_m, crop.salinity.slope_pct_per_dS_per_m));
  const lr = leachingRequirement_fraction(ecw, leachingTargetEce_dS_per_m(crop));
  const lrPct = r0(lr * 100);
  const tooSalty = lr >= 0.5;
  // Crops this farm's own water would cut below 60% of full yield (input 4 uses the local groundwater instead).
  const sensitive = growableCrops(ecw, eco.climate_normal.hottest_month_mean_max_c)
    .filter((c) => c.relative_yield_pct < 60 && c.crop !== crop.name)
    .sort((a, b) => a.relative_yield_pct - b.relative_yield_pct);

  // --- Irrigation today and projected over the week ---------------------------------------------------
  const netToday = dr != null && dr >= raw * 0.9 ? r1(dr) : 0;
  const grossToday = netToday > 0 ? r1(irrigationDepthWithLeaching_mm(netToday, Math.min(lr, 0.5))) : 0;
  const plan: Array<{ day: string; net_mm: number; gross_mm: number }> = [];
  let d = dr != null ? Math.max(0, dr - netToday) : raw * 0.5;
  const etcNext: number[] = [];
  w.next.forEach((day, i) => {
    const kcDay = kcForDay(crop.kc, crop.stageLengths_days, st.dap + i + 1).kc ?? st.kc;
    const e = kcDay * day.et0 * factor;
    etcNext.push(r1(e));
    d += e - (factor >= 1 && day.rain > 2 ? day.rain : 0);
    d = Math.max(0, d);
    if (d >= p * taw) {
      const net = r1(d);
      plan.push({ day: forecastDays[i], net_mm: net, gross_mm: r1(irrigationDepthWithLeaching_mm(net, Math.min(lr, 0.5))) });
      d = 0;
    }
  });
  const weekGross = r1(plan.reduce((a, x) => a + x.gross_mm, 0) + grossToday);
  const weekM3 = r0(weekGross * 10 * sc.areaHa);
  const waterCost = sc.water.source === "groundwater" ? r0(weekM3 * GROUNDWATER_COST_QAR_PER_M3) : null;

  // --- Weather flags ------------------------------------------------------------------------------------
  const flags: Flag[][] = w.next.map((day) => {
    const f: Flag[] = [];
    if (day.tmax >= EXTREME_HEAT_C) f.push("extreme heat");
    else if (day.tmax >= heatLimit) f.push("heat");
    if (day.wind_mean >= STRONG_WIND_M_S) f.push("strong wind");
    else if (day.wind_mean >= WINDY_M_S) f.push("windy");
    if (day.rh_max >= HUMID_RH_MAX) f.push("humid night");
    if (day.rain >= 1) f.push("rain");
    return f;
  });
  const daysWith = (flag: Flag) => forecastDays.filter((_, i) => flags[i].includes(flag));
  const heatDays = daysWith("heat").concat(daysWith("extreme heat"));
  const extremeDays = daysWith("extreme heat");
  const strongWind = daysWith("strong wind");
  const windy = daysWith("windy");
  const humid = daysWith("humid night");
  const maxNext = Math.max(...weather.air_temperature.next_7d_max);
  const minNext = Math.min(...weather.air_temperature.next_7d_max);
  const rainNext = r1(weather.rain.next_7d.reduce((a, b) => a + b, 0));

  // --- Harvest and market -------------------------------------------------------------------------------
  const harvestDate = st.status === "harvesting" || st.status === "ending" || st.status === "cutting" ? sc.asOf : st.first;
  const harvestMonth = monthOf(harvestDate);
  const signal = priceSignal(sc.crop, harvestMonth);
  const econ = CROP_ECONOMICS[sc.crop];
  const price = econ.price_qar_kg[signal];
  const yieldLow = r1((econ.yield_t_ha.low * ry) / 100);
  const yieldHigh = r1((econ.yield_t_ha.high * ry) / 100);
  const revenueLow = Math.round((yieldLow * 1000 * price.low * sc.areaHa) / 1000) * 1000;
  const revenueHigh = Math.round((yieldHigh * 1000 * price.high * sc.areaHa) / 1000) * 1000;
  const daysToHarvest = Math.max(0, daysBetween(sc.asOf, st.first));
  const endMonth = st.last ? monthOf(addDays(st.last, 14)) : monthOf(sc.asOf);
  const next = st.last ? nextCrops(sc.crop, ece, endMonth) : [];

  // --- Evidence -------------------------------------------------------------------------------------------
  const wanted =
    sc.crop === "alfalfa"
      ? ["R7", "R4", "R5"]
      : [...(tariffMonths(sc.crop) ? ["N6"] : []), "N14", "N15", ...(sc.water.source === "groundwater" ? ["R5"] : []), ...(heatDays.length ? ["R8"] : [])];
  const news = wanted
    .map((id) => LIBRARY.find((s) => s.id === id)!)
    .filter((s) => s.available_from <= sc.asOf)
    .slice(0, 4);
  const evidenceIds = ["M1", "M2", "D4", "D2", ...news.map((s) => s.id)];
  const evidence = evidenceIds.map((id) => toEvidence(LIBRARY.find((s) => s.id === id)!));
  const has = (id: string) => evidenceIds.includes(id);
  const tariff = has("N6") ? tariffMonths(sc.crop) : null;

  // --- Input ----------------------------------------------------------------------------------------------
  const input: ModelInput = {
    task: "farm_analysis",
    question: sc.question,
    as_of: `${sc.asOf} ${sc.time}`,
    forecast_days: forecastDays,
    forecast_dates: w.next.map((d) => d.date),
    inputs: {
      latitude: sc.lat,
      longitude: sc.lng,
      ecosystem: eco,
      growable_crops: compactGrowable(growable),
      ...weather,
      soil_moisture: robot
        ? { source: "field robot probe", measured_at: `${sc.asOf} ${sc.time}`, depth_cm: "0–30", ...robot }
        : { source: "field robot probe", status: "no survey in the last 24 hours" },
    },
    context: {
      crop: crop.name,
      planted: sc.plantingDate,
      growing_system: sc.system,
      area_ha: sc.areaHa,
      water_source: WATER_SOURCE_LABEL[sc.water.source],
      water_ec_dS_m: ecw,
      water_ec_origin: sc.water.measured ? "measured" : "typical for the source",
    },
    derived: {
      crop_stage: { planted: dateLabel(sc.plantingDate), days_after_planting: st.dap, stage: st.stage, kc: r2(st.kc), status: st.status },
      water_balance: {
        et0_today_mm: et0,
        indoor_water_use_pct: r0(factor * 100),
        crop_water_use_today_mm: etc,
        field_capacity_vwc_pct: fcPct,
        wilting_point_vwc_pct: wpPct,
        root_zone_m: zr,
        total_available_water_mm: r1(taw),
        readily_available_water_mm: raw,
        depletion_mm: dr,
        depletion_pct_of_readily_available: depletionPct,
        stress_coefficient_ks: ks,
        days_until_stress: daysToStress,
        above_field_capacity: overWet,
        irrigate_today_net_mm: netToday,
        irrigate_today_gross_mm: grossToday,
        leaching_requirement_pct: lrPct,
      },
      next_7_days: {
        crop_water_use_mm: etcNext,
        irrigation_plan: plan,
        week_irrigation_gross_mm: weekGross,
        week_irrigation_m3: weekM3,
        flags: Object.fromEntries(forecastDays.map((day, i) => [day, flags[i]])),
        crop_heat_limit_c: heatLimit,
        thresholds: { extreme_heat_c: EXTREME_HEAT_C, windy_m_s: WINDY_M_S, strong_wind_m_s: STRONG_WIND_M_S, humid_night_rh_pct: HUMID_RH_MAX },
        rain_total_mm: rainNext,
      },
      salinity: { water_ec_dS_m: ecw, ece_per_ecw: 1.5, expected_ece_dS_m: ece, relative_yield_pct: ry, yield_loss_pct: 100 - ry, crop_threshold_ece_dS_m: crop.salinity.threshold_dS_per_m },
      salt_sensitive_on_this_water: sensitive.slice(0, 3).map((c) => ({ crop: c.crop, relative_yield_pct: c.relative_yield_pct })),
      robot_spread_pct_points: robot ? r1(robot.max_vwc_pct - robot.min_vwc_pct) : null,
      harvest: {
        first_harvest: dateLabel(st.first),
        first_harvest_date: st.first,
        last_harvest_date: st.last,
        last_harvest: st.last ? dateLabel(st.last) : null,
        days_to_first_harvest: daysToHarvest,
        market_at_harvest: PRICE_SIGNAL_LABEL[signal],
        season_at_harvest: SEASON_LABEL[qatarSeason(harvestMonth)],
      },
      economics: {
        basis: "open-field drip yields and indicative farm-gate prices (market.ts), scaled by the salinity relative yield",
        yield_t_ha: { low: yieldLow, high: yieldHigh },
        price_qar_kg: price,
        revenue_qar: { low: revenueLow, high: revenueHigh },
        water_cost_qar_next_7_days: waterCost,
        groundwater_pumping_qar_m3: GROUNDWATER_COST_QAR_PER_M3,
        revenue_period: sc.crop === "alfalfa" ? "a year" : "this season",
        ...(tariff ? { import_tariff_months: tariff } : {}),
      },
      next_crops: next.map((n) => ({ crop: n.crop, relative_yield_pct: n.relative_yield_pct, plant_from: n.plant_from, market: PRICE_SIGNAL_LABEL[n.harvest_market] })),
    },
    evidence,
  };

  // --- Answer ---------------------------------------------------------------------------------------------
  const pick = sc.pick;
  const stress = ks != null && ks < 1;
  const waterState =
    dr == null
      ? "unknown today (no robot survey)"
      : overWet
        ? "wetter than field capacity"
        : stress
          ? "past the stress point"
          : depletionPct! >= 90
            ? "at the irrigation point"
            : depletionPct! >= 50
              ? "drying but fine"
              : "well watered";

  const on = (days: string[]) => whenDays(days, forecastDays);
  const warnings: DatasetWarning[] = [];
  if (stress) {
    warnings.push({
      severity: "critical",
      title: "Crop is short of water",
      when: "Today",
      detail: `The root zone has lost ${dr} mm against ${raw} mm the ${cropName} can take up easily (Ks ${ks}), so growth is already slowing.`,
      action: `Irrigate ${grossToday} mm today, early in the morning, then follow the weekly plan.`,
    });
  }
  if (tooSalty) {
    warnings.push({
      severity: "critical",
      title: "Irrigation water too salty for this crop",
      when: "Every irrigation",
      detail: `At ECw ${ecw} dS/m the ${cropName} needs a ${lrPct}% leaching fraction and keeps only ${ry}% of its yield.`,
      action: "Blend with desalinated water or move to a salt-tolerant crop next season.",
    });
  }
  if (extremeDays.length) {
    warnings.push({
      severity: "warning",
      title: "Extreme heat this week",
      when: on(extremeDays),
      detail: `${list(extremeDays)} reach ${EXTREME_HEAT_C} °C or more; ${sc.system === "open field" ? "flowers drop and young plants scorch" : "cooling runs flat out and a failure would cook the crop within hours"}.`,
      action: sc.system === "open field" ? "Irrigate before dawn, keep shade net over young plants and don't transplant on those days." : "Check pads, fans and the backup power before the hot days; irrigate before dawn.",
    });
  } else if (heatDays.length >= 3 && sc.crop !== "alfalfa") {
    warnings.push({
      severity: "warning",
      title: "Heat stress on most days",
      when: on(heatDays),
      detail: `${heatDays.length === 7 ? "Every day this week passes" : `${heatDays.length} of the next 7 days pass`} the ${heatLimit} °C line for ${cropName}, when flowers drop and fruit set fails.`,
      action: "Irrigate before dawn and avoid fertigation in the afternoon heat.",
    });
  } else if (heatDays.length) {
    warnings.push({
      severity: "watch",
      title: "Some hot days",
      when: on(heatDays),
      detail: `${list(heatDays)} pass the ${heatLimit} °C heat line for ${cropName}.`,
      action: "Water early on those days.",
    });
  }
  if (overWet) {
    warnings.push({
      severity: "warning",
      title: "Soil wetter than it can hold",
      when: "Today",
      detail: `The robot's mean of ${robot!.mean_vwc_pct}% is above field capacity (${fcPct}%): water is draining past the roots and taking nitrogen with it.`,
      action: "Skip the next irrigation and check timers and valves for leaks.",
    });
  }
  if (!tooSalty && ry < 90) {
    warnings.push({
      severity: "warning",
      title: "Salinity is costing yield",
      when: "Every irrigation",
      detail: `Expected root-zone salinity of ECe ${ece} dS/m is above the ${crop.salinity.threshold_dS_per_m} dS/m ${cropName} tolerates, so it reaches ${ry}% of full yield.`,
      action: `Keep the ${lrPct}% leaching fraction in every irrigation.`,
    });
  }
  if (strongWind.length) {
    warnings.push({
      severity: "warning",
      title: "Strong wind and dust",
      when: on(strongWind),
      detail: `${list(strongWind)} average ${STRONG_WIND_M_S} m/s or more: blowing sand damages leaves and dries the soil faster.`,
      action: sc.system === "open field" ? "Check windbreaks and shade-net ties; don't spray on those days." : "Close vents on the windward side and check the cover is tied down.",
    });
  } else if (windy.length) {
    warnings.push({ severity: "watch", title: "Windy days", when: on(windy), detail: `${list(windy)} are windy (${WINDY_M_S} m/s or more).`, action: "Spray only on calm mornings." });
  }
  if (humid.length && sc.crop !== "alfalfa") {
    warnings.push({
      severity: "watch",
      title: "Humid nights",
      when: on(humid),
      detail: `Humidity reaches ${HUMID_RH_MAX}% or more on ${list(humid)}, when dew forms and fungal disease spreads.`,
      action: "Scout for mildew and irrigate in the morning, not the evening.",
    });
  }
  const order = { critical: 0, warning: 1, watch: 2 };
  warnings.sort((a, b) => order[a.severity] - order[b.severity]);
  const topWarnings = warnings.slice(0, 5);

  // Insights
  const insights: Insight[] = [];
  if (robot && dr != null) {
    insights.push({
      title: "Soil water from the robot",
      detail: `${robot.readings} readings at 0–30 cm average ${robot.mean_vwc_pct}% (from ${robot.min_vwc_pct}% to ${robot.max_vwc_pct}%) against field capacity ${fcPct}% and wilting point ${wpPct}%: ${stress ? `the root zone has used ${dr} mm, more than the ${raw} mm that is readily available (${depletionPct}%)` : `${dr} mm of the ${raw} mm readily available water is used (${depletionPct}%)`}, so it is ${waterState}.`,
      sources: ["M1"],
    });
    if (robot.max_vwc_pct - robot.min_vwc_pct >= 4) {
      insights.push({
        title: "Uneven watering across the field",
        detail: `The driest reading (${robot.min_vwc_pct}%) is ${r1(robot.max_vwc_pct - robot.min_vwc_pct)} points below the wettest (${robot.max_vwc_pct}%), a sign of blocked or uneven emitters.`,
        sources: ["M1"],
      });
    } else if (Math.abs(robot.change_7d_pct_points) >= 1) {
      insights.push({
        title: robot.change_7d_pct_points < 0 ? "Soil drying over the week" : "Soil wetter than last week",
        detail: `The mean moisture ${robot.change_7d_pct_points < 0 ? "fell" : "rose"} by ${Math.abs(robot.change_7d_pct_points)} points in 7 days.`,
        sources: ["M1"],
      });
    }
  }
  insights.push({
    title: "Crop water use",
    detail: `The ${cropName} is ${st.dap} days after planting (${st.stage} stage, Kc ${r2(st.kc)}). With ET₀ at ${et0} mm today${factor < 1 ? ` and the ${sc.system} cutting water use to ${r0(factor * 100)}% of the open field` : ""}, it uses about ${etc} mm a day.`,
    sources: ["M1", "D4"],
  });
  insights.push({
    title: "Water salinity",
    detail: `${WATER_SOURCE_LABEL[sc.water.source]} at ECw ${ecw} dS/m gives a root-zone ECe of about ${ece} dS/m; ${cropName} keeps ${ry}% of its full yield${lrPct > 0 ? ` with a ${lrPct}% leaching fraction` : ""}.`,
    sources: ["M2"],
  });
  const trend = eco.climate_trend.summer_max_temp_change_c_per_decade;
  if (monthOf(sc.asOf) >= 5 && monthOf(sc.asOf) <= 9 && trend != null && trend > 0) {
    insights.push({
      title: "Summers here are getting hotter",
      detail: `Summer maximums at this site have risen by about ${trend} °C per decade (AgERA5, ${eco.climate_trend.period}); the last five summers averaged ${eco.climate_trend.summer_mean_max_last_5_years_c} °C.`,
      sources: has("R8") ? ["D2", "R8"] : ["D2"],
    });
  }

  // Forecast
  const planText = plan.length
    ? `Irrigate ${list(plan.map((x) => `${x.gross_mm} mm on ${x.day}`))} (${weekGross} mm in all${netToday > 0 ? ", including today" : ""}).`
    : netToday > 0
      ? `After today's ${grossToday} mm, no more irrigation is due this week.`
      : "No irrigation is due this week at this water use.";
  const weatherText = `Highs of ${minNext}–${maxNext} °C${rainNext > 0 ? `, ${rainNext} mm of rain` : ", no rain"}${strongWind.length ? `, dusty wind on ${list(strongWind)}` : windy.length ? `, windy on ${list(windy)}` : ""}${humid.length ? `, humid nights on ${list(humid)}` : ""}.`;
  const seasonAhead =
    sc.crop === "alfalfa"
      ? `Next cut around ${dateLabel(st.first)}; ${qatarSeason(harvestMonth) === "summer" ? "summer heat slows regrowth, so expect lighter cuts until October" : "cooler months give the heaviest cuts"}.`
      : st.status === "growing"
        ? `First harvest around ${dateLabel(st.first)} (${daysToHarvest === 1 ? "1 day" : `${daysToHarvest} days`} away), in the ${SEASON_LABEL[qatarSeason(harvestMonth)]}: ${PRICE_SIGNAL_LABEL[signal]}.`
        : `Harvest is under way${st.last ? ` until about ${dateLabel(st.last)}` : ""}; the market now: ${PRICE_SIGNAL_LABEL[signal]}.`;
  const longTerm = next.length
    ? `Next season: ${list(next.map((n) => `${n.crop.toLowerCase()} from ${n.plant_from}${n.relative_yield_pct != null ? ` (${n.relative_yield_pct}% yield at this salinity)` : ""}`))}.${trend != null && trend > 0 ? ` Summer heat is rising about ${trend} °C per decade here, so plan shade and cooling.` : ""}`
    : `A perennial stand: keep it cut on a cycle.${sc.water.source === "groundwater" ? " Fodder on groundwater is being phased out in favour of treated sewage effluent (TSE)." : ""}`;

  // Economics
  const figures: Figure[] = [
    { label: "Expected yield", value: `${yieldLow}–${yieldHigh} t/ha`, basis: `open-field drip yield at ${ry}% relative yield` },
    { label: "Price at harvest", value: `QAR ${price.low}–${price.high}/kg`, basis: `${PRICE_SIGNAL_LABEL[signal]} (indicative)` },
    { label: "Revenue", value: `QAR ${revenueLow.toLocaleString("en-US")}–${revenueHigh.toLocaleString("en-US")}`, basis: `${sc.areaHa} ha, ${sc.crop === "alfalfa" ? "a year" : "this season"}` },
    { label: "Water this week", value: `${weekM3.toLocaleString("en-US")} m³`, basis: `${weekGross} mm over ${sc.areaHa} ha` },
  ];
  if (waterCost != null) figures.push({ label: "Pumping cost this week", value: `QAR ${waterCost.toLocaleString("en-US")}`, basis: `QAR ${GROUNDWATER_COST_QAR_PER_M3}/m³ energy` });
  const advice: string[] = [];
  if (signal === "scarce") advice.push("Prices are high while local supply is short: harvest on time and sell through Mahaseel or the central market.");
  if (signal === "glut") advice.push("The harvest lands in the winter glut: stagger picking, grade hard and look for contract buyers before prices fall.");
  if (ry < 90) advice.push(`Salinity costs about ${100 - ry}% of yield; blending in fresher water would pay back in revenue.`);
  if (tariff) advice.push(`Imported ${cropName} pays a 15% tariff in ${tariff} (Decree No. 45 of 2026), which supports local prices then.`);
  if (stress) advice.push("Water stress now costs more yield than the water does: irrigate first.");
  if (!advice.length) advice.push("Keep water and fertiliser matched to crop use; over-watering wastes both.");
  const econSummary = `At ${ry}% relative yield, ${sc.areaHa} ha of ${cropName} should bring roughly QAR ${revenueLow.toLocaleString("en-US")}–${revenueHigh.toLocaleString("en-US")} ${sc.crop === "alfalfa" ? "a year" : "this season"} at ${PRICE_SIGNAL_LABEL[signal]}.`;

  // Recommendations
  const recs: Recommendation[] = [];
  if (dr == null) {
    recs.push({ priority: "high", action: "Send the robot round the field before irrigating", when: "This morning", why: "There is no soil-moisture survey for today, so the irrigation depth can't be checked." });
  } else if (overWet) {
    recs.push({ priority: "high", action: "Skip the next irrigation", when: "Today", why: `The soil is above field capacity (${robot!.mean_vwc_pct}% against ${fcPct}%).` });
  } else if (netToday > 0) {
    recs.push({ priority: "high", action: `Irrigate ${grossToday} mm (${netToday} mm net plus ${lrPct}% for leaching)`, when: "Today before 8 am", why: `${depletionPct}% of the readily available water is used.` });
  } else {
    recs.push({ priority: "medium", action: plan.length ? `Next irrigation: ${plan[0].gross_mm} mm on ${plan[0].day}` : "No irrigation needed this week", when: plan.length ? plan[0].day : "This week", why: `${depletionPct}% of the readily available water is used; stress starts in about ${daysToStress} days.` });
  }
  if (robot && robot.max_vwc_pct - robot.min_vwc_pct >= 4) recs.push({ priority: "medium", action: "Flush drip lines and check emitters in the driest zone", when: "This week", why: `Readings range from ${robot.min_vwc_pct}% to ${robot.max_vwc_pct}%.` });
  if (extremeDays.length || heatDays.length >= 3) recs.push({ priority: "high", action: sc.system === "cooled greenhouse" ? "Service pads and fans and test the backup power" : sc.system === "net house" ? "Close the shade screens at midday and irrigate before dawn" : st.dap < 30 ? "Irrigate before dawn and cover young plants with shade net" : "Irrigate before dawn and mulch to keep the roots cool", when: `Before ${extremeDays[0] ?? heatDays[0]}`, why: "Heat stress drops flowers and can kill young plants." });
  if (strongWind.length) recs.push({ priority: "medium", action: "Postpone spraying and secure covers", when: list(strongWind), why: "Strong wind causes drift and sand blast." });
  if (humid.length && sc.crop !== "alfalfa") recs.push({ priority: "low", action: "Scout leaves for mildew", when: `After ${humid[0]}`, why: "Humid nights favour fungal disease." });
  if (st.status === "harvesting" || st.status === "cutting") recs.push({ priority: "medium", action: sc.crop === "alfalfa" ? "Plan the next cut" : "Harvest every 2–3 days in the cool morning", when: sc.crop === "alfalfa" ? dateLabel(st.first) : "Ongoing", why: `The market: ${PRICE_SIGNAL_LABEL[signal]}.` });
  if (recs.length < 2) recs.push({ priority: "low", action: "Keep the robot survey going every morning", when: "Daily", why: "Daily readings catch drying before the crop feels it." });

  // Crop plan
  const recommended = [
    { crop: crop.name, farm_type: sc.system, when: "Now", why: st.status === "ending" ? "Finish this season's harvest." : `Continue: ${ry}% relative yield at this water, ${PRICE_SIGNAL_LABEL[signal]} at harvest.` },
    ...next
      .filter((n) => n.crop !== crop.name)
      .slice(0, 2)
      .map((n) => ({ crop: n.crop, farm_type: "open field (drip)", when: `From ${n.plant_from}`, why: `Next season from ${n.plant_from}${n.relative_yield_pct != null ? `, ${n.relative_yield_pct}% yield at this salinity` : ""}; ${PRICE_SIGNAL_LABEL[n.harvest_market]} at harvest.` })),
  ];
  const avoid = sensitive.slice(0, 3).map((c) => ({ crop: c.crop, why: c.relative_yield_pct === 0 ? `No marketable yield on this water (ECw ${ecw} dS/m).` : `Only ${c.relative_yield_pct}% of full yield on this water (ECw ${ecw} dS/m).` }));

  const cited = new Set<string>(insights.flatMap((i) => i.sources));
  if (tariff) cited.add("N6");
  if (signal !== "normal" && has("N14") && signal === "scarce") cited.add("N14");
  if (signal === "glut" && has("N15")) cited.add("N15");
  const sources = evidence.filter((e) => cited.has(e.id)).map((e) => ({ id: e.id, title: e.title, url: e.url }));

  const gaps: string[] = [];
  if (!robot) gaps.push("No robot survey today: the soil-water figures are missing.");
  if (!sc.water.measured) gaps.push(`Water EC is the typical value for ${WATER_SOURCE_LABEL[sc.water.source].toLowerCase()}; measure it.`);
  gaps.push("No soil salinity sensor: root-zone ECe is estimated as 1.5 × water EC.");
  gaps.push("Yields and prices are indicative planning values; check Mahaseel or the central market.");
  if (factor < 1) gaps.push(`Indoor water use is taken as ${r0(factor * 100)}% of the open field; an indoor climate sensor would firm this up.`);

  const lead = {
    overall: `Your ${cropName} is ${st.dap} days in (${st.stage}) and ${dr == null ? "there is no robot survey today, so soil water is unknown" : `the root zone is ${waterState}`}.`,
    irrigation: dr == null ? "I can't size today's irrigation without a robot survey." : netToday > 0 ? `The soil is too dry: irrigate ${grossToday} mm today.` : overWet ? "The soil is too wet: it is above field capacity, so skip the next irrigation." : `The soil moisture is fine, so no irrigation today; ${plan.length ? `the next ${plan[0].gross_mm} mm is due ${plan[0].day}` : "none is due this week"}.`,
    risks: topWarnings.length ? `The main risk this week: ${lcFirst(topWarnings[0].title)}.` : "No serious risks this week.",
    economics: `${sc.crop === "alfalfa" ? "A year of cuts" : "This season"} should bring roughly QAR ${revenueLow.toLocaleString("en-US")}–${revenueHigh.toLocaleString("en-US")} from ${sc.areaHa} ha.`,
    "next crop": next.length ? `After this crop, ${next[0].crop.toLowerCase()} from ${next[0].plant_from} is the best follow-on.` : `This is a perennial stand, so keep cutting rather than replanting.`,
  }[sc.focus];
  const second =
    sc.focus === "irrigation"
      ? `${depletionPct != null ? `${depletionPct}% of the readily available water is used` : "Soil water is unknown"}; the crop uses ${etc} mm a day.`
      : netToday > 0
        ? `Irrigate ${grossToday} mm today.`
        : topWarnings[0]
          ? sc.focus === "risks"
            ? topWarnings[0].action
            : `${topWarnings[0].action.replace(/[.\s]+$/, "")} (${lcFirst(topWarnings[0].title)}).`
          : "No action is urgent.";
  const summary = `${lead} ${second} ${choose(pick, [planText, weatherText])}`;

  const days = w.next.map((day, i) =>
    forecastDay({
      date: day.date,
      tmax: weather.air_temperature.next_7d_max[i],
      rain: weather.rain.next_7d[i],
      irrigate_mm: plan.find((x) => x.day === forecastDays[i])?.gross_mm ?? null,
      extremeHeat: flags[i].includes("extreme heat"),
      heat: flags[i].includes("heat"),
      strongWind: flags[i].includes("strong wind"),
      windy: flags[i].includes("windy"),
      humid: flags[i].includes("humid night"),
    }),
  );

  const output: ModelOutput = {
    task: "farm_analysis",
    summary,
    insights: insights.slice(0, 6),
    warnings: topWarnings,
    forecast: { next_7_days: `${weatherText} ${planText}`, days, season_ahead: seasonAhead, long_term: longTerm },
    economic_advice: { summary: econSummary, figures: figures.slice(0, 6), advice: advice.slice(0, 5) },
    recommendations: recs.slice(0, 6),
    crop_plan: { recommended: recommended.slice(0, 3), avoid, harvest: { status: st.status, start: st.first, end: st.last } },
    sources: sources.length ? sources : [{ id: "M1", title: evidence[0].title, url: evidence[0].url }],
    data_gaps: gaps.slice(0, 5),
  };
  return { input, output };
}

/** "Jan–May" for the months Decree No. 45 of 2026 puts a 15% tariff on the imported crop, else null. */
export function tariffMonths(crop: CropId): string | null {
  const months: Partial<Record<CropId, number[]>> = { tomato: [1, 2, 3, 4, 5], eggplant: [11, 12, 1, 2, 3, 4], zucchini: [10, 11, 12, 1, 2, 3, 4] };
  const m = months[crop];
  return m ? monthsLabel(m) : null;
}

export function compactGrowable(g: ReturnType<typeof growableInput>) {
  return {
    water_assumed: g.water_assumed,
    crops: g.crops.map((c) => ({
      crop: c.crop,
      suitability: c.suitability,
      relative_yield_pct: c.relative_yield_pct,
      open_field_months: c.open_field_months.length ? monthsLabel(c.open_field_months) : "protected only",
      summer_outdoors: c.summer_outdoors,
    })),
  };
}


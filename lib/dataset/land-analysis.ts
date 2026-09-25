/**
 * Task 1, Land Analysis: "what should this land be used for?". Weighs the site (inputs 1–9), its
 * water, the market, trade and politics, Qatar's 2030 food goals and the economics; advises which
 * crops to grow and in what type of farm. Builds the model input and the reference answer.
 *
 * The ranking is the app's own (lib/land/score.ts); the market, trade and policy come from the
 * reference library (sources.ts), filtered to what was published by the example's date.
 */
import { SOILS } from "../agronomy-tables";
import { addDays } from "../data/time";
import { WATER_POLICY } from "../qatar/food-security";
import { describeLocation } from "../qatar/location";
import { CROP_ECONOMICS, GROUNDWATER_COST_QAR_PER_M3, monthName, monthsLabel, priceSignal, qatarSeason, SEASON_LABEL } from "../qatar/market";
import type { SiteClimate } from "../land/climate";
import type { RankedOption } from "../land/contract";
import { landUseOption, WATER_SOURCE_LABEL, type LandUseId, type Level, type WaterSource } from "../land/options";
import { assessWater, goalRows, rankOptions } from "../land/score";
import production from "../../data/dataset/qatar-production.json";
import { forecastDay, whenDays } from "./display";
import { compactGrowable, dayLabel, toEvidence } from "./farm-analysis";
import type { DatasetWarning, Figure, Insight, ModelInput, ModelOutput, Recommendation } from "./schema";
import { ecosystemInput, growableInput, soilTypeOf, nearestCell } from "./site";
import type { RobotSurvey } from "./soil";
import { LIBRARY } from "./sources";
import { weatherInputs, type WeatherDaily, type WeatherWindow } from "./weather";

export type LandFocus = "overall" | "market" | "farm type" | "risk" | "budget";

/** What the owner wants to do with the land; "any" leaves the choice to the ranking. */
export type LandInterest = "any" | "crops" | "livestock" | "aquaculture";
const INTEREST_LABEL: Record<LandInterest, string> = { any: "open to any use", crops: "crops", livestock: "livestock", aquaculture: "fish farming" };

export interface LandScenario {
  asOf: string;
  time: string;
  lat: number;
  lng: number;
  areaHa: number;
  budget: Level | null;
  water: { source: WaterSource; ec: number | null };
  weather: WeatherWindow;
  /** The 365 days before `asOf`, for the site's last-year climate. */
  pastYear: WeatherDaily[];
  elevation: number | null;
  robot: RobotSurvey | null;
  question: string;
  focus: LandFocus;
  interest: LandInterest;
  pick: () => number;
}

const r0 = (v: number) => Math.round(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const n = (v: number) => Math.round(v).toLocaleString("en-US");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const monthOf = (date: string) => Number(date.slice(5, 7));
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const choose = <T,>(pick: () => number, xs: T[]): T => xs[Math.floor(pick() * xs.length) % xs.length];
const noStop = (t: string) => t.replace(/[.\s]+$/, "");
/** Lower-case the first letter unless the first word is an acronym ("LED lighting", "TSE"). */
const lcFirst = (t: string) => (/^(?:[A-Z]{2}|Qatar|Hormuz|Mahaseel|Gulf|Rhodes)/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));

/** The site's climate over the last 12 months, in the land ranker's shape. */
export function siteClimateFrom(days: WeatherDaily[], elevation: number | null): SiteClimate {
  const inMonths = (ms: number[]) => days.filter((d) => ms.includes(monthOf(d.date)));
  const et0Monthly = Array.from({ length: 12 }, (_, m) => r0(days.filter((d) => monthOf(d.date) === m + 1).reduce((a, d) => a + d.et0, 0)));
  return {
    source: "open-meteo-archive",
    period: { start: days[0].date, end: days[days.length - 1].date },
    elevation_m: elevation,
    et0_annual_mm: et0Monthly.reduce((a, b) => a + b, 0),
    et0_monthly_mm: et0Monthly,
    summer_tmax_mean_c: r1(mean(inMonths([6, 7, 8, 9]).map((d) => d.tmax))),
    hottest_c: r1(Math.max(...days.map((d) => d.tmax))),
    days_above_45c: days.filter((d) => d.tmax >= 45).length,
    winter_tmin_mean_c: r1(mean(inMonths([12, 1, 2]).map((d) => d.tmin))),
    coldest_c: r1(Math.min(...days.map((d) => d.tmin))),
    summer_humidity_mean_pct: r0(mean(inMonths([6, 7, 8, 9]).map((d) => (d.rh_max + d.rh_min) / 2))),
    wind_mean_m_s: r1(mean(days.map((d) => d.wind_mean))),
    dust_wind_days: days.filter((d) => d.wind_max >= 10).length,
    rain_annual_mm: r0(days.reduce((a, d) => a + d.rain, 0)),
    note: null,
  };
}

/** What each land use grows and in what kind of farm. */
export const FARM_PLAN: Record<LandUseId, { crop: string; farm_type: string; months: number[] | null }> = {
  "greenhouse-veg": { crop: "Tomato, cucumber and sweet pepper", farm_type: "cooled greenhouse (pad-and-fan) with drip or hydroponics", months: null },
  "hydroponic-leafy": { crop: "Lettuce, leafy greens and herbs", farm_type: "hydroponic greenhouse or vertical farm on RO or desalinated water", months: null },
  "openfield-winter-veg": { crop: "Zucchini, eggplant, tomato and melons", farm_type: "open field with drip and mulch, October–April", months: [9, 10, 11, 1, 2] },
  "date-palms": { crop: "Date palm (Khalas, Barhi, Sukkari)", farm_type: "orchard with bubbler or drip irrigation and windbreaks", months: [2, 3, 4, 9, 10] },
  "fodder-tse": { crop: "Alfalfa or Rhodes grass", farm_type: "centre-pivot or drip fodder field on TSE", months: [10, 11] },
  "table-eggs": { crop: "Table eggs (laying hens)", farm_type: "closed, cooled layer houses", months: null },
  "sheep-goats": { crop: "Sheep and goats (Awassi, Naimi, Najdi)", farm_type: "shaded pens with a fodder store", months: null },
  aquaculture: { crop: "Tilapia or marine fish", farm_type: "lined ponds or a recirculating tank system (RAS)", months: null },
};

/** FAOSTAT items that measure each land use's product. */
const FAO_ITEMS: Partial<Record<LandUseId, string[]>> = {
  "greenhouse-veg": ["Tomatoes", "Cucumbers and gherkins", "Chillies and peppers, green (Capsicum spp. and Pimenta spp.)"],
  "hydroponic-leafy": ["Lettuce and chicory", "Spinach"],
  "openfield-winter-veg": ["Pumpkins, squash and gourds", "Eggplants (aubergines)", "Cantaloupes and other melons"],
  "date-palms": ["Dates"],
  "table-eggs": ["Hen eggs in shell, fresh"],
};

type ProductionItem = { item: string; series: Record<string, number> };
const PRODUCTION = production as unknown as { items: ProductionItem[] };

/** FAOSTAT gross production value for the item in the latest year FAO would have published by `asOf` (two-year lag). */
function productionValue(item: string, asOf: string) {
  const row = PRODUCTION.items.find((i) => i.item === item);
  if (!row) return null;
  const year = Number(asOf.slice(0, 4)) - 2;
  const v = row.series[String(year)];
  const v5 = row.series[String(year - 5)];
  if (v == null || v <= 0) return null;
  return { item, year, value_thousand_usd_2015: r0(v), change_5y_pct: v5 ? r0((v / v5 - 1) * 100) : null };
}

/** Evidence ids relevant to each land use. */
const OPTION_EVIDENCE: Record<LandUseId, string[]> = {
  "greenhouse-veg": ["N1", "N2", "R3", "N10", "N14", "N11", "R9"],
  "hydroponic-leafy": ["R3", "N11", "R9", "N10", "N14"],
  "openfield-winter-veg": ["N15", "N14", "R2", "N1"],
  "date-palms": ["N12", "N13", "N1"],
  "fodder-tse": ["R7", "R4", "N17"],
  "table-eggs": ["N3", "N5", "R1"],
  "sheep-goats": ["N3", "N2", "N5"],
  aquaculture: ["R10", "N2", "N5"],
};
const TRADE_EVIDENCE = ["N6", "N7", "R1", "N9", "N8", "N16", "R4", "R2"];
const WATER_EVIDENCE: Record<WaterSource, string[]> = { groundwater: ["R5", "R6", "N17"], desalinated: ["N17"], tse: ["R7", "N17"] };

const VEG_CROPS = ["tomato", "cucumber", "sweet_pepper", "eggplant", "zucchini"] as const;

export function buildLandExample(sc: LandScenario): { input: ModelInput; output: ModelOutput } {
  const loc = describeLocation([sc.lng, sc.lat]);
  const eco = ecosystemInput(sc.lat, sc.lng);
  const growable = growableInput(eco);
  const climate = siteClimateFrom(sc.pastYear, sc.elevation);
  const water = assessWater(sc.water.source, sc.water.ec, loc, null);
  const budget = sc.budget ?? "medium";
  const ranked = rankOptions({ location: loc, climate, water, area_ha: sc.areaHa, budget });
  const viable = ranked.filter((o) => !o.blocked);
  // The owner's interest goes first; the other viable uses fill in behind it as fallbacks.
  const ofInterest = sc.interest === "any" ? viable : viable.filter((o) => o.category === sc.interest);
  const top = [...ofInterest, ...viable.filter((o) => !ofInterest.includes(o))].slice(0, 3);
  const best = top[0];
  const interestBlocked = sc.interest !== "any" && !ofInterest.length ? (ranked.find((o) => o.category === sc.interest && o.blocked) ?? null) : null;
  const avoid = ranked.filter((o) => o.blocked).slice(0, 3);
  const month = monthOf(sc.asOf);
  const season = qatarSeason(month);
  const weather = weatherInputs(sc.weather);
  const forecastDays = sc.weather.next.map((d) => dayLabel(d.date));
  const soil = SOILS[soilTypeOf(nearestCell(sc.lat, sc.lng))];

  // --- Market now ----------------------------------------------------------------------------------
  const scarce = VEG_CROPS.filter((c) => priceSignal(c, month) === "scarce").map((c) => c.replace("_", " "));
  const glut = VEG_CROPS.filter((c) => priceSignal(c, month) === "glut").map((c) => c.replace("_", " "));
  const tariffsKnown = sc.asOf >= "2026-09-17";
  const tariffNow = tariffsKnown
    ? (["tomato", "eggplant", "zucchini"] as const).filter((c) => {
        const months: Record<string, number[]> = { tomato: [1, 2, 3, 4, 5], eggplant: [11, 12, 1, 2, 3, 4], zucchini: [10, 11, 12, 1, 2, 3, 4] };
        return months[c].includes(month);
      })
    : [];
  const prod = top.flatMap((o) => (FAO_ITEMS[o.id] ?? []).slice(0, 2).map((item) => productionValue(item, sc.asOf))).filter((x): x is NonNullable<typeof x> => x != null);

  // --- Evidence --------------------------------------------------------------------------------------
  const wanted = [...new Set([...top.flatMap((o) => OPTION_EVIDENCE[o.id].slice(0, 3)), ...TRADE_EVIDENCE, ...WATER_EVIDENCE[water.source].slice(0, 2)])];
  const news = wanted
    .map((id) => LIBRARY.find((s) => s.id === id)!)
    .filter((s) => s.available_from <= sc.asOf)
    .slice(0, 8);
  const evidenceIds = [...news.map((s) => s.id), "D1", "D2", ...(prod.length ? ["D3"] : []), "D4", "M2"];
  const evidence = evidenceIds.map((id) => toEvidence(LIBRARY.find((s) => s.id === id)!));
  const has = (id: string) => evidenceIds.includes(id);

  // --- Economics per top option ----------------------------------------------------------------------
  const economics = top.map((o) => {
    const crop = o.id === "greenhouse-veg" ? "tomato" : o.id === "openfield-winter-veg" ? "zucchini" : null;
    const pumping = water.source === "groundwater" && o.water_m3_yr != null ? r0(o.water_m3_yr * GROUNDWATER_COST_QAR_PER_M3) : null;
    return {
      option: o.name,
      capex: o.capex,
      capex_note: o.capex_note,
      first_income: o.first_income,
      first_steps: o.first_steps,
      water_m3_yr: o.water_m3_yr,
      pumping_cost_qar_yr: pumping,
      ...(crop
        ? {
            indicative_price_qar_kg: {
              crop,
              summer: CROP_ECONOMICS[crop].price_qar_kg.scarce,
              winter_peak: CROP_ECONOMICS[crop].price_qar_kg.glut,
            },
          }
        : {}),
    };
  });

  const goals = goalRows().map((g) => ({ product: g.label, current_pct: g.current_pct, year: g.current_year, target_2030_pct: g.target_pct, gap_points: g.gap_pct }));

  // --- Input ---------------------------------------------------------------------------------------------
  const input: ModelInput = {
    task: "land_analysis",
    question: sc.question,
    as_of: `${sc.asOf} ${sc.time}`,
    forecast_days: forecastDays,
    forecast_dates: sc.weather.next.map((d) => d.date),
    inputs: {
      latitude: sc.lat,
      longitude: sc.lng,
      ecosystem: eco,
      growable_crops: compactGrowable(growable),
      ...weather,
      soil_moisture: sc.robot
        ? { source: "field robot probe", measured_at: `${sc.asOf} ${sc.time}`, depth_cm: "0–30", ...sc.robot }
        : { source: "field robot probe", status: "the robot has not surveyed this plot" },
    },
    context: {
      area_ha: sc.areaHa,
      water_source: WATER_SOURCE_LABEL[sc.water.source],
      water_ec_dS_m: sc.water.ec,
      budget: sc.budget ?? "not given",
      owner_interest: INTEREST_LABEL[sc.interest],
    },
    derived: {
      soil: { texture: eco.soil.texture, field_capacity_vwc_pct: r1(soil.thetaFc * 100), wilting_point_vwc_pct: r1(soil.thetaWp * 100) },
      site_climate_last_12_months: {
        hottest_c: climate.hottest_c,
        days_above_45c: climate.days_above_45c,
        summer_mean_max_c: climate.summer_tmax_mean_c,
        winter_mean_min_c: climate.winter_tmin_mean_c,
        summer_humidity_mean_pct: climate.summer_humidity_mean_pct,
        dust_wind_days: climate.dust_wind_days,
        rain_mm: climate.rain_annual_mm,
        et0_mm: climate.et0_annual_mm,
      },
      water: { source: WATER_SOURCE_LABEL[water.source], ec_dS_m: water.ec_dS_m, ec_origin: water.ec_origin, ece_per_ecw: 1.5, expected_ece_dS_m: water.ece_expected_dS_m, class: water.class },
      land_uses: ranked.map((o) => ({
        option: o.name,
        fit: o.blocked ? "blocked" : o.fit,
        blocked: o.blocked,
        water: o.factors.water.label,
        goal: o.factors.goal.label,
        market: landUseOption(o.id).market,
        budget: o.factors.budget.label,
        site: o.factors.site.label,
        water_m3_ha_yr: o.water_m3_ha_yr,
      })),
      ...(sc.interest !== "any" ? { best_use_overall: viable[0]?.name ?? null } : {}),
      national_goals: goals,
      market_now: {
        month: monthName(month),
        season: SEASON_LABEL[season],
        scarce_now: scarce,
        glut_now: glut,
        ...(tariffsKnown ? { import_tariff_now: tariffNow } : {}),
      },
      production_value_faostat: prod,
      top_options: economics,
      groundwater_policy: { abstraction_Mm3_yr: WATER_POLICY.groundwaterAbstraction_Mm3_per_yr, safe_yield_Mm3_yr: WATER_POLICY.groundwaterSafeYield_Mm3_per_yr },
      next_7_days_rain_mm: r1(weather.rain.next_7d.reduce((x, y) => x + y, 0)),
      thresholds: { hot_day_c: 40, extreme_heat_c: 45, dusty_wind_m_s: 8, humid_night_rh_pct: 90, groundwater_pumping_qar_m3: GROUNDWATER_COST_QAR_PER_M3 },
    },
    evidence,
  };

  // --- Answer --------------------------------------------------------------------------------------------
  const pick = sc.pick;
  const plan = (o: RankedOption) => FARM_PLAN[o.id];
  const goalOf = (o: RankedOption) => o.factors.goal.label;
  const cited = new Set<string>();
  const cite = (...ids: string[]) => {
    const ok = ids.filter(has);
    ok.forEach((id) => cited.add(id));
    return ok;
  };

  // Insights
  const insights: Insight[] = [];
  insights.push({
    title: "A hyper-arid site: every crop is irrigated",
    detail: `Aridity index ${eco.aridity_index} (${eco.aridity_class}): about ${eco.climate_normal.rain_annual_mm} mm of rain a year against ${n(eco.climate_normal.et0_annual_mm)} mm of evaporative demand, a deficit of ${n(eco.climate_normal.water_deficit_mm)} mm. ${eco.type}.`,
    sources: cite("D1", "D2"),
  });
  insights.push({
    title: `Water decides the options: ${water.class.toLowerCase()}`,
    detail: `${WATER_SOURCE_LABEL[water.source]} at ECw ${water.ec_dS_m} dS/m (${water.ec_origin}) gives a root-zone ECe of about ${water.ece_expected_dS_m} dS/m. ${best.name}: ${best.factors.water.label}.${avoid[0] ? ` ${avoid[0].name} is ruled out: ${avoid[0].blocked}` : ""}`,
    sources: cite("M2", ...(water.source === "groundwater" ? ["R5"] : [])),
  });
  const GOAL_EVIDENCE: Record<LandUseId, string[]> = {
    "greenhouse-veg": ["N5", "N1"],
    "hydroponic-leafy": ["N5", "N1"],
    "openfield-winter-veg": ["N5", "N1"],
    "date-palms": ["N12"],
    "fodder-tse": ["R4"],
    "table-eggs": ["N3", "N5"],
    "sheep-goats": ["N3", "N5"],
    aquaculture: ["N5"],
  };
  const goalSources = cite(...GOAL_EVIDENCE[best.id]);
  const prodBest = prod.find((p) => (FAO_ITEMS[best.id] ?? []).includes(p.item));
  insights.push({
    title: "Market and national goals",
    detail: `${goalOf(best)}. Market baseline for ${lcFirst(best.name)}: ${landUseOption(best.id).market}.${prodBest ? ` FAOSTAT values local ${prodBest.item.toLowerCase()} output at ${n(prodBest.value_thousand_usd_2015)} thousand US$ (${prodBest.year}, constant 2014–2016 prices)${prodBest.change_5y_pct != null ? `, ${prodBest.change_5y_pct >= 0 ? "up" : "down"} ${Math.abs(prodBest.change_5y_pct)}% in five years` : ""}.` : ""}`,
    sources: [...goalSources, ...(prodBest ? cite("D3") : [])],
  });
  // Trade and politics, by what was known on the date.
  if (has("R1")) {
    insights.push({
      title: "Trade risk makes local supply worth more",
      detail: `Qatar imports most of its food, and the 2026 war cut tanker traffic through Hormuz, the only sea route to its ports, by more than 90% within days${has("N9") ? "; officials credit local protected farms and reserves for keeping Qatar's markets stable" : ""}. ${best.category === "livestock" ? "Feed and fertiliser come through the same routes, so budget for dearer inputs." : "Fertiliser prices rose too (urea up more than 20%), so budget for dearer inputs."}`,
      sources: cite("R1", "N9"),
    });
  } else if (has("R4") || has("N16") || has("R2")) {
    insights.push({
      title: "Policy favours local production",
      detail: "Since the 2017 blockade Qatar has combined local production, strategic reserves and diversified trade; the 2030 strategy gives the private sector a pivotal role in expanding local output.",
      sources: cite("R4", "N16", "R2", "N5"),
    });
  }
  if (tariffsKnown && ["greenhouse-veg", "openfield-winter-veg"].some((id) => top.some((o) => o.id === id))) {
    insights.push({
      title: "New import tariffs protect the local season",
      detail: "Decree No. 45 of 2026 adds a 15% tariff on imported tomatoes (Jan–May), eggplants (Jan–Apr, Nov–Dec) and zucchini (Jan–Apr, Oct–Dec); GCC produce is exempt.",
      sources: cite("N6", "N7"),
    });
  }
  const trend = eco.climate_trend.summer_max_temp_change_c_per_decade;
  if (trend != null && trend > 0 && insights.length < 6) {
    insights.push({
      title: "Summers are getting hotter",
      detail: `Summer maximums here have risen about ${trend} °C per decade (AgERA5, ${eco.climate_trend.period}); last 12 months: hottest ${climate.hottest_c} °C, ${climate.days_above_45c} days above 45 °C.`,
      sources: cite("D2", "R8"),
    });
  }
  if (sc.robot && insights.length < 6) {
    insights.push({
      title: "Robot survey of the soil",
      detail: `${sc.robot.readings} readings at 0–30 cm average ${sc.robot.mean_vwc_pct}% water by volume; this ${eco.soil.texture} holds about ${r1(soil.thetaFc * 100)}% at field capacity, so it drains fast and needs drip with short, frequent irrigations.`,
      sources: [],
    });
  }

  // Warnings
  const warnings: DatasetWarning[] = [];
  if (water.class === "Severe restriction" && water.source === "groundwater") {
    warnings.push({
      severity: "warning",
      title: "Well water too salty for most vegetables",
      when: "Before investing",
      detail: `At ECw ${water.ec_dS_m} dS/m only salt-tolerant uses work without treatment.`,
      action: "Budget for RO treatment or a desalinated connection before planning vegetables.",
    });
  }
  if (water.ec_origin === "basin typical") {
    warnings.push({
      severity: "warning",
      title: "Water salinity is assumed, not measured",
      when: "Before investing",
      detail: `The ranking uses the ${loc.groundwater_basin} basin typical ECw of ${water.ec_dS_m} dS/m; a real test can change the best option.`,
      action: "Test the well's EC before investing.",
    });
  }
  if (water.source === "groundwater") {
    warnings.push({
      severity: "watch",
      title: "The aquifer is over-pumped",
      when: "Long term",
      detail: `Qatar pumps about ${WATER_POLICY.groundwaterAbstraction_Mm3_per_yr} million m³ of groundwater a year against a safe yield of about ${WATER_POLICY.groundwaterSafeYield_Mm3_per_yr} million m³; salinity rises where wells are over-used.`,
      action: "Choose water-thrifty crops, use drip and meter the well.",
    });
    cite("R5");
  }
  const extreme = sc.weather.next.filter((d) => d.tmax >= 45).map((d) => dayLabel(d.date));
  const dusty = sc.weather.next.filter((d) => d.wind_mean >= 8).map((d) => dayLabel(d.date));
  if (extreme.length) {
    warnings.push({ severity: "warning", title: "Extreme heat this week", when: whenDays(extreme, forecastDays), detail: `${list(extreme)} reach 45 °C or more.`, action: "Do site work in the early morning; don't plant or transplant until it cools." });
  }
  if (dusty.length) {
    warnings.push({ severity: "watch", title: "Dusty, windy days", when: whenDays(dusty, forecastDays), detail: `${list(dusty)} average 8 m/s or more.`, action: "Plan windbreaks on the north-west side before planting." });
  }
  if (best.id === "openfield-winter-veg" || top.some((o) => o.id === "openfield-winter-veg")) {
    warnings.push({ severity: "watch", title: "Winter glut", when: "December–March", detail: "December–March is the peak of local supply, when cucumber, eggplant and zucchini prices fall.", action: "Plant early (Sep–Oct) or late (Feb) to sell outside the glut." });
    cite("N15");
  }
  if (has("R1") && (best.id === "table-eggs" || best.id === "sheep-goats")) {
    warnings.push({ severity: "watch", title: "Imported feed is exposed to shipping", when: "Ongoing", detail: "Feed comes by sea through Hormuz, where traffic collapsed in March 2026.", action: "Hold feed stock for several weeks and line up two suppliers." });
  } else if (has("R4") && (best.id === "table-eggs" || best.id === "sheep-goats")) {
    warnings.push({ severity: "watch", title: "Imported feed depends on open trade routes", when: "Ongoing", detail: "Feed is imported, and the 2017 blockade showed how quickly a supply route can close.", action: "Hold feed stock for several weeks and line up two suppliers." });
  }
  const order = { critical: 0, warning: 1, watch: 2 };
  warnings.sort((a, b) => order[a.severity] - order[b.severity]);

  // Forecast
  const w = weather;
  const maxT = Math.max(...w.air_temperature.next_7d_max);
  const minT = Math.min(...w.air_temperature.next_7d_max);
  const rain7 = r1(w.rain.next_7d.reduce((a, b) => a + b, 0));
  const plantable = (FARM_PLAN[best.id].months ?? []).includes(month) || (FARM_PLAN[best.id].months ?? []).includes(monthOf(addDays(sc.asOf, 7)));
  const weekUse = extreme.length
    ? "too hot for planting; use the mornings for surveys, soil tests and a well test"
    : plantable
      ? `a good window to start ${lcFirst(FARM_PLAN[best.id].crop.split(" (")[0])} if the site is ready`
      : "fine for land preparation, soil sampling and a well test";
  const next7 = `Highs of ${minT}–${maxT} °C, humidity up to ${Math.max(...w.relative_humidity.next_7d_max)}% at night, wind up to ${Math.max(...w.wind.next_7d_max)} m/s${rain7 > 0 ? `, ${rain7} mm of rain` : ", no rain"}: ${weekUse}.`;
  const seasonAhead =
    season === "summer"
      ? `It is summer (${monthName(month)}), when local vegetables are short and prices highest; from October the open-field season starts and prices ease, with the glut from December to March.`
      : season === "peak"
        ? `This is the winter peak (${monthName(month)}): open-field produce floods the market until March; from June to September local supply collapses and prices rise, which only cooled or indoor systems can serve.`
        : `The ${SEASON_LABEL[season]} is a planting window: open-field crops go in from September to November and are harvested into the winter peak; summer production needs cooling.`;
  const longTerm = `By 2030 Qatar targets ${goals.filter((g) => g.target_2030_pct != null && (g.gap_points ?? 0) > 0).slice(0, 3).map((g) => `${g.target_2030_pct}% for ${g.product.toLowerCase()} (now ${g.current_pct}%)`).join(", ")}${has("N17") ? ", with 40% less water per tonne of crops" : ""}.${trend != null && trend > 0 ? ` Summer heat here is rising about ${trend} °C per decade, so cooling costs will grow.` : ""}${water.source === "groundwater" ? " Groundwater will keep getting saltier where it is over-pumped." : ""}`;
  if (has("N17")) cited.add("N17");

  // Economics
  const bestEcon = economics[0];
  const figures: Figure[] = [
    { label: "Set-up cost", value: best.capex, basis: best.capex_note },
    { label: "First income", value: best.first_income, basis: best.name },
  ];
  if (bestEcon.water_m3_yr != null) figures.push({ label: "Water a year", value: `${n(bestEcon.water_m3_yr)} m³`, basis: `${n(best.water_m3_ha_yr!)} m³/ha × ${sc.areaHa} ha, FAO-56 ET₀ at this site` });
  if (bestEcon.pumping_cost_qar_yr != null) figures.push({ label: "Pumping energy", value: `QAR ${n(bestEcon.pumping_cost_qar_yr)} a year`, basis: `QAR ${GROUNDWATER_COST_QAR_PER_M3}/m³ (indicative)` });
  if ("indicative_price_qar_kg" in bestEcon && bestEcon.indicative_price_qar_kg) {
    const p = bestEcon.indicative_price_qar_kg;
    figures.push({ label: `${p.crop[0].toUpperCase()}${p.crop.slice(1)} price`, value: `QAR ${p.summer.low}–${p.summer.high}/kg in summer, ${p.winter_peak.low}–${p.winter_peak.high} at the winter peak`, basis: "indicative farm-gate prices" });
  }
  if (prodBest) figures.push({ label: "Local production value", value: `${n(prodBest.value_thousand_usd_2015)} thousand US$ (${prodBest.year})`, basis: "FAOSTAT, constant 2014–2016 US$" });
  const advice: string[] = [];
  if (best.id === "greenhouse-veg" || best.id === "hydroponic-leafy") {
    if (has("R3")) {
      advice.push("Build in a greenhouse rather than a fully indoor vertical farm: in Qatar a greenhouse produced tomato at US$3.19/kg against US$3.77/kg in a vertical farm.");
      cited.add("R3");
    }
    advice.push("Aim the harvest at June–September, when local supply collapses and prices peak.");
    cite("N14");
  }
  if (has("N10") && ["greenhouse-veg", "hydroponic-leafy", "openfield-winter-veg"].includes(best.id)) {
    advice.push("Apply for Ministry of Municipality support: greenhouse structures, hydroponic systems, irrigation and seeds.");
    cited.add("N10");
  }
  if (has("N9")) {
    if (best.category === "crops") advice.push("Sign an off-take with Mahaseel, which markets for more than 400 local farmers, before the first harvest.");
    cited.add("N9");
  }
  if (has("N11") && best.capex === "high") {
    advice.push("Margins in the local market are narrow, so size the first phase small and prove the yields.");
    cited.add("N11");
  }
  if (best.id === "date-palms") advice.push("Plant premium varieties and sell fresh (rutab) directly at the summer Local Dates Festival.");
  if (best.id === "date-palms") cite("N13", "N12");
  if (bestEcon.pumping_cost_qar_yr != null) advice.push("Pumping is cheap but the aquifer is not: water-thrifty systems protect the farm's future.");
  if (!advice.length) advice.push(`Match the first phase to a ${budget} budget and expand once the first income arrives.`);
  const econSummary = `${best.name} needs a ${best.capex} set-up budget (${lcFirst(best.capex_note)}); time to first income: ${lcFirst(best.first_income)}.${bestEcon.water_m3_yr != null ? ` It uses about ${n(bestEcon.water_m3_yr)} m³ of water a year on ${sc.areaHa} ha.` : ""}`;

  // Recommendations
  const recs: Recommendation[] = [];
  if (water.ec_origin !== "measured" && water.source === "groundwater") recs.push({ priority: "high", action: "Test the well's salinity (EC) and yield", when: "Before any investment", why: "Water salinity decides which options work here." });
  if (!sc.robot) recs.push({ priority: "medium", action: "Run a robot soil-moisture survey across the plot", when: "This week", why: "It shows how fast the soil drains and where it holds water." });
  recs.push(
    ...best.first_steps.slice(0, 3).map((s, i): Recommendation => ({
      priority: i === 0 ? "high" : "medium",
      action: s,
      when: i === 0 ? "Now" : best.category === "crops" ? "Before planting" : "Before stocking",
      why: `${i === 0 ? "First" : "Next"} step for ${lcFirst(best.name)}, the best fit here.`,
    })),
  );
  if (top[1]) recs.push({ priority: "low", action: `Keep ${lcFirst(top[1].name)} as the fallback`, when: "If the first plan stalls", why: top[1].factors.water.label });

  // Crop plan
  const recommended = top.map((o) => ({
    crop: plan(o).crop,
    farm_type: plan(o).farm_type,
    when: plan(o).months ? `Plant ${monthsLabel(plan(o).months!)}` : "Start any time of year",
    why: `${o.fit === "strong" ? "Strong fit" : "Possible fit"}. ${o.why.slice(0, 2).map(noStop).join("; ") || noStop(o.summary)}.`,
  }));
  const avoidList = avoid.map((o) => ({ crop: plan(o).crop, why: o.blocked! }));

  // Summary
  const kind = best.category === "crops" ? "Crops" : best.category === "livestock" ? "Livestock" : "Fish";
  const interestLabel = INTEREST_LABEL[sc.interest];
  const interestLead =
    sc.interest === "any"
      ? null
      : interestBlocked
        ? `${interestLabel.charAt(0).toUpperCase() + interestLabel.slice(1)} won't work here: ${lcFirst(noStop(interestBlocked.blocked!))}. ${best.name} (${plan(best).farm_type}) is the best alternative.`
        : `For ${interestLabel}, ${lcFirst(best.name)} (${plan(best).farm_type}) is the best choice here${viable[0] !== best ? `, though ${lcFirst(viable[0].name)} fits this land better overall` : top[1]?.category === sc.interest ? `, ahead of ${lcFirst(top[1].name)}` : ""}.`;
  const lead = interestLead ?? {
    overall: `${best.name} is the best use of this ${sc.areaHa} ha plot ${loc.place}${top[1] ? `, with ${lcFirst(top[1].name)} as the runner-up` : ""}.`,
    market: `${best.name} has the best market case here: ${lcFirst(noStop(goalOf(best)))}.`,
    "farm type": `${kind}: ${lcFirst(best.name)} (${plan(best).farm_type}) fits this land best${top[1] ? `, ahead of ${lcFirst(top[1].name)}` : ""}.`,
    risk: `${best.name} carries the least risk here; ${warnings[0] ? `the main risk to plan for: ${lcFirst(warnings[0].title)}` : "water and prices still need watching"}.`,
    budget: `On a ${budget} budget, ${lcFirst(best.name)} is the smartest start: ${best.capex} set-up cost; time to first income: ${lcFirst(best.first_income)}.`,
  }[sc.focus];
  const reason = choose(pick, [
    `${best.category === "crops" ? `The water (ECw ${water.ec_dS_m} dS/m) carries ${water.class === "No restriction" ? "no restriction" : `a ${lcFirst(water.class)}`} for irrigation. ` : ""}${noStop(best.factors.water.label)}. ${noStop(goalOf(best))}.`,
    `${noStop(best.why[0] ?? best.summary)}.`,
  ]);
  const avoidText = avoid[0] ? ` Avoid ${lcFirst(plan(avoid[0]).crop)} (${lcFirst(noStop(avoid[0].blocked!))}).` : "";
  const summary = `${lead} ${reason}${avoidText}`;

  const sources = evidence.filter((e) => cited.has(e.id)).map((e) => ({ id: e.id, title: e.title, url: e.url }));
  const gaps: string[] = [];
  if (sc.water.ec == null) gaps.push(`Water EC not given: used ${water.ec_dS_m} dS/m (${water.ec_origin}).`);
  if (!sc.budget) gaps.push("Budget not given: assumed medium.");
  if (!sc.robot) gaps.push("No robot soil survey of this plot yet.");
  gaps.push("Prices and set-up costs are indicative; get quotes and check Mahaseel or the central market.");
  if (!prod.length) gaps.push(`No FAOSTAT production value for ${lcFirst(best.name)}.`);

  const output: ModelOutput = {
    task: "land_analysis",
    summary,
    insights: insights.slice(0, 6),
    warnings: warnings.slice(0, 5),
    forecast: {
      next_7_days: next7,
      days: sc.weather.next.map((d, i) =>
        forecastDay({
          date: d.date,
          tmax: weather.air_temperature.next_7d_max[i],
          rain: weather.rain.next_7d[i],
          extremeHeat: d.tmax >= 45,
          heat: d.tmax >= 40,
          strongWind: d.wind_mean >= 8,
          humid: d.rh_max >= 90,
        }),
      ),
      season_ahead: seasonAhead,
      long_term: longTerm,
    },
    economic_advice: { summary: econSummary, figures: figures.slice(0, 6), advice: advice.slice(0, 5) },
    recommendations: recs.slice(0, 6),
    crop_plan: { recommended, avoid: avoidList, harvest: null },
    sources,
    data_gaps: gaps.slice(0, 5),
  };
  return { input, output };
}


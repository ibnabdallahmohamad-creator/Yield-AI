/**
 * Facts the AI reasons over beyond today's readings, all computed in code so every number the model
 * quotes is traceable:
 *
 *  - location  — where the farm is in Qatar (lat/lng, nearest town, coast, groundwater basin)
 *  - air       — today's air from the four core sensors' view: temperature, humidity, wind, VPD
 *  - outlook   — the next 7 days: forecast weather, crop water use and a projected irrigation
 *                schedule (FAO-56 daily water balance run forward from today's measured depletion)
 *  - economics — expected harvest, revenue and what salinity and water cost, in QAR (indicative)
 *  - harvest   — where the crop is in its season, the harvest window, and what to plant next
 *
 * Thresholds marked "indicative" are rules of thumb (like `crop-guides.ts`), not published tables.
 */
import {
  actualVapourPressureFromRhMaxMin_kPa,
  adjustedDepletionFraction,
  irrigationDepthWithLeaching_mm,
  kcForDay,
  meanSaturationVapourPressure_kPa,
  windSpeedAt2m_m_per_s,
} from "../agronomy";
import { CROPS, type CropId } from "../agronomy-tables";
import { HEAT_STRESS_C } from "../crop-guides";
import { addDays, daysBetween } from "../data/time";
import { goalFor, type NationalGoal } from "../qatar/food-security";
import { describeLocation, type QatarLocation } from "../qatar/location";
import {
  CROP_ECONOMICS,
  GROUNDWATER_COST_QAR_PER_M3,
  monthsLabel,
  OPEN_FIELD_PLANTING,
  priceSignal,
  qatarSeason,
  type PriceSignal,
  type QatarSeason,
} from "../qatar/market";
import type { FarmBundle, FarmDay } from "../types";
import { rankCrops, VEGETABLE_CROPS } from "./analysis";

/** Daily mean wind at 10 m above which spraying drifts and sprinklers lose water, m/s (≈ 20 km/h). Indicative. */
export const WINDY_M_S = 5.5;
/** Daily mean wind at 10 m that usually means blowing dust (Shamal days), m/s (≈ 29 km/h). Indicative. */
export const STRONG_WIND_M_S = 8;
/** Night-time humidity at or above which dew forms and fungal disease spreads, %. Indicative. */
export const HUMID_RH_MAX = 90;
/** Air temperature at which most crops shut down and young plants scorch, °C. Indicative. */
export const EXTREME_HEAT_C = 45;
/** Horizon of the outlook, days after today. */
export const OUTLOOK_DAYS = 7;

const r = (v: number | null | undefined, d = 1) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const monthOf = (date: string) => Number(date.slice(5, 7));
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const weekdayOf = (date: string) => WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()];

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export function farmLocation(bundle: Pick<FarmBundle, "farm">): QatarLocation {
  return describeLocation([bundle.farm.lng, bundle.farm.lat], bundle.farm.region);
}

// ---------------------------------------------------------------------------
// Air today (temperature, humidity, wind)
// ---------------------------------------------------------------------------

export interface AirToday {
  temperature_max_c: number | null;
  temperature_min_c: number | null;
  humidity_max_pct: number | null;
  humidity_min_pct: number | null;
  /** Mean wind speed at 2 m (converted from 10 m, FAO-56 Eq. 47), m/s. */
  wind_2m_m_s: number | null;
  /** Mean wind speed at 10 m as measured or forecast, m/s. */
  wind_10m_m_s: number | null;
  /** Vapour pressure deficit es − ea (FAO-56 Eq. 12 and 17), kPa. */
  vpd_kpa: number | null;
  /** Dew point from ea (inverse of FAO-56 Eq. 11), °C. */
  dew_point_c: number | null;
  /** Where temperature and humidity came from; wind is always from Open-Meteo until a station sends it. */
  source: "probe mast" | "open-meteo" | null;
}

export function dewPoint_C(ea_kPa: number): number {
  const x = Math.log(ea_kPa / 0.6108);
  return (237.3 * x) / (17.27 - x);
}

export function airToday(day: FarmDay): AirToday {
  const { airTmax: tmax, airTmin: tmin, rhMax, rhMin, wind10 } = day;
  let vpd: number | null = null;
  let dew: number | null = null;
  if (tmax != null && tmin != null && rhMax != null && rhMin != null) {
    const ea = actualVapourPressureFromRhMaxMin_kPa(tmin, tmax, rhMax, rhMin);
    vpd = Math.max(0, meanSaturationVapourPressure_kPa(tmax, tmin) - ea);
    dew = dewPoint_C(ea);
  }
  return {
    temperature_max_c: tmax,
    temperature_min_c: tmin,
    humidity_max_pct: rhMax,
    humidity_min_pct: rhMin,
    wind_2m_m_s: wind10 != null ? r(windSpeedAt2m_m_per_s(wind10, 10), 1) : null,
    wind_10m_m_s: r(wind10, 1),
    vpd_kpa: r(vpd, 2),
    dew_point_c: r(dew, 1),
    source: day.airSource === "probe" ? "probe mast" : day.airSource === "open-meteo" ? "open-meteo" : null,
  };
}

// ---------------------------------------------------------------------------
// Outlook — the next 7 days
// ---------------------------------------------------------------------------

export type DayFlag = "heat" | "extreme-heat" | "windy" | "strong-wind" | "humid" | "rain" | "irrigate";

export interface OutlookDay {
  date: string;
  weekday: string;
  tmax_c: number | null;
  tmin_c: number | null;
  humidity_max_pct: number | null;
  humidity_min_pct: number | null;
  wind_10m_m_s: number | null;
  rain_mm: number | null;
  et0_mm: number | null;
  /** Crop water use ETc = Kc × ET₀, mm. */
  etc_mm: number | null;
  /** Projected gross irrigation that day (with the leaching fraction), mm; 0 when none is due. */
  irrigate_mm: number | null;
  flags: DayFlag[];
}

export interface Outlook {
  horizon_days: number;
  /** True when today's depletion is already past the trigger, so the projection assumes today's irrigation happens. */
  assumes_irrigation_today: boolean;
  days: OutlookDay[];
  irrigations: number | null;
  irrigation_gross_mm: number | null;
  water_m3: number | null;
  crop_water_use_mm: number | null;
  heat_threshold_c: number;
  heat_days: string[];
  extreme_heat_days: string[];
  windy_days: string[];
  strong_wind_days: string[];
  humid_days: string[];
  /** Days with wind under the spraying limit and no rain. */
  calm_days: string[];
  rain_mm: number;
}

/** FAO-56 treats light rain as lost to evaporation; 80 % of rain above 2 mm counts here (indicative). */
function effectiveRain_mm(rain: number | null): number {
  return rain != null && rain >= 2 ? 0.8 * rain : 0;
}

/**
 * Run the FAO-56 daily water balance forward from today's measured depletion using the Open-Meteo
 * forecast (ET₀, rain) and the crop's Kc curve, irrigating to field capacity whenever depletion
 * reaches RAW. Weather after `index` comes from `bundle.weatherDays` (forecast for today, observed
 * weather for past dates).
 */
export function buildOutlook(bundle: FarmBundle, day: FarmDay): Outlook | null {
  const future = bundle.weatherDays.filter((w) => w.date > day.date).slice(0, OUTLOOK_DAYS);
  if (future.length === 0) return null;
  const farm = bundle.farm;
  const crop = CROPS[farm.main_crop];
  const heat = HEAT_STRESS_C[farm.main_crop];
  let dr = day.dr;
  let assumesToday = false;
  if (dr != null && day.raw > 0 && dr >= day.raw) {
    dr = 0;
    assumesToday = true;
  }
  const canProject = dr != null;
  let irrigations = 0;
  let gross = 0;
  let use = 0;
  const days: OutlookDay[] = future.map((w) => {
    const dap = daysBetween(farm.planting_date, w.date);
    const kc = kcForDay(bundle.kcAdjusted, crop.stageLengths_days, dap).kc;
    const et0 = w.et0 ?? day.et0;
    const etc = kc != null && et0 != null ? kc * et0 : null;
    let irrigate: number | null = canProject ? 0 : null;
    if (dr != null && etc != null) {
      use += etc;
      const raw = adjustedDepletionFraction(crop.depletionFraction_p, etc) * day.taw;
      dr = Math.min(day.taw, Math.max(0, dr + etc - effectiveRain_mm(w.precip)));
      if (dr >= raw) {
        irrigate = irrigationDepthWithLeaching_mm(dr, day.lr);
        irrigations++;
        gross += irrigate;
        dr = 0;
      }
    }
    const flags: DayFlag[] = [];
    if (w.tmax != null && w.tmax >= EXTREME_HEAT_C) flags.push("extreme-heat");
    else if (w.tmax != null && w.tmax > heat) flags.push("heat");
    if (w.wind10 != null && w.wind10 >= STRONG_WIND_M_S) flags.push("strong-wind");
    else if (w.wind10 != null && w.wind10 >= WINDY_M_S) flags.push("windy");
    if (w.rhMax != null && w.rhMax >= HUMID_RH_MAX) flags.push("humid");
    if ((w.precip ?? 0) >= 1) flags.push("rain");
    if ((irrigate ?? 0) > 0) flags.push("irrigate");
    return {
      date: w.date,
      weekday: weekdayOf(w.date),
      tmax_c: r(w.tmax, 1),
      tmin_c: r(w.tmin, 1),
      humidity_max_pct: r(w.rhMax, 0),
      humidity_min_pct: r(w.rhMin, 0),
      wind_10m_m_s: r(w.wind10, 1),
      rain_mm: r(w.precip, 1),
      et0_mm: r(et0, 1),
      etc_mm: r(etc, 1),
      irrigate_mm: r(irrigate, 0),
      flags,
    };
  });
  const having = (...f: DayFlag[]) => days.filter((d) => d.flags.some((x) => f.includes(x))).map((d) => d.date);
  return {
    horizon_days: days.length,
    assumes_irrigation_today: assumesToday,
    days,
    irrigations: canProject ? irrigations : null,
    irrigation_gross_mm: canProject ? r(gross, 0) : null,
    water_m3: canProject ? r(gross * farm.area_ha * 10, 0) : null,
    crop_water_use_mm: canProject ? r(use, 0) : null,
    heat_threshold_c: heat,
    heat_days: having("heat", "extreme-heat"),
    extreme_heat_days: having("extreme-heat"),
    windy_days: having("windy", "strong-wind"),
    strong_wind_days: having("strong-wind"),
    humid_days: having("humid"),
    calm_days: days.filter((d) => d.wind_10m_m_s != null && d.wind_10m_m_s < WINDY_M_S && !d.flags.includes("rain")).map((d) => d.date),
    rain_mm: r(days.reduce((s, d) => s + (d.rain_mm ?? 0), 0), 1) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Harvest and the next crop
// ---------------------------------------------------------------------------

export type HarvestStatus = "establishing" | "growing" | "harvesting" | "ending" | "finished" | "cutting";

export interface NextCropOption {
  crop: string;
  crop_id: CropId;
  /** % of full yield at today's ECe (FAO-29); null when salinity isn't measured. */
  relative_yield_pct: number | null;
  plant_months: string;
  /** Next open-field planting month from the end of this season. */
  plant_from: string;
  /** Market when its first harvest would land. */
  harvest_market: PriceSignal;
  reason: string;
}

export interface HarvestFacts {
  status: HarvestStatus;
  days_after_planting: number;
  /** First and last harvest dates of the season (alfalfa: next cut). */
  first_harvest: string | null;
  last_harvest: string | null;
  days_to_first_harvest: number | null;
  days_to_season_end: number | null;
  /** Market when the harvest lands (now if harvesting, else at first harvest). */
  harvest_market: PriceSignal;
  harvest_season: QatarSeason;
  next_crops: NextCropOption[];
}

/** Indicative cutting interval for alfalfa in the warm season, days. */
const ALFALFA_CUT_INTERVAL_D = 30;

export function buildHarvest(bundle: FarmBundle, day: FarmDay): HarvestFacts {
  const farm = bundle.farm;
  const crop = CROPS[farm.main_crop];
  const s = crop.stageLengths_days;
  const dap = day.dap;
  const firstDap = s.ini + s.dev;
  const lastDap = s.mid != null && s.late != null ? s.ini + s.dev + s.mid + s.late : null;

  let status: HarvestStatus;
  let first: string | null = addDays(farm.planting_date, firstDap);
  const last: string | null = lastDap != null ? addDays(farm.planting_date, lastDap) : null;
  if (lastDap == null) {
    // Perennial (alfalfa): cut on a cycle once established.
    status = dap < firstDap ? "establishing" : "cutting";
    if (dap >= firstDap) {
      const sinceFirst = dap - firstDap;
      const sinceCut = sinceFirst % ALFALFA_CUT_INTERVAL_D;
      first = addDays(day.date, sinceCut === 0 ? 0 : ALFALFA_CUT_INTERVAL_D - sinceCut);
    }
  } else if (dap < firstDap) status = "growing";
  else if (dap <= lastDap - 14) status = "harvesting";
  else if (dap <= lastDap) status = "ending";
  else status = "finished";

  const harvestDate = status === "harvesting" || status === "ending" ? day.date : (first ?? day.date);
  const endDate = last && last > day.date ? last : day.date;
  const plantMonth = monthOf(addDays(endDate, 14));

  // A perennial stand (alfalfa) is not replanted each season.
  const options = lastDap == null ? [] : nextCrops(farm.main_crop, day.ece, plantMonth);
  return {
    status,
    days_after_planting: dap,
    first_harvest: first,
    last_harvest: last,
    days_to_first_harvest: first ? Math.max(0, daysBetween(day.date, first)) : null,
    days_to_season_end: last ? daysBetween(day.date, last) : null,
    harvest_market: priceSignal(farm.main_crop, monthOf(harvestDate)),
    harvest_season: qatarSeason(monthOf(harvestDate)),
    next_crops: options,
  };
}

/** First month on or after `from` (1–12) that is in `months`, and how many months away it is. */
function nextMonthIn(months: number[], from: number): { month: number; wait: number } {
  for (let k = 0; k < 12; k++) {
    const m = ((from - 1 + k) % 12) + 1;
    if (months.includes(m)) return { month: m, wait: k };
  }
  return { month: from, wait: 0 };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Rank next-season crops by salt tolerance at today's ECe (when measured), the Qatar market when
 * their first harvest lands, and how soon they can go in after this season. Heuristic weights.
 */
export function nextCrops(current: CropId, ece: number | null, fromMonth: number): NextCropOption[] {
  const candidates: CropId[] = current === "alfalfa" ? ["alfalfa"] : VEGETABLE_CROPS;
  const ranked = ece != null ? rankCrops(current, ece) : null;
  const MARKET_POINTS: Record<PriceSignal, number> = { scarce: 10, normal: 0, glut: -10 };
  return candidates
    .map((id) => {
      const c = CROPS[id];
      const rel = ranked?.find((o) => o.crop === id)?.relativeYield ?? null;
      const { month, wait } = nextMonthIn(OPEN_FIELD_PLANTING[id], fromMonth);
      const harvestMonth = ((month - 1 + Math.round((c.stageLengths_days.ini + c.stageLengths_days.dev) / 30)) % 12) + 1;
      const market = priceSignal(id, harvestMonth);
      const score = (rel ?? 100) + MARKET_POINTS[market] - 3 * wait;
      const parts = [
        rel != null ? `${Math.round(rel)}% of full yield at ECe ${ece?.toFixed(1)} dS/m` : null,
        `first harvest around ${MONTH_NAMES[harvestMonth - 1]} (${market === "scarce" ? "short supply, high prices" : market === "glut" ? "glut risk, low prices" : "normal prices"})`,
        wait > 0 ? `plant from ${MONTH_NAMES[month - 1]}` : null,
      ].filter(Boolean);
      return {
        option: {
          crop: c.name,
          crop_id: id,
          relative_yield_pct: rel != null ? Math.round(rel) : null,
          plant_months: monthsLabel(OPEN_FIELD_PLANTING[id]),
          plant_from: MONTH_NAMES[month - 1],
          harvest_market: market,
          reason: parts.join("; "),
        } satisfies NextCropOption,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.option);
}

// ---------------------------------------------------------------------------
// Economics (QAR, indicative)
// ---------------------------------------------------------------------------

export interface Range {
  low: number;
  high: number;
}

export interface EconomicsFacts {
  currency: "QAR";
  area_ha: number;
  /** "season" for vegetables, "year" for alfalfa. */
  per: "season" | "year";
  market_now: PriceSignal;
  market_at_harvest: PriceSignal;
  /** Price averaged over the months the crop is sold (`price_months`), QAR/kg. */
  price_qar_kg: Range;
  price_months: string;
  /** % of full yield after salinity losses; null when salinity isn't measured. */
  relative_yield_pct: number | null;
  expected_yield_t: Range;
  revenue_qar: Range;
  /** Yield and revenue lost to salinity at today's ECe. */
  yield_at_risk_t: Range | null;
  revenue_at_risk_qar: Range | null;
  water_7d_m3: number | null;
  water_7d_cost_qar: number | null;
  /** Extra water per irrigation for the leaching fraction, and its pumping cost. */
  leaching_m3_per_irrigation: number | null;
  leaching_cost_qar_per_irrigation: number | null;
  assumptions: string[];
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const money = (v: number) => roundTo(v, v >= 10_000 ? 1000 : v >= 1000 ? 100 : 10);

/** Months (1–12) from `from` to `to` inclusive, wrapping over the new year; at most 12. */
function monthsBetween(from: string, to: string): number[] {
  const out: number[] = [];
  let y = Number(from.slice(0, 4));
  let m = monthOf(from);
  const endKey = Number(to.slice(0, 4)) * 12 + monthOf(to);
  while (y * 12 + m <= endKey && out.length < 12) {
    out.push(m);
    m = m === 12 ? 1 : m + 1;
    if (m === 1) y++;
  }
  return out.length ? out : [monthOf(from)];
}

/** Indicative price averaged over the selling months, so a harvest that runs into the glut is priced fairly. */
function sellingPrice(crop: CropId, months: number[]): Range {
  const ranges = months.map((m) => CROP_ECONOMICS[crop].price_qar_kg[priceSignal(crop, m)]);
  const avg = (k: "low" | "high") => Math.round((ranges.reduce((s, x) => s + x[k], 0) / ranges.length) * 10) / 10;
  return { low: avg("low"), high: avg("high") };
}

export function buildEconomics(bundle: FarmBundle, day: FarmDay, outlook: Outlook | null, harvest: HarvestFacts): EconomicsFacts {
  const farm = bundle.farm;
  const eco = CROP_ECONOMICS[farm.main_crop];
  const area = farm.area_ha;
  const perennial = farm.main_crop === "alfalfa";
  const sellFrom = harvest.first_harvest && harvest.first_harvest > day.date && !perennial ? harvest.first_harvest : day.date;
  const sellTo = perennial ? addDays(day.date, 330) : harvest.last_harvest && harvest.last_harvest > sellFrom ? harvest.last_harvest : sellFrom;
  const months = monthsBetween(sellFrom, sellTo);
  const price = sellingPrice(farm.main_crop, months);
  const lossPct = day.yieldLoss;
  const rel = lossPct != null ? Math.max(0, 100 - lossPct) : null;
  const factor = (rel ?? 100) / 100;
  const expected = { low: area * eco.yield_t_ha.low * factor, high: area * eco.yield_t_ha.high * factor };
  const atRisk = lossPct != null ? { low: area * eco.yield_t_ha.low * (lossPct / 100), high: area * eco.yield_t_ha.high * (lossPct / 100) } : null;
  const leachMm = day.grossDepth != null && day.netDepth != null ? day.grossDepth - day.netDepth : null;
  const leachM3 = leachMm != null ? leachMm * area * 10 : null;
  return {
    currency: "QAR",
    area_ha: area,
    per: perennial ? "year" : "season",
    market_now: priceSignal(farm.main_crop, monthOf(day.date)),
    market_at_harvest: harvest.harvest_market,
    price_qar_kg: price,
    price_months: perennial ? "all year" : monthsLabel(months),
    relative_yield_pct: rel != null ? Math.round(rel) : null,
    expected_yield_t: { low: r(expected.low, 0)!, high: r(expected.high, 0)! },
    revenue_qar: { low: money(expected.low * 1000 * price.low), high: money(expected.high * 1000 * price.high) },
    yield_at_risk_t: atRisk ? { low: r(atRisk.low, 1)!, high: r(atRisk.high, 1)! } : null,
    revenue_at_risk_qar: atRisk ? { low: money(atRisk.low * 1000 * price.low), high: money(atRisk.high * 1000 * price.high) } : null,
    water_7d_m3: outlook?.water_m3 ?? null,
    water_7d_cost_qar: outlook?.water_m3 != null ? money(outlook.water_m3 * GROUNDWATER_COST_QAR_PER_M3) : null,
    leaching_m3_per_irrigation: leachM3 != null ? r(leachM3, 0) : null,
    leaching_cost_qar_per_irrigation: leachM3 != null ? r(leachM3 * GROUNDWATER_COST_QAR_PER_M3, 0) : null,
    assumptions: [
      `Yield ${eco.yield_t_ha.low}–${eco.yield_t_ha.high} t/ha per ${perennial ? "year (dry matter)" : "season"}, open-field drip (indicative).`,
      `Farm-gate price QAR ${price.low}–${price.high}/kg averaged over the selling months (${perennial ? "all year" : monthsLabel(months)}); indicative, not a quote.`,
      `Groundwater pumping QAR ${GROUNDWATER_COST_QAR_PER_M3.toFixed(2)}/m³ (indicative).`,
      rel == null ? "Salinity is not measured, so no salinity loss is counted." : `Salinity loss ${Math.round(lossPct ?? 0)}% (FAO-29, Maas–Hoffman).`,
    ],
  };
}

// ---------------------------------------------------------------------------
// National goals relevant to this farm
// ---------------------------------------------------------------------------

export function relevantGoals(crop: CropId): NationalGoal[] {
  return crop === "alfalfa" ? [goalFor("green-fodder"), goalFor("red-meat")] : [goalFor("vegetables")];
}

// ---------------------------------------------------------------------------
// Everything together
// ---------------------------------------------------------------------------

export interface FarmFacts {
  location: QatarLocation;
  air: AirToday;
  outlook: Outlook | null;
  harvest: HarvestFacts;
  economics: EconomicsFacts;
  goals: NationalGoal[];
  /** Which of the farm's inputs are measured on site. */
  measured: {
    soil_moisture: boolean;
    air_temperature: boolean;
    air_humidity: boolean;
    wind: "station" | "open-meteo" | "none";
    salinity: boolean;
    ph: boolean;
    npk: boolean;
  };
}

export function buildFarmFacts(bundle: FarmBundle, day: FarmDay): FarmFacts {
  const outlook = buildOutlook(bundle, day);
  const harvest = buildHarvest(bundle, day);
  return {
    location: farmLocation(bundle),
    air: airToday(day),
    outlook,
    harvest,
    economics: buildEconomics(bundle, day, outlook, harvest),
    goals: relevantGoals(bundle.farm.main_crop),
    measured: {
      soil_moisture: day.moisture != null,
      air_temperature: day.airSource === "probe" && day.airTmax != null,
      air_humidity: day.airSource === "probe" && day.rhMax != null,
      wind: day.wind10 != null ? "open-meteo" : "none",
      salinity: day.ec != null,
      ph: day.ph != null,
      npk: day.n != null || day.p != null || day.k != null,
    },
  };
}

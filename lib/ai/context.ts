/**
 * Builds the grounding context sent with every chat question: where the farm is, the latest
 * readings (soil moisture, air temperature, humidity, wind and any soil chemistry), 30-day trends,
 * every FAO-56 / FAO-29 derived value, the 7-day outlook, economics, harvest timing, the Qatar
 * market and national goals, and the latest AI insight.
 */
import { GROWTH_STAGE_LABEL } from "../agronomy";
import { CROPS, CROP_IDS, ECE_CLASSES } from "../agronomy-tables";
import { HEAT_STRESS_C } from "../crop-guides";
import { addDays } from "../data/time";
import { priceSignal, qatarSeason, SEASON_LABEL } from "../qatar/market";
import { compassPoint, formatTime } from "../format";
import type { DashboardData, FarmBundle } from "../types";
import type { ChatContext, ChatNext12h, ChatWeather } from "./contract";
import { lastDataIndex, probeLocation, trend, windowMean } from "./analysis";
import { buildFarmFacts } from "./farm-facts";

const TREND_WINDOW_DAYS = 30;
/** Rain of at least this much (mm) counts as a rain day. */
const RAIN_DAY_MM = 0.5;

const r = (v: number | null | undefined, d = 2) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;

/**
 * Rain and heat over the `windowDays` ending on `asOf`, plus the forecast when `asOf` is the
 * latest day. Built from the Open-Meteo series (`bundle.weatherDays`), never from probe sensors.
 */
export function weatherSummary(bundle: Pick<FarmBundle, "farm" | "weatherDays">, asOf: string, latest: string, windowDays = TREND_WINDOW_DAYS): ChatWeather | null {
  const from = addDays(asOf, -(windowDays - 1));
  const past = bundle.weatherDays.filter((w) => w.date >= from && w.date <= asOf);
  if (past.length === 0) return null;
  const heat = HEAT_STRESS_C[bundle.farm.main_crop];
  const future = asOf === latest ? bundle.weatherDays.filter((w) => w.date > asOf) : [];
  const today = past.find((w) => w.date === asOf) ?? null;
  const rainy = past.filter((w) => (w.precip ?? 0) >= RAIN_DAY_MM);
  const tmaxes = past.map((w) => w.tmax).filter((v): v is number => v != null);
  const hot = (list: typeof past) => list.filter((w) => w.tmax != null && w.tmax > heat).length;
  return {
    source: "open-meteo",
    window_days: past.length,
    rain_total_mm: r(past.reduce((sum, w) => sum + (w.precip ?? 0), 0), 1) ?? 0,
    rain_days: rainy.length,
    last_rain_date: rainy.at(-1)?.date ?? null,
    air_tmax_c: r(today?.tmax, 1),
    air_tmin_c: r(today?.tmin, 1),
    hottest_tmax_c: tmaxes.length ? r(Math.max(...tmaxes), 1) : null,
    heat_stress_threshold_c: heat,
    days_above_heat_threshold: hot(past),
    forecast: future.map((w) => ({
      date: w.date,
      tmax_c: r(w.tmax, 1),
      tmin_c: r(w.tmin, 1),
      rain_mm: r(w.precip, 1),
      rain_chance_pct: r(w.precipProb, 0),
    })),
    forecast_rain_total_mm: future.length ? r(future.reduce((sum, w) => sum + (w.precip ?? 0), 0), 1) : null,
    forecast_days_above_heat_threshold: future.length ? hot(future) : null,
  };
}

/** The hourly 12-hour forecast, compact, for the model. */
export function next12hSummary(bundle: Pick<FarmBundle, "next12h">): ChatNext12h | null {
  const f = bundle.next12h;
  if (!f || f.hours.length === 0) return null;
  const s = f.summary;
  return {
    source: "open-meteo",
    fetched_at: f.fetched_at,
    temp_min_c: r(s.temp_min_c, 1),
    temp_max_c: r(s.temp_max_c, 1),
    hottest_at: s.temp_max_at ? formatTime(s.temp_max_at) : null,
    humidity_min_pct: r(s.humidity_min_pct, 0),
    humidity_max_pct: r(s.humidity_max_pct, 0),
    rain_total_mm: s.rain_total_mm,
    rain_max_chance_pct: r(s.rain_max_prob_pct, 0),
    wind_max_ms: r(s.wind_max_ms, 1),
    gust_max_ms: r(s.gust_max_ms, 1),
    wind_from: s.wind_dir_deg != null ? compassPoint(s.wind_dir_deg) : null,
    hours: f.hours.map((h) => ({
      time: formatTime(h.time),
      temp_c: r(h.temp_c, 1),
      humidity_pct: r(h.humidity_pct, 0),
      rain_mm: r(h.precip_mm, 1),
      rain_chance_pct: r(h.precip_prob_pct, 0),
      wind_ms: r(h.wind_ms, 1),
      gust_ms: r(h.gust_ms, 1),
      wind_from: h.wind_dir_deg != null ? compassPoint(h.wind_dir_deg) : null,
    })),
  };
}

export function buildChatContext(bundle: FarmBundle, data: Pick<DashboardData, "dates">, dateIndex?: number): ChatContext | null {
  const index = lastDataIndex(bundle, dateIndex ?? data.dates.length - 1);
  const day = index >= 0 ? bundle.days[index] : null;
  if (!day) return null;
  const farm = bundle.farm;
  const crop = CROPS[farm.main_crop];
  const facts = buildFarmFacts(bundle, day);
  const month = Number(day.date.slice(5, 7));

  const eceTrend = trend(bundle, index, TREND_WINDOW_DAYS, (d) => d.ece);
  const moistureTrend = trend(bundle, index, TREND_WINDOW_DAYS, (d) => d.moisture);
  const phTrend = trend(bundle, index, TREND_WINDOW_DAYS, (d) => d.ph);
  const tempTrend = trend(bundle, index, TREND_WINDOW_DAYS, (d) => d.temperature);

  const methods = [
    day.et0Method === "penman-monteith"
      ? `ET0: FAO-56 Penman–Monteith (Eq. 6, daily, G = 0); air T/RH from ${day.airSource === "probe" ? "the probe mast sensor" : "Open-Meteo"}, wind and radiation from Open-Meteo`
      : "ET0: FAO-56 Hargreaves (Eq. 52), estimated because a Penman–Monteith input was missing",
    `ETc = Kc × ET0 (FAO-56 Eq. 56); Kc from ${crop.kcSource}, mid/end adjusted for climate (Eq. 62, 65); stage lengths ${crop.stageSource}`,
    `TAW = 1000 (θFC − θWP) Zr, RAW = p × TAW (FAO-56 Eq. 82–83); soil limits FAO-56 Table 19, p and Zr FAO-56 Table 22`,
    "Depletion Dr from measured moisture: Dr = 1000 (θFC − θ) Zr; Ks from FAO-56 Eq. 84",
    `ECe (estimated) = probe bulk EC × calibration factor ${farm.ec_calibration_factor}`,
    `Yield loss: Maas–Hoffman threshold–slope model, ${crop.salinity.source}`,
    "Leaching requirement LR = ECw / (5 ECe − ECw) (FAO-29 Eq. 7), ECe at 90% yield potential",
  ];

  return {
    farm: {
      id: farm.id,
      name: farm.name,
      owner: farm.owner,
      region: farm.region,
      area_ha: farm.area_ha,
      crop: crop.name,
      crop_id: farm.main_crop,
      planting_date: farm.planting_date,
      days_after_planting: day.dap,
      growth_stage: GROWTH_STAGE_LABEL[day.stage],
      soil_type: farm.soil_type.replace("_", " "),
      irrigation_water_ec_dS_m: farm.irrigation_water_ec,
    },
    location: facts.location,
    measured: facts.measured,
    as_of: day.date,
    latest_readings: {
      probes: day.sensors.length,
      moisture_pct: day.moisture,
      soil_temperature_c: day.temperature,
      bulk_ec_dS_m: day.ec,
      ph: day.ph,
      n_mg_kg: day.n,
      p_mg_kg: day.p,
      k_mg_kg: day.k,
      air: facts.air,
      by_probe: day.sensors.map((s) => ({
        sensor_id: s.id,
        location: probeLocation(bundle, s.id),
        moisture_pct: s.moisture,
        ece_dS_m: s.ece,
        ph: s.ph,
        yield_loss_pct: s.yieldLoss,
        water_deficit_pct_of_raw: s.deficitPct,
      })),
    },
    trends: {
      window_days: eceTrend.days,
      ece_change_pct: r(eceTrend.changePct, 1),
      ece_start_dS_m: r(eceTrend.from, 2),
      moisture_change_pct: r(moistureTrend.changePct, 1),
      ph_change: r(phTrend.change, 2),
      soil_temperature_change_c: r(tempTrend.change, 1),
      et0_mean_mm_day: r(windowMean(bundle, index, TREND_WINDOW_DAYS, (d) => d.et0), 2),
    },
    derived: {
      et0_mm_day: day.et0,
      et0_method: day.et0Method,
      et0_open_meteo_mm_day: day.et0OpenMeteo,
      kc: day.kc,
      etc_mm_day: day.etc,
      taw_mm: day.taw,
      raw_mm: day.raw,
      root_zone_depletion_mm: day.dr,
      water_deficit_pct_of_raw: day.deficitPct,
      water_stress_coefficient_ks: day.ks,
      days_until_irrigation: day.daysToIrrigation,
      net_irrigation_depth_mm: day.netDepth,
      gross_irrigation_depth_with_leaching_mm: day.grossDepth,
      ece_dS_m: day.ece,
      salinity_class: ECE_CLASSES.find((c) => c.id === day.salinityClass)?.label ?? null,
      crop_salinity_threshold_dS_m: crop.salinity.threshold_dS_per_m,
      predicted_yield_loss_pct: day.yieldLoss,
      leaching_requirement_pct: r(day.lr * 100, 1) ?? 0,
      methods,
    },
    latest_insight: bundle.insight
      ? {
          risk_score: bundle.insight.risk_score,
          risk_level: bundle.insight.risk_level,
          summary: bundle.insight.summary,
          recommendations: bundle.insight.recommendations,
          crop_suggestion: bundle.insight.crop_suggestion,
          warnings: bundle.insight.warnings,
        }
      : null,
    outlook: facts.outlook,
    harvest: facts.harvest,
    economics: facts.economics,
    national_goals: facts.goals.map((g) => ({
      label: g.label,
      current_pct: g.current_pct,
      current_year: g.current_year,
      target_pct: g.target_pct,
      note: g.note,
    })),
    market: {
      oversupplied: CROP_IDS.filter((c) => CROPS[c].market.status === "oversupplied").map((c) => CROPS[c].name),
      undersupplied: CROP_IDS.filter((c) => CROPS[c].market.status === "undersupplied").map((c) => CROPS[c].name),
      crop_status: crop.market.note,
      season: SEASON_LABEL[qatarSeason(month)],
      scarce_now: CROP_IDS.filter((c) => priceSignal(c, month) === "scarce").map((c) => CROPS[c].name),
      glut_now: CROP_IDS.filter((c) => priceSignal(c, month) === "glut").map((c) => CROPS[c].name),
    },
    weather: weatherSummary(bundle, day.date, data.dates[data.dates.length - 1] ?? day.date),
    weather_next_12h: next12hSummary(bundle),
  };
}

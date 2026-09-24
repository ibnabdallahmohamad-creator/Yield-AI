/**
 * Builds the grounding context sent with every chat question: the latest probe readings,
 * 30-day trends, every FAO-56 / FAO-29 derived value and the latest AI insight.
 */
import { GROWTH_STAGE_LABEL } from "../agronomy";
import { CROPS, CROP_IDS, ECE_CLASSES } from "../agronomy-tables";
import type { DashboardData, FarmBundle } from "../types";
import type { ChatContext } from "./contract";
import { lastDataIndex, probeLocation, trend, windowMean } from "./analysis";

const TREND_WINDOW_DAYS = 30;

const r = (v: number | null | undefined, d = 2) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;

export function buildChatContext(bundle: FarmBundle, data: Pick<DashboardData, "dates">, dateIndex?: number): ChatContext | null {
  const index = lastDataIndex(bundle, dateIndex ?? data.dates.length - 1);
  const day = index >= 0 ? bundle.days[index] : null;
  if (!day) return null;
  const farm = bundle.farm;
  const crop = CROPS[farm.main_crop];

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
        }
      : null,
    market: {
      oversupplied: CROP_IDS.filter((c) => CROPS[c].market.status === "oversupplied").map((c) => CROPS[c].name),
      undersupplied: CROP_IDS.filter((c) => CROPS[c].market.status === "undersupplied").map((c) => CROPS[c].name),
      crop_status: crop.market.note,
    },
  };
}

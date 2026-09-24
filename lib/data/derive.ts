/**
 * Turns farms + daily probe aggregates + weather + AI insights into the dashboard dataset,
 * applying the FAO-56 / FAO-29 engine to every farm-day and every probe.
 */
import {
  adjustKcForClimate,
  adjustedDepletionFraction,
  computeDailyEt0,
  daysUntilIrrigation_d,
  eceFromBulkEc_dS_per_m,
  irrigationDepthWithLeaching_mm,
  kcForDay,
  leachingRequirement_fraction,
  leachingTargetEce_dS_per_m,
  netIrrigationDepth_mm,
  rootZoneDepletion_mm,
  salinityClass,
  schedulingRootDepth_m,
  soilWaterLimits,
  totalAvailableWater_mm,
  waterStressCoefficient,
  windSpeedAt2m_m_per_s,
  yieldLoss_pct,
} from "../agronomy";
import { CROPS } from "../agronomy-tables";
import type { AiInsight } from "../ai/contract";
import type {
  AirSource,
  DashboardData,
  DataSource,
  Farm,
  FarmBundle,
  FarmDay,
  Sensor,
  SensorDaily,
  SensorDay,
  WeatherDay,
} from "../types";
import { round } from "./random";
import { daysBetween } from "./time";
import type { WeatherResult } from "./weather";

/** A probe's air readings count for Tmax/Tmin only if they span most of the day. */
const MIN_AIR_COVERAGE_H = 18;

export interface DeriveInput {
  farms: Farm[];
  daily: SensorDaily[];
  weather: WeatherResult;
  insights: AiInsight[];
  source: DataSource;
  sourceNote: string | null;
  /** Explicit date axis; defaults to the distinct days in `daily` (last `maxDays`). */
  dates?: string[];
  maxDays?: number;
  sensorsByFarm?: Record<string, Sensor[]>;
}

const r = (v: number | null | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) ? round(v, d) : null);

function mean(values: Array<number | null | undefined>): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
}

function latestInsightByFarm(insights: AiInsight[]): Map<string, AiInsight> {
  const map = new Map<string, AiInsight>();
  for (const ins of insights) {
    const prev = map.get(ins.farm_id);
    if (!prev || ins.created_at > prev.created_at) map.set(ins.farm_id, ins);
  }
  return map;
}

/** Mean u2 and RHmin over the window, for the FAO-56 Eq. 62/65 Kc climate adjustment. */
function windowClimate(rows: SensorDaily[], weather: Record<string, WeatherDay> | undefined) {
  const winds = Object.values(weather ?? {})
    .map((w) => (w.wind10 != null ? windSpeedAt2m_m_per_s(w.wind10, 10) : null))
    .filter((v): v is number => v != null);
  const rhProbe = rows.map((row) => row.rh_min).filter((v): v is number => v != null);
  const rhWeather = Object.values(weather ?? {})
    .map((w) => w.rhMin)
    .filter((v): v is number => v != null);
  return {
    u2: winds.length ? winds.reduce((a, b) => a + b, 0) / winds.length : null,
    rhMin: rhProbe.length
      ? rhProbe.reduce((a, b) => a + b, 0) / rhProbe.length
      : rhWeather.length
        ? rhWeather.reduce((a, b) => a + b, 0) / rhWeather.length
        : null,
  };
}

/** Derive one farm-day from its probe aggregates. Exported for live updates. */
export function deriveFarmDay(
  farm: Farm,
  date: string,
  rows: SensorDaily[],
  weatherDay: WeatherDay | undefined,
  kcAdjusted: FarmBundle["kcAdjusted"],
): FarmDay | null {
  if (rows.length === 0) return null;
  const crop = CROPS[farm.main_crop];
  const { thetaFc, thetaWp } = soilWaterLimits(farm.soil_type, { thetaFc: farm.theta_fc, thetaWp: farm.theta_wp });
  const rootDepth = schedulingRootDepth_m(crop);
  const taw = totalAvailableWater_mm(thetaFc, thetaWp, rootDepth);
  const eceTarget = leachingTargetEce_dS_per_m(crop);
  const lr = leachingRequirement_fraction(farm.irrigation_water_ec, eceTarget);

  // Air temperature / humidity: probe air sensor when it covers the day, else Open-Meteo.
  const covered = rows.filter(
    (row) =>
      row.air_tmax != null &&
      row.air_tmin != null &&
      (Date.parse(row.last_ts) - Date.parse(row.first_ts)) / 3_600_000 >= MIN_AIR_COVERAGE_H,
  );
  let airSource: AirSource | null = null;
  let airTmax: number | null = null;
  let airTmin: number | null = null;
  let rhMax: number | null = null;
  let rhMin: number | null = null;
  if (covered.length > 0) {
    airSource = "probe";
    airTmax = mean(covered.map((row) => row.air_tmax));
    airTmin = mean(covered.map((row) => row.air_tmin));
    rhMax = mean(covered.map((row) => row.rh_max));
    rhMin = mean(covered.map((row) => row.rh_min));
  } else if (weatherDay?.tmax != null && weatherDay?.tmin != null) {
    airSource = "open-meteo";
    airTmax = weatherDay.tmax;
    airTmin = weatherDay.tmin;
    rhMax = weatherDay.rhMax;
    rhMin = weatherDay.rhMin;
  } else if (rows.some((row) => row.air_tmax != null)) {
    airSource = "probe"; // partial-day probe data is better than nothing (Hargreaves only)
    airTmax = mean(rows.map((row) => row.air_tmax));
    airTmin = mean(rows.map((row) => row.air_tmin));
  }

  const et0Result = computeDailyEt0({
    date,
    latitude_deg: farm.lat,
    altitude_m: farm.elevation_m,
    tmax_C: airTmax,
    tmin_C: airTmin,
    rhMax_pct: rhMax,
    rhMin_pct: rhMin,
    windSpeed_m_per_s: weatherDay?.wind10 ?? null,
    windHeight_m: 10,
    rs_MJ_per_m2_day: weatherDay?.rs ?? null,
  });

  const dap = daysBetween(farm.planting_date, date);
  const { kc, stage } = kcForDay(kcAdjusted, crop.stageLengths_days, dap);
  const et0 = et0Result?.et0_mm_per_day ?? null;
  const etc = kc != null && et0 != null ? kc * et0 : null;
  const pAdj = etc != null ? adjustedDepletionFraction(crop.depletionFraction_p, etc) : crop.depletionFraction_p;
  const raw = pAdj * taw;
  const { threshold_dS_per_m: threshold, slope_pct_per_dS_per_m: slope } = crop.salinity;

  const sensors: SensorDay[] = rows
    .slice()
    .sort((a, b) => a.sensor_id.localeCompare(b.sensor_id))
    .map((row) => {
      const theta = row.moisture != null ? row.moisture / 100 : null;
      const dr = theta != null ? rootZoneDepletion_mm(thetaFc, theta, rootDepth, taw) : null;
      const ece = row.ec != null ? eceFromBulkEc_dS_per_m(row.ec, farm.ec_calibration_factor) : null;
      return {
        id: row.sensor_id,
        moisture: r(row.moisture, 1),
        temperature: r(row.temperature, 1),
        ec: r(row.ec, 3),
        ece: r(ece, 2),
        ph: r(row.ph, 2),
        n: r(row.n, 0),
        p: r(row.p, 0),
        k: r(row.k, 0),
        dr: r(dr, 1),
        deficitPct: dr != null && raw > 0 ? r((dr / raw) * 100, 0) : null,
        yieldLoss: ece != null ? r(yieldLoss_pct(ece, threshold, slope), 1) : null,
      };
    });

  const dr = mean(sensors.map((s) => s.dr));
  const ece = mean(sensors.map((s) => s.ece));
  const days = dr != null && etc != null ? daysUntilIrrigation_d(dr, raw, etc) : null;
  return {
    date,
    readings: rows.reduce((a, row) => a + row.n_readings, 0),
    moisture: r(mean(rows.map((row) => row.moisture)), 1),
    temperature: r(mean(rows.map((row) => row.temperature)), 1),
    ec: r(mean(rows.map((row) => row.ec)), 3),
    ece: r(ece, 2),
    ph: r(mean(rows.map((row) => row.ph)), 2),
    n: r(mean(rows.map((row) => row.n)), 0),
    p: r(mean(rows.map((row) => row.p)), 0),
    k: r(mean(rows.map((row) => row.k)), 0),
    airTmax: r(airTmax, 1),
    airTmin: r(airTmin, 1),
    rhMax: r(rhMax, 0),
    rhMin: r(rhMin, 0),
    airSource,
    wind10: r(weatherDay?.wind10, 2),
    rs: r(weatherDay?.rs, 2),
    et0OpenMeteo: r(weatherDay?.et0, 2),
    et0: r(et0, 2),
    et0Method: et0Result?.method ?? null,
    dap,
    stage,
    kc: r(kc, 3),
    etc: r(etc, 2),
    rootDepth,
    taw: round(taw, 1),
    pAdj: round(pAdj, 3),
    raw: round(raw, 1),
    dr: r(dr, 1),
    deficitPct: dr != null && raw > 0 ? r((dr / raw) * 100, 0) : null,
    ks: dr != null ? r(waterStressCoefficient(taw, raw, dr), 2) : null,
    daysToIrrigation: days != null && Number.isFinite(days) ? r(days, 1) : null,
    netDepth: dr != null ? r(netIrrigationDepth_mm(dr), 1) : null,
    grossDepth: dr != null ? r(irrigationDepthWithLeaching_mm(dr, lr), 1) : null,
    eceTarget: round(eceTarget, 2),
    lr: round(lr, 3),
    yieldLoss: r(mean(sensors.map((s) => s.yieldLoss)), 1),
    salinityClass: ece != null ? salinityClass(ece) : null,
    sensors,
  };
}

export function computeKcAdjusted(farm: Farm, rows: SensorDaily[], weather: Record<string, WeatherDay> | undefined) {
  const crop = CROPS[farm.main_crop];
  const climate = windowClimate(rows, weather);
  if (climate.u2 == null || climate.rhMin == null) return { ...crop.kc };
  return {
    ini: crop.kc.ini,
    mid: round(adjustKcForClimate(crop.kc.mid, climate.u2, climate.rhMin, crop.maxHeight_m), 3),
    end: round(adjustKcForClimate(crop.kc.end, climate.u2, climate.rhMin, crop.maxHeight_m), 3),
  };
}

export function buildDashboardData(input: DeriveInput): DashboardData {
  const maxDays = input.maxDays ?? 60;
  const dates =
    input.dates ?? Array.from(new Set(input.daily.map((row) => row.day))).sort().slice(-maxDays);
  const dateSet = new Set(dates);
  const insights = latestInsightByFarm(input.insights);

  const byFarm = new Map<string, SensorDaily[]>();
  for (const row of input.daily) {
    if (!dateSet.has(row.day)) continue;
    const list = byFarm.get(row.farm_id) ?? [];
    list.push(row);
    byFarm.set(row.farm_id, list);
  }

  const farms: FarmBundle[] = input.farms.map((farm) => {
    const rows = byFarm.get(farm.id) ?? [];
    const weather = input.weather.byFarm[farm.id];
    const kcAdjusted = computeKcAdjusted(farm, rows, weather);
    const byDay = new Map<string, SensorDaily[]>();
    for (const row of rows) {
      const list = byDay.get(row.day) ?? [];
      list.push(row);
      byDay.set(row.day, list);
    }
    let sensors = input.sensorsByFarm?.[farm.id];
    if (!sensors) {
      const latest = new Map<string, Sensor>();
      for (const row of rows.slice().sort((a, b) => a.last_ts.localeCompare(b.last_ts))) {
        latest.set(row.sensor_id, { id: row.sensor_id, lat: row.lat, lng: row.lng });
      }
      sensors = Array.from(latest.values()).sort((a, b) => a.id.localeCompare(b.id));
    }
    return {
      farm,
      sensors,
      kcAdjusted,
      insight: insights.get(farm.id) ?? null,
      days: dates.map((date) => deriveFarmDay(farm, date, byDay.get(date) ?? [], weather?.[date], kcAdjusted)),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    source: input.source,
    sourceNote: input.sourceNote,
    weather: { source: input.weather.source, note: input.weather.note },
    dates,
    farms,
  };
}

/**
 * Harvestar AI agronomy engine.
 *
 * Pure, typed functions. Units are part of every name (e.g. `_kPa`, `_mm_per_day`)
 * and every formula cites its source equation. Coefficient tables (Kc, p, Zr,
 * salt tolerance, soils) live in `lib/agronomy-tables.ts`.
 *
 * Sources
 *  - FAO-56: Allen et al. (1998), FAO Irrigation and Drainage Paper 56.
 *    Chapter 3 (meteorological data), Chapter 4 (ET0), Chapter 6 (Kc), Chapter 8 (water stress).
 *  - FAO-29: Ayers & Westcot (1985), FAO Irrigation and Drainage Paper 29 Rev.1.
 *  - Maas & Hoffman (1977): threshold–slope salt tolerance model.
 */

import {
  CROPS,
  ECE_CLASSES,
  SOILS,
  type CropId,
  type CropParams,
  type SalinityClassId,
  type SoilType,
} from "./agronomy-tables";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Solar constant Gsc = 0.0820 MJ m⁻² min⁻¹ (FAO-56 Eq. 21). */
export const SOLAR_CONSTANT_MJ_PER_M2_MIN = 0.082;
/** Stefan–Boltzmann constant σ = 4.903 × 10⁻⁹ MJ K⁻⁴ m⁻² day⁻¹ (FAO-56 Eq. 39). */
export const STEFAN_BOLTZMANN_MJ_PER_K4_M2_DAY = 4.903e-9;
/** Albedo of the hypothetical grass reference crop, α = 0.23 (FAO-56 Eq. 38). */
export const REFERENCE_ALBEDO = 0.23;
/** Conversion from MJ m⁻² day⁻¹ to equivalent evaporation in mm day⁻¹ (FAO-56 Eq. 20: 1 / λ = 0.408). */
export const MJ_TO_MM_EVAPORATION = 0.408;
/** Ångström coefficients as = 0.25, bs = 0.50 when no calibration is available (FAO-56 Eq. 35). */
export const ANGSTROM_AS = 0.25;
export const ANGSTROM_BS = 0.5;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function degToRad(deg: number): number {
  return (Math.PI / 180) * deg; // FAO-56 Eq. 22
}

/** Day of the year J (1 = 1 January) for an ISO date string `YYYY-MM-DD` or a Date (UTC). */
export function dayOfYear(date: string | Date): number {
  const d = typeof date === "string" ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((today - start) / 86_400_000) + 1;
}

// ---------------------------------------------------------------------------
// FAO-56 Chapter 3 — atmospheric parameters
// ---------------------------------------------------------------------------

/** Atmospheric pressure P (kPa) from altitude z (m above sea level). FAO-56 Eq. 7. */
export function atmosphericPressure_kPa(altitude_m: number): number {
  return 101.3 * Math.pow((293 - 0.0065 * altitude_m) / 293, 5.26);
}

/** Psychrometric constant γ (kPa °C⁻¹) = 0.665 × 10⁻³ P. FAO-56 Eq. 8. */
export function psychrometricConstant_kPa_per_C(pressure_kPa: number): number {
  return 0.665e-3 * pressure_kPa;
}

// ---------------------------------------------------------------------------
// FAO-56 Chapter 3 — vapour pressure
// ---------------------------------------------------------------------------

/** Saturation vapour pressure e°(T) (kPa) at air temperature T (°C). FAO-56 Eq. 11. */
export function saturationVapourPressure_kPa(t_C: number): number {
  return 0.6108 * Math.exp((17.27 * t_C) / (t_C + 237.3));
}

/** Mean saturation vapour pressure es (kPa) from daily Tmax/Tmin. FAO-56 Eq. 12. */
export function meanSaturationVapourPressure_kPa(tmax_C: number, tmin_C: number): number {
  return (saturationVapourPressure_kPa(tmax_C) + saturationVapourPressure_kPa(tmin_C)) / 2;
}

/**
 * Slope of the saturation vapour pressure curve Δ (kPa °C⁻¹) at temperature T (°C).
 * FAO-56 Eq. 13; for daily steps T is the mean daily temperature (Tmax + Tmin) / 2 (Eq. 9).
 */
export function slopeVapourPressureCurve_kPa_per_C(t_C: number): number {
  return (4098 * saturationVapourPressure_kPa(t_C)) / Math.pow(t_C + 237.3, 2);
}

/** Actual vapour pressure ea (kPa) from RHmax and RHmin (%). FAO-56 Eq. 17. */
export function actualVapourPressureFromRhMaxMin_kPa(
  tmin_C: number,
  tmax_C: number,
  rhMax_pct: number,
  rhMin_pct: number,
): number {
  return (
    (saturationVapourPressure_kPa(tmin_C) * (rhMax_pct / 100) +
      saturationVapourPressure_kPa(tmax_C) * (rhMin_pct / 100)) /
    2
  );
}

/** Actual vapour pressure ea (kPa) from mean relative humidity (%). FAO-56 Eq. 19. */
export function actualVapourPressureFromRhMean_kPa(tmin_C: number, tmax_C: number, rhMean_pct: number): number {
  return (rhMean_pct / 100) * meanSaturationVapourPressure_kPa(tmax_C, tmin_C);
}

/** Actual vapour pressure ea (kPa) when humidity data are missing: ea ≈ e°(Tmin). FAO-56 Eq. 48. */
export function actualVapourPressureFromTmin_kPa(tmin_C: number): number {
  return saturationVapourPressure_kPa(tmin_C);
}

// ---------------------------------------------------------------------------
// FAO-56 Chapter 3 — radiation
// ---------------------------------------------------------------------------

/** Inverse relative distance Earth–Sun dr (–) for day of year J. FAO-56 Eq. 23. */
export function inverseRelativeDistanceEarthSun(j: number): number {
  return 1 + 0.033 * Math.cos(((2 * Math.PI) / 365) * j);
}

/** Solar declination δ (rad) for day of year J. FAO-56 Eq. 24. */
export function solarDeclination_rad(j: number): number {
  return 0.409 * Math.sin(((2 * Math.PI) / 365) * j - 1.39);
}

/** Sunset hour angle ωs (rad). FAO-56 Eq. 25 (argument clamped to [-1, 1] for polar days). */
export function sunsetHourAngle_rad(latitude_rad: number, declination_rad: number): number {
  return Math.acos(clamp(-Math.tan(latitude_rad) * Math.tan(declination_rad), -1, 1));
}

/** Extraterrestrial radiation Ra (MJ m⁻² day⁻¹) for latitude φ (°) and day of year J. FAO-56 Eq. 21. */
export function extraterrestrialRadiation_MJ_per_m2_day(latitude_deg: number, j: number): number {
  const phi = degToRad(latitude_deg);
  const dr = inverseRelativeDistanceEarthSun(j);
  const delta = solarDeclination_rad(j);
  const ws = sunsetHourAngle_rad(phi, delta);
  return (
    ((24 * 60) / Math.PI) *
    SOLAR_CONSTANT_MJ_PER_M2_MIN *
    dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws))
  );
}

/** Daylight hours N (h) from the sunset hour angle ωs (rad). FAO-56 Eq. 34. */
export function daylightHours_h(sunsetHourAngle: number): number {
  return (24 / Math.PI) * sunsetHourAngle;
}

/** Solar radiation Rs (MJ m⁻² day⁻¹) from sunshine duration n (h) — Ångström formula. FAO-56 Eq. 35. */
export function solarRadiationFromSunshine_MJ_per_m2_day(
  sunshine_h: number,
  daylight_h: number,
  ra_MJ_per_m2_day: number,
): number {
  return (ANGSTROM_AS + ANGSTROM_BS * (sunshine_h / daylight_h)) * ra_MJ_per_m2_day;
}

/** Clear-sky solar radiation Rso (MJ m⁻² day⁻¹). FAO-56 Eq. 37. */
export function clearSkySolarRadiation_MJ_per_m2_day(ra_MJ_per_m2_day: number, altitude_m: number): number {
  return (0.75 + 2e-5 * altitude_m) * ra_MJ_per_m2_day;
}

/** Net shortwave radiation Rns (MJ m⁻² day⁻¹) = (1 − α) Rs. FAO-56 Eq. 38. */
export function netShortwaveRadiation_MJ_per_m2_day(rs_MJ_per_m2_day: number, albedo = REFERENCE_ALBEDO): number {
  return (1 - albedo) * rs_MJ_per_m2_day;
}

/**
 * Net outgoing longwave radiation Rnl (MJ m⁻² day⁻¹). FAO-56 Eq. 39.
 * Absolute temperatures use K = °C + 273.16 and Rs/Rso is limited to ≤ 1.0, as in FAO-56.
 */
export function netLongwaveRadiation_MJ_per_m2_day(
  tmax_C: number,
  tmin_C: number,
  ea_kPa: number,
  rs_MJ_per_m2_day: number,
  rso_MJ_per_m2_day: number,
): number {
  const tmaxK4 = Math.pow(tmax_C + 273.16, 4);
  const tminK4 = Math.pow(tmin_C + 273.16, 4);
  const relativeShortwave = rso_MJ_per_m2_day > 0 ? Math.min(rs_MJ_per_m2_day / rso_MJ_per_m2_day, 1) : 1;
  return (
    STEFAN_BOLTZMANN_MJ_PER_K4_M2_DAY *
    ((tmaxK4 + tminK4) / 2) *
    (0.34 - 0.14 * Math.sqrt(ea_kPa)) *
    (1.35 * relativeShortwave - 0.35)
  );
}

/** Net radiation Rn (MJ m⁻² day⁻¹) = Rns − Rnl. FAO-56 Eq. 40. */
export function netRadiation_MJ_per_m2_day(rns_MJ_per_m2_day: number, rnl_MJ_per_m2_day: number): number {
  return rns_MJ_per_m2_day - rnl_MJ_per_m2_day;
}

// ---------------------------------------------------------------------------
// FAO-56 Chapter 3 — wind
// ---------------------------------------------------------------------------

/** Wind speed at 2 m u2 (m s⁻¹) from a measurement uz at height z (m). FAO-56 Eq. 47. */
export function windSpeedAt2m_m_per_s(uz_m_per_s: number, measurementHeight_m: number): number {
  return (uz_m_per_s * 4.87) / Math.log(67.8 * measurementHeight_m - 5.42);
}

// ---------------------------------------------------------------------------
// FAO-56 Chapter 4 — reference evapotranspiration
// ---------------------------------------------------------------------------

export interface PenmanMonteithInputs {
  tmax_C: number;
  tmin_C: number;
  ea_kPa: number;
  u2_m_per_s: number;
  rn_MJ_per_m2_day: number;
  /** Soil heat flux G; ≈ 0 for daily time steps (FAO-56 Eq. 42). */
  g_MJ_per_m2_day?: number;
  altitude_m: number;
}

/** FAO Penman–Monteith reference evapotranspiration ET0 (mm day⁻¹). FAO-56 Eq. 6. */
export function et0PenmanMonteith_mm_per_day(inputs: PenmanMonteithInputs): number {
  const { tmax_C, tmin_C, ea_kPa, u2_m_per_s, rn_MJ_per_m2_day, altitude_m } = inputs;
  const g = inputs.g_MJ_per_m2_day ?? 0;
  const tmean_C = (tmax_C + tmin_C) / 2; // FAO-56 Eq. 9
  const delta = slopeVapourPressureCurve_kPa_per_C(tmean_C);
  const gamma = psychrometricConstant_kPa_per_C(atmosphericPressure_kPa(altitude_m));
  const es = meanSaturationVapourPressure_kPa(tmax_C, tmin_C);
  const numerator =
    0.408 * delta * (rn_MJ_per_m2_day - g) + gamma * (900 / (tmean_C + 273)) * u2_m_per_s * (es - ea_kPa);
  const denominator = delta + gamma * (1 + 0.34 * u2_m_per_s);
  return numerator / denominator;
}

/**
 * Hargreaves reference evapotranspiration ET0 (mm day⁻¹). FAO-56 Eq. 52:
 * ET0 = 0.0023 (Tmean + 17.8) (Tmax − Tmin)^0.5 Ra, with Ra expressed as mm day⁻¹ (× 0.408).
 */
export function et0Hargreaves_mm_per_day(tmax_C: number, tmin_C: number, ra_MJ_per_m2_day: number): number {
  const tmean_C = (tmax_C + tmin_C) / 2;
  const range = Math.max(tmax_C - tmin_C, 0);
  return 0.0023 * (tmean_C + 17.8) * Math.sqrt(range) * (ra_MJ_per_m2_day * MJ_TO_MM_EVAPORATION);
}

export type Et0Method = "penman-monteith" | "hargreaves";

export interface DailyEt0Inputs {
  /** ISO date `YYYY-MM-DD` (local day). */
  date: string;
  latitude_deg: number;
  altitude_m: number;
  tmax_C?: number | null;
  tmin_C?: number | null;
  rhMax_pct?: number | null;
  rhMin_pct?: number | null;
  /** Wind speed measured at `windHeight_m` (Open-Meteo reports 10 m). */
  windSpeed_m_per_s?: number | null;
  windHeight_m?: number;
  /** Incoming shortwave (solar) radiation Rs. */
  rs_MJ_per_m2_day?: number | null;
}

export interface DailyEt0Result {
  et0_mm_per_day: number;
  method: Et0Method;
  ra_MJ_per_m2_day: number;
  /** Present for Penman–Monteith only. */
  details?: {
    u2_m_per_s: number;
    es_kPa: number;
    ea_kPa: number;
    delta_kPa_per_C: number;
    gamma_kPa_per_C: number;
    rso_MJ_per_m2_day: number;
    rns_MJ_per_m2_day: number;
    rnl_MJ_per_m2_day: number;
    rn_MJ_per_m2_day: number;
  };
}

function isNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Daily ET0 with the full FAO-56 Penman–Monteith procedure (G = 0 for daily steps).
 * Falls back to FAO-56 Hargreaves (Eq. 52) when humidity, wind or radiation is missing,
 * and returns `null` when even Tmax/Tmin are unavailable.
 */
export function computeDailyEt0(inputs: DailyEt0Inputs): DailyEt0Result | null {
  const { tmax_C, tmin_C } = inputs;
  if (!isNum(tmax_C) || !isNum(tmin_C)) return null;
  const j = dayOfYear(inputs.date);
  const ra = extraterrestrialRadiation_MJ_per_m2_day(inputs.latitude_deg, j);

  const haveHumidity = isNum(inputs.rhMax_pct) && isNum(inputs.rhMin_pct);
  const haveWind = isNum(inputs.windSpeed_m_per_s);
  const haveRadiation = isNum(inputs.rs_MJ_per_m2_day);

  if (!haveHumidity || !haveWind || !haveRadiation) {
    return {
      et0_mm_per_day: Math.max(0, et0Hargreaves_mm_per_day(tmax_C, tmin_C, ra)),
      method: "hargreaves",
      ra_MJ_per_m2_day: ra,
    };
  }

  const u2 = windSpeedAt2m_m_per_s(inputs.windSpeed_m_per_s as number, inputs.windHeight_m ?? 10);
  const ea = actualVapourPressureFromRhMaxMin_kPa(
    tmin_C,
    tmax_C,
    clamp(inputs.rhMax_pct as number, 0, 100),
    clamp(inputs.rhMin_pct as number, 0, 100),
  );
  const rs = inputs.rs_MJ_per_m2_day as number;
  const rso = clearSkySolarRadiation_MJ_per_m2_day(ra, inputs.altitude_m);
  const rns = netShortwaveRadiation_MJ_per_m2_day(rs);
  const rnl = netLongwaveRadiation_MJ_per_m2_day(tmax_C, tmin_C, ea, rs, rso);
  const rn = netRadiation_MJ_per_m2_day(rns, rnl);
  const tmean = (tmax_C + tmin_C) / 2;
  const et0 = et0PenmanMonteith_mm_per_day({
    tmax_C,
    tmin_C,
    ea_kPa: ea,
    u2_m_per_s: u2,
    rn_MJ_per_m2_day: rn,
    g_MJ_per_m2_day: 0,
    altitude_m: inputs.altitude_m,
  });
  return {
    et0_mm_per_day: Math.max(0, et0),
    method: "penman-monteith",
    ra_MJ_per_m2_day: ra,
    details: {
      u2_m_per_s: u2,
      es_kPa: meanSaturationVapourPressure_kPa(tmax_C, tmin_C),
      ea_kPa: ea,
      delta_kPa_per_C: slopeVapourPressureCurve_kPa_per_C(tmean),
      gamma_kPa_per_C: psychrometricConstant_kPa_per_C(atmosphericPressure_kPa(inputs.altitude_m)),
      rso_MJ_per_m2_day: rso,
      rns_MJ_per_m2_day: rns,
      rnl_MJ_per_m2_day: rnl,
      rn_MJ_per_m2_day: rn,
    },
  };
}

// ---------------------------------------------------------------------------
// FAO-56 Chapter 6 — crop coefficient and crop evapotranspiration
// ---------------------------------------------------------------------------

export type GrowthStage = "not-planted" | "initial" | "development" | "mid-season" | "late-season" | "harvested";

export const GROWTH_STAGE_LABEL: Record<GrowthStage, string> = {
  "not-planted": "Not planted",
  initial: "Initial",
  development: "Development",
  "mid-season": "Mid-season",
  "late-season": "Late season",
  harvested: "Harvested",
};

/**
 * Kc climate adjustment for Kc mid (Eq. 62) and Kc end (Eq. 65) of FAO-56:
 * Kc = Kc(Tab) + [0.04 (u2 − 2) − 0.004 (RHmin − 45)] (h / 3)^0.3.
 * Inputs are clamped to the validity ranges given by FAO-56 (1 ≤ u2 ≤ 6 m/s, 20 ≤ RHmin ≤ 80 %),
 * and Eq. 65 is only applied when the tabulated value is ≥ 0.45.
 */
export function adjustKcForClimate(
  kcTable: number,
  u2_m_per_s: number,
  rhMin_pct: number,
  cropHeight_m: number,
): number {
  if (kcTable < 0.45) return kcTable;
  const u2 = clamp(u2_m_per_s, 1, 6);
  const rh = clamp(rhMin_pct, 20, 80);
  const h = clamp(cropHeight_m, 0.1, 10);
  return kcTable + (0.04 * (u2 - 2) - 0.004 * (rh - 45)) * Math.pow(h / 3, 0.3);
}

export interface KcCurve {
  ini: number;
  mid: number;
  end: number;
}

export interface StageLengths {
  ini: number;
  dev: number;
  mid: number | null;
  late: number | null;
}

/**
 * Crop coefficient for a given number of days after planting, following the FAO-56
 * Kc curve construction (Fig. 25): constant Kc ini, linear rise to Kc mid (Eq. 66),
 * constant Kc mid, linear decline to Kc end. Returns `null` before planting.
 */
export function kcForDay(
  kc: KcCurve,
  stages: StageLengths,
  daysAfterPlanting: number,
): { kc: number | null; stage: GrowthStage } {
  const i = daysAfterPlanting;
  if (i < 0) return { kc: null, stage: "not-planted" };
  const { ini, dev } = stages;
  if (i < ini) return { kc: kc.ini, stage: "initial" };
  if (i < ini + dev) {
    // FAO-56 Eq. 66: Kc_i = Kc_prev + [(i − ΣL_prev) / L_stage] (Kc_next − Kc_prev)
    return { kc: kc.ini + ((i - ini) / dev) * (kc.mid - kc.ini), stage: "development" };
  }
  if (stages.mid === null) return { kc: kc.mid, stage: "mid-season" };
  const midEnd = ini + dev + stages.mid;
  if (i < midEnd) return { kc: kc.mid, stage: "mid-season" };
  if (stages.late === null) return { kc: kc.mid, stage: "mid-season" };
  const lateEnd = midEnd + stages.late;
  if (i <= lateEnd) {
    return { kc: kc.mid + ((i - midEnd) / stages.late) * (kc.end - kc.mid), stage: "late-season" };
  }
  return { kc: kc.end, stage: "harvested" };
}

/** Crop evapotranspiration under standard conditions ETc = Kc × ET0 (mm day⁻¹). FAO-56 Eq. 56. */
export function cropEvapotranspiration_mm_per_day(kc: number, et0_mm_per_day: number): number {
  return kc * et0_mm_per_day;
}

// ---------------------------------------------------------------------------
// FAO-56 Chapter 8 — soil water balance
// ---------------------------------------------------------------------------

/** Total available soil water in the root zone TAW (mm) = 1000 (θFC − θWP) Zr. FAO-56 Eq. 82. */
export function totalAvailableWater_mm(thetaFc: number, thetaWp: number, rootDepth_m: number): number {
  return 1000 * (thetaFc - thetaWp) * rootDepth_m;
}

/**
 * Depletion fraction p adjusted for the evaporative demand:
 * p = p(Table 22) + 0.04 (5 − ETc), limited to 0.1 ≤ p ≤ 0.8 (FAO-56 Table 22 footnote).
 */
export function adjustedDepletionFraction(pTable: number, etc_mm_per_day: number): number {
  return clamp(pTable + 0.04 * (5 - etc_mm_per_day), 0.1, 0.8);
}

/** Readily available soil water RAW (mm) = p × TAW. FAO-56 Eq. 83. */
export function readilyAvailableWater_mm(p: number, taw_mm: number): number {
  return p * taw_mm;
}

/**
 * Root-zone depletion Dr (mm) from a measured volumetric water content θ (m³/m³):
 * Dr = 1000 (θFC − θ) Zr (FAO-56 Eq. 87), bounded to 0 ≤ Dr ≤ TAW (Eq. 86).
 */
export function rootZoneDepletion_mm(thetaFc: number, theta: number, rootDepth_m: number, taw_mm: number): number {
  return clamp(1000 * (thetaFc - theta) * rootDepth_m, 0, taw_mm);
}

/** Water stress coefficient Ks (–): 1 while Dr ≤ RAW, else (TAW − Dr) / (TAW − RAW). FAO-56 Eq. 84. */
export function waterStressCoefficient(taw_mm: number, raw_mm: number, dr_mm: number): number {
  if (dr_mm <= raw_mm) return 1;
  if (taw_mm <= raw_mm) return 0;
  return clamp((taw_mm - dr_mm) / (taw_mm - raw_mm), 0, 1);
}

/**
 * Days until the root zone reaches the irrigation trigger (Dr = RAW) at the current ETc,
 * assuming no rain (FAO-56 Ch. 8 daily water balance, Eq. 85 with P = I = CR = DP = 0).
 */
export function daysUntilIrrigation_d(dr_mm: number, raw_mm: number, etc_mm_per_day: number): number {
  if (dr_mm >= raw_mm) return 0;
  if (etc_mm_per_day <= 0) return Infinity;
  return (raw_mm - dr_mm) / etc_mm_per_day;
}

/** Net irrigation depth (mm) that refills the root zone to field capacity: In = Dr (FAO-56 Ch. 8). */
export function netIrrigationDepth_mm(dr_mm: number): number {
  return Math.max(0, dr_mm);
}

/**
 * Gross depth including the leaching requirement: AW = ET / (1 − LR), FAO-29 Eq. (8),
 * applied per irrigation event to the net depth.
 */
export function irrigationDepthWithLeaching_mm(netDepth_mm: number, leachingRequirement: number): number {
  const lr = clamp(leachingRequirement, 0, 0.9);
  return netDepth_mm / (1 - lr);
}

// ---------------------------------------------------------------------------
// Salinity — FAO-29 and Maas & Hoffman (1977)
// ---------------------------------------------------------------------------

/**
 * The probe measures bulk soil EC, not ECe (saturated paste extract). ECe is estimated with a
 * site-specific linear calibration factor fitted from paired lab (ECe) and probe samples.
 */
export function eceFromBulkEc_dS_per_m(bulkEc_dS_per_m: number, calibrationFactor: number): number {
  return bulkEc_dS_per_m * calibrationFactor;
}

/**
 * Relative yield Yr (%) = 100 − b (ECe − ECe threshold) for ECe > threshold, bounded to 0–100.
 * Maas & Hoffman (1977) threshold–slope model (FAO-29 Table 4; FAO-56 Eq. 89).
 */
export function relativeYield_pct(ece_dS_per_m: number, threshold_dS_per_m: number, slope_pct_per_dS_per_m: number): number {
  if (ece_dS_per_m <= threshold_dS_per_m) return 100;
  return clamp(100 - slope_pct_per_dS_per_m * (ece_dS_per_m - threshold_dS_per_m), 0, 100);
}

/** Predicted yield loss (%) = 100 − relative yield. */
export function yieldLoss_pct(ece_dS_per_m: number, threshold_dS_per_m: number, slope_pct_per_dS_per_m: number): number {
  return 100 - relativeYield_pct(ece_dS_per_m, threshold_dS_per_m, slope_pct_per_dS_per_m);
}

/** ECe (dS/m) at which the crop reaches a given relative yield (inverse of the Maas–Hoffman model). */
export function eceAtRelativeYield_dS_per_m(
  threshold_dS_per_m: number,
  slope_pct_per_dS_per_m: number,
  relativeYield: number,
): number {
  return threshold_dS_per_m + (100 - relativeYield) / slope_pct_per_dS_per_m;
}

/**
 * Leaching requirement LR (fraction) = ECw / (5 ECe − ECw). FAO-29 Eq. (7).
 * ECe is the target soil salinity; FAO-29 recommends the ECe giving ≥ 90 % yield potential.
 * Returns 1 when the water is too saline to reach the target (5 ECe ≤ ECw).
 */
export function leachingRequirement_fraction(ecw_dS_per_m: number, eceTarget_dS_per_m: number): number {
  const denominator = 5 * eceTarget_dS_per_m - ecw_dS_per_m;
  if (denominator <= 0) return 1;
  return clamp(ecw_dS_per_m / denominator, 0, 1);
}

export function salinityClass(ece_dS_per_m: number): SalinityClassId {
  const found = ECE_CLASSES.find((c) => ece_dS_per_m >= c.min && ece_dS_per_m < c.max);
  return (found ?? ECE_CLASSES[ECE_CLASSES.length - 1]).id;
}

// ---------------------------------------------------------------------------
// Composite helpers used by the dashboard (all built from the functions above)
// ---------------------------------------------------------------------------

export function getCrop(cropId: CropId): CropParams {
  return CROPS[cropId];
}

export function soilWaterLimits(soilType: SoilType, overrides?: { thetaFc?: number | null; thetaWp?: number | null }) {
  const soil = SOILS[soilType];
  return {
    thetaFc: overrides?.thetaFc ?? soil.thetaFc,
    thetaWp: overrides?.thetaWp ?? soil.thetaWp,
  };
}

/** Root depth used for irrigation scheduling: the smaller Table 22 value (FAO-56 Table 22 footnote). */
export function schedulingRootDepth_m(crop: CropParams): number {
  return crop.rootDepth_m.min;
}

/** Target ECe for the leaching requirement: ECe at 90 % relative yield (FAO-29 recommendation). */
export function leachingTargetEce_dS_per_m(crop: CropParams): number {
  return eceAtRelativeYield_dS_per_m(crop.salinity.threshold_dS_per_m, crop.salinity.slope_pct_per_dS_per_m, 90);
}

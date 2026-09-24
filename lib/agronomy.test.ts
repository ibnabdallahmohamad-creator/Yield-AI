/**
 * Unit tests for the agronomy engine against the worked examples of
 * FAO Irrigation and Drainage Paper 56 (Chapter 3, plus the daily ET0 example of Chapter 4)
 * and the yield-potential table of FAO-29 (Table 4).
 *
 * FAO-56 prints results rounded to 2–3 significant digits, so each assertion uses
 * a tolerance of half a unit in the last printed digit unless noted otherwise.
 */
import { describe, expect, it } from "vitest";
import {
  actualVapourPressureFromRhMaxMin_kPa,
  actualVapourPressureFromRhMean_kPa,
  adjustKcForClimate,
  adjustedDepletionFraction,
  atmosphericPressure_kPa,
  clearSkySolarRadiation_MJ_per_m2_day,
  computeDailyEt0,
  daylightHours_h,
  dayOfYear,
  daysUntilIrrigation_d,
  degToRad,
  eceAtRelativeYield_dS_per_m,
  eceFromBulkEc_dS_per_m,
  et0Hargreaves_mm_per_day,
  extraterrestrialRadiation_MJ_per_m2_day,
  inverseRelativeDistanceEarthSun,
  irrigationDepthWithLeaching_mm,
  kcForDay,
  leachingRequirement_fraction,
  leachingTargetEce_dS_per_m,
  meanSaturationVapourPressure_kPa,
  netLongwaveRadiation_MJ_per_m2_day,
  netRadiation_MJ_per_m2_day,
  netShortwaveRadiation_MJ_per_m2_day,
  psychrometricConstant_kPa_per_C,
  readilyAvailableWater_mm,
  relativeYield_pct,
  rootZoneDepletion_mm,
  salinityClass,
  saturationVapourPressure_kPa,
  slopeVapourPressureCurve_kPa_per_C,
  solarDeclination_rad,
  solarRadiationFromSunshine_MJ_per_m2_day,
  sunsetHourAngle_rad,
  totalAvailableWater_mm,
  waterStressCoefficient,
  windSpeedAt2m_m_per_s,
  yieldLoss_pct,
} from "./agronomy";
import { CROPS } from "./agronomy-tables";

/** Assert |actual − expected| ≤ tolerance. */
function near(actual: number, expected: number, tolerance: number) {
  expect(Math.abs(actual - expected), `expected ${actual} ≈ ${expected} (±${tolerance})`).toBeLessThanOrEqual(
    tolerance,
  );
}

describe("FAO-56 Chapter 3 worked examples", () => {
  it("Example 2 — atmospheric pressure and psychrometric constant at 1800 m", () => {
    const p = atmosphericPressure_kPa(1800);
    near(p, 81.8, 0.05);
    near(psychrometricConstant_kPa_per_C(p), 0.054, 0.0005);
  });

  it("Example 3 — mean saturation vapour pressure (Tmax 24.5 °C, Tmin 15 °C)", () => {
    near(saturationVapourPressure_kPa(24.5), 3.075, 0.0005);
    near(saturationVapourPressure_kPa(15), 1.705, 0.0005);
    near(meanSaturationVapourPressure_kPa(24.5, 15), 2.39, 0.005);
  });

  it("Example 5 — actual vapour pressure from RHmax/RHmin (Eq. 17) and RHmean (Eq. 19)", () => {
    near(saturationVapourPressure_kPa(18), 2.064, 0.0005);
    near(saturationVapourPressure_kPa(25), 3.168, 0.0005);
    near(actualVapourPressureFromRhMaxMin_kPa(18, 25, 82, 54), 1.7, 0.005);
    near(actualVapourPressureFromRhMean_kPa(18, 25, 68), 1.78, 0.005);
  });

  it("Example 6 — vapour pressure deficit", () => {
    const es = meanSaturationVapourPressure_kPa(25, 18);
    const ea = actualVapourPressureFromRhMaxMin_kPa(18, 25, 82, 54);
    near(es - ea, 0.91, 0.005);
  });

  it("Example 7 — latitude in radians", () => {
    near(degToRad(13 + 44 / 60), 0.24, 0.0005); // Bangkok 13°44'N
    near(degToRad(-(22 + 54 / 60)), -0.4, 0.0005); // Rio de Janeiro 22°54'S
  });

  it("Example 8 — extraterrestrial radiation, 20°S on 3 September", () => {
    const j = dayOfYear("1998-09-03");
    expect(j).toBe(246);
    near(inverseRelativeDistanceEarthSun(j), 0.985, 0.0005);
    const delta = solarDeclination_rad(j);
    near(delta, 0.12, 0.0005);
    near(sunsetHourAngle_rad(-0.35, delta), 1.527, 0.0005);
    near(extraterrestrialRadiation_MJ_per_m2_day(-20, j), 32.2, 0.05);
  });

  it("Example 9 — daylight hours", () => {
    near(daylightHours_h(1.527), 11.7, 0.05);
  });

  it("Example 10 — solar radiation from sunshine duration (Rio de Janeiro, May)", () => {
    // FAO prints 14.5, which is 14.45 rounded half-up; Example 12 carries 14.45 forward.
    near(solarRadiationFromSunshine_MJ_per_m2_day(7.1, 10.9, 25.1), 14.45, 0.005);
  });

  it("Example 11 — net longwave radiation (Rio de Janeiro, May)", () => {
    const rso = clearSkySolarRadiation_MJ_per_m2_day(25.1, 0);
    near(rso, 18.8, 0.05);
    near(netLongwaveRadiation_MJ_per_m2_day(25.1, 19.1, 2.1, 14.5, rso), 3.5, 0.05);
  });

  it("Example 12 — net radiation", () => {
    const rns = netShortwaveRadiation_MJ_per_m2_day(14.45); // Rs carried unrounded from Example 10
    near(rns, 11.1, 0.05);
    near(netRadiation_MJ_per_m2_day(rns, 3.5), 7.6, 0.05);
  });

  it("Example 14 — wind speed adjusted from 10 m to 2 m", () => {
    near(windSpeedAt2m_m_per_s(3.2, 10), 2.4, 0.05);
    near(windSpeedAt2m_m_per_s(1, 10), 0.748, 0.0005);
  });

  it("Example 15 — extraterrestrial radiation at Lyon (45°43'N) on 15 July", () => {
    near(extraterrestrialRadiation_MJ_per_m2_day(45 + 43 / 60, dayOfYear("1998-07-15")), 40.6, 0.05);
  });

  it("Example 16 — net radiation terms for Bangkok in April (13°44'N)", () => {
    const ra = extraterrestrialRadiation_MJ_per_m2_day(13 + 44 / 60, dayOfYear("1998-04-15"));
    near(ra, 38.1, 0.05);
    const rso = clearSkySolarRadiation_MJ_per_m2_day(ra, 2);
    near(rso, 28.5, 0.1);
    const rns = netShortwaveRadiation_MJ_per_m2_day(21.9);
    near(rns, 16.9, 0.05);
    const rnl = netLongwaveRadiation_MJ_per_m2_day(34.8, 25.6, 2.85, 21.9, rso);
    near(rnl, 2.9, 0.06);
    near(netRadiation_MJ_per_m2_day(rns, rnl), 13.9, 0.06);
  });
});

describe("FAO-56 daily ET0 (Chapter 4, Example 18: Uccle, Brussels, 6 July)", () => {
  const latitude = 50 + 48 / 60;
  const date = "1998-07-06";
  const j = dayOfYear(date);
  const ra = extraterrestrialRadiation_MJ_per_m2_day(latitude, j);
  const n = daylightHours_h(sunsetHourAngle_rad(degToRad(latitude), solarDeclination_rad(j)));
  const rs = solarRadiationFromSunshine_MJ_per_m2_day(9.25, n, ra);

  it("reproduces the intermediate values", () => {
    expect(j).toBe(187);
    near(ra, 41.09, 0.005);
    near(n, 16.1, 0.05);
    near(rs, 22.07, 0.005);
    near(slopeVapourPressureCurve_kPa_per_C((21.5 + 12.3) / 2), 0.122, 0.0005);
    near(psychrometricConstant_kPa_per_C(atmosphericPressure_kPa(100)), 0.0666, 0.00005);
  });

  it("computes ET0 = 3.9 mm/day with the full Penman–Monteith equation", () => {
    const result = computeDailyEt0({
      date,
      latitude_deg: latitude,
      altitude_m: 100,
      tmax_C: 21.5,
      tmin_C: 12.3,
      rhMax_pct: 84,
      rhMin_pct: 63,
      windSpeed_m_per_s: 10 / 3.6, // 10 km/h measured at 10 m
      windHeight_m: 10,
      rs_MJ_per_m2_day: rs,
    });
    expect(result?.method).toBe("penman-monteith");
    near(result!.details!.u2_m_per_s, 2.078, 0.0005);
    near(result!.details!.ea_kPa, 1.409, 0.0005);
    near(result!.details!.rn_MJ_per_m2_day, 13.28, 0.01);
    near(result!.et0_mm_per_day, 3.88, 0.01);
  });
});

describe("FAO-56 Hargreaves (Eq. 52) fallback", () => {
  it("predicts ≈ 5.0 mm/day for Lyon in July (FAO-56 Example 20 note)", () => {
    const ra = extraterrestrialRadiation_MJ_per_m2_day(45 + 43 / 60, dayOfYear("1998-07-15"));
    near(et0Hargreaves_mm_per_day(26.6, 14.8, ra), 5.0, 0.05);
  });

  it("is used and labelled when wind or radiation is missing", () => {
    const result = computeDailyEt0({
      date: "2026-08-15",
      latitude_deg: 25.7,
      altitude_m: 10,
      tmax_C: 42,
      tmin_C: 30,
      rhMax_pct: 70,
      rhMin_pct: 20,
      windSpeed_m_per_s: null,
      rs_MJ_per_m2_day: 25,
    });
    expect(result?.method).toBe("hargreaves");
    expect(result!.et0_mm_per_day).toBeGreaterThan(5);
  });

  it("returns null when air temperature is unavailable", () => {
    expect(computeDailyEt0({ date: "2026-08-15", latitude_deg: 25.7, altitude_m: 10 })).toBeNull();
  });
});

describe("FAO-56 crop coefficients (Chapter 6)", () => {
  const cucumber = CROPS.cucumber;

  it("follows the Kc curve by growth stage (Eq. 66 interpolation)", () => {
    expect(kcForDay(cucumber.kc, cucumber.stageLengths_days, -1)).toEqual({ kc: null, stage: "not-planted" });
    expect(kcForDay(cucumber.kc, cucumber.stageLengths_days, 10)).toEqual({ kc: 0.6, stage: "initial" });
    const dev = kcForDay(cucumber.kc, cucumber.stageLengths_days, 35);
    expect(dev.stage).toBe("development");
    near(dev.kc!, 0.8, 1e-9);
    expect(kcForDay(cucumber.kc, cucumber.stageLengths_days, 60)).toEqual({ kc: 1.0, stage: "mid-season" });
    const late = kcForDay(cucumber.kc, cucumber.stageLengths_days, 97.5);
    expect(late.stage).toBe("late-season");
    near(late.kc!, 0.875, 1e-9);
    expect(kcForDay(cucumber.kc, cucumber.stageLengths_days, 200).stage).toBe("harvested");
  });

  it("keeps an established alfalfa stand in mid-season ('var.' in Table 11)", () => {
    const alfalfa = CROPS.alfalfa;
    expect(kcForDay(alfalfa.kc, alfalfa.stageLengths_days, 300)).toEqual({ kc: 0.95, stage: "mid-season" });
  });

  it("adjusts Kc mid for climate with Eq. 62", () => {
    // Reference climate (u2 = 2 m/s, RHmin = 45 %) leaves the table value unchanged.
    near(adjustKcForClimate(1.15, 2, 45, 0.6), 1.15, 1e-12);
    // Windier and drier than the reference raises Kc: +[0.04·2 + 0.004·20]·(3/3)^0.3 = +0.16.
    near(adjustKcForClimate(1.0, 4, 25, 3), 1.16, 1e-12);
    // Inputs outside the FAO-56 validity range are clamped (RHmin ≥ 20 %).
    near(adjustKcForClimate(1.0, 2, 5, 3), adjustKcForClimate(1.0, 2, 20, 3), 1e-12);
  });
});

describe("FAO-56 soil water balance (Chapter 8)", () => {
  it("computes TAW (Eq. 82) and RAW (Eq. 83)", () => {
    // Loamy sand θFC 0.15, θWP 0.06 → 90 mm per metre of root zone (FAO-56 Chapter 8 example values).
    near(totalAvailableWater_mm(0.15, 0.06, 1), 90, 1e-9);
    near(readilyAvailableWater_mm(0.5, 90), 45, 1e-9);
  });

  it("adjusts p for evaporative demand and bounds it to 0.1–0.8 (Table 22 footnote)", () => {
    near(adjustedDepletionFraction(0.5, 5), 0.5, 1e-12);
    near(adjustedDepletionFraction(0.5, 8), 0.38, 1e-12);
    near(adjustedDepletionFraction(0.3, 15), 0.1, 1e-12);
    near(adjustedDepletionFraction(0.55, -10), 0.8, 1e-12);
  });

  it("derives root-zone depletion from measured θ (Eq. 87) bounded to 0 ≤ Dr ≤ TAW", () => {
    near(rootZoneDepletion_mm(0.15, 0.11, 0.7, 59.5), 28, 1e-9);
    expect(rootZoneDepletion_mm(0.15, 0.2, 0.7, 59.5)).toBe(0);
    expect(rootZoneDepletion_mm(0.15, 0.01, 0.7, 59.5)).toBe(59.5);
  });

  it("computes Ks (Eq. 84) and days until the RAW trigger", () => {
    expect(waterStressCoefficient(60, 30, 20)).toBe(1);
    near(waterStressCoefficient(60, 30, 45), 0.5, 1e-12);
    near(daysUntilIrrigation_d(10, 30, 5), 4, 1e-12);
    expect(daysUntilIrrigation_d(35, 30, 5)).toBe(0);
  });
});

describe("Salinity — FAO-29 and Maas & Hoffman (1977)", () => {
  it("converts bulk EC to an ECe estimate with the calibration factor", () => {
    near(eceFromBulkEc_dS_per_m(0.8, 3.2), 2.56, 1e-12);
  });

  // FAO-29 Table 4: ECe (dS/m) at 90 %, 75 % and 50 % yield potential.
  const table4: Array<[keyof typeof CROPS, number, number, number]> = [
    ["tomato", 3.5, 5.0, 7.6],
    ["cucumber", 3.3, 4.4, 6.3],
    ["sweet_pepper", 2.2, 3.3, 5.1],
    ["zucchini", 5.8, 7.4, 10],
    ["alfalfa", 3.4, 5.4, 8.8],
  ];

  it.each(table4)("reproduces FAO-29 Table 4 yield potentials for %s", (cropId, ece90, ece75, ece50) => {
    const { threshold_dS_per_m: a, slope_pct_per_dS_per_m: b } = CROPS[cropId].salinity;
    near(relativeYield_pct(ece90, a, b), 90, 1.5);
    near(relativeYield_pct(ece75, a, b), 75, 1.5);
    near(relativeYield_pct(ece50, a, b), 50, 1.5);
  });

  it("returns full yield below the threshold and bounds the loss to 0–100 %", () => {
    expect(relativeYield_pct(1, 2.5, 9.9)).toBe(100);
    expect(yieldLoss_pct(50, 2.5, 9.9)).toBe(100);
    near(yieldLoss_pct(4.5, 2.5, 9.9), 19.8, 1e-9);
  });

  it("computes the leaching requirement LR = ECw / (5 ECe − ECw) (FAO-29 Eq. 7)", () => {
    near(leachingRequirement_fraction(1, 2), 1 / 9, 1e-12);
    expect(leachingRequirement_fraction(12, 2)).toBe(1); // water too saline for the target
    const target = leachingTargetEce_dS_per_m(CROPS.tomato);
    near(target, eceAtRelativeYield_dS_per_m(2.5, 9.9, 90), 1e-12);
    near(target, 3.5, 0.05); // FAO-29 Table 4: tomato 90 % yield at ECe 3.5
    near(irrigationDepthWithLeaching_mm(20, 0.2), 25, 1e-12); // FAO-29 Eq. 8: AW = ET / (1 − LR)
  });

  it("classifies ECe with the FAO/USDA salinity classes", () => {
    expect(salinityClass(1.9)).toBe("non-saline");
    expect(salinityClass(2)).toBe("slightly");
    expect(salinityClass(5)).toBe("moderately");
    expect(salinityClass(8)).toBe("strongly");
    expect(salinityClass(20)).toBe("very-strongly");
  });
});

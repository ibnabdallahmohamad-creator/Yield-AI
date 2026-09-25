/**
 * Long-term climate for any point in Qatar: a transparent model that scales the Doha station
 * normals with the country's published spatial gradients. It describes "typical" conditions for
 * land planning — the live and 7-day weather come from WeatherAPI.com / Open-Meteo instead.
 *
 * Inputs
 *  - Doha International Airport monthly normals, Qatar Meteorology Department (QMD) climate
 *    normals 1962–2013 (as published on the QMD site / reproduced by the Qatar Open Data Portal):
 *    Jan mean max ≈22 °C and RH 74 %, Jul mean max ≈41–42 °C and RH 50 %, annual rain ≈75 mm.
 *  - Rainfall gradient: Mamoon & Rahman (2017), "Rainfall in Qatar: Is it changing?", Natural
 *    Hazards 85: 453–470 (29 gauges, 1962–2010): mean annual rainfall ≈55 mm in the south rising
 *    to ≈105 mm in the north, national mean ≈80 mm.
 *  - Coast → inland contrasts (hotter summer days and cooler winter nights inland, more humid
 *    coasts) are standard for the Gulf's desert climate; the sizes below are model parameters,
 *    not measurements, and are named as such.
 */
import { dayOfYear, et0Hargreaves_mm_per_day, extraterrestrialRadiation_MJ_per_m2_day } from "../agronomy";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Doha International Airport normals (QMD 1962–2013), rounded. */
export const DOHA_NORMALS = {
  lat: 25.26,
  coastKm: 2,
  tmax_C: [22.0, 23.4, 27.3, 32.5, 38.8, 41.6, 41.9, 40.9, 38.9, 35.4, 29.2, 24.4],
  tmin_C: [13.5, 14.5, 17.3, 21.0, 25.8, 28.4, 29.6, 29.5, 27.3, 24.2, 19.6, 15.4],
  rh_pct: [74, 70, 63, 53, 44, 41, 50, 58, 62, 63, 67, 74],
  rain_mm: [13.2, 17.1, 16.1, 8.7, 3.6, 0, 0, 0, 0, 1.1, 3.3, 12.1],
  /** Mean wind speed at 10 m, m/s. */
  wind10_m_s: [4.3, 4.6, 4.7, 4.3, 4.3, 5.1, 4.6, 4.0, 3.6, 3.4, 3.8, 4.1],
};

/** Model parameters (not measurements). */
const PARAMS = {
  /** Rainfall at the southern and northern ends of the peninsula (Mamoon & Rahman 2017). */
  rainSouth_mm: 55,
  rainNorth_mm: 105,
  rainSouthLat: 24.6,
  rainNorthLat: 26.1,
  /** Extra summer-day heat far inland vs the coast, °C, and its e-folding distance, km. */
  inlandSummerTmax_C: 2.5,
  /** Winter nights cooler far inland (desert radiative cooling), °C. */
  inlandWinterTmin_C: -3,
  inlandScaleKm: 12,
  /** Summer-day cooling per degree of latitude north of Doha (the sea wraps the northern tip). */
  northSummerTmax_C_per_deg: -0.8,
  /** RH difference coast → far inland, %-points, and its e-folding distance, km. */
  inlandRh_pct: -14,
  inlandRhScaleKm: 10,
  /** Wind: +10 % on the coast. */
  coastalWindBoost: 0.1,
};

/** Summer weight (1 in May–Sep, 0 in Nov–Mar, 0.5 in the shoulder months). */
const SUMMER_WEIGHT = [0, 0, 0, 0.5, 1, 1, 1, 1, 1, 0.5, 0, 0];

const inland = (km: number, scale: number) => 1 - Math.exp(-Math.max(0, km) / scale);

export interface MonthlyClimate {
  month: (typeof MONTHS)[number];
  tmax_C: number;
  tmin_C: number;
  rh_pct: number;
  rain_mm: number;
  wind10_m_s: number;
  /** Reference ET0 from FAO-56 Hargreaves (Eq. 52) at mid-month, mm/day. */
  et0_mm_day: number;
}

export interface ClimateSummary {
  annualRain_mm: number;
  wettestMonth: { month: string; rain_mm: number };
  rainyMonths: string;
  annualMeanTemp_C: number;
  hottestMonth: { month: string; tmax_C: number };
  coolestMonth: { month: string; tmin_C: number };
  summerTmax_C: number;
  winterTmin_C: number;
  meanRh_pct: number;
  meanWind10_m_s: number;
  /** Annual reference ET0 (Hargreaves), mm/yr. */
  annualEt0_mm: number;
  peakEt0: { month: string; et0_mm_day: number };
  /** Share of the annual reference ET0 that rainfall could cover, %. */
  rainCoverOfEt0_pct: number;
  monthly: MonthlyClimate[];
  method: string;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Annual rainfall (mm) at a latitude, linear between the published south and north means. */
export function annualRainAt(lat: number): number {
  const t = (lat - PARAMS.rainSouthLat) / (PARAMS.rainNorthLat - PARAMS.rainSouthLat);
  return PARAMS.rainSouth_mm + Math.max(-0.1, Math.min(1.1, t)) * (PARAMS.rainNorth_mm - PARAMS.rainSouth_mm);
}

export function climateAt(lat: number, lng: number, coastKm: number): ClimateSummary {
  const d = DOHA_NORMALS;
  const rainScale = annualRainAt(lat) / annualRainAt(d.lat);
  const dInlandT = inland(coastKm, PARAMS.inlandScaleKm) - inland(d.coastKm, PARAMS.inlandScaleKm);
  const dInlandRh = inland(coastKm, PARAMS.inlandRhScaleKm) - inland(d.coastKm, PARAMS.inlandRhScaleKm);
  const windScale = 1 + PARAMS.coastalWindBoost * (1 - inland(coastKm, 5)) - PARAMS.coastalWindBoost * (1 - inland(d.coastKm, 5));

  const monthly: MonthlyClimate[] = MONTHS.map((month, i) => {
    const s = SUMMER_WEIGHT[i];
    const tmax = d.tmax_C[i] + s * (PARAMS.inlandSummerTmax_C * dInlandT + PARAMS.northSummerTmax_C_per_deg * (lat - d.lat));
    const tmin = d.tmin_C[i] + (1 - s) * PARAMS.inlandWinterTmin_C * dInlandT;
    const rh = Math.max(15, Math.min(95, d.rh_pct[i] + PARAMS.inlandRh_pct * dInlandRh));
    const mid = `2025-${String(i + 1).padStart(2, "0")}-15`;
    const ra = extraterrestrialRadiation_MJ_per_m2_day(lat, dayOfYear(mid));
    return {
      month,
      tmax_C: r1(tmax),
      tmin_C: r1(tmin),
      rh_pct: Math.round(rh),
      rain_mm: r1(d.rain_mm[i] * rainScale),
      wind10_m_s: r1(d.wind10_m_s[i] * windScale),
      et0_mm_day: r1(Math.max(0, et0Hargreaves_mm_per_day(tmax, tmin, ra))),
    };
  });

  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const annualRain = monthly.reduce((a, m) => a + m.rain_mm, 0);
  const annualEt0 = monthly.reduce((a, m, i) => a + m.et0_mm_day * DAYS[i], 0);
  const wettest = monthly.reduce((a, m) => (m.rain_mm > a.rain_mm ? m : a));
  const hottest = monthly.reduce((a, m) => (m.tmax_C > a.tmax_C ? m : a));
  const coolest = monthly.reduce((a, m) => (m.tmin_C < a.tmin_C ? m : a));
  const peak = monthly.reduce((a, m) => (m.et0_mm_day > a.et0_mm_day ? m : a));
  // The rainy season wraps the new year, so look for it in Jul → Jun order.
  const seasonOrder = [...monthly.slice(6), ...monthly.slice(0, 6)];
  const rainy = seasonOrder.filter((m) => m.rain_mm >= 5).map((m) => m.month);

  return {
    annualRain_mm: Math.round(annualRain),
    wettestMonth: { month: wettest.month, rain_mm: wettest.rain_mm },
    rainyMonths: rainy.length ? `${rainy[0]}–${rainy.at(-1)}` : "none",
    annualMeanTemp_C: r1(monthly.reduce((a, m) => a + (m.tmax_C + m.tmin_C) / 2, 0) / 12),
    hottestMonth: { month: hottest.month, tmax_C: hottest.tmax_C },
    coolestMonth: { month: coolest.month, tmin_C: coolest.tmin_C },
    summerTmax_C: hottest.tmax_C,
    winterTmin_C: coolest.tmin_C,
    meanRh_pct: Math.round(monthly.reduce((a, m) => a + m.rh_pct, 0) / 12),
    meanWind10_m_s: r1(monthly.reduce((a, m) => a + m.wind10_m_s, 0) / 12),
    annualEt0_mm: Math.round(annualEt0),
    peakEt0: { month: peak.month, et0_mm_day: peak.et0_mm_day },
    rainCoverOfEt0_pct: r1((annualRain / annualEt0) * 100),
    monthly,
    method:
      "Doha QMD normals (1962–2013) scaled by the north–south rainfall gradient of Mamoon & Rahman (2017) and a coast-distance model; ET₀ by FAO-56 Hargreaves (Eq. 52).",
  };
}

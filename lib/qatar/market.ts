/**
 * The Qatar calendar for local vegetables: when prices are low (winter glut) or high (summer
 * shortage), when to plant in the open field, and indicative prices for the economics section.
 *
 * Sources
 *  - Summer shortage: FreshPlaza, 8 Jul 2024, "Vegetable prices up in Qatar due to constrained local
 *    production" — tomatoes, capsicum, leafy greens, eggplants and zucchinis scarce at Al Sailiya
 *    Central Market once the season ends. https://www.freshplaza.com/asia/article/9642425/
 *  - Winter surplus: The Peninsula, 23 Jan 2023, "Local vegetable production exceeds consumption" —
 *    the market needs about 2,000 t of cucumber and 5,000–6,000 t of tomato a month.
 *    https://thepeninsulaqatar.com/article/23/01/2023/local-vegetable-production-exceeds-consumption-official
 *  - Peak-season oversupply per crop: `CROPS[crop].market` in agronomy-tables.ts (project brief).
 *
 * Like `crop-guides.ts`, the planting months and prices below are INDICATIVE planning values, not
 * published tables or quotes: replace them with your Mahaseel / central-market prices and your
 * agronomist's calendar. The UI and the AI always label them as indicative.
 */
import { CROPS, type CropId } from "../agronomy-tables";

export type QatarSeason = "peak" | "shoulder" | "summer";

/** Local supply season by month (1–12): peak Dec–Mar, summer Jun–Sep, shoulder in between. */
export function qatarSeason(month: number): QatarSeason {
  if (month === 12 || month <= 3) return "peak";
  if (month >= 6 && month <= 9) return "summer";
  return "shoulder";
}

export const SEASON_LABEL: Record<QatarSeason, string> = {
  peak: "winter peak (Dec–Mar)",
  shoulder: "shoulder season (Apr–May, Oct–Nov)",
  summer: "summer (Jun–Sep)",
};

export type PriceSignal = "glut" | "normal" | "scarce";

/** Vegetables reported scarce in summer (FreshPlaza, Jul 2024). */
const SUMMER_SCARCE = new Set<CropId>(["tomato", "sweet_pepper", "eggplant", "zucchini"]);

/** Expected market for a crop harvested in `month`. */
export function priceSignal(crop: CropId, month: number): PriceSignal {
  if (crop === "alfalfa") return "normal";
  const season = qatarSeason(month);
  if (season === "summer") return SUMMER_SCARCE.has(crop) ? "scarce" : "normal";
  if (season === "peak") return CROPS[crop].market.status === "oversupplied" ? "glut" : "normal";
  return "normal";
}

export const PRICE_SIGNAL_LABEL: Record<PriceSignal, string> = {
  glut: "glut risk — low prices",
  normal: "normal prices",
  scarce: "short supply — high prices",
};

/** Monthly local demand where reported (The Peninsula, Jan 2023), tonnes. */
export const MONTHLY_DEMAND_T: Partial<Record<CropId, { low: number; high: number }>> = {
  tomato: { low: 5000, high: 6000 },
  cucumber: { low: 2000, high: 2000 },
};

export interface CropEconomics {
  /** Open-field drip yield per season (alfalfa: per year, dry matter), t/ha. Indicative. */
  yield_t_ha: { low: number; high: number };
  /** Farm-gate price, QAR/kg, by market signal. Indicative. */
  price_qar_kg: Record<PriceSignal, { low: number; high: number }>;
}

export const CROP_ECONOMICS: Record<CropId, CropEconomics> = {
  tomato: {
    yield_t_ha: { low: 30, high: 50 },
    price_qar_kg: { glut: { low: 1, high: 2 }, normal: { low: 2, high: 3.5 }, scarce: { low: 3.5, high: 6 } },
  },
  cucumber: {
    yield_t_ha: { low: 20, high: 35 },
    price_qar_kg: { glut: { low: 1, high: 2 }, normal: { low: 2, high: 3.5 }, scarce: { low: 3, high: 5 } },
  },
  sweet_pepper: {
    yield_t_ha: { low: 15, high: 25 },
    price_qar_kg: { glut: { low: 2.5, high: 4 }, normal: { low: 4, high: 7 }, scarce: { low: 7, high: 10 } },
  },
  eggplant: {
    yield_t_ha: { low: 25, high: 40 },
    price_qar_kg: { glut: { low: 1, high: 2 }, normal: { low: 2, high: 3.5 }, scarce: { low: 3.5, high: 5.5 } },
  },
  zucchini: {
    yield_t_ha: { low: 15, high: 25 },
    price_qar_kg: { glut: { low: 1.5, high: 2.5 }, normal: { low: 2.5, high: 4.5 }, scarce: { low: 4.5, high: 7 } },
  },
  alfalfa: {
    yield_t_ha: { low: 15, high: 25 },
    price_qar_kg: { glut: { low: 0.8, high: 1.2 }, normal: { low: 0.8, high: 1.5 }, scarce: { low: 1.2, high: 2 } },
  },
};

/** Pumping energy for groundwater, QAR/m³ (indicative; the water itself is not priced). */
export const GROUNDWATER_COST_QAR_PER_M3 = 0.1;

/** Indicative open-field planting months (1–12) in Qatar; cooled greenhouses extend them. */
export const OPEN_FIELD_PLANTING: Record<CropId, number[]> = {
  tomato: [9, 10, 11],
  cucumber: [9, 10, 11, 2],
  sweet_pepper: [9, 10],
  eggplant: [8, 9, 10],
  zucchini: [9, 10, 11, 1, 2],
  alfalfa: [10, 11],
};

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep–Nov", "Sep–Nov, Feb" or "Nov–Jan" (runs may wrap past December) for a list of months. */
export function monthsLabel(months: number[]): string {
  const runs: number[][] = [];
  for (const m of months) {
    const run = runs.at(-1);
    const last = run?.[run.length - 1];
    if (run && last != null && (m === last + 1 || (last === 12 && m === 1))) run.push(m);
    else runs.push([m]);
  }
  // [Jan], …, [Sep–Dec] → [Sep–Jan], …
  const first = runs[0];
  const tail = runs[runs.length - 1];
  if (runs.length > 1 && first[0] === 1 && tail[tail.length - 1] === 12) runs.splice(0, runs.length, [...tail, ...first], ...runs.slice(1, -1));
  return runs.map((r) => (r.length === 1 ? MONTH[r[0] - 1] : `${MONTH[r[0] - 1]}–${MONTH[r[r.length - 1] - 1]}`)).join(", ");
}

export function monthName(month: number): string {
  return MONTH[month - 1];
}

export const MARKET_REFERENCE_NOTE = "Prices and planting months are indicative planning values, not quotes. Check Mahaseel or the Al Sailiya Central Market for today's prices.";

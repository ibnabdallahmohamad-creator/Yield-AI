/**
 * Agronomy configuration tables.
 *
 * Every coefficient below is copied from a published table and cited next to
 * the value. Nothing here is tuned or invented. The formulas that consume
 * these tables live in `lib/agronomy.ts`.
 *
 * Sources
 *  - FAO-56: Allen, Pereira, Raes & Smith (1998). Crop evapotranspiration.
 *    FAO Irrigation and Drainage Paper 56. https://www.fao.org/4/x0490e/x0490e00.htm
 *      Table 11 – lengths of crop development stages (Chapter 6)
 *      Table 12 – single crop coefficients Kc and max crop height (Chapter 6)
 *      Table 19 – typical soil water characteristics (Chapter 7)
 *      Table 22 – rooting depth Zr and depletion fraction p (Chapter 8)
 *  - FAO-29: Ayers & Westcot (1985). Water quality for agriculture.
 *    FAO Irrigation and Drainage Paper 29 Rev.1, Table 4 (adapted from
 *    Maas & Hoffman 1977 and Maas 1984). https://www.fao.org/4/t0234e/T0234E03.htm
 *  - FAO-61: Tanji & Kielen (2002). Agricultural drainage water management in
 *    arid and semi-arid areas. FAO I&D Paper 61, Annex 1, Table A1.1 (after
 *    Maas & Grattan 1999). https://www.fao.org/4/y4263e/y4263e0e.htm
 */

export type CropId =
  | "tomato"
  | "cucumber"
  | "sweet_pepper"
  | "eggplant"
  | "zucchini"
  | "alfalfa";

export type SoilType = "sand" | "loamy_sand";

export type SaltToleranceRating = "S" | "MS" | "MT" | "T";

/** Market signal for Qatar, from the project brief (not a scientific table). */
export type MarketStatus = "oversupplied" | "undersupplied" | "no-signal";

export interface CropParams {
  id: CropId;
  name: string;
  /** FAO-56 single crop coefficients (dimensionless). */
  kc: { ini: number; mid: number; end: number };
  kcSource: string;
  /**
   * FAO-56 stage lengths in days. `null` = "var." in Table 11 (open-ended,
   * e.g. an established perennial stand).
   */
  stageLengths_days: { ini: number; dev: number; mid: number | null; late: number | null };
  stageSource: string;
  /** Maximum crop height h (m), FAO-56 Table 12 — used by the Kc climate adjustment (Eq. 62). */
  maxHeight_m: number;
  /** Maximum effective rooting depth Zr range (m), FAO-56 Table 22. */
  rootDepth_m: { min: number; max: number };
  /** Soil water depletion fraction for no stress p (for ETc ≈ 5 mm/day), FAO-56 Table 22. */
  depletionFraction_p: number;
  /** Maas–Hoffman threshold–slope salt tolerance. */
  salinity: {
    /** ECe at which yield starts to decline (dS/m). */
    threshold_dS_per_m: number;
    /** Yield decline per dS/m above the threshold (% per dS/m). */
    slope_pct_per_dS_per_m: number;
    rating: SaltToleranceRating;
    source: string;
  };
  market: { status: MarketStatus; note: string };
}

export const CROPS: Record<CropId, CropParams> = {
  tomato: {
    id: "tomato",
    name: "Tomato",
    // FAO-56 Table 12: tomato Kc ini is blank → Solanum-family group value 0.6;
    // Kc mid 1.15; Kc end listed as 0.70–0.90 → 0.80 (range midpoint = Solanum group value).
    kc: { ini: 0.6, mid: 1.15, end: 0.8 },
    kcSource: "FAO-56 Table 12 (Solanaceae)",
    // FAO-56 Table 11, tomato, "Arid Region", planted Oct/Nov: 35 / 45 / 70 / 30 (180 days).
    stageLengths_days: { ini: 35, dev: 45, mid: 70, late: 30 },
    stageSource: "FAO-56 Table 11 (tomato, arid region)",
    maxHeight_m: 0.6, // FAO-56 Table 12
    rootDepth_m: { min: 0.7, max: 1.5 }, // FAO-56 Table 22
    depletionFraction_p: 0.4, // FAO-56 Table 22
    salinity: {
      threshold_dS_per_m: 2.5, // FAO-29 Table 4: ECe for 100% yield potential
      slope_pct_per_dS_per_m: 9.9, // Maas & Hoffman (1977) slope; reproduces FAO-29 Table 4 (90% at 3.5, 50% at 7.6)
      rating: "MS",
      source: "FAO-29 Table 4 (Maas & Hoffman 1977)",
    },
    market: { status: "no-signal", note: "No oversupply flagged for tomato in the current season." },
  },
  cucumber: {
    id: "cucumber",
    name: "Cucumber",
    // FAO-56 Table 12, "Cucumber – Fresh Market": 0.6 / 1.00 / 0.75.
    kc: { ini: 0.6, mid: 1.0, end: 0.75 },
    kcSource: "FAO-56 Table 12 (cucumber, fresh market)",
    // FAO-56 Table 11, cucumber, "Arid Region", planted June/Aug: 20 / 30 / 40 / 15 (105 days).
    stageLengths_days: { ini: 20, dev: 30, mid: 40, late: 15 },
    stageSource: "FAO-56 Table 11 (cucumber, arid region, Jun/Aug)",
    maxHeight_m: 0.3, // FAO-56 Table 12
    rootDepth_m: { min: 0.7, max: 1.2 }, // FAO-56 Table 22
    depletionFraction_p: 0.5, // FAO-56 Table 22
    salinity: {
      threshold_dS_per_m: 2.5, // FAO-29 Table 4
      slope_pct_per_dS_per_m: 13, // Maas & Hoffman (1977); reproduces FAO-29 Table 4 (90% at 3.3, 50% at 6.3)
      rating: "MS",
      source: "FAO-29 Table 4 (Maas & Hoffman 1977)",
    },
    market: {
      status: "oversupplied",
      note: "Oversupplied in Qatar during the peak season — farm-gate prices drop when local harvests overlap.",
    },
  },
  sweet_pepper: {
    id: "sweet_pepper",
    name: "Sweet pepper",
    // FAO-56 Table 12, "Sweet Peppers (bell)": Kc ini blank → Solanum group 0.6; Kc mid 1.05; Kc end 0.90.
    kc: { ini: 0.6, mid: 1.05, end: 0.9 },
    kcSource: "FAO-56 Table 12 (sweet peppers, bell)",
    // FAO-56 Table 11, sweet peppers, "Arid Region", planted October: 30 / 40 / 110 / 30 (210 days).
    stageLengths_days: { ini: 30, dev: 40, mid: 110, late: 30 },
    stageSource: "FAO-56 Table 11 (sweet peppers, arid region)",
    maxHeight_m: 0.7, // FAO-56 Table 12
    rootDepth_m: { min: 0.5, max: 1.0 }, // FAO-56 Table 22
    depletionFraction_p: 0.3, // FAO-56 Table 22
    salinity: {
      threshold_dS_per_m: 1.5, // FAO-29 Table 4 (pepper)
      slope_pct_per_dS_per_m: 14, // Maas & Hoffman (1977); reproduces FAO-29 Table 4 (90% at 2.2, 50% at 5.1)
      rating: "MS",
      source: "FAO-29 Table 4 (Maas & Hoffman 1977)",
    },
    market: {
      status: "undersupplied",
      note: "Undersupplied locally — strong demand and an import-substitution opportunity.",
    },
  },
  eggplant: {
    id: "eggplant",
    name: "Eggplant",
    // FAO-56 Table 12, "Egg Plant": Kc ini blank → Solanum group 0.6; Kc mid 1.05; Kc end 0.90.
    kc: { ini: 0.6, mid: 1.05, end: 0.9 },
    kcSource: "FAO-56 Table 12 (egg plant)",
    // FAO-56 Table 11, egg plant, "Arid Region", planted October: 30 / 40 / 40 / 20 (130 days).
    stageLengths_days: { ini: 30, dev: 40, mid: 40, late: 20 },
    stageSource: "FAO-56 Table 11 (egg plant, arid region)",
    maxHeight_m: 0.8, // FAO-56 Table 12
    rootDepth_m: { min: 0.7, max: 1.2 }, // FAO-56 Table 22
    depletionFraction_p: 0.45, // FAO-56 Table 22
    salinity: {
      // Not tabulated in FAO-29 Table 4, and FAO-56 Table 23 lists egg plant as "MS" without values,
      // so we use FAO-61 Annex 1 Table A1.1 (Maas & Grattan 1999, after Heuer et al. 1986).
      threshold_dS_per_m: 1.1,
      slope_pct_per_dS_per_m: 6.9,
      rating: "MS",
      source: "FAO-61 Table A1.1 (Maas & Grattan 1999)",
    },
    market: {
      status: "oversupplied",
      note: "Oversupplied in Qatar during the peak season — expect low prices without a forward contract.",
    },
  },
  zucchini: {
    id: "zucchini",
    name: "Zucchini",
    // FAO-56 Table 12, "Squash, Zucchini": Kc ini blank → Cucurbitaceae group 0.5; Kc mid 0.95; Kc end 0.75.
    kc: { ini: 0.5, mid: 0.95, end: 0.75 },
    kcSource: "FAO-56 Table 12 (squash, zucchini)",
    // FAO-56 Table 11, squash/zucchini, "Mediterranean; Arid Reg.", planted Apr/Dec: 25 / 35 / 25 / 15 (100 days).
    stageLengths_days: { ini: 25, dev: 35, mid: 25, late: 15 },
    stageSource: "FAO-56 Table 11 (squash, zucchini, arid region)",
    maxHeight_m: 0.3, // FAO-56 Table 12
    rootDepth_m: { min: 0.6, max: 1.0 }, // FAO-56 Table 22
    depletionFraction_p: 0.5, // FAO-56 Table 22
    salinity: {
      threshold_dS_per_m: 4.7, // FAO-29 Table 4 (squash, zucchini)
      slope_pct_per_dS_per_m: 9.4, // Maas & Hoffman (1977); reproduces FAO-29 Table 4 (90% at 5.8, 50% at 10)
      rating: "MT",
      source: "FAO-29 Table 4 (Maas & Hoffman 1977)",
    },
    market: {
      status: "oversupplied",
      note: "Oversupplied in Qatar during the peak season — stagger planting or pre-sell to avoid the glut.",
    },
  },
  alfalfa: {
    id: "alfalfa",
    name: "Alfalfa",
    // FAO-56 Table 12, "Alfalfa Hay – averaged cutting effects": 0.40 / 0.95 / 0.90.
    kc: { ini: 0.4, mid: 0.95, end: 0.9 },
    kcSource: "FAO-56 Table 12 (alfalfa hay, averaged cutting effects)",
    // FAO-56 Table 11, alfalfa "Total season": Init 10, Dev 30, Mid "var.", Late "var." —
    // an established stand stays in the mid-season (averaged cutting) phase.
    stageLengths_days: { ini: 10, dev: 30, mid: null, late: null },
    stageSource: "FAO-56 Table 11 (alfalfa, total season)",
    maxHeight_m: 0.7, // FAO-56 Table 12
    rootDepth_m: { min: 1.0, max: 2.0 }, // FAO-56 Table 22 (alfalfa for hay)
    depletionFraction_p: 0.55, // FAO-56 Table 22 (alfalfa for hay)
    salinity: {
      threshold_dS_per_m: 2.0, // FAO-29 Table 4
      slope_pct_per_dS_per_m: 7.3, // Maas & Hoffman (1977); reproduces FAO-29 Table 4 (90% at 3.4, 50% at 8.8)
      rating: "MS",
      source: "FAO-29 Table 4 (Maas & Hoffman 1977)",
    },
    market: { status: "no-signal", note: "No oversupply flagged for fodder; mind its high water use." },
  },
};

export const CROP_IDS = Object.keys(CROPS) as CropId[];

export interface SoilParams {
  id: SoilType;
  name: string;
  /** Volumetric water content at field capacity θFC (m³/m³). */
  thetaFc: number;
  /** Volumetric water content at wilting point θWP (m³/m³). */
  thetaWp: number;
  source: string;
}

export const SOILS: Record<SoilType, SoilParams> = {
  // FAO-56 Table 19, sand: θFC 0.07–0.17, θWP 0.02–0.07 → range midpoints.
  sand: { id: "sand", name: "Sand", thetaFc: 0.12, thetaWp: 0.045, source: "FAO-56 Table 19 (sand, range midpoints)" },
  // FAO-56 Table 19, loamy sand: θFC 0.11–0.19, θWP 0.03–0.10 → range midpoints.
  loamy_sand: {
    id: "loamy_sand",
    name: "Loamy sand",
    thetaFc: 0.15,
    thetaWp: 0.065,
    source: "FAO-56 Table 19 (loamy sand, range midpoints)",
  },
};

/**
 * Soil salinity classes by ECe (dS/m) of the saturated paste extract.
 * FAO / USDA Salinity Laboratory classification as specified in the project brief:
 * non-saline < 2, slightly 2–4, moderately 4–8, strongly 8–16, very strongly > 16.
 */
export const ECE_CLASSES = [
  { id: "non-saline", label: "Non-saline", min: 0, max: 2 },
  { id: "slightly", label: "Slightly saline", min: 2, max: 4 },
  { id: "moderately", label: "Moderately saline", min: 4, max: 8 },
  { id: "strongly", label: "Strongly saline", min: 8, max: 16 },
  { id: "very-strongly", label: "Very strongly saline", min: 16, max: Infinity },
] as const;

export type SalinityClassId = (typeof ECE_CLASSES)[number]["id"];

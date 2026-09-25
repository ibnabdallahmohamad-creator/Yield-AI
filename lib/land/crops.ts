/**
 * Crop options for land suitability: the six crops the farm engine models (lib/agronomy-tables.ts)
 * plus other crops grown in Qatar, each with its Maas–Hoffman salt tolerance.
 *
 * Extra crops: FAO-29 (Ayers & Westcot 1985) Table 4, after Maas & Hoffman (1977) — ECe threshold
 * for 100 % yield (dS/m) and yield decline per dS/m above it (%).
 */
import { relativeYield_pct } from "../agronomy";
import { CROPS, CROP_IDS, type SaltToleranceRating } from "../agronomy-tables";

export type CropGroup = "vegetable" | "fodder" | "cereal" | "fruit";

export interface LandCrop {
  id: string;
  name: string;
  group: CropGroup;
  threshold_dS_m: number;
  slope_pct_per_dS_m: number;
  rating: SaltToleranceRating;
  season: string;
  source: string;
  /** Crop the farm engine can model in detail (a valid `main_crop`). */
  modelled: boolean;
}

const FAO29 = "FAO-29 Table 4 (Maas & Hoffman 1977)";

const SEASON: Record<string, string> = {
  tomato: "Open field Oct–Apr; year-round in cooled greenhouses",
  cucumber: "Open field Oct–Apr; year-round in cooled greenhouses",
  sweet_pepper: "Open field Oct–Apr; year-round in cooled greenhouses",
  eggplant: "Open field Oct–Apr; year-round in cooled greenhouses",
  zucchini: "Open field Oct–Mar; year-round in cooled greenhouses",
  alfalfa: "Year-round perennial fodder (high water use)",
};

export const LAND_CROPS: LandCrop[] = [
  ...CROP_IDS.map((id) => {
    const c = CROPS[id];
    return {
      id,
      name: c.name,
      group: (id === "alfalfa" ? "fodder" : "vegetable") as CropGroup,
      threshold_dS_m: c.salinity.threshold_dS_per_m,
      slope_pct_per_dS_m: c.salinity.slope_pct_per_dS_per_m,
      rating: c.salinity.rating,
      season: SEASON[id],
      source: c.salinity.source,
      modelled: true,
    };
  }),
  { id: "date_palm", name: "Date palm", group: "fruit", threshold_dS_m: 4.0, slope_pct_per_dS_m: 3.6, rating: "T", season: "Perennial; harvest Jun–Sep", source: FAO29, modelled: false },
  { id: "barley", name: "Barley", group: "cereal", threshold_dS_m: 8.0, slope_pct_per_dS_m: 5.0, rating: "T", season: "Winter, sown Nov–Dec (grain or green fodder)", source: FAO29, modelled: false },
  { id: "wheat", name: "Wheat", group: "cereal", threshold_dS_m: 6.0, slope_pct_per_dS_m: 7.1, rating: "MT", season: "Winter, sown Nov–Dec", source: FAO29, modelled: false },
  { id: "sorghum", name: "Sorghum (fodder)", group: "fodder", threshold_dS_m: 6.8, slope_pct_per_dS_m: 16, rating: "MT", season: "Spring–autumn fodder", source: FAO29, modelled: false },
  { id: "bermuda_grass", name: "Bermuda grass (fodder)", group: "fodder", threshold_dS_m: 6.9, slope_pct_per_dS_m: 6.4, rating: "T", season: "Year-round perennial fodder", source: FAO29, modelled: false },
  { id: "beet", name: "Beetroot", group: "vegetable", threshold_dS_m: 4.0, slope_pct_per_dS_m: 9.0, rating: "MT", season: "Open field Nov–Mar", source: FAO29, modelled: false },
  { id: "spinach", name: "Spinach", group: "vegetable", threshold_dS_m: 2.0, slope_pct_per_dS_m: 7.6, rating: "MS", season: "Open field Nov–Feb", source: FAO29, modelled: false },
  { id: "cabbage", name: "Cabbage", group: "vegetable", threshold_dS_m: 1.8, slope_pct_per_dS_m: 9.7, rating: "MS", season: "Open field Nov–Feb", source: FAO29, modelled: false },
  { id: "potato", name: "Potato", group: "vegetable", threshold_dS_m: 1.7, slope_pct_per_dS_m: 12, rating: "MS", season: "Open field Nov–Mar", source: FAO29, modelled: false },
  { id: "lettuce", name: "Lettuce", group: "vegetable", threshold_dS_m: 1.3, slope_pct_per_dS_m: 13, rating: "MS", season: "Open field Nov–Feb; hydroponics year-round", source: FAO29, modelled: false },
  { id: "onion", name: "Onion", group: "vegetable", threshold_dS_m: 1.2, slope_pct_per_dS_m: 16, rating: "S", season: "Open field Nov–Mar", source: FAO29, modelled: false },
];

export type Suitability = "well-suited" | "with-management" | "poor";

export interface CropSuitability {
  id: string;
  name: string;
  group: CropGroup;
  /** Relative yield (%) at the expected root-zone ECe, Maas–Hoffman. */
  relativeYield: number;
  /** Relative yield with low-salinity water (desalinated / blended). */
  relativeYieldLowSaltWater: number;
  suitability: Suitability;
  season: string;
  modelled: boolean;
}

/**
 * Root-zone ECe after irrigating with water of salinity ECw at a 15–20 % leaching fraction:
 * ECe ≈ 1.5 × ECw — the relation FAO-29 uses to convert the ECe thresholds of Table 4 into ECw.
 */
export const irrigatedEce = (ecw_dS_m: number) => 1.5 * ecw_dS_m;

/** ECw of desalinated water blended into irrigation, dS/m (planning assumption). */
export const LOW_SALT_WATER_ECW = 0.8;

export function suitabilityFor(relativeYield: number): Suitability {
  if (relativeYield >= 90) return "well-suited";
  if (relativeYield >= 75) return "with-management";
  return "poor";
}

/** Rank every crop for a groundwater salinity, best first. */
export function rankLandCrops(ecw_dS_m: number): CropSuitability[] {
  const ece = irrigatedEce(ecw_dS_m);
  const eceLow = irrigatedEce(LOW_SALT_WATER_ECW);
  return LAND_CROPS.map((c) => {
    const relativeYield = Math.round(relativeYield_pct(ece, c.threshold_dS_m, c.slope_pct_per_dS_m));
    return {
      id: c.id,
      name: c.name,
      group: c.group,
      relativeYield,
      relativeYieldLowSaltWater: Math.round(relativeYield_pct(eceLow, c.threshold_dS_m, c.slope_pct_per_dS_m)),
      suitability: suitabilityFor(relativeYield),
      season: c.season,
      modelled: c.modelled,
    };
  }).sort((a, b) => b.relativeYield - a.relativeYield || a.name.localeCompare(b.name));
}

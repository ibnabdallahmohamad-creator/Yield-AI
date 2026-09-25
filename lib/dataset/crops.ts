/**
 * The crops the dataset considers for Qatar land (input 4, "what can be grown here"), with the salt
 * tolerance that decides most of it on brackish water.
 *
 * Salt tolerance: Maas–Hoffman threshold and slope, FAO-29 Table 4 (Ayers & Westcot 1985) and Maas &
 * Grattan (1999); the six app crops come from `agronomy-tables.ts`. Season-average Kc follows FAO-56
 * Table 12. Open-field months and heat limits are INDICATIVE planning values for Qatar (like
 * `market.ts` and `crop-guides.ts`), not published tables.
 */
import { relativeYield_pct } from "../agronomy";
import { CROPS, type CropId } from "../agronomy-tables";
import { OPEN_FIELD_PLANTING } from "../qatar/market";

export type FarmType =
  | "open field (drip)"
  | "net house (shade)"
  | "cooled greenhouse"
  | "hydroponic greenhouse"
  | "vertical farm"
  | "orchard (bubbler/drip)"
  | "fodder field on TSE";

export interface CatalogCrop {
  id: string;
  name: string;
  group: "vegetable" | "leafy" | "fruit" | "fodder" | "tree";
  threshold_dS_m: number;
  slope_pct_per_dS_m: number;
  /** Season-average crop coefficient (FAO-56 Table 12, rounded). */
  kc: number;
  /** Indicative open-field planting months in Qatar; [] = protected cultivation only in practice. */
  plant_months: number[];
  /** Perennial stand (planted once). */
  perennial: boolean;
  /** Daily maximum air temperature above which the crop stalls or drops flowers, °C. Indicative. */
  heat_limit_c: number;
  farm_types: FarmType[];
  /** Link to the app's crop table, where one exists. */
  app_crop?: CropId;
}

const fromApp = (id: CropId, group: CatalogCrop["group"], kc: number, heat: number, farm_types: FarmType[]): CatalogCrop => ({
  id,
  name: CROPS[id].name,
  group,
  threshold_dS_m: CROPS[id].salinity.threshold_dS_per_m,
  slope_pct_per_dS_m: CROPS[id].salinity.slope_pct_per_dS_per_m,
  kc,
  plant_months: OPEN_FIELD_PLANTING[id],
  perennial: id === "alfalfa",
  heat_limit_c: heat,
  farm_types,
  app_crop: id,
});

const VEG_TYPES: FarmType[] = ["open field (drip)", "net house (shade)", "cooled greenhouse"];

export const CROP_CATALOG: CatalogCrop[] = [
  fromApp("tomato", "vegetable", 0.95, 35, [...VEG_TYPES, "hydroponic greenhouse"]),
  fromApp("cucumber", "vegetable", 0.85, 35, [...VEG_TYPES, "hydroponic greenhouse"]),
  fromApp("sweet_pepper", "vegetable", 0.9, 35, ["net house (shade)", "cooled greenhouse", "hydroponic greenhouse"]),
  fromApp("eggplant", "vegetable", 0.9, 35, VEG_TYPES),
  fromApp("zucchini", "vegetable", 0.85, 35, ["open field (drip)", "net house (shade)"]),
  fromApp("alfalfa", "fodder", 0.95, 38, ["fodder field on TSE"]),
  // FAO-29 Table 4 values below.
  { id: "lettuce", name: "Lettuce", group: "leafy", threshold_dS_m: 1.3, slope_pct_per_dS_m: 13, kc: 0.9, plant_months: [10, 11, 12, 1], perennial: false, heat_limit_c: 30, farm_types: ["hydroponic greenhouse", "vertical farm", "open field (drip)"] },
  { id: "spinach", name: "Spinach", group: "leafy", threshold_dS_m: 2.0, slope_pct_per_dS_m: 7.6, kc: 0.9, plant_months: [10, 11, 12], perennial: false, heat_limit_c: 30, farm_types: ["open field (drip)", "hydroponic greenhouse"] },
  { id: "cabbage", name: "Cabbage", group: "vegetable", threshold_dS_m: 1.8, slope_pct_per_dS_m: 9.7, kc: 0.95, plant_months: [9, 10, 11], perennial: false, heat_limit_c: 32, farm_types: ["open field (drip)"] },
  { id: "broccoli", name: "Broccoli", group: "vegetable", threshold_dS_m: 2.8, slope_pct_per_dS_m: 9.2, kc: 0.95, plant_months: [10, 11], perennial: false, heat_limit_c: 30, farm_types: ["open field (drip)"] },
  { id: "onion", name: "Onion", group: "vegetable", threshold_dS_m: 1.2, slope_pct_per_dS_m: 16, kc: 0.85, plant_months: [10, 11], perennial: false, heat_limit_c: 35, farm_types: ["open field (drip)"] },
  { id: "potato", name: "Potato", group: "vegetable", threshold_dS_m: 1.7, slope_pct_per_dS_m: 12, kc: 0.9, plant_months: [10, 11], perennial: false, heat_limit_c: 30, farm_types: ["open field (drip)"] },
  { id: "strawberry", name: "Strawberry", group: "fruit", threshold_dS_m: 1.0, slope_pct_per_dS_m: 33, kc: 0.8, plant_months: [], perennial: false, heat_limit_c: 30, farm_types: ["hydroponic greenhouse", "vertical farm"] },
  { id: "date_palm", name: "Date palm", group: "tree", threshold_dS_m: 4.0, slope_pct_per_dS_m: 3.6, kc: 0.93, plant_months: [2, 3, 4, 9, 10], perennial: true, heat_limit_c: 50, farm_types: ["orchard (bubbler/drip)"] },
  { id: "forage_barley", name: "Forage barley", group: "fodder", threshold_dS_m: 6.0, slope_pct_per_dS_m: 7.1, kc: 0.9, plant_months: [11, 12], perennial: false, heat_limit_c: 32, farm_types: ["fodder field on TSE", "open field (drip)"] },
  { id: "sorghum", name: "Forage sorghum", group: "fodder", threshold_dS_m: 6.8, slope_pct_per_dS_m: 16, kc: 0.9, plant_months: [3, 4, 5, 6, 7, 8], perennial: false, heat_limit_c: 42, farm_types: ["fodder field on TSE"] },
  { id: "bermuda_grass", name: "Bermuda grass", group: "fodder", threshold_dS_m: 6.9, slope_pct_per_dS_m: 6.4, kc: 0.9, plant_months: [3, 4, 5], perennial: true, heat_limit_c: 45, farm_types: ["fodder field on TSE"] },
];

export const CROP_CATALOG_SOURCE =
  "Salt tolerance: FAO Irrigation and Drainage Paper 29, Table 4 (Maas & Hoffman); Kc: FAO-56 Table 12. Planting months and heat limits: indicative for Qatar.";

export type Suitability = "good" | "marginal" | "protected only" | "not with this water";

export interface GrowableCrop {
  crop: string;
  group: CatalogCrop["group"];
  suitability: Suitability;
  /** % of full yield at the expected root-zone salinity (ECe ≈ 1.5 × ECw). */
  relative_yield_pct: number;
  open_field_months: number[];
  /** Survives the site's summer outdoors (heat limit at or above the hottest-month mean maximum). */
  summer_outdoors: boolean;
  farm_types: FarmType[];
}

/**
 * Which crops can be grown on water of salinity `ecw` at a site whose hottest-month mean maximum is
 * `summerTmax`. Open-field vegetables are winter crops everywhere in Qatar; a crop with no open-field
 * months is "protected only".
 */
export function growableCrops(ecw: number, summerTmax: number): GrowableCrop[] {
  const ece = 1.5 * ecw;
  return CROP_CATALOG.map((c) => {
    const ry = Math.round(relativeYield_pct(ece, c.threshold_dS_m, c.slope_pct_per_dS_m));
    let suitability: Suitability;
    if (ry < 50) suitability = "not with this water";
    else if (c.plant_months.length === 0) suitability = "protected only";
    else if (ry < 80) suitability = "marginal";
    else suitability = "good";
    return {
      crop: c.name,
      group: c.group,
      suitability,
      relative_yield_pct: ry,
      open_field_months: c.plant_months,
      summer_outdoors: c.heat_limit_c >= summerTmax,
      farm_types: c.farm_types,
    };
  }).sort((a, b) => b.relative_yield_pct - a.relative_yield_pct || a.crop.localeCompare(b.crop));
}

export function catalogCrop(name: string): CatalogCrop | undefined {
  return CROP_CATALOG.find((c) => c.name === name || c.id === name);
}

/**
 * What a piece of land in Qatar can be used for: the options the land-use advisor ranks. Each one
 * carries what the scoring needs (water tolerance, national goal, relative capital cost, market
 * baseline) and what a farmer needs to act (first income, risks, first steps).
 *
 * Salt tolerance is FAO-29 Table 4 (Maas–Hoffman threshold and slope); livestock water limits are
 * FAO-29 Table 30. Costs, timings and markets are indicative planning values for Qatar, not quotes.
 */
import type { GoalProduct } from "../qatar/food-security";

export type LandUseId =
  | "greenhouse-veg"
  | "hydroponic-leafy"
  | "openfield-winter-veg"
  | "date-palms"
  | "fodder-tse"
  | "table-eggs"
  | "sheep-goats"
  | "aquaculture";

export type WaterSource = "groundwater" | "desalinated" | "tse";
export type Level = "low" | "medium" | "high";
export type MarketBaseline = "strong" | "steady" | "saturated";

export const WATER_SOURCE_LABEL: Record<WaterSource, string> = {
  groundwater: "Well (groundwater)",
  desalinated: "Desalinated (Kahramaa network)",
  tse: "Treated sewage effluent (TSE)",
};

/** Typical ECw when the user doesn't know theirs, dS/m. Groundwater uses the basin range instead. */
export const TYPICAL_WATER_EC: Record<Exclude<WaterSource, "groundwater">, number> = {
  desalinated: 0.4,
  tse: 1.8,
};

export type WaterNeed =
  /** A crop: salt response (FAO-29 Table 4), season-average Kc and the months it uses water. */
  | {
      kind: "crop";
      crop: string;
      threshold_dS_m: number;
      slope_pct_per_dS_m: number;
      kc: number;
      months: number[];
      /** Share of open-field water use: shading and humidity indoors, recirculation in hydroponics. */
      indoorFactor?: number;
      /** Runs on reverse-osmosis water as standard, so brackish water means treatment, not yield loss. */
      reverseOsmosis?: boolean;
    }
  | { kind: "livestock"; poultry: boolean }
  | { kind: "aquaculture" };

export interface LandUseOption {
  id: LandUseId;
  name: string;
  category: "crops" | "livestock" | "aquaculture";
  summary: string;
  goal: GoalProduct | null;
  water: WaterNeed;
  /** Water sources this use can run on in Qatar. */
  sources: WaterSource[];
  capex: Level;
  capexNote: string;
  firstIncome: string;
  /** Smallest area that makes sense as a unit, ha. */
  minAreaHa: number;
  market: MarketBaseline;
  marketNote: string;
  risks: string[];
  firstSteps: string[];
}

const ALL: WaterSource[] = ["groundwater", "desalinated", "tse"];
const FOOD: WaterSource[] = ["groundwater", "desalinated"];

export const LAND_USE_OPTIONS: LandUseOption[] = [
  {
    id: "greenhouse-veg",
    name: "Greenhouse vegetables",
    category: "crops",
    summary: "Tomato, cucumber and pepper in cooled greenhouses, harvested through the summer shortage.",
    goal: "vegetables",
    // Tomato (FAO-29 Table 4); inside a greenhouse crop water use is well below the open field.
    water: { kind: "crop", crop: "tomato", threshold_dS_m: 2.5, slope_pct_per_dS_m: 9.9, kc: 1.0, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], indoorFactor: 0.6 },
    sources: FOOD,
    capex: "high",
    capexNote: "Cooled greenhouse structure, drip or hydroponics, climate control",
    firstIncome: "3–4 months after planting",
    minAreaHa: 0.2,
    market: "strong",
    marketNote: "Local vegetables cover about 39% of demand against a 55% goal; summer prices are the highest of the year.",
    risks: [
      "Cooling costs peak in July–August; pad-and-fan cooling struggles in humid coastal air.",
      "Winter (Dec–Mar) brings a local glut and low prices for greenhouse cucumber and tomato.",
    ],
    firstSteps: [
      "Ask the Ministry of Municipality about the greenhouse support programme and licences.",
      "Size cooling for the site's summer peak and humidity, not the annual average.",
      "Agree an off-take with Mahaseel before the first summer crop.",
    ],
  },
  {
    id: "hydroponic-leafy",
    name: "Hydroponic leafy greens",
    category: "crops",
    summary: "Lettuce, herbs and leafy greens in a closed hydroponic or vertical farm, year-round.",
    goal: "vegetables",
    // Lettuce (FAO-29 Table 4) is very salt-sensitive, so the nutrient solution is made with desalinated
    // or RO water; recirculating systems use a small fraction of open-field water.
    water: {
      kind: "crop",
      crop: "lettuce",
      threshold_dS_m: 1.3,
      slope_pct_per_dS_m: 13,
      kc: 0.9,
      months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      indoorFactor: 0.15,
      reverseOsmosis: true,
    },
    sources: FOOD,
    capex: "high",
    capexNote: "Hydroponic systems, insulated building or greenhouse, LED lighting for vertical farms",
    firstIncome: "1–2 months after start-up",
    minAreaHa: 0.05,
    market: "strong",
    marketNote: "Leafy greens are short every summer and much is flown in; hotels and supermarkets buy year-round.",
    risks: ["High electricity use for cooling and lighting.", "A crop failure shows up fast: daily monitoring of nutrient solution is needed."],
    firstSteps: [
      "Budget RO treatment unless the site has desalinated water.",
      "Start with one module and a supermarket or hotel buyer before scaling.",
    ],
  },
  {
    id: "openfield-winter-veg",
    name: "Open-field winter vegetables",
    category: "crops",
    summary: "Zucchini, eggplant, tomato and melons in the open field from October to April.",
    goal: "vegetables",
    // Zucchini / squash (FAO-29 Table 4): the most salt-tolerant of the common vegetables.
    water: { kind: "crop", crop: "zucchini", threshold_dS_m: 4.7, slope_pct_per_dS_m: 9.4, kc: 0.85, months: [10, 11, 12, 1, 2, 3, 4] },
    sources: FOOD,
    capex: "low",
    capexNote: "Drip lines, mulch, shade net for young plants",
    firstIncome: "2–3 months after planting",
    minAreaHa: 0.5,
    market: "saturated",
    marketNote: "Winter (Dec–Mar) is the peak of local supply: prices fall for cucumber, eggplant and zucchini.",
    risks: ["Only one season a year; the land sits idle through the summer.", "Glut prices at the winter peak."],
    firstSteps: [
      "Plant early (Sep–Oct) or late (Feb) to sell outside the December–March glut.",
      "Choose salt-tolerant crops (zucchini, eggplant) when the well water is brackish.",
    ],
  },
  {
    id: "date-palms",
    name: "Date palm orchard",
    category: "crops",
    summary: "Premium date varieties (Khalas, Barhi, Sukkari) with the most salt- and heat-tolerant crop in Qatar.",
    goal: "dates",
    // Date palm (FAO-29 Table 4); FAO-56 Table 12 Kc about 0.9–0.95 all year.
    water: { kind: "crop", crop: "date palm", threshold_dS_m: 4.0, slope_pct_per_dS_m: 3.6, kc: 0.93, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
    sources: ALL,
    capex: "medium",
    capexNote: "Offshoots or tissue-culture plants, drip or bubbler irrigation, windbreaks",
    firstIncome: "4–5 years to the first real crop",
    minAreaHa: 1,
    market: "saturated",
    marketNote: "Qatar already grows about 72% of its dates; common varieties sell cheaply, premium fresh (rutab) dates less so.",
    risks: ["Years without income before the palms bear.", "Red palm weevil: buy certified offshoots and inspect monthly."],
    firstSteps: [
      "Plant premium varieties and plan to sell fresh (rutab) at the summer date festivals.",
      "Put in bubbler or drip irrigation with a leaching fraction from day one.",
    ],
  },
  {
    id: "fodder-tse",
    name: "Green fodder on TSE",
    category: "crops",
    summary: "Alfalfa or Rhodes grass irrigated with treated sewage effluent, for local livestock.",
    goal: "green-fodder",
    // Alfalfa (FAO-29 Table 4); Rhodes grass and forage barley tolerate more salt.
    water: { kind: "crop", crop: "alfalfa", threshold_dS_m: 2.0, slope_pct_per_dS_m: 7.3, kc: 0.95, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
    sources: ["tse"],
    capex: "medium",
    capexNote: "Centre pivot or drip, TSE connection and storage",
    firstIncome: "3 months (first cut), then every 4–6 weeks",
    minAreaHa: 5,
    market: "steady",
    marketNote: "Local fodder covers about 55% of need; policy moves all fodder to TSE by 2030.",
    risks: ["Only viable with a TSE allocation near the farm.", "Very high water use: about 2 m of water a year."],
    firstSteps: ["Apply for a TSE allocation before anything else.", "Sell to nearby sheep, goat and dairy farms under contract."],
  },
  {
    id: "table-eggs",
    name: "Table eggs (layer houses)",
    category: "livestock",
    summary: "Climate-controlled layer houses. Eggs have the largest gap to Qatar's 2030 goal.",
    goal: "table-eggs",
    water: { kind: "livestock", poultry: true },
    sources: ALL,
    capex: "high",
    capexNote: "Closed, cooled houses with automatic feeding and egg collection; feed is imported",
    firstIncome: "About 5 months (pullets start laying at 18–20 weeks)",
    minAreaHa: 0.5,
    market: "strong",
    marketNote: "Local eggs cover about 27% of demand against a 70% goal for 2030.",
    risks: ["Bird flu and heat: biosecurity and backup cooling are essential.", "Imported feed makes margins depend on world grain prices."],
    firstSteps: ["Check the Ministry of Municipality's poultry licensing and distance rules.", "Plan RO or network water: poultry need water under 1.5 dS/m."],
  },
  {
    id: "sheep-goats",
    name: "Sheep and goats",
    category: "livestock",
    summary: "Local breeds (Awassi, Naimi, Najdi) for red meat, in shaded pens.",
    goal: "red-meat",
    water: { kind: "livestock", poultry: false },
    sources: ALL,
    capex: "medium",
    capexNote: "Shaded pens, feeders, water troughs, a fodder store",
    firstIncome: "6–8 months (first lambs to market)",
    minAreaHa: 0.5,
    market: "strong",
    marketNote: "Local red meat covers about 19% of demand against a 30% goal; demand peaks at Eid.",
    risks: ["Heat stress in summer: shade, airflow and cool water.", "Feed cost: most fodder and concentrate is bought in."],
    firstSteps: ["Buy local-breed stock from a vet-inspected source.", "Line up fodder supply (ideally TSE-grown) before stocking."],
  },
  {
    id: "aquaculture",
    name: "Aquaculture (fish)",
    category: "aquaculture",
    summary: "Tilapia in brackish groundwater, or marine fish near the coast, in ponds or recirculating tanks.",
    goal: "fresh-fish",
    water: { kind: "aquaculture" },
    sources: ["groundwater", "desalinated"],
    capex: "high",
    capexNote: "Lined ponds or recirculating (RAS) tanks, aeration, backup power",
    firstIncome: "6–9 months (first harvest)",
    minAreaHa: 0.2,
    market: "steady",
    marketNote: "Local fresh fish covers about 65% of demand against an 80% goal.",
    risks: ["Summer water temperature: shade and aeration, or a recirculating system.", "Power cuts kill stock fast: backup aeration is essential."],
    firstSteps: ["Test the well's salinity: tilapia does well in brackish water.", "Talk to the Ministry of Municipality's fisheries team about licences."],
  },
];

export function landUseOption(id: LandUseId): LandUseOption {
  const found = LAND_USE_OPTIONS.find((o) => o.id === id);
  if (!found) throw new Error(`Unknown land use ${id}`);
  return found;
}

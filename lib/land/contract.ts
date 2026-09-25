/**
 * Land-use advisor contract: the request from the planner page, the report it gets back, and the
 * structured output Claude writes after researching Qatar's market (research.ts).
 */
import { z } from "zod";
import type { NationalGoal } from "../qatar/food-security";
import type { QatarLocation } from "../qatar/location";
import type { SiteClimate } from "./climate";
import type { LandUseId, Level, WaterSource } from "./options";

export const LAND_USE_IDS = [
  "greenhouse-veg",
  "hydroponic-leafy",
  "openfield-winter-veg",
  "date-palms",
  "fodder-tse",
  "table-eggs",
  "sheep-goats",
  "aquaculture",
] as const satisfies readonly LandUseId[];

export const LandRequestSchema = z
  .object({
    /** A farm in the dataset: its centre, water EC and sensor history are used. */
    farm_id: z.string().min(1).max(100).optional(),
    lat: z.number({ error: "Latitude must be a number." }).min(-90).max(90).optional(),
    lng: z.number({ error: "Longitude must be a number." }).min(-180).max(180).optional(),
    area_ha: z.number({ error: "Area must be a number." }).positive("Area must be more than 0 ha.").max(5000, "Area must be 5,000 ha or less."),
    water_source: z.enum(["groundwater", "desalinated", "tse"], { error: "Choose a water source." }),
    /** Measured irrigation water EC; null uses the farm's value or the typical one for the source. */
    water_ec_dS_m: z.number().min(0).max(60, "Water EC must be 60 dS/m or less.").nullable().optional(),
    budget: z.enum(["low", "medium", "high"], { error: "Choose a budget." }),
    /** Live web research with Claude when a key is configured. */
    research: z.boolean().default(true),
  })
  .refine((v) => v.farm_id || (v.lat != null && v.lng != null), { message: "Choose a farm or enter latitude and longitude." });
export type LandRequest = z.infer<typeof LandRequestSchema>;

export type FactorKey = "water" | "goal" | "market" | "budget" | "policy" | "site";

export interface Factor {
  /** 0–1. */
  score: number;
  label: string;
}

export interface RankedOption {
  id: LandUseId;
  name: string;
  category: "crops" | "livestock" | "aquaculture";
  summary: string;
  /** 0–100 after any research adjustment. */
  score: number;
  /** Score from the rules alone. */
  base_score: number;
  fit: "strong" | "possible" | "poor";
  /** Why the option can't work here, when it can't. */
  blocked: string | null;
  factors: Record<FactorKey, Factor>;
  /** Irrigation or pond water per hectare per year at this site, m³ (crops and ponds only). */
  water_m3_ha_yr: number | null;
  /** For the requested area, m³ per year. */
  water_m3_yr: number | null;
  capex: Level;
  capex_note: string;
  first_income: string;
  why: string[];
  risks: string[];
  first_steps: string[];
  /** From the live research, when it ran. */
  research_note: string | null;
  research_delta: number;
}

export interface SiteSensors {
  farm_id: string;
  farm_name: string;
  crop: string;
  days: number;
  soil_moisture_pct: number | null;
  air_tmax_mean_c: number | null;
  humidity_mean_pct: number | null;
  ece_dS_m: number | null;
  measured: string[];
}

export interface WaterAssessment {
  source: WaterSource;
  ec_dS_m: number;
  /** Where the EC came from. */
  ec_origin: "measured" | "farm" | "basin typical" | "source typical";
  /** Root-zone salinity to expect with a 15–20% leaching fraction: ECe ≈ 1.5 × ECw (FAO-29). */
  ece_expected_dS_m: number;
  class: string;
  note: string;
}

export interface GoalRow extends Pick<NationalGoal, "product" | "label" | "current_pct" | "current_year" | "target_pct" | "note"> {
  gap_pct: number | null;
  source_url: string | null;
}

export interface ResearchSource {
  title: string;
  url: string;
}

export interface LandResearch {
  status: "live" | "offline" | "failed";
  model: string | null;
  searched_at: string | null;
  headline: string;
  highlights: Array<{ title: string; detail: string; signal: "opportunity" | "risk" | "neutral"; sources: ResearchSource[] }>;
  advice: string;
  caveats: string[];
  sources: ResearchSource[];
}

export interface LandReport {
  generated_at: string;
  as_of: string;
  location: QatarLocation;
  area_ha: number;
  budget: Level;
  water: WaterAssessment;
  climate: SiteClimate;
  sensors: SiteSensors | null;
  goals: GoalRow[];
  market_now: { season: string; scarce: string[]; glut: string[]; note: string };
  options: RankedOption[];
  research: LandResearch;
  method: string[];
}

export interface LandResponse {
  report: LandReport;
}

// ---------------------------------------------------------------------------
// Claude's structured research output (phase 2 of research.ts)
// ---------------------------------------------------------------------------

export const ResearchOutputSchema = z.object({
  headline: z.string().describe("One sentence: what the current market and news mean for this land."),
  highlights: z
    .array(
      z.object({
        title: z.string().describe("Short headline, e.g. 'Tomato prices high after import disruption'."),
        detail: z.string().describe("One or two sentences with the figure or fact and why it matters here."),
        signal: z.enum(["opportunity", "risk", "neutral"]),
        source_ids: z.array(z.number().int()).describe("Ids of the sources in the research notes that support this."),
      }),
    )
    .describe("Three to six findings from the research, most important first."),
  adjustments: z
    .array(
      z.object({
        option_id: z.enum(LAND_USE_IDS),
        delta: z.number().int().describe("Score change from -10 to 10 based on current news and market evidence."),
        reason: z.string().describe("One sentence citing the evidence."),
        source_ids: z.array(z.number().int()),
      }),
    )
    .describe("Only options the evidence says something about; leave the rest out."),
  advice: z.string().describe("Two to four sentences: which option to pursue on this land and the first step."),
  caveats: z.array(z.string()).describe("What the research could not confirm."),
});
export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

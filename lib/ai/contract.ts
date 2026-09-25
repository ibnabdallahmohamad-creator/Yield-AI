/**
 * AI contract — the ONE place that defines what the AI model produces and consumes.
 *
 *  1. `AiInsight`             rows the AI teammate writes to the `ai_insights` table
 *  2. `ChatRequest`           browser → POST /api/chat
 *  3. `AiServiceChatRequest`  our server → POST ${AI_SERVICE_URL}
 *  4. `AiServiceChatResponse` AI service → our server
 *  5. `ChatResponse`          our server → browser
 *  6. `ChatContext`           grounding data sent with every question (readings, trends, FAO-56 values)
 *
 * Change a format here and TypeScript will point at every place that needs updating.
 * The README documents the same shapes for the AI and hardware teammates.
 */
import { z } from "zod";
import type { AnswerSection } from "./sections";

// ---------------------------------------------------------------------------
// 1. Insights (ai_insights table)
// ---------------------------------------------------------------------------

export const RiskLevelSchema = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const PrioritySchema = z.enum(["high", "medium", "low"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const RecommendationSchema = z.object({
  title: z.string().min(1),
  detail: z.string().default(""),
  priority: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), PrioritySchema).catch("medium"),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const CropSuggestionSchema = z.object({
  crop: z.string().min(1),
  reason: z.string().default(""),
  market_note: z.string().default(""),
});
export type CropSuggestion = z.infer<typeof CropSuggestionSchema>;

/** Accept JSON columns that arrive as strings (e.g. inserted as text by a script). */
const jsonish = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }, schema);

export const AiInsightSchema = z.object({
  id: z.coerce.string(),
  farm_id: z.string().min(1),
  created_at: z.string(),
  risk_score: z.coerce.number().min(0).max(100),
  risk_level: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), RiskLevelSchema),
  summary: z.string().min(1),
  recommendations: jsonish(z.array(RecommendationSchema)).catch([]),
  crop_suggestion: jsonish(CropSuggestionSchema.nullable()).catch(null),
});
export type AiInsight = z.infer<typeof AiInsightSchema>;

/** Insights from the built-in rule engine (lib/data/insights.ts), not the AI model, carry this id prefix. */
export const RULES_INSIGHT_PREFIX = "rules-";

export function isRulesInsight(insight: Pick<AiInsight, "id">): boolean {
  return insight.id.startsWith(RULES_INSIGHT_PREFIX);
}

/** Parse an ai_insights row; returns null (and never throws) when the row is unusable. */
export function parseInsight(row: unknown): AiInsight | null {
  const parsed = AiInsightSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// 2–5. Chat
// ---------------------------------------------------------------------------

export const ChatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(4000),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

/** Browser → POST /api/chat. The server builds the context itself. */
export const ChatRequestSchema = z.object({
  farm_id: z.string().min(1).max(64),
  question: z.string().trim().min(1, "Ask a question first").max(1000),
  /** Optional day (YYYY-MM-DD) the user is looking at; defaults to the latest. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  history: z.array(ChatTurnSchema).max(12).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** Our server → POST ${AI_SERVICE_URL} (JSON body). */
export interface AiServiceChatRequest {
  farm_id: string;
  question: string;
  context: ChatContext;
  history?: ChatTurn[];
}

/**
 * AI service → our server. `answer` is required; we also accept `response`, `text` or `message`
 * as the field name so a quick prototype can plug in without changes.
 */
export const AiServiceChatResponseSchema = z
  .object({
    answer: z.string().optional(),
    response: z.string().optional(),
    text: z.string().optional(),
    message: z.string().optional(),
    confidence: z.coerce.number().min(0).max(1).optional(),
    sources: z.array(z.string()).optional(),
  })
  .transform((v) => ({
    answer: (v.answer ?? v.response ?? v.text ?? v.message ?? "").trim(),
    confidence: v.confidence,
    sources: v.sources,
  }))
  .refine((v) => v.answer.length > 0, { message: "AI service returned an empty answer" });
export type AiServiceChatResponse = z.infer<typeof AiServiceChatResponseSchema>;

export type ChatAnswerSource = "ai-service" | "llm" | "offline";

/**
 * What the AI Insights tab asks the answer chain (GET /api/analysis). Whatever the model returns
 * is split into sections by lib/ai/sections.ts — no second model call.
 */
export const ANALYSIS_QUESTION =
  "Give a complete analysis of this farm right now, with a Markdown heading for each part: Summary, Diagnosis, Irrigation, " +
  "Salinity, Nutrients & pH, Weather (next 12 hours), Risks, Recommended actions, What to monitor. Quote the farm's readings " +
  "and derived values with units, and name the probes where it matters.";

/** GET /api/analysis → browser. */
export interface AnalysisResponse {
  farm_id: string;
  /** The day the analysis describes (YYYY-MM-DD). */
  as_of: string;
  answer: string;
  /** The answer split into sections (lib/ai/sections.ts). */
  sections: AnswerSection[];
  source: ChatAnswerSource;
  model: string | null;
  created_at: string;
}

/** Our server → browser. */
export interface ChatResponse {
  farm_id: string;
  answer: string;
  /** Who produced the answer: the teammate's model, the LLM fallback, or the offline agronomy engine. */
  source: ChatAnswerSource;
  model: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// 6. Chat context — grounding data sent with every question
// ---------------------------------------------------------------------------

export interface ChatContext {
  farm: {
    id: string;
    name: string;
    owner: string;
    region: string;
    area_ha: number;
    crop: string;
    crop_id: string;
    planting_date: string;
    days_after_planting: number;
    growth_stage: string;
    soil_type: string;
    irrigation_water_ec_dS_m: number;
  };
  /** The day the numbers describe (YYYY-MM-DD, Asia/Qatar). */
  as_of: string;
  latest_readings: {
    probes: number;
    moisture_pct: number | null;
    soil_temperature_c: number | null;
    bulk_ec_dS_m: number | null;
    ph: number | null;
    n_mg_kg: number | null;
    p_mg_kg: number | null;
    k_mg_kg: number | null;
    /** Per-probe values so the model can point at hotspots. */
    by_probe: Array<{
      sensor_id: string;
      /** Where the probe sits in the field, e.g. "north-east" or "centre". */
      location: string;
      moisture_pct: number | null;
      ece_dS_m: number | null;
      ph: number | null;
      yield_loss_pct: number | null;
      water_deficit_pct_of_raw: number | null;
    }>;
  };
  /** Change over the trend window (default: the last 30 days). */
  trends: {
    window_days: number;
    ece_change_pct: number | null;
    ece_start_dS_m: number | null;
    moisture_change_pct: number | null;
    ph_change: number | null;
    soil_temperature_change_c: number | null;
    et0_mean_mm_day: number | null;
  };
  /** FAO-56 / FAO-29 derived values — ground answers in these, not guesses. */
  derived: {
    et0_mm_day: number | null;
    et0_method: string | null;
    et0_open_meteo_mm_day: number | null;
    kc: number | null;
    etc_mm_day: number | null;
    taw_mm: number;
    raw_mm: number;
    root_zone_depletion_mm: number | null;
    water_deficit_pct_of_raw: number | null;
    water_stress_coefficient_ks: number | null;
    days_until_irrigation: number | null;
    net_irrigation_depth_mm: number | null;
    gross_irrigation_depth_with_leaching_mm: number | null;
    ece_dS_m: number | null;
    salinity_class: string | null;
    crop_salinity_threshold_dS_m: number;
    predicted_yield_loss_pct: number | null;
    leaching_requirement_pct: number;
    methods: string[];
  };
  latest_insight: Pick<AiInsight, "risk_score" | "risk_level" | "summary" | "recommendations" | "crop_suggestion"> | null;
  market: { oversupplied: string[]; undersupplied: string[]; crop_status: string };
  /** The next 12 hours at the farm (Open-Meteo, refreshed every 12 h); null when unavailable. */
  forecast_next_12h: ForecastContext | null;
}

export interface ForecastContext {
  /** ISO hour starts (UTC) of the first and last forecast hour. */
  from: string;
  to: string;
  conditions: string;
  temperature_min_c: number | null;
  temperature_max_c: number | null;
  temperature_max_at: string | null;
  humidity_min_pct: number | null;
  humidity_max_pct: number | null;
  rain_total_mm: number;
  rain_chance_max_pct: number | null;
  wind_mean_m_s: number | null;
  /** Where the wind comes from, e.g. "NW". */
  wind_from: string;
  gust_max_m_s: number | null;
  et0_total_mm: number;
  /** Plain-language advisories (rain vs irrigation, heat, spray window, leaf wetness, crop water use). */
  advisories: string[];
}

/**
 * AI contract — the ONE place that defines what the AI model produces and consumes.
 *
 *  1. `AiInsight`             rows the AI teammate writes to the `ai_insights` table
 *  2. `ChatRequest`           browser → POST /api/chat
 *  3. `AiServiceChatRequest`  our server → POST ${AI_SERVICE_URL}
 *  4. `AiServiceChatResponse` AI service → our server
 *  5. `ChatResponse`          our server → browser
 *  6. `ChatContext`           grounding data sent with every question (readings, trends, FAO-56 values,
 *                             plus retrieved land-atlas, weather and research passages — RAG)
 *
 * Change a format here and TypeScript will point at every place that needs updating.
 * The README documents the same shapes for the AI and hardware teammates.
 */
import { z } from "zod";

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

/** The 10 km² land-atlas cell under the farm (lib/land) — retrieved for every question. */
export interface LandContext {
  cell_id: string;
  municipality: string;
  landform: string;
  coast_distance_km: number;
  fertility_index: number;
  fertility_class: string;
  rawdat_density: string;
  protected_area: string | null;
  soil: {
    description: string;
    texture: string;
    depth: string;
    ph: string;
    organic_matter: string;
    typical_ece_dS_m: number | null;
  };
  climate: {
    annual_rain_mm: number;
    rainy_season: string;
    wettest_month: string;
    annual_mean_temp_c: number;
    july_mean_max_c: number;
    january_mean_min_c: number;
    mean_rh_pct: number;
    mean_wind_10m_m_s: number;
    annual_et0_mm: number;
    peak_et0_mm_day: number;
    rain_share_of_et0_pct: number;
    method: string;
  };
  groundwater: { basin: string; tds_mg_l: number; ecw_dS_m: number; fao29_restriction: string; note: string };
  /** Crops ranked for irrigation with the local groundwater (Maas–Hoffman, ECe ≈ 1.5 × ECw). */
  crops: Array<{ crop: string; relative_yield_pct: number; with_low_salt_water_pct: number; suitability: string; season: string }>;
  /** The full cell description (the retrieved document). */
  description: string;
  /** One line on the 8 surrounding cells. */
  surroundings: string;
  sources: string[];
}

/** Real-time conditions and the 7-day forecast at the farm (WeatherAPI.com, Open-Meteo fills gaps). */
export interface WeatherContext {
  sources: string[];
  current: {
    observed_at: string;
    temp_c: number | null;
    feels_like_c: number | null;
    humidity_pct: number | null;
    wind_kph: number | null;
    gust_kph: number | null;
    wind_dir: string | null;
    precip_mm: number | null;
    condition: string;
  } | null;
  forecast_7d: Array<{
    date: string;
    tmax_c: number | null;
    tmin_c: number | null;
    rh_min_pct: number | null;
    rh_max_pct: number | null;
    wind_mean_kph: number | null;
    wind_max_kph: number | null;
    wind_dir: string | null;
    precip_mm: number | null;
    chance_of_rain_pct: number | null;
    et0_mm: number | null;
    condition: string;
    source: string;
  }>;
  alerts: string[];
  note: string | null;
}

/** A research passage retrieved for the question (lib/land/knowledge.ts). */
export interface KnowledgeContext {
  id: string;
  title: string;
  text: string;
  source: string;
  url?: string;
}

export interface ChatContext {
  /** False until the farm's probes have sent readings; then only land, weather and farm settings are known. */
  has_readings: boolean;
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
  /** Retrieved land-atlas cell for the farm's location. */
  land?: LandContext | null;
  /** Real-time weather and the 7-day forecast. */
  weather?: WeatherContext | null;
  /** Research passages that match the question. */
  knowledge?: KnowledgeContext[];
  /** Summaries of any municipality the question names. */
  region_notes?: string[];
}

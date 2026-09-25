/**
 * AI contract — the ONE place that defines what the AI model produces and consumes.
 *
 *  1. `AiInsight`             rows the AI teammate writes to the `ai_insights` table
 *  2. `ChatRequest`           browser → POST /api/chat
 *  3. `AiServiceChatRequest`  our server → POST ${AI_SERVICE_URL}
 *  4. `AiServiceChatResponse` AI service → our server
 *  5. `ChatResponse`          our server → browser
 *  6. `ChatContext`           grounding data sent with every question (location, readings, trends,
 *                             FAO-56 values, 7-day outlook, economics, harvest, national goals)
 *  7. `Conversation`          saved chats and their messages (/api/conversations)
 *
 * Change a format here and TypeScript will point at every place that needs updating.
 * The README documents the same shapes for the AI and hardware teammates.
 */
import { z } from "zod";
import type { QatarLocation } from "../qatar/location";
import type { AirToday, EconomicsFacts, FarmFacts, HarvestFacts, Outlook } from "./farm-facts";

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

// The report sections (ai_insights columns added in migration 0003). Every one is optional so rows
// written before the sections existed, or by a model that leaves one out, still parse.

const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);

/** Insights: what the readings say, in plain words. */
export const FindingSchema = z.object({
  title: z.string().min(1),
  detail: z.string().default(""),
});
export type Finding = z.infer<typeof FindingSchema>;

export const WarningSeveritySchema = z.enum(["critical", "warning", "watch"]);
export type WarningSeverity = z.infer<typeof WarningSeveritySchema>;

/** Warnings: something that will hurt the crop soon unless acted on. */
export const WarningSchema = z.object({
  severity: z.preprocess(lower, WarningSeveritySchema).catch("watch"),
  title: z.string().min(1),
  detail: z.string().default(""),
  /** When it applies, e.g. "Today" or "Thu 25 – Sat 27 Sep". */
  when: z.string().default(""),
});
export type Warning = z.infer<typeof WarningSchema>;

export const ForecastDaySchema = z.object({
  date: z.string(),
  /** Short headline for the day, e.g. "Irrigate 14 mm" or "Windy — no spraying". */
  label: z.string().default(""),
  level: z.preprocess(lower, z.enum(["ok", "watch", "warning"])).catch("ok"),
});
export type ForecastDay = z.infer<typeof ForecastDaySchema>;

/** Forecast: the next 7 days for this farm. */
export const ForecastSchema = z.object({
  summary: z.string().min(1),
  days: z.array(ForecastDaySchema).default([]),
});
export type Forecast = z.infer<typeof ForecastSchema>;

export const EconomicLineSchema = z.object({
  label: z.string().min(1),
  /** Display value with its unit, e.g. "QAR 38,000–64,000" or "540 m³". */
  value: z.string().min(1),
  detail: z.string().default(""),
});
export type EconomicLine = z.infer<typeof EconomicLineSchema>;

/** Economic analysis in QAR. Figures rest on indicative prices, listed in `assumptions`. */
export const EconomicsSchema = z.object({
  summary: z.string().min(1),
  lines: z.array(EconomicLineSchema).default([]),
  assumptions: z.array(z.string()).default([]),
});
export type Economics = z.infer<typeof EconomicsSchema>;

export const NextCropSchema = z.object({
  crop: z.string().min(1),
  reason: z.string().default(""),
  /** Open-field planting months in Qatar, e.g. "Sep–Nov". */
  plant_window: z.string().default(""),
});
export type NextCrop = z.infer<typeof NextCropSchema>;

/** Harvest: when to harvest the current crop and what to grow next. */
export const HarvestSchema = z.object({
  status: z.preprocess(lower, z.enum(["establishing", "growing", "harvesting", "ending", "finished", "cutting"])).catch("growing"),
  summary: z.string().min(1),
  /** Harvest window, YYYY-MM-DD. */
  window: z.object({ start: z.string(), end: z.string().nullable() }).nullable().catch(null),
  next_crops: z.array(NextCropSchema).default([]),
});
export type Harvest = z.infer<typeof HarvestSchema>;

export const AiInsightSchema = z.object({
  id: z.coerce.string(),
  farm_id: z.string().min(1),
  created_at: z.string(),
  risk_score: z.coerce.number().min(0).max(100),
  risk_level: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), RiskLevelSchema),
  summary: z.string().min(1),
  recommendations: jsonish(z.array(RecommendationSchema)).catch([]),
  crop_suggestion: jsonish(CropSuggestionSchema.nullable()).catch(null),
  insights: jsonish(z.array(FindingSchema)).catch([]),
  warnings: jsonish(z.array(WarningSchema)).catch([]),
  forecast: jsonish(ForecastSchema.nullable()).catch(null),
  economics: jsonish(EconomicsSchema.nullable()).catch(null),
  harvest: jsonish(HarvestSchema.nullable()).catch(null),
});
export type AiInsight = z.infer<typeof AiInsightSchema>;

/** The sections of an insight a model writes (the fine-tuning target; no ids or timestamps). */
export const FarmReportSchema = AiInsightSchema.omit({ id: true, farm_id: true, created_at: true });
export type FarmReport = z.infer<typeof FarmReportSchema>;

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
  /** Append to this saved conversation. The server loads its history and ignores `history`. */
  conversation_id: z.string().min(1).max(64).optional(),
  /** Start a saved conversation titled after the question (ignored when `conversation_id` is set). */
  new_conversation: z.boolean().optional(),
  /** The insight an "Ask AI about this" question came from; stored on the user message. */
  insight_id: z.string().min(1).max(128).optional(),
  /** With `conversation_id`: answer the last user message again, replacing the replies after it. */
  regenerate: z.boolean().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** Our server → POST ${AI_SERVICE_URL} (JSON body). */
export interface AiServiceChatRequest {
  farm_id: string;
  question: string;
  context: ChatContext;
  history?: ChatTurn[];
}

/** The fine-tuned model's own output keys (lib/dataset/schema.ts OUTPUT_KEYS), to recognise a bare answer object. */
const MODEL_OUTPUT_HINTS = ["summary", "insights", "warnings", "recommendations", "forecast", "economic_advice", "crop_plan", "data_gaps"];

const asText = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return JSON.stringify(v);
  return null;
};

/**
 * Pull the answer text out of whatever the model server returns, so a quick prototype plugs in
 * without changes: { answer | response | text | output | content | generated_text }, { message:
 * string | { content } } (Ollama), { choices: [{ message: { content } } | { text }] } (OpenAI-style,
 * vLLM, llama.cpp), [{ generated_text }] (Hugging Face), or the model's answer object itself
 * ({ task, summary, insights, … }). An answer that is an object is kept as JSON text; the chat splits
 * it into sections (lib/ai/sections.ts).
 */
export function normalizeAiServicePayload(payload: unknown): unknown {
  let p = payload;
  if (Array.isArray(p) && p.length > 0 && p[0] && typeof p[0] === "object") p = p[0];
  if (!p || typeof p !== "object" || Array.isArray(p)) return { answer: asText(p) ?? "" };
  const o = p as Record<string, unknown>;
  const choice = Array.isArray(o.choices) ? (o.choices[0] as Record<string, unknown> | undefined) : undefined;
  const choiceMessage = choice?.message && typeof choice.message === "object" ? (choice.message as Record<string, unknown>) : undefined;
  const message = o.message && typeof o.message === "object" && !Array.isArray(o.message) ? (o.message as Record<string, unknown>) : undefined;
  // Messages-API style: content is a list of { type: "text", text } blocks.
  const blocks = Array.isArray(o.content)
    ? o.content.map((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : "")).join("")
    : o.content;
  const candidates: unknown[] = [
    o.answer,
    o.response,
    o.text,
    o.output,
    blocks,
    o.generated_text,
    typeof o.message === "string" ? o.message : message?.content,
    choiceMessage?.content,
    choice?.text,
  ];
  let answer = candidates.map(asText).find((v) => v != null && v.trim() !== "") ?? null;
  if (answer == null && MODEL_OUTPUT_HINTS.filter((k) => k in o).length >= 2) answer = JSON.stringify(o);
  return { answer: answer ?? "", confidence: o.confidence, sources: o.sources };
}

/**
 * AI service → our server, after `normalizeAiServicePayload`: the answer text (Markdown or the
 * model's JSON), plus optional `confidence` and `sources`.
 */
export const AiServiceChatResponseSchema = z
  .object({
    answer: z.string(),
    confidence: z.coerce.number().min(0).max(1).optional().catch(undefined),
    sources: z.array(z.string()).optional().catch(undefined),
  })
  .transform((v) => ({ answer: v.answer.trim(), confidence: v.confidence, sources: v.sources }))
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
  /** The saved conversation this exchange belongs to; null when stateless or not saved. */
  conversation_id: string | null;
  /** Present when saved: the created or updated conversation. */
  conversation?: Conversation;
  /** The stored question (absent on regenerate). */
  user_message?: ConversationMessage;
  /** The stored answer. */
  message?: ConversationMessage;
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
  /** Exact position (farm centre) and what it means in Qatar: coast, groundwater basin, nearest town. */
  location: QatarLocation;
  /** Which inputs are measured on site; the rest are null or come from Open-Meteo. */
  measured: FarmFacts["measured"];
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
    /** Air temperature, humidity and wind for the day, with VPD and dew point derived from them. */
    air: AirToday;
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
  latest_insight: Pick<AiInsight, "risk_score" | "risk_level" | "summary" | "recommendations" | "crop_suggestion" | "warnings"> | null;
  /** The next 7 days: forecast weather, crop water use and the projected irrigation schedule. */
  outlook: Outlook | null;
  /** Harvest window for the current crop and the best crops for next season. */
  harvest: HarvestFacts;
  /** Expected harvest, revenue, salinity and water costs in QAR (indicative prices, see assumptions). */
  economics: EconomicsFacts;
  /** Qatar National Food Security Strategy 2030 goals this farm contributes to. */
  national_goals: Array<{ label: string; current_pct: number; current_year: number; target_pct: number | null; note: string }>;
  market: {
    /** Crops flagged oversupplied / undersupplied in the winter peak season (project brief). */
    oversupplied: string[];
    undersupplied: string[];
    crop_status: string;
    /** Qatar supply season on `as_of`, e.g. "summer (Jun–Sep)". */
    season: string;
    /** Crops that are short in local markets right now (e.g. tomato and pepper in summer). */
    scarce_now: string[];
    /** Crops at risk of a glut right now. */
    glut_now: string[];
  };
  /** Air temperature and rain from Open-Meteo around `as_of`; null when weather is unavailable. */
  weather: ChatWeather | null;
  /** Hour by hour for the next 12 hours (Open-Meteo, refreshed at 00:00 and 12:00 Qatar time); null when unavailable. */
  weather_next_12h?: ChatNext12h | null;
}

/** Rain and heat summary for the chat (the Temperature and Rain chart tabs). */
export interface ChatWeather {
  source: "open-meteo";
  /** Past days summarised, ending on `as_of`. */
  window_days: number;
  rain_total_mm: number;
  /** Days with at least 0.5 mm of rain. */
  rain_days: number;
  last_rain_date: string | null;
  /** Air temperature on `as_of`. */
  air_tmax_c: number | null;
  air_tmin_c: number | null;
  hottest_tmax_c: number | null;
  /** Indicative daily-maximum air temperature above which the crop is heat-stressed. */
  heat_stress_threshold_c: number;
  days_above_heat_threshold: number;
  /** The coming days (only when `as_of` is today); not used in the water balance. */
  forecast: Array<{ date: string; tmax_c: number | null; tmin_c: number | null; rain_mm: number | null; rain_chance_pct: number | null }>;
  forecast_rain_total_mm: number | null;
  forecast_days_above_heat_threshold: number | null;
}

export interface ChatNext12h {
  source: "open-meteo";
  fetched_at: string;
  temp_min_c: number | null;
  temp_max_c: number | null;
  /** Qatar time of the hottest hour, "14:00". */
  hottest_at: string | null;
  humidity_min_pct: number | null;
  humidity_max_pct: number | null;
  rain_total_mm: number;
  rain_max_chance_pct: number | null;
  wind_max_ms: number | null;
  gust_max_ms: number | null;
  /** Compass direction the wind mostly comes from, e.g. "NW". */
  wind_from: string | null;
  hours: Array<{ time: string; temp_c: number | null; humidity_pct: number | null; rain_mm: number | null; rain_chance_pct: number | null; wind_ms: number | null; gust_ms: number | null; wind_from: string | null }>;
}

// ---------------------------------------------------------------------------
// 7. Conversations — saved chats (see README → "Saved chats")
// ---------------------------------------------------------------------------

export const MessageFeedbackValueSchema = z.enum(["up", "down"], { error: 'Feedback must be "up", "down" or null.' });
export type MessageFeedback = "up" | "down";

export interface Conversation {
  /** uuid (Supabase) or a random url-safe id (local accounts). */
  id: string;
  farm_id: string | null;
  title: string;
  pinned: boolean;
  created_at: string;
  /** Bumped on every new message, rename and pin. */
  updated_at: string;
  /** Last message text, trimmed to ~140 chars (for the history list and search). */
  preview: string;
  message_count: number;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  /** Assistant messages only. */
  source: ChatAnswerSource | null;
  model: string | null;
  /** The day (YYYY-MM-DD) the answer was grounded on. */
  as_of: string | null;
  /** Set when the question came from "Ask AI about this" on an insight. */
  insight_id: string | null;
  feedback: MessageFeedback | null;
  created_at: string;
}

const ConversationFarmSchema = z.string({ error: "Pick a farm." }).min(1, "Pick a farm.").max(64, "That farm id is too long.");

const ConversationTitleSchema = z
  .string({ error: "The title must be text." })
  .trim()
  .min(1, "Give the chat a title.")
  .max(120, "Keep the title under 120 characters.");

/** Browser → POST /api/conversations. */
export const ConversationCreateSchema = z.object({
  farm_id: ConversationFarmSchema,
  title: ConversationTitleSchema.optional(),
});
export type ConversationCreate = z.infer<typeof ConversationCreateSchema>;

/** Browser → PATCH /api/conversations/[id]. At least one field. */
export const ConversationPatchSchema = z
  .object({
    title: ConversationTitleSchema.optional(),
    pinned: z.boolean({ error: "`pinned` must be true or false." }).optional(),
    farm_id: ConversationFarmSchema.optional(),
  })
  .refine((v) => v.title !== undefined || v.pinned !== undefined || v.farm_id !== undefined, {
    message: "Nothing to update.",
  });
export type ConversationPatch = z.infer<typeof ConversationPatchSchema>;

/** Browser → PATCH /api/conversations/[id]/messages/[messageId]. `null` clears the rating. */
export const MessageFeedbackSchema = z.object({
  feedback: MessageFeedbackValueSchema.nullable(),
});

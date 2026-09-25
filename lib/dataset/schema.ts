/**
 * The contract of the fine-tuned model: what it is given and what it must answer, for both tasks.
 *
 * INPUT: one JSON object (the user message)
 *   task, question, as_of, forecast_days
 *   inputs — the nine inputs, always all present:
 *     1 latitude            2 longitude            (the farm or plot)
 *     3 ecosystem           4 growable_crops       (derived from the FAO datasets for that point)
 *     5 air_temperature     6 relative_humidity    7 wind     8 rain   (Open-Meteo, real time)
 *     9 soil_moisture       (the field robot's probe survey)
 *   context   — what the farmer told us (crop, area, water source, budget)
 *   derived   — numbers computed by code from the inputs (FAO-56 water balance, FAO-29 salinity,
 *               land-use ranking facts, market calendar), so the model never has to do arithmetic
 *   evidence  — news, papers and reports relevant to the question, each with an id to cite
 *
 * OUTPUT: one JSON object with exactly OUTPUT_KEYS, in that order, for both tasks.
 */
import { z } from "zod";

export const TASKS = ["land_analysis", "farm_analysis"] as const;
export type Task = (typeof TASKS)[number];

export const INPUT_KEYS = [
  "latitude",
  "longitude",
  "ecosystem",
  "growable_crops",
  "air_temperature",
  "relative_humidity",
  "wind",
  "rain",
  "soil_moisture",
] as const;

export const OUTPUT_KEYS = [
  "task",
  "summary",
  "insights",
  "warnings",
  "forecast",
  "economic_advice",
  "recommendations",
  "crop_plan",
  "sources",
  "data_gaps",
] as const;

/**
 * Every string is one line of plain text (no Markdown, no line breaks), so the website can drop it
 * straight into its place on the page.
 */
const text = z
  .string()
  .min(1)
  .refine((s) => !/[\n\r]/.test(s) && !/\*\*|^#|^\s*[-*] /.test(s), "one line of plain text");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const InsightSchema = z.object({ title: text, detail: text, sources: z.array(text) }).strict();
export const WarningSchema = z
  .object({
    severity: z.enum(["critical", "warning", "watch"]),
    title: text,
    /** When it applies: "Today", "Thu 25 Sep", "Thu 25 – Sat 27 Sep", "This week", "Ongoing"… */
    when: text,
    detail: text,
    action: text,
  })
  .strict();
export const ForecastDaySchema = z.object({ date: isoDate, label: text, level: z.enum(["ok", "watch", "warning"]) }).strict();
export const ForecastSchema = z
  .object({ next_7_days: text, days: z.array(ForecastDaySchema).length(7), season_ahead: text, long_term: text })
  .strict();
export const FigureSchema = z.object({ label: text, value: text, basis: text }).strict();
export const EconomicAdviceSchema = z.object({ summary: text, figures: z.array(FigureSchema).min(1).max(6), advice: z.array(text).min(1).max(5) }).strict();
export const RecommendationSchema = z
  .object({ priority: z.enum(["high", "medium", "low"]), action: text, when: text, why: text })
  .strict();
export const HarvestStatusSchema = z.enum(["establishing", "growing", "harvesting", "ending", "cutting"]);
export const CropPlanSchema = z
  .object({
    /** First item: the crop or use to go with (the current crop on a farm); then the alternatives. */
    recommended: z.array(z.object({ crop: text, farm_type: text, when: text, why: text }).strict()).min(1).max(3),
    avoid: z.array(z.object({ crop: text, why: text }).strict()).max(4),
    /** The current crop's harvest (farm_analysis); null for land_analysis. */
    harvest: z.object({ status: HarvestStatusSchema, start: isoDate, end: isoDate.nullable() }).strict().nullable(),
  })
  .strict();
export const SourceRefSchema = z.object({ id: text, title: text, url: text }).strict();

export const ModelOutputSchema = z
  .object({
    task: z.enum(TASKS),
    summary: text,
    insights: z.array(InsightSchema).min(2).max(6),
    warnings: z.array(WarningSchema).max(5),
    forecast: ForecastSchema,
    economic_advice: EconomicAdviceSchema,
    recommendations: z.array(RecommendationSchema).min(2).max(6),
    crop_plan: CropPlanSchema,
    sources: z.array(SourceRefSchema).min(1),
    data_gaps: z.array(text).max(5),
  })
  .strict();

export type ModelOutput = z.infer<typeof ModelOutputSchema>;
export type Insight = z.infer<typeof InsightSchema>;
export type DatasetWarning = z.infer<typeof WarningSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type Figure = z.infer<typeof FigureSchema>;
export type ForecastDay = z.infer<typeof ForecastDaySchema>;

export interface EvidenceItem {
  id: string;
  kind: string;
  publisher: string;
  title: string;
  date: string;
  url: string;
  facts: string[];
}

export interface ModelInput {
  task: Task;
  question: string;
  /** Local time in Qatar, "YYYY-MM-DD HH:mm". */
  as_of: string;
  /** Labels of the seven forecast days, tomorrow first ("Thu 25 Sep"). */
  forecast_days: string[];
  /** The same seven days as YYYY-MM-DD, for `forecast.days[].date`. */
  forecast_dates: string[];
  inputs: Record<(typeof INPUT_KEYS)[number], unknown>;
  context: Record<string, unknown>;
  derived: Record<string, unknown>;
  evidence: EvidenceItem[];
}

/**
 * Q1 marks a land-suitability question (Land Analysis: what should this land be used for?), Q2 an
 * inquiry about a farm that is already growing (Farm Analysis).
 */
export const QUESTION_TAG: Record<Task, "Q1" | "Q2"> = { land_analysis: "Q1", farm_analysis: "Q2" };

/**
 * The user turn, the same in training and inference: "Q1: <question>" or "Q2: <question>" on the first
 * line, then a blank line and the input as JSON (without the question, which is already on line one).
 */
export function formatUserMessage(input: ModelInput): string {
  const { question, ...rest } = input;
  return `${QUESTION_TAG[input.task]}: ${question}\n\n${JSON.stringify(rest)}`;
}

/** The same system prompt for training and inference. */
export const SYSTEM_PROMPT = [
  "You are Yield AI, an agronomy and farm-economics advisor for farms and land in Qatar only. Every site, market, price, policy and goal you discuss is Qatar's.",
  "The user message starts with the farmer's question on one line, tagged Q1 or Q2. Q1 is a land question (task land_analysis): is this land suitable, and what should it be used for? Q2 is an inquiry about a farm that is already growing a crop (task farm_analysis).",
  "After a blank line comes the input as JSON: the task, the date, nine inputs (latitude, longitude, ecosystem, growable_crops, air_temperature, relative_humidity, wind, rain, soil_moisture), context from the farmer, values derived from the inputs by code, and evidence items (news, research, reports, data) with ids.",
  "Q1 / land_analysis: decide what the land should be used for. Weigh the site and its water, the market, trade and politics, the national food-security goals and the economics; say which crops to grow and in what type of farm, and what to avoid.",
  "Q2 / farm_analysis: assess the growing crop today. Weigh soil water from the robot, crop water use, salinity, the weather and the 7-day forecast, the harvest and the market; say what to do now.",
  `Answer with one JSON object and nothing else, with exactly these keys in this order: ${OUTPUT_KEYS.join(", ")}.`,
  "Each key is one section of the app's page, so keep every section's shape exactly as below. Every string is one line of plain text: no Markdown, no bullets, no line breaks.",
  "summary: the direct answer to the question in 2–3 sentences. insights: 2–6 {title, detail, sources}, each citing evidence ids. warnings: 0–5 {severity: critical|warning|watch, title, when, detail, action}, most severe first. forecast: {next_7_days, days, season_ahead, long_term}; days has one {date, label, level: ok|watch|warning} for each of forecast_dates. economic_advice: {summary, figures: [{label, value, basis}], advice: [text]}. recommendations: 2–6 {priority: high|medium|low, action, when, why}, most important first. crop_plan: {recommended: 1–3 {crop, farm_type, when, why}, the first being the one to go with; avoid: [{crop, why}]; harvest: {status, start, end} for the current crop in farm_analysis, null in land_analysis}. sources: every evidence item you cited, with its title and url. data_gaps: what is missing or assumed.",
  "Use only numbers that appear in the input. Never invent prices, dates or statistics. If something is unknown, say so in data_gaps.",
].join("\n");

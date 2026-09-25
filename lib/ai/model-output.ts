/**
 * The fine-tuned Yield AI model's answer, taken apart for the website with plain code (no second model):
 *
 *   parseModelReply(reply)  raw model text → the validated answer (lib/dataset/schema.ts), or an error
 *   SECTION_LAYOUT          which section goes where on the page, in reading order
 *   toFarmReport(answer)    a Q2 answer → the Insights page's sections (FarmReport, contract.ts)
 *   toLandResearch(answer)  a Q1 answer → the land planner's research panel (LandResearch)
 *
 * Every section has a fixed key and a fixed shape, and every string is one line of plain text, so
 * each one can be dropped into its slot as it is.
 */
import { ModelOutputSchema, OUTPUT_KEYS, type ModelOutput } from "../dataset/schema";
import type { LandResearch } from "../land/contract";
import { FarmReportSchema, type AiInsight, type FarmReport, type RiskLevel } from "./contract";

export type SectionKey = Exclude<(typeof OUTPUT_KEYS)[number], "task">;

/** Where each section of an answer is shown, in reading order. */
export const SECTION_LAYOUT: ReadonlyArray<{ key: SectionKey; heading: string; place: string }> = [
  { key: "summary", heading: "Answer", place: "Top of the page, above everything else" },
  { key: "warnings", heading: "Warnings", place: "Warnings card, most severe first; `when` beside the title" },
  { key: "insights", heading: "Insights", place: "Insights card" },
  { key: "recommendations", heading: "What to do", place: "Recommendations list, by priority" },
  { key: "forecast", heading: "Next 7 days", place: "Forecast card: `days` as seven day chips, then the season and long-term outlook" },
  { key: "economic_advice", heading: "Economic analysis", place: "Economics card: summary, then `figures` as label/value rows" },
  { key: "crop_plan", heading: "Crop plan", place: "Crop plan / Harvest card: the first recommended item leads, then alternatives and crops to avoid" },
  { key: "data_gaps", heading: "Data gaps", place: "Small print under the economics card" },
  { key: "sources", heading: "Sources", place: "Source links at the bottom" },
];

export type ParsedReply = { ok: true; answer: ModelOutput } | { ok: false; error: string };

/**
 * Reads the model's reply. Tolerates what small models add around the JSON (a ```json fence, an
 * empty <think></think> block, stray text before or after), then validates every section.
 */
export function parseModelReply(reply: string): ParsedReply {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "No JSON object in the reply." };
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return { ok: false, error: `The reply isn't valid JSON: ${(e as Error).message}` };
  }
  const parsed = ModelOutputSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
  return { ok: true, answer: parsed.data };
}

/**
 * The risk badge, from the warnings alone: the worst severity sets the band (the Insights page's
 * bands: low < 40, medium 40–69, high ≥ 70) and each further warning adds 5 within it.
 */
export function riskFromWarnings(warnings: ModelOutput["warnings"]): { risk_score: number; risk_level: RiskLevel } {
  const band = warnings.some((w) => w.severity === "critical")
    ? { base: 75, max: 100 }
    : warnings.some((w) => w.severity === "warning")
      ? { base: 45, max: 69 }
      : warnings.length
        ? { base: 20, max: 39 }
        : { base: 10, max: 10 };
  const risk_score = Math.min(band.max, band.base + 5 * Math.max(0, warnings.length - 1));
  return { risk_score, risk_level: risk_score >= 70 ? "high" : risk_score >= 40 ? "medium" : "low" };
}

const planted = (when: string) => when.replace(/^(From|Plant)\s+/i, "");

/** A Q2 (farm_analysis) answer as the sections the Insights page renders. */
export function toFarmReport(answer: ModelOutput): FarmReport {
  const [keep, ...next] = answer.crop_plan.recommended;
  const harvest = answer.crop_plan.harvest;
  return FarmReportSchema.parse({
    ...riskFromWarnings(answer.warnings),
    summary: answer.summary,
    recommendations: answer.recommendations.map((r) => ({ title: r.action, detail: `${r.when}: ${r.why}`, priority: r.priority })),
    crop_suggestion: keep ? { crop: keep.crop, reason: keep.why, market_note: answer.forecast.season_ahead } : null,
    insights: answer.insights.map(({ title, detail }) => ({ title, detail })),
    warnings: answer.warnings.map((w) => ({ severity: w.severity, title: w.title, detail: `${w.detail} ${w.action}`, when: w.when })),
    forecast: { summary: answer.forecast.next_7_days, days: answer.forecast.days },
    economics: {
      summary: [answer.economic_advice.summary, ...answer.economic_advice.advice].join(" "),
      lines: answer.economic_advice.figures.map((f) => ({ label: f.label, value: f.value, detail: f.basis })),
      assumptions: answer.data_gaps,
    },
    harvest: harvest
      ? {
          status: harvest.status,
          summary: answer.forecast.season_ahead,
          window: { start: harvest.start, end: harvest.end },
          next_crops: next.map((c) => ({ crop: c.crop, reason: c.why, plant_window: planted(c.when) })),
        }
      : null,
  });
}

/** A stored `ai_insights` row from the model's raw reply, or null when the reply is unusable. */
export function insightFromModelReply(reply: string, row: { id: string; farm_id: string; created_at: string }): AiInsight | null {
  const parsed = parseModelReply(reply);
  if (!parsed.ok || parsed.answer.task !== "farm_analysis") return null;
  return { ...row, ...toFarmReport(parsed.answer) };
}

/** A Q1 (land_analysis) answer as the land planner's research panel. */
export function toLandResearch(answer: ModelOutput, meta: { model: string; at: string }): LandResearch {
  const byId = new Map(answer.sources.map((s) => [s.id, { title: s.title, url: s.url }]));
  const [best] = answer.crop_plan.recommended;
  return {
    status: "live",
    model: meta.model,
    searched_at: meta.at,
    headline: answer.summary,
    highlights: [
      ...answer.insights.map((i) => ({
        title: i.title,
        detail: i.detail,
        signal: "neutral" as const,
        sources: i.sources.flatMap((id) => byId.get(id) ?? []),
      })),
      ...answer.warnings.map((w) => ({ title: w.title, detail: `${w.detail} ${w.action}`, signal: "risk" as const, sources: [] })),
    ],
    advice: [best ? `${best.crop} (${best.farm_type}): ${best.why}` : "", answer.economic_advice.summary, ...answer.recommendations.slice(0, 2).map((r) => `${r.action} (${r.when}).`)]
      .filter(Boolean)
      .join(" "),
    caveats: answer.data_gaps,
    sources: answer.sources.map((s) => ({ title: s.title, url: s.url })),
  };
}

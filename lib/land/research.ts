/**
 * Live market research for the land-use advisor, in two calls to Claude:
 *
 *  1. Research: Claude searches the web (server-side web search, results localised to Qatar) for
 *     current prices, shortages, government programmes and what is working, and writes cited notes.
 *  2. Structure: Claude turns the notes into `ResearchOutput` (highlights, per-option score
 *     changes, advice) with a JSON schema. Structured outputs can't carry citations, so the notes
 *     mark sources as [S1], [S2]… and the output refers to them by number.
 *
 * Returns null when no API key is configured; a failed or refused call returns status "failed".
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { env } from "../env";
import { ResearchOutputSchema, type LandResearch, type RankedOption, type ResearchOutput, type ResearchSource, type SiteSensors, type WaterAssessment } from "./contract";
import type { SiteClimate } from "./climate";
import type { QatarLocation } from "../qatar/location";
import { NATIONAL_GOALS } from "../qatar/food-security";

const RESEARCH_TIMEOUT_MS = 70_000;
const STRUCTURE_TIMEOUT_MS = 35_000;
const MAX_CONTINUATIONS = 2;
const MAX_SEARCHES = 6;

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!env.anthropicApiKey) return null;
  client ??= new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 1 });
  return client;
}

export function researchAvailable(): boolean {
  return Boolean(env.anthropicApiKey);
}

export interface ResearchInput {
  as_of: string;
  season: string;
  location: QatarLocation;
  area_ha: number;
  budget: string;
  water: WaterAssessment;
  climate: SiteClimate;
  sensors: SiteSensors | null;
  options: RankedOption[];
}

const RESEARCH_SYSTEM = `You are an agricultural market analyst for Qatar. You help a farmer decide what to use a piece of land for.
Search the web for current evidence, then write short research notes.
- Prefer sources from the last 12 months: Qatar News Agency, The Peninsula, Gulf Times, Qatar Tribune, the Ministry of Municipality, Mahaseel, Hassad, the Planning and Statistics Authority, FAO.
- Report facts with figures and dates (prices in QAR, volumes, self-sufficiency rates, programme names and deadlines). Say when a fact is older than 12 months.
- Cover: what is scarce or expensive in Qatar's markets now; government support and licensing news; projects that are working (and failing); water and TSE policy; import disruptions.
- Keep the notes under 450 words, grouped by land-use option. Never invent a figure.`;

function describeSite(input: ResearchInput): string {
  const l = input.location;
  const c = input.climate;
  const top = input.options.slice(0, 6).map((o) => `- ${o.name} (${o.id}): rule score ${o.base_score}/100${o.blocked ? ` — blocked: ${o.blocked}` : ""}`);
  const goals = NATIONAL_GOALS.map((g) => `${g.label} ${g.current_pct}% (${g.current_year})${g.target_pct != null ? ` → ${g.target_pct}% by 2030` : ""}`).join("; ");
  const sensors = input.sensors
    ? `On-site sensors (${input.sensors.farm_name}, last ${input.sensors.days} days): soil moisture ${input.sensors.soil_moisture_pct ?? "n/a"}%, air max ${input.sensors.air_tmax_mean_c ?? "n/a"} °C, humidity ${input.sensors.humidity_mean_pct ?? "n/a"}%${input.sensors.ece_dS_m != null ? `, soil ECe ${input.sensors.ece_dS_m} dS/m` : ""}.`
    : "No on-site sensors.";
  return [
    `Date: ${input.as_of} (${input.season}).`,
    `Site: ${l.lat.toFixed(4)} N, ${l.lng.toFixed(4)} E — ${l.place}, ${l.municipality}; ${l.distance_to_coast_km} km from the sea; ${l.groundwater_basin} groundwater basin.`,
    `Area ${input.area_ha} ha; budget ${input.budget}; water: ${input.water.source}, ECw ${input.water.ec_dS_m} dS/m (${input.water.class}).`,
    `Climate last year: ET₀ ${c.et0_annual_mm} mm, summer highs ${c.summer_tmax_mean_c} °C, ${c.days_above_45c} days above 45 °C, winter lows ${c.winter_tmin_mean_c} °C, summer humidity ${c.summer_humidity_mean_pct}%.`,
    sensors,
    `National Food Security Strategy 2030: ${goals}.`,
    "Options ranked by our rules (salt tolerance, national goals, budget, water policy, site):",
    ...top,
  ].join("\n");
}

/** Text blocks with [S#] markers after cited passages, and the numbered source list. */
function notesWithSources(content: Anthropic.Beta.BetaContentBlock[]): { notes: string; sources: ResearchSource[] } {
  const sources: ResearchSource[] = [];
  const idOf = (url: string, title: string | null) => {
    let i = sources.findIndex((s) => s.url === url);
    if (i < 0) {
      sources.push({ url, title: title?.trim() || new URL(url).hostname });
      i = sources.length - 1;
    }
    return i + 1;
  };
  let notes = "";
  for (const block of content) {
    if (block.type !== "text") continue;
    const ids = new Set<number>();
    for (const c of block.citations ?? []) if (c.type === "web_search_result_location") ids.add(idOf(c.url, c.title));
    notes += block.text + (ids.size ? ` [${[...ids].map((i) => `S${i}`).join(", ")}]` : "");
  }
  // Nothing cited: fall back to the pages the search returned.
  if (sources.length === 0) {
    for (const block of content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content.slice(0, 4)) idOf(r.url, r.title);
      }
    }
  }
  return { notes: notes.trim(), sources };
}

async function research(anthropic: Anthropic, input: ResearchInput): Promise<{ notes: string; sources: ResearchSource[]; model: string } | null> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `${describeSite(input)}\n\nResearch the current evidence for these options on this land, then write your notes.` },
  ];
  const content: Anthropic.Beta.BetaContentBlock[] = [];
  let model = env.anthropicModel;
  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const response = await anthropic.beta.messages.create(
      {
        model: env.anthropicModel,
        max_tokens: 8000,
        output_config: { effort: "medium" },
        system: RESEARCH_SYSTEM,
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            max_uses: MAX_SEARCHES,
            user_location: { type: "approximate", country: "QA", city: input.location.municipality === "Doha" ? "Doha" : input.location.nearest_town, timezone: "Asia/Qatar" },
          },
        ],
        messages,
      },
      { timeout: RESEARCH_TIMEOUT_MS },
    );
    model = response.model;
    if (response.stop_reason === "refusal") return null;
    content.push(...response.content);
    // A long server-side search turn pauses; send it back to let Claude continue.
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  const { notes, sources } = notesWithSources(content);
  return notes ? { notes, sources, model } : null;
}

async function structure(anthropic: Anthropic, input: ResearchInput, notes: string, sources: ResearchSource[]): Promise<ResearchOutput | null> {
  const list = sources.map((s, i) => `S${i + 1}: ${s.title} — ${s.url}`).join("\n");
  const response = await anthropic.beta.messages.parse(
    {
      model: env.anthropicModel,
      max_tokens: 4000,
      output_config: { effort: "low", format: betaZodOutputFormat(ResearchOutputSchema) },
      system:
        "Turn market research notes into a land-use briefing for a farmer in Qatar. Use only facts in the notes; refer to sources by their number (S3 → 3). Score changes run from -10 to 10 and only where the notes give evidence. Plain words, figures in QAR and %.",
      messages: [
        {
          role: "user",
          content: `${describeSite(input)}\n\nResearch notes:\n${notes}\n\nSources:\n${list || "(none)"}`,
        },
      ],
    },
    { timeout: STRUCTURE_TIMEOUT_MS },
  );
  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
}

export interface ResearchResult {
  research: LandResearch;
  adjustments: Array<{ id: string; delta: number; note: string }>;
}

export async function researchLandUse(input: ResearchInput): Promise<ResearchResult | null> {
  const anthropic = getClient();
  if (!anthropic) return null;
  const failed = (message: string): ResearchResult => ({
    research: { status: "failed", model: null, searched_at: null, headline: message, highlights: [], advice: "", caveats: [], sources: [] },
    adjustments: [],
  });
  try {
    const found = await research(anthropic, input);
    if (!found) return failed("The live market search returned nothing usable, so the ranking uses the built-in rules only.");
    const out = await structure(anthropic, input, found.notes, found.sources);
    if (!out) return failed("The market research couldn't be summarised, so the ranking uses the built-in rules only.");
    const pick = (ids: number[]) => ids.map((i) => found.sources[i - 1]).filter((s): s is ResearchSource => Boolean(s));
    return {
      research: {
        status: "live",
        model: found.model,
        searched_at: new Date().toISOString(),
        headline: out.headline,
        highlights: out.highlights.slice(0, 6).map((h) => ({ title: h.title, detail: h.detail, signal: h.signal, sources: pick(h.source_ids) })),
        advice: out.advice,
        caveats: out.caveats.slice(0, 4),
        sources: found.sources.slice(0, 12),
      },
      adjustments: out.adjustments.map((a) => ({
        id: a.option_id,
        delta: a.delta,
        note: `${a.reason}${a.source_ids.length ? ` (${pick(a.source_ids).map((s) => s.title).join("; ")})` : ""}`,
      })),
    };
  } catch (error) {
    console.warn("[land] Research failed:", error instanceof Error ? error.message : error);
    return failed("The live market search didn't finish in time, so the ranking uses the built-in rules only.");
  }
}

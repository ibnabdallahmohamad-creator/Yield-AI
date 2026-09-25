/**
 * LLM fallback for the chat when AI_SERVICE_URL is not set (or not answering): Claude via the
 * official Anthropic SDK, grounded in the same ChatContext the AI service receives.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import type { ChatContext, ChatTurn } from "./contract";

/** The system prompt from the product brief, followed by formatting rules and the farm context. */
export const AGRONOMIST_SYSTEM_PROMPT =
  "You are an agronomist assistant for farms in Qatar. Be concise and practical. Reference the farm's actual readings.";

const FORMAT_RULES = [
  "Answer in at most about 150 words unless the user asks for more detail.",
  "Quote numbers with their units and say which probe or method they come from when it matters.",
  "Use short paragraphs, **bold** for the key figure, and a numbered list for actions.",
  "Use only the data in the farm context below. If something is not in it, say you don't have that reading.",
  "The derived values follow FAO-56 (evapotranspiration, water balance) and FAO-29 (salinity, leaching); ECe is estimated from probe bulk EC.",
  "`land` is the 10 km² land-atlas cell under the farm (soil, fertility, long-term climate, groundwater, crop suitability) — a modelled planning guide, so prefer the farm's own probe readings where they disagree.",
  "`weather` is real-time data and the 7-day forecast; use it for questions about the coming days (heat, wind, humidity, rain, irrigation timing).",
  "`knowledge` holds research passages retrieved for this question; cite a source briefly (author, year) when you use one.",
  "If `has_readings` is false the probes have not reported yet: say so, and answer from the land, weather and research context.",
].join("\n");

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!env.anthropicApiKey) return null;
  client ??= new Anthropic({ apiKey: env.anthropicApiKey, timeout: 30_000, maxRetries: 1 });
  return client;
}

export function llmAvailable(): boolean {
  return Boolean(env.anthropicApiKey);
}

export interface LlmAnswer {
  answer: string;
  model: string;
}

export async function askLlm(question: string, context: ChatContext, history: ChatTurn[] = []): Promise<LlmAnswer | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.slice(-8).map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: question },
  ];
  // The API requires the first message to be from the user.
  while (messages.length > 1 && messages[0].role !== "user") messages.shift();

  const response = await anthropic.beta.messages.create({
    model: env.anthropicModel,
    max_tokens: 4096,
    // Chat is latency-sensitive; low effort keeps answers quick while adaptive thinking stays on.
    output_config: { effort: "low" },
    // Server-side refusal fallback: a declined request is retried on Anthropic's recommended model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    cache_control: { type: "ephemeral" },
    system: [
      { type: "text", text: `${AGRONOMIST_SYSTEM_PROMPT}\n\n${FORMAT_RULES}` },
      { type: "text", text: `Farm context (JSON):\n${JSON.stringify(context)}` },
    ],
    messages,
  });

  if (response.stop_reason === "refusal") return null;
  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text ? { answer: text, model: response.model } : null;
}

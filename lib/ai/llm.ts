/**
 * LLM fallback for the chat when AI_SERVICE_URL is not set (or not answering): Claude via the
 * official Anthropic SDK, grounded in the same ChatContext the AI service receives.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import type { ChatContext, ChatTurn } from "./contract";
import { AGRONOMIST_SYSTEM_PROMPT, ANSWER_FORMAT } from "./prompts";

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
    ...history.slice(-12).map((turn) => ({ role: turn.role, content: turn.content })),
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
      { type: "text", text: `${AGRONOMIST_SYSTEM_PROMPT}\n\n${ANSWER_FORMAT}` },
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

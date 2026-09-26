/**
 * Client for the fine-tuned Harvestar AI model (AI_MODEL_URL). It sends exactly what the model was
 * trained on — SYSTEM_PROMPT and the "Q1: …" / "Q2: …" user turn from formatUserMessage — and reads
 * the reply with parseModelReply, which validates every section.
 *
 * Three server styles, picked by AI_MODEL_FORMAT or guessed from the URL:
 *   openai  POST …/v1/chat/completions {model, messages}   → choices[0].message.content
 *           (vLLM, llama.cpp server, LM Studio, TGI, Hugging Face endpoints, Together, …)
 *   ollama  POST …/api/chat {model, messages, stream:false} → message.content
 *   raw     POST <url> {system, prompt, messages, input}     → the answer object itself, or
 *           {output | answer | response | text | content | generated_text} (object or JSON string)
 */
import "server-only";
import { env } from "../env";
import { formatUserMessage, SYSTEM_PROMPT, type ModelInput, type ModelOutput } from "../dataset/schema";
import { parseModelReply } from "./model-output";

const TIMEOUT_MS = 55_000;
/** The longest training answer is ~3,000 tokens; leave room. */
const MAX_TOKENS = 4096;

export type ModelFormat = "openai" | "ollama" | "raw";

export function modelConfigured(): boolean {
  return Boolean(env.aiModelUrl);
}

export function modelFormat(url = env.aiModelUrl ?? "", explicit = env.aiModelFormat): ModelFormat {
  if (explicit === "openai" || explicit === "ollama" || explicit === "raw") return explicit;
  if (/\/chat\/completions\/?$/.test(url) || /\/v1\/?$/.test(url)) return "openai";
  if (/\/api\/(chat|generate)\/?$/.test(url)) return "ollama";
  return "raw";
}

export class ModelError extends Error {}

/** The request body for a server style (exported for tests). */
export function modelRequest(input: ModelInput, format: ModelFormat, model = env.aiModelName): Record<string, unknown> {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: formatUserMessage(input) },
  ];
  if (format === "openai") return { model, messages, temperature: 0.2, max_tokens: MAX_TOKENS, stream: false };
  if (format === "ollama") return { model, messages, stream: false, format: "json", options: { temperature: 0.2, num_predict: MAX_TOKENS, num_ctx: 12288 } };
  return { model, system: SYSTEM_PROMPT, prompt: messages[1].content, messages, input, max_tokens: MAX_TOKENS };
}

/** The model's text (or object) out of any of the accepted response shapes. */
export function replyText(payload: unknown): string | null {
  if (payload == null) return null;
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  // Already the answer object.
  if (typeof p.summary === "string" && "crop_plan" in p) return JSON.stringify(p);
  const choice = Array.isArray(p.choices) ? (p.choices[0] as Record<string, unknown> | undefined) : undefined;
  const fromChoice = choice ? ((choice.message as Record<string, unknown> | undefined)?.content ?? choice.text) : undefined;
  const fromMessage = p.message && typeof p.message === "object" ? (p.message as Record<string, unknown>).content : undefined;
  const list = Array.isArray(payload) ? (payload[0] as Record<string, unknown> | undefined)?.generated_text : undefined;
  for (const v of [fromChoice, fromMessage, p.output, p.answer, p.response, p.text, p.content, p.generated_text, list]) {
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object") return JSON.stringify(v);
  }
  return null;
}

export interface ModelAnswer {
  answer: ModelOutput;
  raw: string;
  model: string;
  ms: number;
}

export async function askModel(input: ModelInput): Promise<ModelAnswer> {
  const url = env.aiModelUrl;
  if (!url) throw new ModelError("AI_MODEL_URL is not set");
  const format = modelFormat(url);
  const endpoint = format === "openai" && /\/v1\/?$/.test(url) ? `${url.replace(/\/+$/, "")}/chat/completions` : url;
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (env.aiModelApiKey) headers.Authorization = `Bearer ${env.aiModelApiKey}`;

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(modelRequest(input, format)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ModelError(timedOut ? `The model didn't answer within ${TIMEOUT_MS / 1000} s` : `Couldn't reach the model (${error instanceof Error ? error.message : error})`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new ModelError(`The model returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const type = res.headers.get("content-type") ?? "";
  const payload: unknown = type.includes("json") ? await res.json() : await res.text();
  const text = replyText(payload);
  if (!text) throw new ModelError("The model's response had no answer text");
  const parsed = parseModelReply(text);
  if (!parsed.ok) throw new ModelError(`The model's answer didn't match the output format: ${parsed.error.slice(0, 300)}`);
  if (parsed.answer.task !== input.task) throw new ModelError(`The model answered task "${parsed.answer.task}" instead of "${input.task}"`);
  const model = (payload && typeof payload === "object" && typeof (payload as { model?: unknown }).model === "string" ? (payload as { model: string }).model : null) ?? env.aiModelName;
  return { answer: parsed.answer, raw: text, model, ms: Date.now() - started };
}

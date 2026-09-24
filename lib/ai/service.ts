/**
 * Client for the team's fine-tuned model service: POST ${AI_SERVICE_URL} with
 * { farm_id, question, context, history } and expect { answer } back (see contract.ts / README).
 */
import "server-only";
import { env } from "../env";
import { AiServiceChatResponseSchema, type AiServiceChatRequest, type AiServiceChatResponse } from "./contract";

const TIMEOUT_MS = 20_000;

export function aiServiceConfigured(): boolean {
  return Boolean(env.aiServiceUrl);
}

export async function askAiService(body: AiServiceChatRequest): Promise<AiServiceChatResponse> {
  if (!env.aiServiceUrl) throw new Error("AI_SERVICE_URL is not set");
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (env.aiServiceApiKey) headers.Authorization = `Bearer ${env.aiServiceApiKey}`;
  const res = await fetch(env.aiServiceUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`AI service HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json") ? await res.json() : { answer: await res.text() };
  const parsed = AiServiceChatResponseSchema.safeParse(payload);
  if (!parsed.success) throw new Error(`AI service returned an unexpected shape: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

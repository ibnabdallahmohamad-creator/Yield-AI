/**
 * The answer chain shared by the chat and the AI Insights analysis: the team's fine-tuned model
 * (AI_SERVICE_URL) → Claude (LLM fallback) → the offline agronomy engine, stopping at the first
 * that answers. The answer is plain text; lib/ai/sections.ts splits it for display.
 */
import "server-only";
import type { ChatAnswerSource, ChatContext, ChatTurn } from "./contract";
import { askLlm, llmAvailable } from "./llm";
import { aiServiceConfigured, askAiService } from "./service";

export interface ChainAnswer {
  answer: string;
  source: ChatAnswerSource;
  model: string | null;
}

export async function answerQuestion({
  farmId,
  question,
  context,
  history = [],
  offline,
}: {
  farmId: string;
  question: string;
  context: ChatContext;
  history?: ChatTurn[];
  /** The built-in engine's answer, used when neither model answers. */
  offline: () => string;
}): Promise<ChainAnswer> {
  if (aiServiceConfigured()) {
    try {
      const res = await askAiService({ farm_id: farmId, question, context, history });
      return { answer: res.answer, source: "ai-service", model: "yield-ai" };
    } catch (error) {
      console.warn("[ai] AI service failed, falling back:", error instanceof Error ? error.message : error);
    }
  }
  if (llmAvailable()) {
    try {
      const res = await askLlm(question, context, history);
      if (res) return { answer: res.answer, source: "llm", model: res.model };
    } catch (error) {
      console.warn("[ai] LLM fallback failed, using the offline engine:", error instanceof Error ? error.message : error);
    }
  }
  return { answer: offline(), source: "offline", model: "agronomy-rules" };
}

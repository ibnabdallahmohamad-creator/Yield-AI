import { NextResponse } from "next/server";
import { buildChatContext } from "@/lib/ai/context";
import { ChatRequestSchema, type ChatAnswerSource, type ChatResponse } from "@/lib/ai/contract";
import { askLlm, llmAvailable } from "@/lib/ai/llm";
import { answerOffline } from "@/lib/ai/offline";
import { groundContext } from "@/lib/ai/rag";
import { aiServiceConfigured, askAiService } from "@/lib/ai/service";
import { getCurrentUser } from "@/lib/auth/session";
import { getFarmBundle } from "@/lib/data/repository";
import { scopeFor } from "@/lib/farms/scope";

/**
 * POST /api/chat — { farm_id, question, date?, history? } → ChatResponse.
 * Answer chain: the team's AI service → Claude (LLM fallback) → offline agronomy engine.
 * Every answer is grounded in the farm's readings plus retrieved land-atlas, weather and research
 * context (lib/ai/rag.ts), so farms without probe data yet still get useful answers.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in to use the assistant." }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = ChatRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { farm_id, question, date, history } = parsed.data;

  const found = await getFarmBundle(scopeFor(user), farm_id);
  if (!found) return NextResponse.json({ error: "That farm doesn't exist." }, { status: 404 });
  const { data, bundle } = found;
  const dateIndex = date ? data.dates.indexOf(date) : -1;
  const context = await groundContext(
    buildChatContext(bundle, data, dateIndex >= 0 ? dateIndex : undefined),
    { lat: bundle.farm.lat, lng: bundle.farm.lng },
    question,
  );

  let answer: string | null = null;
  let source: ChatAnswerSource = "offline";
  let model: string | null = null;

  if (aiServiceConfigured()) {
    try {
      const res = await askAiService({ farm_id, question, context, history });
      answer = res.answer;
      source = "ai-service";
      model = "yield-ai";
    } catch (error) {
      console.warn("[chat] AI service failed, falling back:", error instanceof Error ? error.message : error);
    }
  }
  if (!answer && llmAvailable()) {
    try {
      const res = await askLlm(question, context, history);
      if (res) {
        answer = res.answer;
        source = "llm";
        model = res.model;
      }
    } catch (error) {
      console.warn("[chat] LLM fallback failed, using the offline engine:", error instanceof Error ? error.message : error);
    }
  }
  if (!answer) {
    answer = answerOffline(question, context);
    source = "offline";
    model = "agronomy-rules";
  }

  const body: ChatResponse = { farm_id, answer, source, model, created_at: new Date().toISOString() };
  return NextResponse.json(body);
}

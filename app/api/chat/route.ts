import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/ai/answer";
import { buildChatContext } from "@/lib/ai/context";
import { ChatRequestSchema, type ChatResponse } from "@/lib/ai/contract";
import { answerOffline } from "@/lib/ai/offline";
import { getCurrentUser } from "@/lib/auth/session";
import { getFarmBundle } from "@/lib/data/repository";
import { farmForecast } from "@/lib/weather/farm-forecast";

/**
 * POST /api/chat — { farm_id, question, date?, history? } → ChatResponse.
 * Answer chain: the team's AI service → Claude (LLM fallback) → offline agronomy engine.
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

  const found = await getFarmBundle(user, farm_id);
  if (!found) return NextResponse.json({ error: "That farm doesn't exist." }, { status: 404 });
  const { data, bundle } = found;
  const dateIndex = date ? data.dates.indexOf(date) : -1;
  const forecast = await farmForecast(data, farm_id);
  const context = buildChatContext(bundle, data, dateIndex >= 0 ? dateIndex : undefined, forecast);
  if (!context) {
    return NextResponse.json(
      { error: "There are no readings for this farm yet — the assistant answers once its ESP32 has reported." },
      { status: 409 },
    );
  }

  const { answer, source, model } = await answerQuestion({
    farmId: farm_id,
    question,
    context,
    history,
    offline: () => answerOffline(question, context),
  });
  const body: ChatResponse = { farm_id, answer, source, model, created_at: new Date().toISOString() };
  return NextResponse.json(body);
}

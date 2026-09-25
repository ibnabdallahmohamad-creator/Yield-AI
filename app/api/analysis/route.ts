import { NextResponse, type NextRequest } from "next/server";
import { answerQuestion } from "@/lib/ai/answer";
import { buildChatContext } from "@/lib/ai/context";
import { ANALYSIS_QUESTION, type AnalysisResponse } from "@/lib/ai/contract";
import { analyzeOffline } from "@/lib/ai/offline";
import { splitAnswer } from "@/lib/ai/sections";
import { getCurrentUser } from "@/lib/auth/session";
import { getFarmBundle } from "@/lib/data/repository";
import { farmForecast } from "@/lib/weather/farm-forecast";

const CACHE_TTL_MS = 30 * 60_000;

const cache = globalThis as unknown as { __yieldAnalysis?: Map<string, { at: number; value: AnalysisResponse }> };

/** GET /api/analysis?farm=…&refresh=1 — a full AI analysis of one farm, split into sections. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const farmId = request.nextUrl.searchParams.get("farm") ?? "";
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  const found = await getFarmBundle(user, farmId);
  if (!found) return NextResponse.json({ error: "That farm doesn't exist." }, { status: 404 });
  const { data, bundle } = found;
  const forecast = await farmForecast(data, farmId);
  const context = buildChatContext(bundle, data, undefined, forecast);
  if (!context) {
    return NextResponse.json(
      { error: "There are no readings for this farm yet — the analysis appears once its ESP32 has reported." },
      { status: 409 },
    );
  }

  const key = `${user.id}|${farmId}|${context.as_of}`;
  const store = (cache.__yieldAnalysis ??= new Map());
  const hit = store.get(key);
  if (!refresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json(hit.value);

  const { answer, source, model } = await answerQuestion({
    farmId,
    question: ANALYSIS_QUESTION,
    context,
    offline: () => analyzeOffline(context),
  });
  const value: AnalysisResponse = {
    farm_id: farmId,
    as_of: context.as_of,
    answer,
    sections: splitAnswer(answer),
    source,
    model,
    created_at: new Date().toISOString(),
  };
  store.set(key, { at: Date.now(), value });
  return NextResponse.json(value, { headers: { "Cache-Control": "private, no-store" } });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeFarm } from "@/lib/ai/live-analysis";
import { getCurrentUser } from "@/lib/auth/session";

/** The model may take up to ~55 s on a cold GPU. */
export const maxDuration = 60;

const PostSchema = z.object({
  farm_id: z.string().min(1).max(64),
  question: z.string().trim().max(500).optional(),
});

async function respond(farmId: string, question: string | undefined, fresh: boolean) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    const result = await analyzeFarm(user, farmId, question, fresh);
    if (!result) return NextResponse.json({ error: "That farm doesn't exist." }, { status: 404 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("[analysis] Could not analyse the farm:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "The analysis failed. Try again in a minute." }, { status: 503 });
  }
}

/**
 * GET /api/analysis?farm=<id>[&fresh=1] — the farm's AI analysis for the default question.
 * POST /api/analysis { farm_id, question? } — the analysis for a farmer's own question.
 * Both return FarmAnalysisResult (lib/ai/analysis-types.ts): the model input, the answer in the
 * model's output format, and whether the fine-tuned model or the built-in engine wrote it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const farm = url.searchParams.get("farm");
  if (!farm) return NextResponse.json({ error: "Add ?farm=<farm id>." }, { status: 400 });
  return respond(farm, undefined, url.searchParams.get("fresh") === "1");
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = PostSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  return respond(parsed.data.farm_id, parsed.data.question || undefined, true);
}

import { NextResponse } from "next/server";
import { aiServiceConfigured } from "@/lib/ai/service";
import { llmAvailable } from "@/lib/ai/llm";
import { env } from "@/lib/env";
import { getDashboardData } from "@/lib/data/repository";

/** GET /api/health — which integrations are live. Handy for teammates wiring up the AI service or probes. */
export async function GET() {
  const data = await getDashboardData();
  return NextResponse.json(
    {
      ok: true,
      data: { source: data.source, note: data.sourceNote, farms: data.farms.length, days: data.dates.length, latest: data.dates.at(-1) },
      weather: data.weather,
      auth: env.supabaseConfigured ? "supabase (+ local fallback)" : "local accounts",
      chat: aiServiceConfigured() ? "ai-service" : llmAvailable() ? "llm" : "offline",
      ingest: Boolean(env.ingestApiKey),
      live_simulation: env.liveSimulation,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

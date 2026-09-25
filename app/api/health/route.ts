import { NextResponse } from "next/server";
import { aiServiceConfigured } from "@/lib/ai/service";
import { llmAvailable } from "@/lib/ai/llm";
import { env } from "@/lib/env";
import { getDemoDashboard } from "@/lib/data/repository";

/** GET /api/health — which integrations are live. Handy for teammates wiring up the AI service or probes. */
export async function GET() {
  const demo = await getDemoDashboard();
  return NextResponse.json(
    {
      ok: true,
      accounts_data: env.localData ? "local (.data/)" : "supabase",
      auth: env.supabaseConfigured ? "supabase (+ local fallback)" : "local accounts",
      // ESP32s post with their own keys, into whichever store holds accounts' data.
      device_ingest: env.localData ? "local (.data/)" : "supabase",
      bulk_ingest: Boolean(env.ingestApiKey),
      demo: { farms: demo.farms.length, days: demo.dates.length, latest: demo.dates.at(-1) },
      weather: demo.weather,
      chat: aiServiceConfigured() ? "ai-service" : llmAvailable() ? "llm" : "offline",
      live_simulation: env.liveSimulation,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

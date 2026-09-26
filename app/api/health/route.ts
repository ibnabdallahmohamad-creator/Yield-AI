import { NextResponse } from "next/server";
import { aiServiceConfigured } from "@/lib/ai/service";
import { llmAvailable } from "@/lib/ai/llm";
import { modelConfigured, modelFormat } from "@/lib/ai/model-client";
import { env } from "@/lib/env";
import { getDemoDashboard } from "@/lib/data/repository";

/**
 * GET /api/health — which integrations are live. Handy for teammates wiring up the AI service or
 * probes. Public, so it only describes the shared demo dataset, never an account's farms.
 */
export async function GET() {
  const data = await getDemoDashboard();
  const forecastFarms = data.farms.filter((b) => b.next12h).length;
  return NextResponse.json(
    {
      ok: true,
      data: { source: data.source, note: data.sourceNote, farms: data.farms.length, days: data.dates.length, latest: data.dates.at(-1) },
      accounts: env.supabaseConfigured ? "supabase (+ local fallback)" : "local files (.data/)",
      weather: data.weather,
      forecast_12h: {
        farms: forecastFarms,
        refresh: "every 12 hours at 00:00 and 12:00 Asia/Qatar",
        fetched_at: data.farms.find((b) => b.next12h)?.next12h?.fetched_at ?? null,
      },
      auth: env.supabaseConfigured ? "supabase (+ local fallback)" : "local accounts",
      supabase_server_key: Boolean(env.supabaseServiceRoleKey),
      model: modelConfigured() ? { configured: true, format: modelFormat(), name: env.aiModelName } : { configured: false, fallback: "built-in engine (same output format)" },
      chat: modelConfigured() ? "harvestar-model" : aiServiceConfigured() ? "ai-service" : llmAvailable() ? "llm" : "offline",
      ingest: { devices: true, shared_key: Boolean(env.ingestApiKey) },
      live_simulation: env.liveSimulation,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

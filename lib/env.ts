/**
 * Server-side configuration. Every integration is optional: without Supabase the app keeps
 * accounts and their farms in the local `.data/` store; without AI_SERVICE_URL or an LLM key the
 * chat answers from the offline agronomy engine. See README → "Environment variables".
 */
import "server-only";
import path from "node:path";

const read = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

const supabaseUrl = read("SUPABASE_URL") ?? read("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey =
  read("SUPABASE_ANON_KEY") ?? read("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  supabaseServiceRoleKey: read("SUPABASE_SERVICE_ROLE_KEY"),
  /**
   * True when account data (farms, devices, readings) lives in the local `.data/` store instead
   * of Supabase: Supabase is not configured, or USE_MOCK=true keeps data out of it.
   */
  localData: read("USE_MOCK") === "true" || !supabaseUrl || !supabaseAnonKey,
  /** Supabase is configured (auth can use it even when USE_MOCK keeps data local). */
  supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  /** Folder of the local store and local accounts (runtime data: kept out of build tracing). */
  localDataDir: path.resolve(/*turbopackIgnore: true*/ process.cwd(), read("LOCAL_DATA_DIR") ?? ".data"),
  aiServiceUrl: read("AI_SERVICE_URL"),
  aiServiceApiKey: read("AI_SERVICE_API_KEY"),
  anthropicApiKey: read("ANTHROPIC_API_KEY"),
  anthropicModel: read("ANTHROPIC_MODEL") ?? "claude-opus-5",
  ingestApiKey: read("INGEST_API_KEY"),
  /** Protects GET /api/cron/weather (sent as `Authorization: Bearer …`). */
  cronSecret: read("CRON_SECRET"),
  /** Demo account live feed: "auto"/"on" simulate probe readings, "off" keeps it quiet. */
  liveSimulation: (read("LIVE_SIMULATION") ?? "auto") as "auto" | "on" | "off",
};

export const DEMO_ACCOUNT = {
  email: read("DEMO_EMAIL") ?? "demo@yield-ai.app",
  password: read("DEMO_PASSWORD") ?? "harvest-demo-2026",
  name: "Demo Agronomist",
};

/** The shared demo account sees the built-in demo farms; every other account sees only its own. */
export function isDemoEmail(email: string): boolean {
  return email.trim().toLowerCase() === DEMO_ACCOUNT.email.trim().toLowerCase();
}

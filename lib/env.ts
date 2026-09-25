/**
 * Server-side configuration. Every integration is optional: without Supabase the app runs on
 * the built-in demo dataset and local accounts; without AI_SERVICE_URL or an LLM key the chat
 * answers from the offline agronomy engine. See README → "Environment variables".
 */
import "server-only";

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
  /** True when the app should use the local demo dataset instead of Supabase. */
  useMock: read("USE_MOCK") === "true" || !supabaseUrl || !supabaseAnonKey,
  /** Supabase is configured (auth can use it even when USE_MOCK forces demo data). */
  supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  aiServiceUrl: read("AI_SERVICE_URL"),
  aiServiceApiKey: read("AI_SERVICE_API_KEY"),
  anthropicApiKey: read("ANTHROPIC_API_KEY"),
  anthropicModel: read("ANTHROPIC_MODEL") ?? "claude-opus-5",
  ingestApiKey: read("INGEST_API_KEY"),
  /** WeatherAPI.com key for real-time conditions and forecasts (Open-Meteo fills in without it). */
  weatherApiKey: read("WEATHERAPI_KEY") ?? read("WEATHER_API_KEY"),
  /** Live mode feed: "auto" simulates probe readings when no real ones are arriving. */
  liveSimulation: (read("LIVE_SIMULATION") ?? "auto") as "auto" | "on" | "off",
};

export const DEMO_ACCOUNT = {
  email: read("DEMO_EMAIL") ?? "demo@yield-ai.app",
  password: read("DEMO_PASSWORD") ?? "harvest-demo-2026",
  name: "Demo Agronomist",
};

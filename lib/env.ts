/**
 * Server-side configuration. Every integration is optional: without Supabase the app runs on
 * the built-in demo dataset and local accounts; without AI_MODEL_URL, AI_SERVICE_URL or an LLM key
 * the answers come from the built-in agronomy engine. See README → "Environment variables".
 */
import "server-only";

const read = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

const supabaseUrl = read("SUPABASE_URL") ?? read("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey =
  read("SUPABASE_ANON_KEY") ??
  read("NEXT_PUBLIC_SUPABASE_ANON_KEY") ??
  read("SUPABASE_PUBLISHABLE_KEY") ??
  read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  /** The service-role key, or the new-style secret key the Vercel ↔ Supabase integration sets. */
  supabaseServiceRoleKey: read("SUPABASE_SERVICE_ROLE_KEY") ?? read("SUPABASE_SECRET_KEY"),
  /** True when the app should use the local demo dataset instead of Supabase. */
  useMock: read("USE_MOCK") === "true" || !supabaseUrl || !supabaseAnonKey,
  /** Supabase is configured (auth can use it even when USE_MOCK forces demo data). */
  supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  /** The fine-tuned Harvestar AI model (Q1/Q2 JSON in, JSON out; lib/ai/model-client.ts). */
  aiModelUrl: read("AI_MODEL_URL"),
  aiModelApiKey: read("AI_MODEL_API_KEY"),
  aiModelName: read("AI_MODEL_NAME") ?? "harvestar-ai",
  /** "openai" (…/chat/completions), "ollama" (…/api/chat) or "raw"; guessed from the URL when unset. */
  aiModelFormat: read("AI_MODEL_FORMAT") as "openai" | "ollama" | "raw" | undefined,
  aiServiceUrl: read("AI_SERVICE_URL"),
  aiServiceApiKey: read("AI_SERVICE_API_KEY"),
  anthropicApiKey: read("ANTHROPIC_API_KEY"),
  anthropicModel: read("ANTHROPIC_MODEL") ?? "claude-opus-5",
  ingestApiKey: read("INGEST_API_KEY"),
  /** Live mode feed: "auto" simulates probe readings when no real ones are arriving. */
  liveSimulation: (read("LIVE_SIMULATION") ?? "auto") as "auto" | "on" | "off",
};

export const DEMO_ACCOUNT = {
  email: read("DEMO_EMAIL") ?? "demo@harvestar.ai",
  password: read("DEMO_PASSWORD") ?? "harvest-demo-2026",
  name: "Demo Agronomist",
};

/**
 * The ready-made test account: sign in with the username "Tester" and the password "Tester". It is a
 * real account (its own farms and ESP32 devices, stored in Supabase when configured), provisioned on
 * first sign-in with three farms whose test probes keep reporting (lib/account/tester.ts).
 */
export const TESTER_ACCOUNT = {
  username: "Tester",
  email: read("TESTER_EMAIL") ?? "tester@harvestar.ai",
  password: read("TESTER_PASSWORD") ?? "Tester",
  name: "Tester",
};

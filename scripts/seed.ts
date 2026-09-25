/**
 * Seed Supabase with the demo dataset: 8 farms in northern Qatar, 60 days of 3-hourly probe
 * readings (the same deterministic data mock mode shows), one AI insight per farm, and the
 * demo account.
 *
 *   1. Apply supabase/migrations/0001_init.sql (Supabase CLI or SQL editor)
 *   2. Put SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *   3. npm run seed
 *
 * Re-running replaces the demo farms' readings and insights, so the 60-day window always ends today.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { aggregateDaily } from "../lib/data/aggregate";
import { buildDashboardData } from "../lib/data/derive";
import { generateDemoDataset, HISTORY_DAYS } from "../lib/data/generate";
import { generateInsights } from "../lib/data/insights";
import { dateRangeEnding } from "../lib/data/time";
import { getWeatherForFarms } from "../lib/data/weather";

config({ path: ".env.local" });
config();

const CHUNK = 1000;

function required(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || (fallback ? process.env[fallback]?.trim() : undefined);
  if (!value) {
    console.error(`✖ Missing ${name}. Add it to .env.local (see .env.example).`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const url = required("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const probe = await supabase.from("farms").select("id").limit(1);
  if (probe.error) {
    console.error(`✖ Cannot read the farms table: ${probe.error.message}`);
    console.error("  Apply supabase/migrations/0001_init.sql first (npx supabase db push, or paste it into the SQL editor).");
    process.exit(1);
  }

  console.log("• Generating the demo dataset…");
  const now = new Date();
  const ds = generateDemoDataset(now);
  const weather = await getWeatherForFarms(ds.farms);
  const data = buildDashboardData({
    farms: ds.farms,
    daily: aggregateDaily(ds.readings),
    weather,
    insights: [],
    source: "supabase",
    sourceNote: null,
    dates: dateRangeEnding(ds.today, HISTORY_DAYS),
    sensorsByFarm: ds.sensorsByFarm,
  });
  const createdAt = new Date(now);
  createdAt.setUTCMinutes(0, 0, 0);
  const insights = generateInsights(data, createdAt.toISOString());
  console.log(`  ${ds.farms.length} farms, ${ds.readings.length} readings, ${insights.length} insights (weather: ${weather.source})`);

  const ids = ds.farms.map((f) => f.id);

  console.log("• Upserting farms…");
  const { error: farmError } = await supabase.from("farms").upsert(ds.farms, { onConflict: "id" });
  if (farmError) throw new Error(`farms: ${farmError.message}`);

  console.log("• Replacing readings and insights…");
  for (const table of ["ai_insights", "sensor_readings"] as const) {
    const { error } = await supabase.from(table).delete().in("farm_id", ids);
    if (error) throw new Error(`${table} delete: ${error.message}`);
  }

  for (let i = 0; i < ds.readings.length; i += CHUNK) {
    const chunk = ds.readings.slice(i, i + CHUNK);
    const { error } = await supabase.from("sensor_readings").insert(chunk);
    if (error) throw new Error(`sensor_readings insert: ${error.message}`);
    process.stdout.write(`\r  readings ${Math.min(i + CHUNK, ds.readings.length)}/${ds.readings.length}`);
  }
  process.stdout.write("\n");

  const baseRows = insights.map((insight) => ({
    farm_id: insight.farm_id,
    created_at: insight.created_at,
    risk_score: insight.risk_score,
    risk_level: insight.risk_level,
    summary: insight.summary,
    recommendations: insight.recommendations,
    crop_suggestion: insight.crop_suggestion,
  }));
  const fullRows = insights.map((insight, i) => ({
    ...baseRows[i],
    insights: insight.insights,
    warnings: insight.warnings,
    forecast: insight.forecast,
    economics: insight.economics,
    harvest: insight.harvest,
  }));
  let { error: insightError } = await supabase.from("ai_insights").insert(fullRows);
  if (insightError && /column|schema cache/i.test(insightError.message)) {
    // Migration 0003 not applied yet: store the core insight; the report sections are recomputed on read.
    console.warn(`  ! ${insightError.message}
  ! Apply supabase/migrations/0003_insight_sections.sql to store the report sections.`);
    ({ error: insightError } = await supabase.from("ai_insights").insert(baseRows));
  }
  if (insightError) throw new Error(`ai_insights insert: ${insightError.message}`);

  console.log("• Ensuring the demo account exists…");
  const demoEmail = process.env.DEMO_EMAIL?.trim() || "demo@yield-ai.app";
  const demoPassword = process.env.DEMO_PASSWORD?.trim() || "harvest-demo-2026";
  const { error: userError } = await supabase.auth.admin.createUser({
    email: demoEmail,
    password: demoPassword,
    email_confirm: true,
    user_metadata: { name: "Demo Agronomist" },
  });
  if (userError && userError.code !== "email_exists" && userError.status !== 422) {
    console.warn(`  ⚠ Could not create the demo user: ${userError.message}`);
  } else if (userError) {
    // Already there — make sure the password matches the one the login page uses.
    for (let page = 1; page <= 20; page++) {
      const { data: list, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error || !list?.users.length) break;
      const existing = list.users.find((u) => u.email?.toLowerCase() === demoEmail.toLowerCase());
      if (existing) {
        await supabase.auth.admin.updateUserById(existing.id, { password: demoPassword, email_confirm: true });
        break;
      }
    }
  }

  console.log(`✔ Seeded ${ds.farms.length} farms · ${ds.readings.length} readings · ${insights.length} insights.`);
  console.log(`  Demo login: ${demoEmail} / ${demoPassword}`);
}

main().catch((error) => {
  console.error(`✖ Seed failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

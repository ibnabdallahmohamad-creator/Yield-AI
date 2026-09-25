/**
 * Prints the full rule-based report (Insights, Warnings, Forecast, Economics, Harvest) and the
 * location section for a few farms (no API keys needed; weather from Open-Meteo when reachable).
 *
 *   npx tsx scripts/report-preview.ts [farm-id ...]
 */
import { buildChatContext } from "../lib/ai/context";
import { aggregateDaily } from "../lib/data/aggregate";
import { buildDashboardData } from "../lib/data/derive";
import { generateDemoDataset } from "../lib/data/generate";
import { generateInsights } from "../lib/data/insights";
import { getWeatherForFarms } from "../lib/data/weather";

async function main() {
  const ds = generateDemoDataset();
  const weather = await getWeatherForFarms(ds.farms);
  const data = buildDashboardData({
    farms: ds.farms,
    daily: aggregateDaily(ds.readings),
    weather,
    insights: [],
    source: "mock",
    sourceNote: null,
    sensorsByFarm: ds.sensorsByFarm,
  });
  const insights = generateInsights(data);
  for (const b of data.farms) b.insight = insights.find((i) => i.farm_id === b.farm.id) ?? null;
  const ids = process.argv.slice(2);
  for (const bundle of data.farms.filter((b) => ids.length === 0 || ids.includes(b.farm.id))) {
    const ctx = buildChatContext(bundle, data)!;
    const { insights: findings, warnings, forecast, economics, harvest, summary, risk_score } = bundle.insight!;
    console.log(`\n=== ${bundle.farm.name} (${ctx.farm.crop}, ${ctx.as_of}) — risk ${risk_score} ===`);
    console.log("Location:", ctx.location.place, `· ${ctx.location.municipality} · ${ctx.location.distance_to_coast_km} km to coast · ${ctx.location.groundwater_basin} basin`);
    console.log("Summary:", summary);
    console.log("\nInsights:");
    for (const f of findings) console.log(`  - ${f.title}: ${f.detail}`);
    console.log("\nWarnings:");
    for (const w of warnings) console.log(`  [${w.severity}] ${w.title} (${w.when}): ${w.detail}`);
    console.log("\nForecast:", forecast?.summary);
    for (const d of forecast?.days ?? []) console.log(`  ${d.date} ${d.level.padEnd(7)} ${d.label}`);
    console.log("\nEconomics:", economics?.summary);
    for (const l of economics?.lines ?? []) console.log(`  ${l.label}: ${l.value} — ${l.detail}`);
    console.log("\nHarvest:", harvest?.summary);
    for (const c of harvest?.next_crops ?? []) console.log(`  next: ${c.crop} (${c.plant_window}) — ${c.reason}`);
    console.log(`\nContext size: ${JSON.stringify(ctx).length.toLocaleString()} chars`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

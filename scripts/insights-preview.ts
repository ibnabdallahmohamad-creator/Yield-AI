/**
 * Prints the rule-based seed insights for every farm (what mock mode and `npm run seed` store).
 *
 *   npx tsx scripts/insights-preview.ts
 */
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
  for (const insight of generateInsights(data).sort((a, b) => b.risk_score - a.risk_score)) {
    const farm = data.farms.find((b) => b.farm.id === insight.farm_id)!.farm;
    console.log(`\n■ ${farm.name} — risk ${insight.risk_score} (${insight.risk_level})`);
    console.log(`  ${insight.summary}`);
    for (const r of insight.recommendations) console.log(`  [${r.priority}] ${r.title}\n         ${r.detail}`);
    if (insight.crop_suggestion) {
      console.log(`  → ${insight.crop_suggestion.crop}: ${insight.crop_suggestion.reason}\n    market: ${insight.crop_suggestion.market_note}`);
    }
  }
}

main();

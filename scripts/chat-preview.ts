/**
 * Prints offline chat answers for a few farms and questions (no API keys needed).
 *
 *   npx tsx scripts/chat-preview.ts
 */
import { buildChatContext } from "../lib/ai/context";
import { answerOffline } from "../lib/ai/offline";
import { aggregateDaily } from "../lib/data/aggregate";
import { buildDashboardData } from "../lib/data/derive";
import { generateDemoDataset } from "../lib/data/generate";
import { generateInsights } from "../lib/data/insights";
import { getWeatherForFarms } from "../lib/data/weather";

const QUESTIONS = [
  "Why is salinity rising?",
  "When should I irrigate next, and how much?",
  "What should I plant next season?",
  "Where are the problem spots?",
  "What's the pH situation?",
  "Explain today's ET0",
  "How is the farm doing?",
  "What does the next week look like?",
  "When can I spray?",
  "Is there a fungal disease risk?",
  "How much will this crop earn?",
  "When is the harvest?",
  "Where is the farm?",
  "Is it too hot for the crop?",
];

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
  for (const id of process.argv.slice(2).length ? process.argv.slice(2) : ["khor-north", "sheehaniya-west"]) {
    const bundle = data.farms.find((b) => b.farm.id === id)!;
    const ctx = buildChatContext(bundle, data)!;
    console.log(`\n=================== ${bundle.farm.name} ===================`);
    for (const q of QUESTIONS) console.log(`\n> ${q}\n${answerOffline(q, ctx)}`);
  }
}

main();

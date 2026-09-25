/**
 * Prints a per-farm summary of the demo dataset (first vs last day) — handy for checking
 * the scenarios and the FAO-56 numbers without opening the UI.
 *
 *   npx tsx scripts/data-summary.ts
 */
import { aggregateDaily } from "../lib/data/aggregate";
import { buildDashboardData } from "../lib/data/derive";
import { generateDemoDataset } from "../lib/data/generate";
import { getWeatherForFarms } from "../lib/data/weather";

async function main() {
  const t0 = performance.now();
  const ds = generateDemoDataset();
  const t1 = performance.now();
  const daily = aggregateDaily(ds.readings);
  const weather = await getWeatherForFarms(ds.farms);
  const data = buildDashboardData({
    farms: ds.farms,
    daily,
    weather,
    insights: [],
    source: "demo",
    sourceNote: null,
    sensorsByFarm: ds.sensorsByFarm,
  });
  const t2 = performance.now();
  console.log(
    `readings=${ds.readings.length} daily=${daily.length} dates=${data.dates[0]}..${data.dates.at(-1)} (${data.dates.length}) weather=${weather.source}`,
  );
  console.log(`generate ${(t1 - t0).toFixed(0)} ms, derive ${(t2 - t1).toFixed(0)} ms, json ${(JSON.stringify(data).length / 1024).toFixed(0)} KB`);
  for (const b of data.farms) {
    const first = b.days.find(Boolean)!;
    const lastFull = b.days[b.days.length - 2]!;
    const today = b.days[b.days.length - 1];
    console.log(`\n${b.farm.name} (${b.farm.main_crop}, ${b.farm.area_ha} ha, ${b.sensors.length} probes) Kc adj ${JSON.stringify(b.kcAdjusted)}`);
    for (const [label, d] of [
      ["first", first],
      ["yday ", lastFull],
      ["today", today],
    ] as const) {
      if (!d) continue;
      console.log(
        `  ${label} ${d.date} ECe ${d.ece} (${d.salinityClass}) loss ${d.yieldLoss}% | θ ${d.moisture}% Dr ${d.dr}/${d.raw} mm (${d.deficitPct}% RAW) Ks ${d.ks} days ${d.daysToIrrigation} | ET0 ${d.et0} ${d.et0Method} (OM ${d.et0OpenMeteo}) air ${d.airSource} ${d.airTmin}-${d.airTmax}°C RH ${d.rhMin}-${d.rhMax} | Kc ${d.kc} ${d.stage} DAP ${d.dap} ETc ${d.etc} | LR ${d.lr} gross ${d.grossDepth} | pH ${d.ph} T ${d.temperature} NPK ${d.n}/${d.p}/${d.k}`,
      );
    }
  }
}

main();

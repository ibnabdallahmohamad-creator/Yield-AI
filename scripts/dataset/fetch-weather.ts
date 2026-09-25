/**
 * Caches real daily weather for the dataset sites from the Open-Meteo historical archive (ERA5, free,
 * no key) into data/dataset/cache/weather/. Sites are spread over the land cells of the site grid plus
 * the demo farms. Already-cached sites are skipped, so it can be re-run after an interruption.
 *
 *   npx tsx scripts/dataset/fetch-weather.ts [sites=30] [start=2023-01-01]
 *
 * Open-Meteo weights a request by days × variables (about 100 "calls" per site here) and allows about
 * 600 a minute, so requests are spaced 12 s apart.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, qatarDateString } from "../../lib/data/time";
import { FARM_SEEDS } from "../../lib/data/seed-farms";
import { datasetSites } from "../../lib/dataset/site";
import { archiveUrl, parseOpenMeteo } from "../../lib/dataset/weather";

const CACHE = join(process.cwd(), "data", "dataset", "cache", "weather");
/** ERA5 reaches the archive about five days late. */
const ARCHIVE_LAG_DAYS = 6;
const GAP_MS = 12_000;

export const weatherCachePath = (lat: number, lng: number) => join(CACHE, `${lat.toFixed(2)}_${lng.toFixed(2)}.json`);

async function fetchWithRetry(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (res.ok) return res.json();
    const body = await res.text();
    console.warn(`  HTTP ${res.status}: ${body.slice(0, 160)}`);
    await new Promise((r) => setTimeout(r, (res.status === 429 ? 65_000 : 5_000) * (attempt + 1)));
  }
  throw new Error(`gave up on ${url}`);
}

async function main() {
  const count = Number(process.argv[2] ?? 30);
  const start = process.argv[3] ?? "2023-01-01";
  const end = addDays(qatarDateString(new Date()), -ARCHIVE_LAG_DAYS);
  mkdirSync(CACHE, { recursive: true });
  const farms = FARM_SEEDS.map((f) => ({
    lat: f.ring.reduce((a, p) => a + p[1], 0) / f.ring.length,
    lng: f.ring.reduce((a, p) => a + p[0], 0) / f.ring.length,
  }));
  const sites = datasetSites(count, farms);
  console.log(`${sites.length} sites, ${start} → ${end}`);
  let fetched = 0;
  for (const [i, site] of sites.entries()) {
    const path = weatherCachePath(site.lat, site.lng);
    if (existsSync(path)) continue;
    if (fetched > 0) await new Promise((r) => setTimeout(r, GAP_MS));
    const json = (await fetchWithRetry(archiveUrl(site.lat, site.lng, start, end))) as Parameters<typeof parseOpenMeteo>[0];
    const series = parseOpenMeteo(json, "open-meteo-archive (ERA5)");
    writeFileSync(path, JSON.stringify({ ...series, cell: { lat: site.lat, lng: site.lng } }));
    fetched++;
    console.log(`  ${i + 1}/${sites.length} ${site.lat},${site.lng}: ${series.days.length} days`);
  }
  console.log(`done (${fetched} fetched)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

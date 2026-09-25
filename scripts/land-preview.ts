/**
 * Prints the land-use ranking for a point in Qatar (rules only, no API keys needed).
 *
 *   npx tsx scripts/land-preview.ts 25.747 51.373 groundwater 2.6 10 medium
 */
import { describeLocation } from "../lib/qatar/location";
import { getSiteClimate } from "../lib/land/climate";
import { assessWater, rankOptions } from "../lib/land/score";
import type { Level, WaterSource } from "../lib/land/options";

async function main() {
  const [lat = "25.747", lng = "51.373", source = "groundwater", ec = "", area = "10", budget = "medium"] = process.argv.slice(2);
  const location = describeLocation([Number(lng), Number(lat)]);
  const today = new Date().toISOString().slice(0, 10);
  const climate = await getSiteClimate(Number(lat), Number(lng), today);
  const water = assessWater(source as WaterSource, ec ? Number(ec) : null, location, null);
  console.log(`${location.place} · ${location.municipality} · ${location.distance_to_coast_km} km to coast · ${location.groundwater_basin}`);
  console.log(`Climate (${climate.source}${climate.period ? ` ${climate.period.start}→${climate.period.end}` : ""}): ET0 ${climate.et0_annual_mm} mm/yr, summer Tmax ${climate.summer_tmax_mean_c} °C, hottest ${climate.hottest_c}, >45 °C ${climate.days_above_45c} d, winter Tmin ${climate.winter_tmin_mean_c}, summer RH ${climate.summer_humidity_mean_pct}%, wind ${climate.wind_mean_m_s} m/s, dust days ${climate.dust_wind_days}, rain ${climate.rain_annual_mm} mm, elevation ${climate.elevation_m} m`);
  console.log(`Water: ${water.source} ECw ${water.ec_dS_m} (${water.ec_origin}) → ECe ≈ ${water.ece_expected_dS_m}; ${water.class}`);
  for (const o of rankOptions({ location, climate, water, area_ha: Number(area), budget: budget as Level })) {
    console.log(`\n${String(o.score).padStart(3)} ${o.fit.padEnd(8)} ${o.name}${o.water_m3_ha_yr ? ` · ${o.water_m3_ha_yr} m³/ha/yr` : ""}`);
    for (const [k, f] of Object.entries(o.factors)) console.log(`      ${k.padEnd(6)} ${f.score.toFixed(2)} ${f.label}`);
    if (o.blocked) console.log(`      BLOCKED: ${o.blocked}`);
  }
}

main();

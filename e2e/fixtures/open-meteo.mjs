/**
 * Test double for the Open-Meteo forecast API (e2e only): answers /v1/forecast for any list of
 * locations with smooth, deterministic hourly weather in Open-Meteo's multi-location format, so
 * the weather tabs can be tested without network access. Run: node e2e/fixtures/open-meteo.mjs [port]
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? process.env.PORT ?? 3999);
const HOURS = 48;

function location(lat, lng, day0) {
  const time = [];
  const v = {
    temperature_2m: [],
    apparent_temperature: [],
    dew_point_2m: [],
    relative_humidity_2m: [],
    precipitation: [],
    precipitation_probability: [],
    wind_speed_10m: [],
    wind_direction_10m: [],
    wind_gusts_10m: [],
    cloud_cover: [],
    shortwave_radiation: [],
    et0_fao_evapotranspiration: [],
    vapour_pressure_deficit: [],
    weather_code: [],
    uv_index: [],
  };
  const north = (lat - 25) * 4;
  const east = (lng - 51) * 4;
  for (let h = 0; h < HOURS; h++) {
    const t = day0 + h * 3600;
    time.push(t);
    const local = (h + 3) % 24; // Qatar time
    const sun = Math.max(0, Math.sin(((local - 6) / 12) * Math.PI));
    const temp = 29 + 9 * Math.sin(((local - 9) / 24) * 2 * Math.PI) - north + east * 0.5;
    const rh = Math.min(98, Math.max(12, 60 - 30 * Math.sin(((local - 9) / 24) * 2 * Math.PI) + north * 3));
    const rain = local >= 16 && local <= 18 && lat > 25.6 ? 0.4 + (local - 16) * 0.6 : 0;
    const wind = 2.5 + 4 * sun + north * 0.5;
    v.temperature_2m.push(+temp.toFixed(1));
    v.apparent_temperature.push(+(temp + 1.5).toFixed(1));
    v.dew_point_2m.push(+(temp - (100 - rh) / 5).toFixed(1));
    v.relative_humidity_2m.push(Math.round(rh));
    v.precipitation.push(+rain.toFixed(1));
    v.precipitation_probability.push(rain > 0 ? 70 : local >= 14 && local <= 20 ? 25 : 5);
    v.wind_speed_10m.push(+wind.toFixed(1));
    v.wind_direction_10m.push(Math.round((330 + 25 * Math.sin(h / 5) + east * 10 + 360) % 360));
    v.wind_gusts_10m.push(+(wind * 1.7).toFixed(1));
    v.cloud_cover.push(rain > 0 ? 85 : Math.round(15 + 20 * Math.sin(h / 7) ** 2));
    v.shortwave_radiation.push(Math.round(850 * sun));
    v.et0_fao_evapotranspiration.push(+(0.75 * sun).toFixed(2));
    v.vapour_pressure_deficit.push(+Math.max(0.1, (1 - rh / 100) * 5.5).toFixed(2));
    v.weather_code.push(rain > 0 ? 61 : sun > 0 ? 1 : 0);
    v.uv_index.push(+(10 * sun).toFixed(1));
  }
  return { latitude: lat, longitude: lng, elevation: 10, hourly: { time, ...v } };
}

/** Daily values for `past` days before today and today (FAO-56 inputs for the soil dashboard). */
function daily(lat, past) {
  const days = [];
  const now = new Date();
  for (let d = -past; d <= 0; d++) {
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d));
    days.push(t.toISOString().slice(0, 10));
  }
  const n = days.length;
  const k = (i) => i / Math.max(1, n - 1);
  return {
    time: days,
    temperature_2m_max: days.map((_, i) => +(43 - 4 * k(i) - (lat - 25)).toFixed(1)),
    temperature_2m_min: days.map((_, i) => +(30 - 2 * k(i)).toFixed(1)),
    relative_humidity_2m_max: days.map((_, i) => Math.round(70 + 12 * k(i))),
    relative_humidity_2m_min: days.map((_, i) => Math.round(20 + 8 * k(i))),
    wind_speed_10m_mean: days.map((_, i) => +(3.5 + Math.sin(i / 3)).toFixed(2)),
    shortwave_radiation_sum: days.map((_, i) => +(26 - 4 * k(i)).toFixed(1)),
    et0_fao_evapotranspiration: days.map((_, i) => +(7 - 1.5 * k(i)).toFixed(2)),
  };
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname !== "/v1/forecast") {
    res.writeHead(404).end();
    return;
  }
  const lats = (url.searchParams.get("latitude") ?? "").split(",").map(Number);
  const lngs = (url.searchParams.get("longitude") ?? "").split(",").map(Number);
  const now = new Date();
  const day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const past = Number(url.searchParams.get("past_days") ?? 0);
  const wantsDaily = url.searchParams.has("daily");
  const body = lats.map((lat, i) => (wantsDaily ? { latitude: lat, longitude: lngs[i], daily: daily(lat, past) } : location(lat, lngs[i], day0)));
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body.length === 1 ? body[0] : body));
}).listen(port, () => console.log(`Open-Meteo test double on http://localhost:${port}`));

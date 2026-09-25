/**
 * Deterministic synthetic dataset: 8 farms × 4–6 probes × 60 days of 3-hourly readings.
 *
 * Used for the demo account and the landing page (never stored with accounts' data).
 * Values are shaped by each farm's scenario (see `seed-farms.ts`) and by physical structure:
 * diurnal cycles, daily drip irrigation, weekly fertigation, a late-summer cooling trend,
 * and spatial hotspots so the IDW maps show real patterns.
 */
import { CROPS, SOILS } from "../agronomy-tables";
import {
  distanceToBoundary_m,
  localProjector,
  pointInPolygon,
  polygonArea_ha,
  polygonBounds,
  polygonCentroid,
  type GeoPolygon,
} from "../geo";
import type { Farm, Sensor, SensorReading } from "../types";
import { ar1Series, gaussian, rngFor, round } from "./random";
import { FARM_SEEDS, seedPolygon, type FarmSeed } from "./seed-farms";
import { addDays, dateRangeEnding, qatarDateString, qatarLocalToUtc } from "./time";

export const HISTORY_DAYS = 60;
/** Local hours at which the historic probes report (every 3 h). */
export const READING_HOURS_LOCAL = [0, 3, 6, 9, 12, 15, 18, 21];
/** Mean-zero moisture pattern around the daily mean: drip irrigation at ~05:30, drying through the day. */
const IRRIGATION_PATTERN = [-0.35, -0.55, 0.9, 0.6, 0.2, -0.15, -0.3, -0.35];

export interface GeneratedDataset {
  today: string;
  farms: Farm[];
  sensorsByFarm: Record<string, Sensor[]>;
  readings: SensorReading[];
}

/** Air temperature diurnal shape: 0 at 05:30 (Tmin), 1 at 14:30 (Tmax). */
export function diurnalShape(hour: number): number {
  if (hour >= 5.5 && hour <= 14.5) return 0.5 - 0.5 * Math.cos((Math.PI * (hour - 5.5)) / 9);
  const sinceMax = hour > 14.5 ? hour - 14.5 : hour + 24 - 14.5;
  return 0.5 + 0.5 * Math.cos((Math.PI * sinceMax) / 15);
}

export function buildFarmRow(seed: FarmSeed, today: string): Farm {
  const polygon = seedPolygon(seed);
  const [lng, lat] = polygonCentroid(polygon);
  return {
    id: seed.id,
    name: seed.name,
    owner: seed.owner,
    lat: round(lat, 6),
    lng: round(lng, 6),
    area_ha: round(polygonArea_ha(polygon), 1),
    main_crop: seed.main_crop,
    polygon,
    region: seed.region,
    planting_date: addDays(today, -seed.plantedDaysAgo),
    soil_type: seed.soil_type,
    theta_fc: null,
    theta_wp: null,
    elevation_m: seed.elevation_m,
    ec_calibration_factor: seed.ec_calibration_factor,
    irrigation_water_ec: seed.irrigation_water_ec,
  };
}

/** Spread probes over the field: rejection-sample candidates ≥ 25 m inside the boundary, then farthest-point sampling. */
export function placeSensors(seed: FarmSeed, polygon: GeoPolygon): Sensor[] {
  const rng = rngFor(seed.id, "sensors");
  const b = polygonBounds(polygon);
  const [cLng, cLat] = polygonCentroid(polygon);
  const proj = localProjector(cLat, cLng);
  const candidates: Array<{ lng: number; lat: number; x: number; y: number }> = [];
  for (let tries = 0; candidates.length < 320 && tries < 30_000; tries++) {
    const lng = b.minLng + rng() * (b.maxLng - b.minLng);
    const lat = b.minLat + rng() * (b.maxLat - b.minLat);
    if (!pointInPolygon(lng, lat, polygon) || distanceToBoundary_m(lng, lat, polygon) < 25) continue;
    const [x, y] = proj.toXY(lng, lat);
    candidates.push({ lng, lat, x, y });
  }
  const picked: typeof candidates = [];
  // Start with the candidate closest to the centre, then add the one farthest from all picked probes.
  let first = candidates[0];
  for (const c of candidates) if (Math.hypot(c.x, c.y) < Math.hypot(first.x, first.y)) first = c;
  picked.push(first);
  while (picked.length < seed.sensorCount && picked.length < candidates.length) {
    let best = candidates[0];
    let bestDist = -1;
    for (const c of candidates) {
      const d = Math.min(...picked.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
      if (d > bestDist) {
        bestDist = d;
        best = c;
      }
    }
    picked.push(best);
  }
  return picked.map((p, i) => ({
    id: `${seed.sensorPrefix}-${String(i + 1).padStart(2, "0")}`,
    lat: round(p.lat, 6),
    lng: round(p.lng, 6),
  }));
}

/** Hotspot location: along the scenario bearing from the centre, 80 % of the way to the boundary. */
function hotspotXY(seed: FarmSeed, polygon: GeoPolygon, proj: ReturnType<typeof localProjector>) {
  const theta = (seed.scenario.hotspotBearing_deg * Math.PI) / 180;
  const dx = Math.sin(theta);
  const dy = Math.cos(theta);
  let reach = 0;
  for (let r = 5; r < 2000; r += 5) {
    const [lng, lat] = proj.toLngLat(dx * r, dy * r);
    if (!pointInPolygon(lng, lat, polygon)) break;
    reach = r;
  }
  return { x: dx * reach * 0.8, y: dy * reach * 0.8, reach: Math.max(reach, 50) };
}

function generateFarmReadings(seed: FarmSeed, farm: Farm, sensors: Sensor[], dates: string[], now: Date): SensorReading[] {
  const crop = CROPS[seed.main_crop];
  const soil = SOILS[seed.soil_type];
  const p = crop.depletionFraction_p;
  const awc = soil.thetaFc - soil.thetaWp; // m³/m³
  const s = seed.scenario;
  const n = dates.length;
  const last = n - 1;
  const rng = rngFor(seed.id, "farm");

  const [cLng, cLat] = polygonCentroid(farm.polygon);
  const proj = localProjector(cLat, cLng);
  const hot = hotspotXY(seed, farm.polygon, proj);
  const sigma = hot.reach * 0.55;

  // Farm-level daily drivers (smooth AR(1) noise around seasonal trends).
  const eceNoise = ar1Series(rng, n, 0.7, 0.05);
  const deficitNoise = ar1Series(rng, n, 0.6, 0.07);
  const soilTNoise = ar1Series(rng, n, 0.7, 0.35);
  const tmaxNoise = ar1Series(rng, n, 0.6, 0.9);
  const tminNoise = ar1Series(rng, n, 0.6, 0.6);
  const rhMaxNoise = ar1Series(rng, n, 0.5, 5);
  const rhMinNoise = ar1Series(rng, n, 0.5, 3);
  const phNoise = ar1Series(rng, n, 0.8, 0.02);
  const fertPhase = Math.floor(rng() * 7);
  const rising = s.kind === "salinity-rising" || s.kind === "salinity-rising-strong";

  const readings: SensorReading[] = [];
  for (const sensor of sensors) {
    const srng = rngFor(seed.id, sensor.id);
    const [sx, sy] = proj.toXY(sensor.lng, sensor.lat);
    const w = Math.exp(-((sx - hot.x) ** 2 + (sy - hot.y) ** 2) / (2 * sigma * sigma));
    const off = {
      ece: gaussian(srng) * 0.05,
      deficit: gaussian(srng) * 0.08,
      soilT: gaussian(srng) * 0.3,
      ph: gaussian(srng) * 0.05,
      n: gaussian(srng) * 0.08,
      p: gaussian(srng) * 0.08,
      k: gaussian(srng) * 0.06,
      airT: gaussian(srng) * 0.25,
      rh: gaussian(srng) * 1.2,
    };
    const sensorNoise = ar1Series(srng, n, 0.5, 0.04);

    for (let d = 0; d < n; d++) {
      const t = last > 0 ? d / last : 1;
      const date = dates[d];

      const eceMean = s.ece.start + (s.ece.end - s.ece.start) * (rising ? Math.pow(t, 1.35) : t);
      const ece =
        eceMean * (1 + off.ece + eceNoise[d] + sensorNoise[d]) + s.eceHotspot * w * (rising ? Math.pow(t, 1.2) : 1);

      // Depletion as a fraction of RAW; the drying farm loses irrigation capacity mid-window.
      let deficit = s.deficit.base + off.deficit + deficitNoise[d];
      let dryRamp = 0;
      if (s.deficit.dryFromDay !== undefined && d >= s.deficit.dryFromDay) {
        dryRamp = (d - s.deficit.dryFromDay) / Math.max(1, last - s.deficit.dryFromDay);
        deficit += ((s.deficit.dryEnd ?? s.deficit.base) - s.deficit.base) * dryRamp;
        deficit += (s.deficit.dryHotspot ?? 0) * w * dryRamp;
      }
      deficit = Math.min(Math.max(deficit, 0.05), 0.97 / p);
      const thetaDay = soil.thetaFc - deficit * p * awc;
      const amplitude = 0.3 * p * awc * (1 - 0.5 * dryRamp);

      const soilTDay = 34.2 - 3.8 * t + 0.6 * s.climate.tmaxOffset_C + soilTNoise[d] + off.soilT;
      const tmax = 43.2 - 3.4 * t + s.climate.tmaxOffset_C + tmaxNoise[d];
      const tmin = 30.0 - 2.2 * t + 0.4 * s.climate.tmaxOffset_C + tminNoise[d];
      const rhMax = Math.min(98, Math.max(35, 70 + 14 * t + s.climate.rhOffset_pct + rhMaxNoise[d]));
      const rhMin = Math.min(60, Math.max(8, 21 + 9 * t + 0.6 * s.climate.rhOffset_pct + rhMinNoise[d]));
      const ph = s.ph.base + s.ph.drift * t + phNoise[d] + off.ph + (rising ? 0.15 * w * t : 0);
      const fert = 1 + 0.22 * (1 - (2 * ((d + fertPhase) % 7)) / 6);
      const kTrend = rising ? 1 - 0.12 * t : 1;

      READING_HOURS_LOCAL.forEach((hour, hi) => {
        const ts = qatarLocalToUtc(date, hour);
        if (ts.getTime() > now.getTime()) return;
        const shape = diurnalShape(hour);
        const theta = Math.min(soil.thetaFc * 1.15, Math.max(soil.thetaWp * 0.8, thetaDay + amplitude * IRRIGATION_PATTERN[hi]));
        const bulkEc = (Math.max(0.05, ece) / seed.ec_calibration_factor) * (1 + 0.015 * Math.sin((Math.PI * hour) / 12)) * (1 + gaussian(srng) * 0.01);
        readings.push({
          farm_id: seed.id,
          sensor_id: sensor.id,
          lat: sensor.lat,
          lng: sensor.lng,
          timestamp: ts.toISOString(),
          moisture: round(theta * 100, 1),
          temperature: round(soilTDay + 2.4 * Math.cos((2 * Math.PI * (hour - 15)) / 24) + gaussian(srng) * 0.15, 1),
          ec: round(bulkEc, 3),
          ph: round(ph + gaussian(srng) * 0.02, 2),
          n: Math.round(s.nutrients.n * fert * (1 + off.n) * (1 + gaussian(srng) * 0.03)),
          p: Math.round(s.nutrients.p * fert * (1 + off.p) * (1 + gaussian(srng) * 0.03)),
          k: Math.round(s.nutrients.k * kTrend * (0.9 + 0.1 * fert) * (1 + off.k) * (1 + gaussian(srng) * 0.02)),
          air_temp: round(tmin + (tmax - tmin) * shape + off.airT + gaussian(srng) * 0.2, 1),
          air_humidity: Math.round(Math.min(100, Math.max(5, rhMax - (rhMax - rhMin) * shape + off.rh + gaussian(srng)))),
        });
      });
    }
  }
  return readings;
}

/** Build the full demo dataset anchored to `now` (the last day is "today" in Qatar, partially filled). */
export function generateDemoDataset(now: Date = new Date()): GeneratedDataset {
  const today = qatarDateString(now);
  const dates = dateRangeEnding(today, HISTORY_DAYS);
  const farms: Farm[] = [];
  const sensorsByFarm: Record<string, Sensor[]> = {};
  const readings: SensorReading[] = [];
  for (const seed of FARM_SEEDS) {
    const farm = buildFarmRow(seed, today);
    const sensors = placeSensors(seed, farm.polygon);
    farms.push(farm);
    sensorsByFarm[farm.id] = sensors;
    readings.push(...generateFarmReadings(seed, farm, sensors, dates, now));
  }
  readings.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { today, farms, sensorsByFarm, readings };
}

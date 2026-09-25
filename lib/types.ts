/**
 * Domain types shared by the server data layer and the UI.
 * Database row shapes mirror `supabase/migrations/0001_init.sql`.
 */
import type { Et0Method, GrowthStage } from "./agronomy";
import type { CropId, SalinityClassId, SoilType } from "./agronomy-tables";
import type { AiInsight } from "./ai/contract";
import type { GeoPolygon } from "./geo";

/** `farms` table row. */
export interface Farm {
  id: string;
  /** Account that owns the farm; null for the built-in demo farms. */
  owner_id?: string | null;
  name: string;
  owner: string;
  lat: number;
  lng: number;
  area_ha: number;
  main_crop: CropId;
  /** GeoJSON Polygon, [lng, lat] order. */
  polygon: GeoPolygon;
  /** Municipality / area label, e.g. "Al Khor". */
  region: string;
  /** Planting (or stand establishment) date, `YYYY-MM-DD` — drives the FAO-56 growth stage. */
  planting_date: string;
  soil_type: SoilType;
  /** Optional per-farm overrides of the FAO-56 Table 19 soil water limits (m³/m³). */
  theta_fc: number | null;
  theta_wp: number | null;
  elevation_m: number;
  /** ECe ≈ factor × bulk EC — fit from paired lab / probe samples. */
  ec_calibration_factor: number;
  /** Irrigation water salinity ECw (dS/m), entered per farm. */
  irrigation_water_ec: number;
}

/** `sensor_readings` table row. */
export interface SensorReading {
  id?: number;
  farm_id: string;
  sensor_id: string;
  lat: number;
  lng: number;
  /** ISO 8601 timestamp (UTC). */
  timestamp: string;
  /** Volumetric soil water content, % (m³/m³ × 100). */
  moisture: number | null;
  /** Soil temperature at probe depth, °C. */
  temperature: number | null;
  /** Bulk soil electrical conductivity, dS/m (= mS/cm; divide the probe's µS/cm by 1000). */
  ec: number | null;
  ph: number | null;
  /** Nitrogen, phosphorus, potassium, mg/kg. */
  n: number | null;
  p: number | null;
  k: number | null;
  /** Optional air sensor on the probe mast (e.g. SHT31): air temperature °C, relative humidity %. */
  air_temp?: number | null;
  air_humidity?: number | null;
}

/** One sensor, one local (Asia/Qatar) day — the `sensor_daily` view. */
export interface SensorDaily {
  farm_id: string;
  sensor_id: string;
  day: string;
  lat: number;
  lng: number;
  n_readings: number;
  moisture: number | null;
  temperature: number | null;
  ec: number | null;
  ph: number | null;
  n: number | null;
  p: number | null;
  k: number | null;
  air_tmax: number | null;
  air_tmin: number | null;
  rh_max: number | null;
  rh_min: number | null;
  first_ts: string;
  last_ts: string;
}

export interface Sensor {
  id: string;
  lat: number;
  lng: number;
}

/** Daily weather for one farm location (Open-Meteo). */
export interface WeatherDay {
  date: string;
  tmax: number | null;
  tmin: number | null;
  rhMax: number | null;
  rhMin: number | null;
  /** Mean wind speed at 10 m, m/s. */
  wind10: number | null;
  /** Shortwave radiation sum Rs, MJ m⁻² day⁻¹. */
  rs: number | null;
  /** Open-Meteo's own FAO ET0, mm/day (cross-check). */
  et0: number | null;
}

/** Per-sensor values for one day, including derived agronomy. */
export interface SensorDay {
  id: string;
  moisture: number | null;
  temperature: number | null;
  ec: number | null;
  ece: number | null;
  ph: number | null;
  n: number | null;
  p: number | null;
  k: number | null;
  /** Root-zone depletion Dr, mm. */
  dr: number | null;
  /** Dr as % of readily available water (100 % = irrigation trigger). */
  deficitPct: number | null;
  /** Predicted yield loss from salinity, %. */
  yieldLoss: number | null;
}

export type AirSource = "probe" | "open-meteo";

/** Farm-level values for one day (means across probes + derived agronomy). */
export interface FarmDay {
  date: string;
  readings: number;
  moisture: number | null;
  temperature: number | null;
  ec: number | null;
  ece: number | null;
  ph: number | null;
  n: number | null;
  p: number | null;
  k: number | null;
  // Air & weather inputs
  airTmax: number | null;
  airTmin: number | null;
  rhMax: number | null;
  rhMin: number | null;
  airSource: AirSource | null;
  wind10: number | null;
  rs: number | null;
  et0OpenMeteo: number | null;
  // FAO-56 water
  et0: number | null;
  et0Method: Et0Method | null;
  dap: number;
  stage: GrowthStage;
  kc: number | null;
  etc: number | null;
  rootDepth: number;
  taw: number;
  pAdj: number;
  raw: number;
  dr: number | null;
  deficitPct: number | null;
  ks: number | null;
  daysToIrrigation: number | null;
  netDepth: number | null;
  grossDepth: number | null;
  // Salinity
  eceTarget: number;
  lr: number;
  yieldLoss: number | null;
  salinityClass: SalinityClassId | null;
  sensors: SensorDay[];
}

export interface FarmBundle {
  farm: Farm;
  sensors: Sensor[];
  /** Aligned with `DashboardData.dates`; `null` when a day has no readings. */
  days: Array<FarmDay | null>;
  insight: AiInsight | null;
  /** Kc mid/end after the FAO-56 Eq. 62/65 climate adjustment. */
  kcAdjusted: { ini: number; mid: number; end: number };
}

/**
 * Where the dashboard data comes from: the account's own farms in Supabase or in the local
 * `.data/` store, or the built-in demo dataset (demo account and landing page only).
 */
export type DataSource = "supabase" | "local" | "demo";

export interface DashboardData {
  generatedAt: string;
  source: DataSource;
  /** Set when the account's data could not be loaded (e.g. Supabase unreachable). */
  sourceNote: string | null;
  weather: { source: "open-meteo" | "unavailable"; note: string | null };
  dates: string[];
  farms: FarmBundle[];
  /** The account's ESP32 devices (empty for the demo dataset). */
  devices: Device[];
}

/** The latest measurement a device sent, kept on the device for status cards. */
export type DeviceSnapshot = Pick<
  SensorReading,
  "timestamp" | "moisture" | "temperature" | "ec" | "ph" | "n" | "p" | "k" | "air_temp" | "air_humidity"
>;

/** An ESP32 that reports one soil probe over Wi-Fi (`devices` table row, minus the token hash). */
export interface Device {
  id: string;
  owner_id: string;
  farm_id: string;
  name: string;
  /** The probe id its readings are stored under (`sensor_readings.sensor_id`). */
  sensor_id: string;
  /** Where the probe sits in the field. */
  lat: number;
  lng: number;
  /** Last four characters of the device key, to tell keys apart. */
  token_hint: string;
  created_at: string;
  /** Last request of any kind (reading or heartbeat). */
  last_seen_at: string | null;
  /** Last request that carried a measurement. */
  last_reading_at: string | null;
  last_ip: string | null;
  /** Wi-Fi signal strength reported by the ESP32, dBm. */
  rssi: number | null;
  firmware: string | null;
  /** Last problem the device reported (e.g. "probe timeout"); null once it recovers. */
  last_error: string | null;
  last_reading: DeviceSnapshot | null;
}

/** Per-account preferences. */
export interface UserSettings {
  /** How often devices report and the dashboard refreshes, seconds. */
  reading_interval_s: number;
}

/** A reading pushed to the dashboard in live mode. */
export interface LiveReading extends SensorReading {
  /** True when generated by the demo feed (no probe data arriving), false for real probe data. */
  simulated: boolean;
}

/** GET /api/live response. */
export interface LiveUpdate {
  serverTime: string;
  /** Opaque cursor; send it back as `?cursor=` on the next poll. */
  cursor: string;
  feed: "probe" | "simulated" | "idle";
  /** The account's devices with their latest status (empty for the demo dataset). */
  devices: Device[];
  /** Local (Asia/Qatar) day that `farms` describes. */
  date: string;
  /** New readings since the previous poll, newest first. */
  readings: LiveReading[];
  /** Re-derived day for every farm that received readings. */
  farms: Record<string, FarmDay>;
}

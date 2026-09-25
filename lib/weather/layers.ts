/**
 * The weather map's layers: what each shows, its unit, colour scale, legend ticks and isolines.
 */
import type { ScalarKey } from "./field";
import { PALETTES, type Palette } from "./palettes";

export type WeatherLayerKey = "wind" | "gust" | "temp" | "feels" | "rh" | "dew" | "rain" | "rainAccum" | "precipProb" | "clouds" | "pressure";

export interface WeatherLayerDef {
  key: WeatherLayerKey;
  label: string;
  /** Short name for chips and the legend. */
  short: string;
  field: ScalarKey;
  unit: string;
  decimals: number;
  palette: Palette;
  /** Legend range and ticks. */
  legend: { min: number; max: number; ticks: number[] };
  /** Isolines: every `step`, bolder and labelled every `major`. */
  isolines?: { step: number; major: number };
  /** What the numbers are, for the info tip. */
  about: string;
}

export const WEATHER_LAYERS: Record<WeatherLayerKey, WeatherLayerDef> = {
  wind: {
    key: "wind",
    label: "Wind",
    short: "Wind",
    field: "speed",
    unit: "m/s",
    decimals: 1,
    palette: PALETTES.wind,
    legend: { min: 0, max: 20, ticks: [0, 2, 4, 6, 8, 10, 12, 15, 20] },
    about: "Mean wind at 10 m above ground. Streaks show where the air is moving.",
  },
  gust: {
    key: "gust",
    label: "Wind gusts",
    short: "Gusts",
    field: "gust",
    unit: "m/s",
    decimals: 1,
    palette: PALETTES.wind,
    legend: { min: 0, max: 25, ticks: [0, 3, 6, 9, 12, 15, 20, 25] },
    about: "Strongest short gust expected in the hour, at 10 m. Above about 7 m/s spraying drifts; above 15 m/s expect blowing sand.",
  },
  temp: {
    key: "temp",
    label: "Temperature",
    short: "Temp.",
    field: "temp",
    unit: "°C",
    decimals: 1,
    palette: PALETTES.temp,
    legend: { min: 5, max: 50, ticks: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] },
    isolines: { step: 1, major: 5 },
    about: "Air temperature 2 m above ground. Lines every 1 °C, labelled every 5 °C.",
  },
  feels: {
    key: "feels",
    label: "Feels like",
    short: "Feels like",
    field: "feels",
    unit: "°C",
    decimals: 1,
    palette: PALETTES.temp,
    legend: { min: 5, max: 55, ticks: [5, 15, 25, 30, 35, 40, 45, 50, 55] },
    isolines: { step: 1, major: 5 },
    about: "Apparent temperature in the shade (Steadman, as used by the Australian Bureau of Meteorology): heat plus humidity, minus wind. Above 40 °C outdoor work needs rest and water breaks.",
  },
  rh: {
    key: "rh",
    label: "Humidity",
    short: "Humidity",
    field: "rh",
    unit: "%",
    decimals: 0,
    palette: PALETTES.rh,
    legend: { min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100] },
    isolines: { step: 10, major: 50 },
    about: "Relative humidity 2 m above ground. Lines every 10 %.",
  },
  dew: {
    key: "dew",
    label: "Dew point",
    short: "Dew point",
    field: "dew",
    unit: "°C",
    decimals: 1,
    palette: PALETTES.temp,
    legend: { min: -5, max: 35, ticks: [-5, 0, 5, 10, 15, 20, 25, 30, 35] },
    isolines: { step: 2, major: 10 },
    about: "Temperature at which the air would saturate (from temperature and humidity). When the night low meets it, expect dew or fog on leaves.",
  },
  rain: {
    key: "rain",
    label: "Rain",
    short: "Rain",
    field: "precip",
    unit: "mm/h",
    decimals: 1,
    palette: PALETTES.rain,
    legend: { min: 0, max: 30, ticks: [0, 0.5, 2, 5, 10, 20, 30] },
    about: "Rain in the hour (mm). Transparent where it's dry.",
  },
  rainAccum: {
    key: "rainAccum",
    label: "Rain, total so far",
    short: "Rain total",
    field: "precipSum",
    unit: "mm",
    decimals: 1,
    palette: PALETTES.rainAccum,
    legend: { min: 0, max: 50, ticks: [0, 1, 3, 6, 12, 25, 50] },
    about: "Rain added up from now to the time on the timeline.",
  },
  precipProb: {
    key: "precipProb",
    label: "Chance of rain",
    short: "Rain chance",
    field: "precipProb",
    unit: "%",
    decimals: 0,
    palette: PALETTES.precipProb,
    legend: { min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100] },
    about: "Chance of at least 0.1 mm of rain in the hour, from the forecast ensemble.",
  },
  clouds: {
    key: "clouds",
    label: "Clouds",
    short: "Clouds",
    field: "cloud",
    unit: "%",
    decimals: 0,
    palette: PALETTES.cloud,
    legend: { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] },
    about: "Total cloud cover. Clear sky shows the map below.",
  },
  pressure: {
    key: "pressure",
    label: "Pressure",
    short: "Pressure",
    field: "pressure",
    unit: "hPa",
    decimals: 1,
    palette: PALETTES.pressure,
    legend: { min: 990, max: 1025, ticks: [990, 995, 1000, 1005, 1010, 1015, 1020, 1025] },
    isolines: { step: 1, major: 4 },
    about: "Air pressure reduced to sea level. Isobars every 1 hPa; wind blows roughly along them, faster where they crowd together.",
  },
};

/** The layer menu: the four everyday layers first. */
export const WEATHER_LAYER_GROUPS: Array<{ label: string; keys: WeatherLayerKey[] }> = [
  { label: "Weather", keys: ["wind", "temp", "rain", "rh"] },
  { label: "More weather", keys: ["gust", "feels", "dew", "precipProb", "rainAccum", "clouds", "pressure"] },
];

export const isWeatherLayer = (v: unknown): v is WeatherLayerKey => typeof v === "string" && v in WEATHER_LAYERS;

export function formatWeather(def: WeatherLayerDef, v: number | null | undefined, withUnit = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const d = def.key === "rain" && v > 0 && v < 0.1 ? 2 : def.decimals;
  const s = v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return withUnit ? `${s}${def.unit === "%" || def.unit === "°C" ? "" : " "}${def.unit}` : s;
}

/** km/h from m/s (the picker shows both). */
export const kmh = (ms: number) => ms * 3.6;

/** Beaufort force for a mean wind speed (m/s). */
export function beaufort(ms: number): { force: number; label: string } {
  const limits = [0.5, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  const labels = ["Calm", "Light air", "Light breeze", "Gentle breeze", "Moderate breeze", "Fresh breeze", "Strong breeze", "Near gale", "Gale", "Strong gale", "Storm", "Violent storm", "Hurricane"];
  const force = limits.findIndex((l) => ms < l);
  const f = force === -1 ? 12 : force;
  return { force: f, label: labels[f] };
}

/**
 * Colour scales for the weather maps, in the same form as the soil layers (lib/metrics.ts):
 * fixed, labelled classes with ColorBrewer colours — sequential ramps for magnitudes, the
 * YlOrRd heat ramp for temperature, and Beaufort classes for wind.
 */
import type { ColorScale, ScaleClass } from "../metrics";
import type { GridField } from "./types";

export type WeatherLayerKey = "temperature" | "humidity" | "precipitation" | "precipProbability" | "windSpeed" | "windGusts";

export interface WeatherLayer extends ColorScale {
  key: WeatherLayerKey;
  field: GridField;
  label: string;
  short: string;
  unit: string;
  decimals: number;
  /** Cells below this are left transparent (no rain is not a colour). */
  transparentBelow?: number;
  /** Map colours may be stretched over the forecast's own range (see stretchedLayer). */
  stretch?: boolean;
  /** Set on a layer whose classes were stretched. */
  stretched?: boolean;
  description: string;
}

const heat: ScaleClass[] = [
  // ColorBrewer YlOrRd (7).
  { min: -Infinity, max: 20, color: "#ffffb2", label: "< 20 °C" },
  { min: 20, max: 25, color: "#fed976", label: "20–25" },
  { min: 25, max: 30, color: "#feb24c", label: "25–30" },
  { min: 30, max: 35, color: "#fd8d3c", label: "30–35" },
  { min: 35, max: 40, color: "#fc4e2a", label: "35–40" },
  { min: 40, max: 45, color: "#e31a1c", label: "40–45" },
  { min: 45, max: Infinity, color: "#b10026", label: "> 45 °C" },
];

const beaufort: ScaleClass[] = [
  // Beaufort scale bands (m/s), ColorBrewer PuBuGn (6).
  { min: 0, max: 1.6, color: "#f6eff7", label: "Calm" },
  { min: 1.6, max: 3.4, color: "#d0d1e6", label: "Light" },
  { min: 3.4, max: 5.5, color: "#a6bddb", label: "Gentle" },
  { min: 5.5, max: 8, color: "#67a9cf", label: "Moderate" },
  { min: 8, max: 10.8, color: "#1c9099", label: "Fresh" },
  { min: 10.8, max: Infinity, color: "#016c59", label: "Strong" },
];

export const WEATHER_LAYERS: Record<WeatherLayerKey, WeatherLayer> = {
  temperature: {
    key: "temperature",
    field: "temperature",
    label: "Air temperature",
    short: "Temp.",
    unit: "°C",
    decimals: 1,
    classes: heat,
    displayMax: 50,
    stretch: true,
    description: "Air temperature at 2 m (Open-Meteo hourly forecast).",
  },
  humidity: {
    key: "humidity",
    field: "humidity",
    label: "Relative humidity",
    short: "Humidity",
    unit: "%",
    decimals: 0,
    // ColorBrewer Blues (6).
    classes: [
      { min: 0, max: 20, color: "#eff3ff", label: "< 20 %" },
      { min: 20, max: 40, color: "#c6dbef", label: "20–40" },
      { min: 40, max: 60, color: "#9ecae1", label: "40–60" },
      { min: 60, max: 80, color: "#6baed6", label: "60–80" },
      { min: 80, max: 90, color: "#3182bd", label: "80–90" },
      { min: 90, max: Infinity, color: "#08519c", label: "> 90 %" },
    ],
    displayMax: 100,
    stretch: true,
    description: "Relative humidity at 2 m. Long spells above 85 % keep leaves wet.",
  },
  precipitation: {
    key: "precipitation",
    field: "precipitation",
    label: "Rain",
    short: "Rain",
    unit: "mm/h",
    decimals: 1,
    transparentBelow: 0.1,
    // ColorBrewer BuPu (6), from the lightest measurable rain.
    classes: [
      { min: 0, max: 0.5, color: "#bfd3e6", label: "< 0.5" },
      { min: 0.5, max: 1, color: "#9ebcda", label: "0.5–1" },
      { min: 1, max: 2.5, color: "#8c96c6", label: "1–2.5" },
      { min: 2.5, max: 5, color: "#8c6bb1", label: "2.5–5" },
      { min: 5, max: 10, color: "#88419d", label: "5–10" },
      { min: 10, max: Infinity, color: "#6e016b", label: "> 10" },
    ],
    displayMax: 20,
    description: "Rain, showers and snow in the hour (mm). Clear where it stays dry.",
  },
  precipProbability: {
    key: "precipProbability",
    field: "precipProbability",
    label: "Chance of rain",
    short: "Chance",
    unit: "%",
    decimals: 0,
    transparentBelow: 5,
    // ColorBrewer Blues (5).
    classes: [
      { min: 0, max: 20, color: "#eff3ff", label: "< 20 %" },
      { min: 20, max: 40, color: "#bdd7e7", label: "20–40" },
      { min: 40, max: 60, color: "#6baed6", label: "40–60" },
      { min: 60, max: 80, color: "#3182bd", label: "60–80" },
      { min: 80, max: Infinity, color: "#08519c", label: "> 80 %" },
    ],
    displayMax: 100,
    description: "Chance of more than 0.1 mm of rain in the hour.",
  },
  windSpeed: {
    key: "windSpeed",
    field: "windSpeed",
    label: "Wind speed",
    short: "Wind",
    unit: "m/s",
    decimals: 1,
    classes: beaufort,
    displayMax: 16,
    description: "Mean wind at 10 m; arrows point where the wind blows. Classes: Beaufort scale.",
  },
  windGusts: {
    key: "windGusts",
    field: "windGusts",
    label: "Wind gusts",
    short: "Gusts",
    unit: "m/s",
    decimals: 1,
    classes: beaufort,
    displayMax: 20,
    description: "Strongest gusts at 10 m in the hour. Classes: Beaufort scale.",
  },
};

export function formatWeatherValue(layer: Pick<WeatherLayer, "decimals" | "unit">, value: number | null | undefined, withUnit = true): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const v = value.toLocaleString("en-US", { minimumFractionDigits: layer.decimals, maximumFractionDigits: layer.decimals });
  return withUnit ? `${v} ${layer.unit}` : v;
}

/**
 * The same colour ramp spread evenly over [lo, hi] — for quantities that vary little across a
 * region, so the map shows the pattern instead of one flat class.
 */
export function stretchedLayer(layer: WeatherLayer, lo: number, hi: number): WeatherLayer {
  let min = lo;
  let max = hi;
  const minSpan = layer.decimals === 0 ? 5 : 1;
  if (max - min < minSpan) {
    const mid = (min + max) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
  }
  const colors = layer.classes.map((c) => c.color);
  const n = colors.length;
  const step = (max - min) / n;
  const f = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: layer.decimals === 0 ? 0 : 1 });
  return {
    ...layer,
    stretched: true,
    displayMax: max,
    classes: colors.map((color, i) => {
      const a = min + i * step;
      const b = min + (i + 1) * step;
      return {
        min: i === 0 ? -Infinity : a,
        max: i === n - 1 ? Infinity : b,
        color,
        label: i === 0 ? `< ${f(b)}` : i === n - 1 ? `> ${f(a)}` : `${f(a)}–${f(b)}`,
      };
    }),
  };
}

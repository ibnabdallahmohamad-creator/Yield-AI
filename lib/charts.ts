/**
 * Data for the "Soil & weather" chart card (ui_improvement §7.3): one row per day for the soil
 * tabs (probes) and for the weather tabs (Open-Meteo, including the 7-day forecast), plus the
 * rules that pick the default tab and the tab's risk dot.
 */
import { CROPS } from "./agronomy-tables";
import { lastDataIndex } from "./ai/analysis";
import { HEAT_STRESS_C, NUTRIENT_GUIDE, nutrientStatus, type NutrientKey } from "./crop-guides";
import { riskReason, triggerMoisturePct, type ChartOverlay, type HealthTone } from "./dashboard";
import type { Recommendation } from "./ai/contract";
import type { MetricKey } from "./metrics";
import type { FarmBundle, FarmDay, SensorDay, WeatherDay } from "./types";

export type ChartTab = "salinity" | "moisture" | "npk" | "temperature" | "rain";

export const CHART_TABS: Array<{ key: ChartTab; label: string; kind: "soil" | "weather" }> = [
  { key: "salinity", label: "Salinity", kind: "soil" },
  { key: "moisture", label: "Moisture", kind: "soil" },
  { key: "npk", label: "NPK", kind: "soil" },
  { key: "temperature", label: "Temperature", kind: "weather" },
  { key: "rain", label: "Rain", kind: "weather" },
];

export function isChartTab(value: unknown): value is ChartTab {
  return typeof value === "string" && CHART_TABS.some((t) => t.key === value);
}

/** The tab behind the farm's top risk: Moisture for a farm drying out, otherwise Salinity. */
export function defaultChartTab(bundle: FarmBundle): ChartTab {
  return riskReason(bundle).driver === "water" ? "moisture" : "salinity";
}

/** The only colour on a tab: a dot when that metric is currently in a risk class. */
export function tabAlert(bundle: FarmBundle, tab: ChartTab, index = bundle.days.length - 1): HealthTone {
  const i = lastDataIndex(bundle, index);
  const d = i >= 0 ? bundle.days[i] : null;
  if (!d) return "none";
  const threshold = CROPS[bundle.farm.main_crop].salinity.threshold_dS_per_m;
  switch (tab) {
    case "salinity":
      if ((d.yieldLoss ?? 0) >= 10) return "bad";
      if ((d.yieldLoss ?? 0) >= 2 || (d.ece ?? 0) >= 0.85 * threshold) return "warn";
      return "none";
    case "moisture":
      if ((d.deficitPct ?? 0) > 100) return "bad";
      if ((d.deficitPct ?? 0) >= 80) return "warn";
      return "none";
    case "npk":
      return (["n", "p", "k"] as NutrientKey[]).some((k) => nutrientStatus(k, d[k]) === "low") ? "warn" : "none";
    case "temperature": {
      const today = bundle.weatherDays.find((w) => w.date === d.date);
      return today?.tmax != null && today.tmax > HEAT_STRESS_C[bundle.farm.main_crop] ? "warn" : "none";
    }
    case "rain":
      return "none";
  }
}

/** The chart tab that explains a map layer. Soil temperature has none (the Temperature tab is air). */
export function tabForLayer(layer: MetricKey): ChartTab | null {
  switch (layer) {
    case "ece":
    case "yieldLoss":
      return "salinity";
    case "moisture":
    case "deficit":
    case "et0":
    case "etc":
      return "moisture";
    case "n":
    case "p":
    case "k":
    case "ph":
      return "npk";
    default:
      return null;
  }
}

/**
 * The map layer that follows a soil chart tab, keeping the current layer when it already belongs
 * to that tab. Temperature and Rain are farm-level weather, so they leave the map alone (null).
 */
export function layerForTab(tab: ChartTab, current: MetricKey, nutrient: MetricKey = "n"): MetricKey | null {
  if (tabForLayer(current) === tab) return current;
  if (tab === "salinity") return "ece";
  if (tab === "moisture") return "moisture";
  if (tab === "npk") return nutrient;
  return null;
}

// ---------------------------------------------------------------------------
// Soil rows
// ---------------------------------------------------------------------------

export interface SoilRow {
  date: string;
  value: number | null;
  range: [number, number] | null;
  overlay: number | null;
  /** Per-probe values, keyed `p:<sensorId>` (for "Show each probe"). */
  [probe: `p:${string}`]: number | null;
}

export function soilRows(
  bundle: FarmBundle,
  dates: string[],
  start: number,
  end: number,
  farmValue: (d: FarmDay) => number | null,
  sensorValue: (s: SensorDay) => number | null,
  overlay: ChartOverlay = { kind: "none" },
): SoilRow[] {
  const span = end - start + 1;
  const rows: SoilRow[] = [];
  for (let i = start; i <= end; i++) {
    const day = bundle.days[i];
    const row: SoilRow = { date: dates[i], value: day ? clean(farmValue(day)) : null, range: null, overlay: null };
    if (day) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const s of day.sensors) {
        const v = clean(sensorValue(s));
        row[`p:${s.id}`] = v;
        if (v == null) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      if (day.sensors.length > 1 && Number.isFinite(lo)) row.range = [lo, hi];
    }
    if (overlay.kind === "previous") {
      const prev = bundle.days[i - span];
      row.overlay = prev ? clean(farmValue(prev)) : null;
    } else if (overlay.kind === "farm") {
      const other = overlay.bundle.days[i];
      row.overlay = other ? clean(farmValue(other)) : null;
    }
    rows.push(row);
  }
  return rows;
}

/** Soil moisture (% VWC) at which depletion reaches RAW, per day — the irrigation trigger line. */
export function triggerSeries(bundle: FarmBundle, start: number, end: number): Array<number | null> {
  const out: Array<number | null> = [];
  for (let i = start; i <= end; i++) {
    const day = bundle.days[i];
    out.push(day ? clean(triggerMoisturePct(bundle.farm, day)) : null);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weather rows
// ---------------------------------------------------------------------------

export interface WeatherRow {
  date: string;
  forecast: boolean;
  tmax: number | null;
  tmin: number | null;
  tmean: number | null;
  /** Past min–max band / forecast band (split so the forecast can be drawn lighter). */
  band: [number, number] | null;
  bandForecast: [number, number] | null;
  meanPast: number | null;
  meanForecast: number | null;
  /** Probe soil temperature (farm mean), for the optional overlay. */
  soil: number | null;
  rain: number | null;
  rainForecast: number | null;
  rainProb: number | null;
  /** Cumulative crop water use ETc and rain since the start of the range, mm. */
  cumEtc: number | null;
  cumRain: number | null;
}

/**
 * Weather from the start of the range to its end, plus the forecast when the range ends today.
 * Past rows follow the date axis; a range ending in the past has no forecast.
 */
export function weatherRows(bundle: FarmBundle, dates: string[], start: number, end: number): WeatherRow[] {
  const byDate = new Map(bundle.weatherDays.map((w) => [w.date, w]));
  const today = dates[dates.length - 1];
  const future = end === dates.length - 1 ? bundle.weatherDays.filter((w) => w.date > today).map((w) => w.date) : [];
  const axis = [...dates.slice(start, end + 1), ...future];
  let cumEtc = 0;
  let cumRain = 0;
  let sawEtc = false;
  return axis.map((date, k) => {
    const w: WeatherDay | undefined = byDate.get(date);
    const forecast = date > today;
    const isToday = date === today;
    const band: [number, number] | null = w?.tmin != null && w?.tmax != null ? [w.tmin, w.tmax] : null;
    const day = !forecast ? bundle.days[start + k] : null;
    if (!forecast) {
      if (day?.etc != null) {
        cumEtc += day.etc;
        sawEtc = true;
      }
      cumRain += w?.precip ?? 0;
    }
    return {
      date,
      forecast,
      tmax: w?.tmax ?? null,
      tmin: w?.tmin ?? null,
      tmean: w?.tmean ?? null,
      band: forecast ? null : band,
      // Today starts both segments so the lines join up.
      bandForecast: forecast || isToday ? band : null,
      meanPast: forecast ? null : (w?.tmean ?? null),
      meanForecast: forecast || isToday ? (w?.tmean ?? null) : null,
      soil: day?.temperature ?? null,
      rain: forecast ? null : (w?.precip ?? null),
      rainForecast: forecast ? (w?.precip ?? null) : null,
      rainProb: w?.precipProb ?? null,
      cumEtc: forecast || !sawEtc ? null : round1(cumEtc),
      cumRain: forecast ? null : round1(cumRain),
    };
  });
}

export interface NutrientSummary {
  key: NutrientKey;
  value: number | null;
  status: ReturnType<typeof nutrientStatus>;
  /** Value relative to the adequate range: < 0 below, 0–1 inside, > 1 above. */
  position: number | null;
}

/** N, P and K today against their indicative ranges; the weakest first. */
export function nutrientSummary(day: FarmDay | null): NutrientSummary[] {
  return (["n", "p", "k"] as NutrientKey[])
    .map((key) => {
      const value = day?.[key] ?? null;
      const g = NUTRIENT_GUIDE[key];
      return { key, value, status: nutrientStatus(key, value), position: value == null ? null : (value - g.low) / (g.high - g.low) };
    })
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
}

function clean(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** The chart that explains an action, for "See the chart". */
export function chartForAction(rec: Pick<Recommendation, "title" | "detail">): ChartTab {
  const text = `${rec.title} ${rec.detail}`.toLowerCase();
  if (/leach|salt|salin|\bece\b|gypsum|drain/.test(text)) return "salinity";
  if (/fertig|fertili|nitrogen|potassium|phosph|npk|\bph\b/.test(text)) return "npk";
  if (/heat|shade|temperature/.test(text)) return "temperature";
  return "moisture";
}

/** One line on the method behind an action, shown under ▸ Why. */
export const METHOD_LINE: Record<ChartTab, string> = {
  salinity: "Method: Maas–Hoffman salt response of the crop (FAO-29), from probe ECe.",
  moisture: "Method: FAO-56 daily soil-water balance from probe moisture and weather.",
  npk: "Method: probe nutrient readings against the crop's target ranges.",
  temperature: "Method: the weather forecast against the crop's heat-stress limit.",
  rain: "Method: forecast rain against the crop's daily water use (FAO-56).",
};

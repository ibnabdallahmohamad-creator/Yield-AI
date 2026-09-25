/**
 * Turns an hourly forecast into what a grower acts on: the next 12 hours at a glance and plain
 * advisories (rain against irrigation, heat, spraying windows, leaf-wetness hours, crop water use).
 * Pure and client-safe; thresholds are stated in each advisory.
 */
import type { GridField, GridForecast, HourlySeries } from "./types";

export const OUTLOOK_HOURS = 12;

// ---------------------------------------------------------------------------
// WMO weather codes (Open-Meteo `weather_code`)
// ---------------------------------------------------------------------------

export type WeatherIcon = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

const WMO: Record<number, [string, WeatherIcon]> = {
  0: ["Clear sky", "clear"],
  1: ["Mainly clear", "clear"],
  2: ["Partly cloudy", "partly"],
  3: ["Overcast", "cloudy"],
  45: ["Fog", "fog"],
  48: ["Rime fog", "fog"],
  51: ["Light drizzle", "drizzle"],
  53: ["Drizzle", "drizzle"],
  55: ["Dense drizzle", "drizzle"],
  56: ["Freezing drizzle", "drizzle"],
  57: ["Freezing drizzle", "drizzle"],
  61: ["Light rain", "rain"],
  63: ["Rain", "rain"],
  65: ["Heavy rain", "rain"],
  66: ["Freezing rain", "rain"],
  67: ["Freezing rain", "rain"],
  71: ["Light snow", "snow"],
  73: ["Snow", "snow"],
  75: ["Heavy snow", "snow"],
  77: ["Snow grains", "snow"],
  80: ["Light showers", "rain"],
  81: ["Showers", "rain"],
  82: ["Violent showers", "rain"],
  85: ["Snow showers", "snow"],
  86: ["Snow showers", "snow"],
  95: ["Thunderstorm", "storm"],
  96: ["Thunderstorm with hail", "storm"],
  99: ["Thunderstorm with hail", "storm"],
};

export function weatherCodeInfo(code: number | null | undefined): { label: string; icon: WeatherIcon } {
  const entry = code == null ? undefined : WMO[code];
  return entry ? { label: entry[0], icon: entry[1] } : { label: "—", icon: "partly" };
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** "NE" for 45°. `deg` is where the wind comes from. */
export function compass(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return "—";
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// ---------------------------------------------------------------------------
// The next hours
// ---------------------------------------------------------------------------

/** Indices of the hours from the current hour on, at most `hours` of them. */
export function upcomingIndices(series: Pick<HourlySeries, "time">, now: number, hours = OUTLOOK_HOURS): number[] {
  const start = Math.floor(now / 3_600_000) * 3_600_000;
  const out: number[] = [];
  series.time.forEach((t, i) => {
    if (t >= start && out.length < hours) out.push(i);
  });
  return out;
}

export function sliceSeries(series: HourlySeries, indices: number[]): HourlySeries {
  const out = {} as HourlySeries;
  for (const key of Object.keys(series) as Array<keyof HourlySeries>) {
    (out as unknown as Record<string, unknown[]>)[key] = indices.map((i) => series[key][i]);
  }
  return out;
}

interface Extreme {
  value: number;
  time: number;
}

function extreme(series: HourlySeries, field: keyof Omit<HourlySeries, "time">, mode: "max" | "min"): Extreme | null {
  let best: Extreme | null = null;
  series[field].forEach((v, i) => {
    if (v == null) return;
    if (!best || (mode === "max" ? v > best.value : v < best.value)) best = { value: v, time: series.time[i] };
  });
  return best;
}

const sum = (values: Array<number | null>) => values.reduce<number>((a, v) => a + (v ?? 0), 0);
const known = (values: Array<number | null>) => values.filter((v): v is number => v != null);
const mean = (values: Array<number | null>) => {
  const k = known(values);
  return k.length ? k.reduce((a, b) => a + b, 0) / k.length : null;
};

/** Mean direction of travel-weighted wind vectors, degrees (where it comes from). */
export function meanWindDirection(speeds: Array<number | null>, directions: Array<number | null>): number | null {
  let x = 0;
  let y = 0;
  directions.forEach((d, i) => {
    const s = speeds[i] ?? 0;
    if (d == null) return;
    x += s * Math.sin((d * Math.PI) / 180);
    y += s * Math.cos((d * Math.PI) / 180);
  });
  if (Math.hypot(x, y) < 1e-6) return null;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

export interface OutlookSummary {
  hours: number;
  from: number | null;
  to: number | null;
  tempMax: Extreme | null;
  tempMin: Extreme | null;
  humidityMax: Extreme | null;
  humidityMin: Extreme | null;
  rainTotal: number;
  rainHours: number;
  rainChanceMax: Extreme | null;
  windMean: number | null;
  windDirection: number | null;
  gustMax: Extreme | null;
  et0Total: number;
  vpdMax: Extreme | null;
  uvMax: Extreme | null;
  cloudMean: number | null;
  /** Most frequent weather code. */
  dominantCode: number | null;
}

export function summarizeOutlook(series: HourlySeries): OutlookSummary {
  const codes = known(series.weatherCode);
  const counts = new Map<number, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  // Ties go to the more significant (higher) code: rain beats cloud.
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
  return {
    hours: series.time.length,
    from: series.time[0] ?? null,
    to: series.time.at(-1) ?? null,
    tempMax: extreme(series, "temperature", "max"),
    tempMin: extreme(series, "temperature", "min"),
    humidityMax: extreme(series, "humidity", "max"),
    humidityMin: extreme(series, "humidity", "min"),
    rainTotal: sum(series.precipitation),
    rainHours: series.precipitation.filter((v) => (v ?? 0) >= 0.1).length,
    rainChanceMax: extreme(series, "precipProbability", "max"),
    windMean: mean(series.windSpeed),
    windDirection: meanWindDirection(series.windSpeed, series.windDirection),
    gustMax: extreme(series, "windGusts", "max"),
    et0Total: sum(series.et0),
    vpdMax: extreme(series, "vpd", "max"),
    uvMax: extreme(series, "uvIndex", "max"),
    cloudMean: mean(series.cloudCover),
    dominantCode: dominant,
  };
}

// ---------------------------------------------------------------------------
// Advisories
// ---------------------------------------------------------------------------

export type AdviceLevel = "alert" | "warn" | "info" | "good";

export interface WeatherAdvice {
  topic: "rain" | "heat" | "wind" | "humidity" | "water" | "cold";
  level: AdviceLevel;
  title: string;
  detail: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** "14:00" in Qatar time (UTC+3), like the rest of the app. */
export function hourLabel(ms: number): string {
  return `${pad(new Date(ms + 3 * 3_600_000).getUTCHours())}:00`;
}
const f1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const f0 = (v: number) => Math.round(v).toLocaleString("en-US");

/** Longest run of consecutive hours where `ok(i)` holds. */
function longestRun(series: HourlySeries, ok: (i: number) => boolean): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  let start = -1;
  for (let i = 0; i <= series.time.length; i++) {
    if (i < series.time.length && ok(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (!best || i - start > best.end - best.start + 1) best = { start, end: i - 1 };
      start = -1;
    }
  }
  return best;
}

/** Spraying needs calm air (< 3 m/s at 10 m, gusts < 5 m/s) and no rain — the usual drift guidance. */
export const SPRAY_WIND_MAX = 3;
export const SPRAY_GUST_MAX = 5;
/** Hours at or above this humidity keep leaves wet enough for fungal infection. */
export const LEAF_WETNESS_RH = 85;

export function weatherAdvice(series: HourlySeries, crop: { name: string; kc: number | null } | null): WeatherAdvice[] {
  if (series.time.length === 0) return [];
  const s = summarizeOutlook(series);
  const out: WeatherAdvice[] = [];

  // Rain against irrigation.
  if (s.rainTotal >= 1) {
    out.push({
      topic: "rain",
      level: s.rainTotal >= 10 ? "warn" : "info",
      title: `${f1(s.rainTotal)} mm of rain expected`,
      detail: `Over ${s.rainHours} hour${s.rainHours === 1 ? "" : "s"}${s.rainChanceMax ? `, chance up to ${f0(s.rainChanceMax.value)}% around ${hourLabel(s.rainChanceMax.time)}` : ""}. Count it against the next irrigation${s.rainTotal >= 10 ? " and check drainage — heavy rain on sandy soil leaches nitrogen" : ""}.`,
    });
  } else if (s.rainChanceMax && s.rainChanceMax.value >= 40) {
    out.push({
      topic: "rain",
      level: "info",
      title: `Showers possible (${f0(s.rainChanceMax.value)}%)`,
      detail: `Around ${hourLabel(s.rainChanceMax.time)}; little accumulation expected (${f1(s.rainTotal)} mm). Keep the irrigation plan.`,
    });
  }

  // Heat.
  if (s.tempMax && s.tempMax.value >= 35) {
    out.push({
      topic: "heat",
      level: s.tempMax.value >= 42 ? "alert" : "warn",
      title: `${s.tempMax.value >= 42 ? "Extreme heat" : "Heat"}: ${f1(s.tempMax.value)} °C at ${hourLabel(s.tempMax.time)}`,
      detail: `${s.vpdMax && s.vpdMax.value >= 3 ? `Very dry air (VPD ${f1(s.vpdMax.value)} kPa) drives transpiration up. ` : ""}Irrigate early morning or evening to cut evaporation losses, and avoid working plants in the midday heat.`,
    });
  }
  if (s.tempMin && s.tempMin.value <= 5) {
    out.push({
      topic: "cold",
      level: s.tempMin.value <= 2 ? "alert" : "warn",
      title: `Cold night: ${f1(s.tempMin.value)} °C at ${hourLabel(s.tempMin.time)}`,
      detail: "Protect sensitive seedlings; frost damage starts near 0 °C.",
    });
  }

  // Wind and spraying.
  const calm = longestRun(
    series,
    (i) => (series.windSpeed[i] ?? 99) < SPRAY_WIND_MAX && (series.windGusts[i] ?? 99) < SPRAY_GUST_MAX && (series.precipitation[i] ?? 0) < 0.1,
  );
  if (s.gustMax && s.gustMax.value >= 10) {
    out.push({
      topic: "wind",
      level: s.gustMax.value >= 15 ? "alert" : "warn",
      title: `Gusts up to ${f1(s.gustMax.value)} m/s at ${hourLabel(s.gustMax.time)}`,
      detail: `Wind from the ${compass(s.windDirection)}. Don't spray; secure shade nets and greenhouse covers${s.gustMax.value >= 15 ? ", and expect blowing dust" : ""}.`,
    });
  }
  if (calm && calm.end - calm.start + 1 >= 2) {
    out.push({
      topic: "wind",
      level: "good",
      title: `Spray window ${hourLabel(series.time[calm.start])}–${hourLabel(series.time[calm.end] + 3_600_000)}`,
      detail: `Wind under ${SPRAY_WIND_MAX} m/s, gusts under ${SPRAY_GUST_MAX} m/s and no rain for ${calm.end - calm.start + 1} hours — lowest drift risk.`,
    });
  } else if (!s.gustMax || s.gustMax.value < 10) {
    out.push({
      topic: "wind",
      level: "info",
      title: "No calm spray window",
      detail: `Wind stays at or above ${SPRAY_WIND_MAX} m/s (or gusts above ${SPRAY_GUST_MAX} m/s) most hours; spraying now risks drift.`,
    });
  }

  // Leaf wetness.
  const wet = series.humidity.filter((v) => (v ?? 0) >= LEAF_WETNESS_RH).length;
  if (wet >= 3) {
    const run = longestRun(series, (i) => (series.humidity[i] ?? 0) >= LEAF_WETNESS_RH);
    out.push({
      topic: "humidity",
      level: wet >= 6 ? "warn" : "info",
      title: `Humid: ≥ ${LEAF_WETNESS_RH}% RH for ${wet} hours`,
      detail: `${run ? `Mostly ${hourLabel(series.time[run.start])}–${hourLabel(series.time[run.end] + 3_600_000)}. ` : ""}Long leaf-wet spells favour fungal disease (e.g. downy mildew); ventilate greenhouses and avoid evening overhead watering.`,
    });
  }

  // Crop water use.
  if (s.et0Total > 0) {
    const etc = crop?.kc != null ? s.et0Total * crop.kc : null;
    out.push({
      topic: "water",
      level: "info",
      title: `Reference ET₀ ${f1(s.et0Total)} mm over the next ${s.hours} h`,
      detail:
        etc != null && crop
          ? `With Kc ${crop.kc!.toFixed(2)}, ${crop.name.toLowerCase()} will use about ${f1(etc)} mm (ETc = Kc × ET₀, FAO-56)${s.rainTotal >= 1 ? `, of which rain covers up to ${f1(Math.min(s.rainTotal, etc))} mm` : ""}.`
          : "FAO-56 reference evapotranspiration from Open-Meteo's hourly forecast.",
    });
  }
  const order: Record<AdviceLevel, number> = { alert: 0, warn: 1, info: 2, good: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// ---------------------------------------------------------------------------
// Grid sampling (maps)
// ---------------------------------------------------------------------------

/** Bilinear value of a grid field at a point for one hour; null outside the grid or where data is missing. */
export function sampleGrid(grid: GridForecast, field: GridField, hour: number, lat: number, lng: number): number | null {
  const values = grid.fields[field][hour];
  if (!values) return null;
  const { lats, lngs } = grid;
  const rows = lats.length;
  const cols = lngs.length;
  // Rows run north → south.
  const fr = ((lats[0] - lat) / (lats[0] - lats[rows - 1])) * (rows - 1);
  const fc = ((lng - lngs[0]) / (lngs[cols - 1] - lngs[0])) * (cols - 1);
  if (!(fr >= 0 && fr <= rows - 1 && fc >= 0 && fc <= cols - 1)) return null;
  const r0 = Math.min(rows - 2, Math.floor(fr));
  const c0 = Math.min(cols - 2, Math.floor(fc));
  const tr = fr - r0;
  const tc = fc - c0;
  const at = (r: number, c: number) => values[r * cols + c];
  const v00 = at(r0, c0);
  const v01 = at(r0, c0 + 1);
  const v10 = at(r0 + 1, c0);
  const v11 = at(r0 + 1, c0 + 1);
  if (v00 == null || v01 == null || v10 == null || v11 == null) return null;
  if (field === "windDirection") {
    // Interpolate directions as vectors so 350° and 10° average to 0°, not 180°.
    const w = [
      [v00, (1 - tr) * (1 - tc)],
      [v01, (1 - tr) * tc],
      [v10, tr * (1 - tc)],
      [v11, tr * tc],
    ];
    const x = w.reduce((a, [d, k]) => a + k * Math.sin((d * Math.PI) / 180), 0);
    const y = w.reduce((a, [d, k]) => a + k * Math.cos((d * Math.PI) / 180), 0);
    return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  }
  return v00 * (1 - tr) * (1 - tc) + v01 * (1 - tr) * tc + v10 * tr * (1 - tc) + v11 * tr * tc;
}

/** Min and max of a grid field over the given hours (for a stable map colour scale). */
export function gridRange(grid: GridForecast, field: GridField, hours: number[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of hours) {
    for (const v of grid.fields[field][h] ?? []) {
      if (v == null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return Number.isFinite(lo) ? [lo, hi] : null;
}

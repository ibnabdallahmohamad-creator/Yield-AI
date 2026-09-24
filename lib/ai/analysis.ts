/**
 * Small, pure helpers that turn a farm's derived data into facts the AI layer talks about:
 * trends over a window, the most extreme probe and where it sits in the field, and which crop
 * best tolerates the current salinity. Shared by the seed insights, the chat context and the
 * offline responder so all three always quote the same numbers.
 */
import { relativeYield_pct } from "../agronomy";
import { CROPS, type CropId, type MarketStatus } from "../agronomy-tables";
import { localProjector, polygonCentroid } from "../geo";
import type { FarmBundle, FarmDay, SensorDay } from "../types";

export const VEGETABLE_CROPS: CropId[] = ["tomato", "cucumber", "sweet_pepper", "eggplant", "zucchini"];

/** Index of the last day with data at or before `index`. */
export function lastDataIndex(bundle: FarmBundle, index = bundle.days.length - 1): number {
  for (let i = Math.min(index, bundle.days.length - 1); i >= 0; i--) if (bundle.days[i]) return i;
  return -1;
}

export function dayAt(bundle: FarmBundle, index: number): FarmDay | null {
  const i = lastDataIndex(bundle, index);
  return i >= 0 ? bundle.days[i] : null;
}

export interface Trend {
  from: number | null;
  to: number | null;
  /** Absolute change `to − from`. */
  change: number | null;
  /** Relative change in % of `from`. */
  changePct: number | null;
  /** Actual number of days between the two points. */
  days: number;
}

/** Change of a farm value over `windowDays` ending at `index` (uses the nearest days with data). */
export function trend(
  bundle: FarmBundle,
  index: number,
  windowDays: number,
  pick: (day: FarmDay) => number | null,
): Trend {
  const endIndex = lastDataIndex(bundle, index);
  let startIndex = Math.max(0, endIndex - windowDays);
  while (startIndex < endIndex && !bundle.days[startIndex]) startIndex++;
  const end = endIndex >= 0 ? bundle.days[endIndex] : null;
  const start = startIndex >= 0 ? bundle.days[startIndex] : null;
  const to = end ? pick(end) : null;
  const from = start ? pick(start) : null;
  const change = to != null && from != null ? to - from : null;
  return {
    from,
    to,
    change,
    changePct: change != null && from != null && Math.abs(from) > 1e-9 ? (change / Math.abs(from)) * 100 : null,
    days: Math.max(0, endIndex - startIndex),
  };
}

/** Mean of a farm value over the `windowDays` days ending at `index`. */
export function windowMean(bundle: FarmBundle, index: number, windowDays: number, pick: (day: FarmDay) => number | null) {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, index - windowDays + 1); i <= index; i++) {
    const d = bundle.days[i];
    const v = d ? pick(d) : null;
    if (v != null && Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function compassDirection(bearingDeg: number): string {
  const i = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i];
}

/** Where a probe sits in the field, e.g. "north-east" or "centre". */
export function probeLocation(bundle: FarmBundle, sensorId: string): string {
  const sensor = bundle.sensors.find((s) => s.id === sensorId);
  if (!sensor) return "field";
  const [cLng, cLat] = polygonCentroid(bundle.farm.polygon);
  const proj = localProjector(cLat, cLng);
  const distances = bundle.sensors.map((s) => Math.hypot(...proj.toXY(s.lng, s.lat)));
  const maxDistance = Math.max(...distances, 1);
  const [x, y] = proj.toXY(sensor.lng, sensor.lat);
  if (Math.hypot(x, y) < 0.3 * maxDistance) return "centre";
  return compassDirection((Math.atan2(x, y) * 180) / Math.PI);
}

export interface ProbeExtreme {
  sensor: SensorDay;
  value: number;
  location: string;
}

export function extremeProbe(
  bundle: FarmBundle,
  day: FarmDay,
  pick: (sensor: SensorDay) => number | null,
  mode: "max" | "min",
): ProbeExtreme | null {
  let best: { sensor: SensorDay; value: number } | null = null;
  for (const sensor of day.sensors) {
    const value = pick(sensor);
    if (value == null || !Number.isFinite(value)) continue;
    if (!best || (mode === "max" ? value > best.value : value < best.value)) best = { sensor, value };
  }
  return best ? { ...best, location: probeLocation(bundle, best.sensor.id) } : null;
}

export interface CropOption {
  crop: CropId;
  name: string;
  /** Relative yield at the current ECe, % (Maas–Hoffman, FAO-29 Table 4 / FAO-61 Table A1.1). */
  relativeYield: number;
  market: MarketStatus;
  score: number;
}

/**
 * Rank candidate crops for a farm by salt tolerance at the current ECe, nudged by the Qatar
 * market signal. The nudge is a product heuristic, not an agronomic coefficient.
 */
export function rankCrops(currentCrop: CropId, ece: number): CropOption[] {
  const MARKET_NUDGE: Record<MarketStatus, number> = { undersupplied: 8, "no-signal": 0, oversupplied: -8 };
  const candidates = currentCrop === "alfalfa" ? (["alfalfa"] as CropId[]) : VEGETABLE_CROPS;
  return candidates
    .map((crop) => {
      const c = CROPS[crop];
      const relativeYield = relativeYield_pct(ece, c.salinity.threshold_dS_per_m, c.salinity.slope_pct_per_dS_per_m);
      return { crop, name: c.name, relativeYield, market: c.market.status, score: relativeYield + MARKET_NUDGE[c.market.status] };
    })
    .sort((a, b) => b.score - a.score);
}

export function fmt(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function signedPct(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(decimals)}%`;
}

export function cropName(crop: CropId): string {
  return CROPS[crop].name;
}

/** "tomato" style lower-case crop name for use mid-sentence. */
export function cropNoun(crop: CropId): string {
  return CROPS[crop].name.toLowerCase();
}

/**
 * Is this a good hour to spray? Indicative rules from extension guidance on spray drift and droplet
 * evaporation (e.g. GRDC "Spray application manual", Delta-T guidance):
 * - wind 3–15 km/h (≈ 0.8–4.2 m/s) is ideal; calm air risks a surface inversion, strong wind drifts;
 * - Delta-T (air minus wet-bulb temperature) 2–8 °C is ideal, 8–10 °C marginal, above 10 °C droplets
 *   evaporate before they land; below 2 °C fine droplets hang in the air;
 * - no rain in the hour (wash-off), and not in extreme heat.
 * In a Qatar summer the afternoon Delta-T is often 15–20 °C, so the good windows are night and dawn.
 */
import { wetBulb, type PointHour } from "./field";

export type SprayTone = "good" | "fair" | "poor";

export interface SprayRating {
  tone: SprayTone;
  label: string;
  reason: string;
}

export const SPRAY_TONE_CLASS: Record<SprayTone, string> = {
  good: "bg-risk-low-soft text-risk-low-ink",
  fair: "bg-risk-medium-soft text-risk-medium-ink",
  poor: "bg-risk-high-soft text-risk-high-ink",
};

const r0 = (v: number) => Math.round(v).toString();

export function sprayRating(h: { wind: number; gust: number; precip: number; precipProb: number; temp: number; deltaT: number }): SprayRating {
  if (![h.wind, h.temp, h.deltaT].every(Number.isFinite)) return { tone: "fair", label: "Unknown", reason: "Not enough forecast data" };
  if (h.precip >= 0.1 || h.precipProb >= 50) return { tone: "poor", label: "Poor", reason: "Rain likely: it would wash off" };
  if (h.wind > 5.5 || h.gust > 8) return { tone: "poor", label: "Poor", reason: `Wind ${h.wind.toFixed(1)} m/s, gusts ${r0(h.gust)}: drift` };
  if (h.deltaT > 10) return { tone: "poor", label: "Poor", reason: `Delta-T ${r0(h.deltaT)} °C: droplets evaporate` };
  if (h.temp > 35) return { tone: "poor", label: "Poor", reason: `${r0(h.temp)} °C: too hot` };
  if (h.wind < 0.8) return { tone: "fair", label: "Marginal", reason: "Calm air: inversion drift risk" };
  if (h.wind > 4.2) return { tone: "fair", label: "Marginal", reason: `Breezy, ${h.wind.toFixed(1)} m/s` };
  if (h.deltaT > 8) return { tone: "fair", label: "Marginal", reason: `Delta-T ${r0(h.deltaT)} °C: use coarse droplets` };
  if (h.deltaT < 2) return { tone: "fair", label: "Marginal", reason: `Delta-T ${h.deltaT.toFixed(1)} °C: fine droplets hang` };
  if (h.temp > 30) return { tone: "fair", label: "Marginal", reason: `${r0(h.temp)} °C: hot` };
  if (h.precipProb >= 30) return { tone: "fair", label: "Marginal", reason: `${r0(h.precipProb)}% chance of rain` };
  return { tone: "good", label: "Good", reason: `Wind ${h.wind.toFixed(1)} m/s, Delta-T ${r0(h.deltaT)} °C` };
}

export function sprayForHour(h: PointHour): SprayRating {
  return sprayRating({ wind: h.wind, gust: h.gust, precip: h.precip, precipProb: h.precipProb, temp: h.temp, deltaT: h.temp - wetBulb(h.temp, h.rh) });
}

/** Runs of consecutive good hours (start and end index, inclusive), longest first. */
export function goodWindows(hours: PointHour[], minHours = 2): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  let start = -1;
  hours.forEach((h, i) => {
    const good = sprayForHour(h).tone === "good";
    if (good && start < 0) start = i;
    if ((!good || i === hours.length - 1) && start >= 0) {
      const end = good ? i : i - 1;
      if (end - start + 1 >= minHours) out.push({ from: start, to: end });
      start = -1;
    }
  });
  return out.sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from);
}

/**
 * Small, display-ready fields the builders add to each answer so the website can place them without
 * any interpretation: when a warning applies, and one headline per forecast day. The wording follows
 * the app's own report (lib/ai/report.ts) so both read the same on the page.
 */
import type { ForecastDay } from "./schema";

/**
 * "Thu 25 Sep", "Thu 25 – Sat 27 Sep" (a run of days), "Thu 25 Sep and Sat 27 Sep", or "This week".
 * `days` are labels from `all` (the seven forecast labels, in order); only their text is reused.
 */
export function whenDays(days: string[], all: string[]): string {
  const idx = [...new Set(days)].map((d) => all.indexOf(d)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (idx.length === 0) return "This week";
  if (idx.length === 1) return all[idx[0]];
  const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (consecutive) {
    const first = all[idx[0]];
    const last = all[idx[idx.length - 1]];
    const month = (l: string) => l.split(" ")[2];
    return `${month(first) === month(last) ? first.split(" ").slice(0, 2).join(" ") : first} – ${last}`;
  }
  if (idx.length === 2) return `${all[idx[0]]} and ${all[idx[1]]}`;
  return "This week";
}

export interface DayFacts {
  date: string;
  tmax: number;
  rain: number;
  irrigate_mm?: number | null;
  extremeHeat?: boolean;
  heat?: boolean;
  strongWind?: boolean;
  windy?: boolean;
  humid?: boolean;
}

/** One forecast chip: a short headline and a level the page colours (ok / watch / warning). */
export function forecastDay(d: DayFacts): ForecastDay {
  const parts: string[] = [];
  let level: ForecastDay["level"] = "ok";
  if (d.irrigate_mm) parts.push(`irrigate ${d.irrigate_mm} mm`);
  if (d.extremeHeat) {
    parts.push(`extreme heat ${d.tmax} °C`);
    level = "warning";
  } else if (d.heat) {
    parts.push(`hot ${d.tmax} °C`);
    level = "watch";
  }
  if (d.strongWind) {
    parts.push("strong wind, secure covers");
    level = "warning";
  } else if (d.windy) {
    parts.push("windy, don't spray");
    if (level === "ok") level = "watch";
  }
  if (d.humid) {
    parts.push("humid night");
    if (level === "ok") level = "watch";
  }
  if (d.rain >= 1) parts.push(`rain ${d.rain} mm`);
  if (parts.length === 0) parts.push(`${d.tmax} °C, no alerts`);
  const label = parts.join(", ");
  return { date: d.date, label: label.charAt(0).toUpperCase() + label.slice(1), level };
}

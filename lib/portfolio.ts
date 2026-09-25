/**
 * The portfolio view (Home): every farm as one row, the counts behind the summary chips, a one-line
 * headline in plain words and the week's irrigation schedule. Client-safe and pure.
 */
import { CROPS } from "./agronomy-tables";
import { lastDataIndex } from "./ai/analysis";
import type { RiskLevel } from "./ai/contract";
import { irrigationPlan, riskReason, sortedActions, type IrrigationPlan, type RiskReason } from "./dashboard";
import type { FarmBundle, RiskPoint } from "./types";

export interface FarmRow {
  id: string;
  name: string;
  crop: string;
  riskLevel: RiskLevel | null;
  riskScore: number | null;
  reason: RiskReason;
  /** Farm-mean salinity (ECe, dS/m) and whether it is past the crop's limit. */
  ece: number | null;
  overLimit: boolean;
  moisture: number | null;
  yieldLoss: number | null;
  irrigation: IrrigationPlan;
  history: RiskPoint[];
  doFirst: number;
}

/** One farm as a portfolio row, on its latest day with readings. */
export function farmRow(bundle: FarmBundle, dates: string[]): FarmRow {
  const i = lastDataIndex(bundle);
  const day = i >= 0 ? (bundle.days[i] ?? null) : null;
  const crop = CROPS[bundle.farm.main_crop];
  const actions = sortedActions(bundle.insight);
  return {
    id: bundle.farm.id,
    name: bundle.farm.name,
    crop: crop.name,
    riskLevel: bundle.insight?.risk_level ?? null,
    riskScore: bundle.insight ? Math.round(bundle.insight.risk_score) : null,
    reason: riskReason(bundle),
    ece: day?.ece ?? null,
    overLimit: day?.ece != null && day.ece > crop.salinity.threshold_dS_per_m,
    moisture: day?.moisture ?? null,
    yieldLoss: day?.yieldLoss ?? null,
    irrigation: irrigationPlan(day, dates, i >= 0 ? i : dates.length - 1),
    history: bundle.riskHistory,
    doFirst: actions.filter((a) => a.priority === "high").length,
  };
}

export interface PortfolioSummary {
  total: number;
  /** High risk. */
  attention: number;
  /** Medium risk. */
  watch: number;
  /** Low risk, or no assessment yet. */
  healthy: number;
  /** Farms due for water now or later today. */
  irrigateToday: number;
  doFirst: number;
}

export function portfolioSummary(rows: FarmRow[]): PortfolioSummary {
  return {
    total: rows.length,
    attention: rows.filter((r) => r.riskLevel === "high").length,
    watch: rows.filter((r) => r.riskLevel === "medium").length,
    healthy: rows.filter((r) => r.riskLevel !== "high" && r.riskLevel !== "medium").length,
    irrigateToday: rows.filter((r) => r.irrigation.when === "Now" || r.irrigation.when === "Today").length,
    doFirst: rows.reduce((n, r) => n + r.doFirst, 0),
  };
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What the high-risk farms have in common, in one clause per reason. */
function reasonClause(label: string, names: string[]): string {
  const many = names.length > 1;
  switch (label) {
    case "Salt rising":
      return `salt is rising at ${listNames(names)}`;
    case "Salty soil":
      return `the soil is salty at ${listNames(names)}`;
    case "Drying out":
      return `${listNames(names)} ${many ? "are" : "is"} drying out`;
    case "Near salt limit":
      return `${listNames(names)} ${many ? "are" : "is"} near the salt limit`;
    case "Irrigate soon":
      return `${listNames(names)} ${many ? "need" : "needs"} water soon`;
    default:
      return `${listNames(names)} ${many ? "need" : "needs"} a look`;
  }
}

/**
 * One sentence for the top of Home: which farms need you and why. The counts sit in the chips
 * beside it, so a sentence about high-risk farms starts straight with the reasons.
 */
export function portfolioHeadline(rows: FarmRow[]): string {
  if (rows.length === 0) return "No farms yet.";
  const high = rows.filter((r) => r.riskLevel === "high");
  if (high.length === 0) {
    const watch = rows.filter((r) => r.riskLevel === "medium");
    if (watch.length === 0) return `All ${rows.length === 1 ? "your farms are" : `${rows.length} farms are`} in range. Keep the current schedules.`;
    return `No farm is at high risk. Keep an eye on ${listNames(watch.map((r) => r.name))}: ${watch
      .map((r) => r.reason.label.toLowerCase())
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(", ")}.`;
  }
  const byReason = new Map<string, string[]>();
  for (const r of high) byReason.set(r.reason.label, [...(byReason.get(r.reason.label) ?? []), r.name]);
  const clauses = [...byReason.entries()].map(([label, names]) => reasonClause(label, names));
  const text = clauses.length > 1 ? `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}` : clauses[0];
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

/** "Good morning" / "Good afternoon" / "Good evening", by the hour in Qatar. */
export function greetingFor(iso: string): string {
  const hour = new Date(Date.parse(iso) + 3 * 3_600_000).getUTCHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

export interface IrrigationGroup {
  /** "Now", "Today", "Tomorrow" or a weekday. */
  when: string;
  status: IrrigationPlan["status"];
  rows: FarmRow[];
}

/** Farms by when they next need water, soonest first (farms without a plan are left out). */
export function irrigationSchedule(rows: FarmRow[]): IrrigationGroup[] {
  const planned = rows.filter((r) => r.irrigation.inDays != null).sort((a, b) => a.irrigation.inDays! - b.irrigation.inDays!);
  const groups: IrrigationGroup[] = [];
  for (const r of planned) {
    const last = groups[groups.length - 1];
    if (last && last.when === r.irrigation.when) last.rows.push(r);
    else groups.push({ when: r.irrigation.when, status: r.irrigation.status, rows: [r] });
  }
  return groups;
}

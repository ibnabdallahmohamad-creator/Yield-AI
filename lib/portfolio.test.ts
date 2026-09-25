import { describe, expect, it } from "vitest";
import type { IrrigationPlan } from "./dashboard";
import { greetingFor, irrigationSchedule, listNames, portfolioHeadline, portfolioSummary, type FarmRow } from "./portfolio";

function plan(when: string, inDays: number | null): IrrigationPlan {
  return {
    status: inDays == null ? "unknown" : inDays <= 0.05 ? "now" : inDays < 1 ? "soon" : "later",
    when,
    inDays,
    grossMm: inDays == null ? null : 20,
    netMm: inDays == null ? null : 16,
    leachMm: inDays == null ? null : 4,
    sentence: "",
  };
}

function row(name: string, riskLevel: FarmRow["riskLevel"], reason: string, when = "Sun", inDays: number | null = 3, doFirst = 0): FarmRow {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    crop: "Tomato",
    riskLevel,
    riskScore: riskLevel === "high" ? 90 : riskLevel === "medium" ? 50 : 20,
    reason: { label: reason, tone: riskLevel === "high" ? "bad" : riskLevel === "medium" ? "warn" : "ok", driver: "none" },
    ece: 3,
    overLimit: false,
    moisture: 12,
    yieldLoss: 0,
    irrigation: plan(when, inDays),
    history: [],
    doFirst,
  };
}

describe("portfolio", () => {
  it("lists names in plain English", () => {
    expect(listNames(["A"])).toBe("A");
    expect(listNames(["A", "B"])).toBe("A and B");
    expect(listNames(["A", "B", "C"])).toBe("A, B and C");
  });

  it("says which farms need attention and why, grouped by reason", () => {
    const rows = [
      row("Shamal", "high", "Salt rising"),
      row("West", "high", "Drying out"),
      row("Khor", "high", "Salt rising"),
      row("Pivot", "low", "Healthy"),
    ];
    expect(portfolioHeadline(rows)).toBe("Salt is rising at Shamal and Khor, and West is drying out.");
  });

  it("stays calm when nothing is at high risk", () => {
    expect(portfolioHeadline([row("A", "low", "Healthy"), row("B", "low", "Healthy")])).toBe("All 2 farms are in range. Keep the current schedules.");
    expect(portfolioHeadline([row("A", "medium", "Near salt limit"), row("B", "low", "Healthy")])).toBe("No farm is at high risk. Keep an eye on A: near salt limit.");
    expect(portfolioHeadline([])).toBe("No farms yet.");
  });

  it("counts farms by risk, farms to water today and do-first actions", () => {
    const rows = [row("A", "high", "Drying out", "Today", 0.5, 2), row("B", "medium", "Near salt limit", "Now", 0, 1), row("C", null, "No readings", "—", null)];
    expect(portfolioSummary(rows)).toEqual({ total: 3, attention: 1, watch: 1, healthy: 1, irrigateToday: 2, doFirst: 3 });
  });

  it("groups the irrigation schedule by day, soonest first", () => {
    const rows = [row("Later", "low", "Healthy", "Sun", 3), row("Now", "high", "Drying out", "Now", 0), row("Also Sun", "low", "Healthy", "Sun", 3.2), row("None", null, "No readings", "—", null)];
    const groups = irrigationSchedule(rows);
    expect(groups.map((g) => [g.when, g.rows.map((r) => r.name)])).toEqual([
      ["Now", ["Now"]],
      ["Sun", ["Later", "Also Sun"]],
    ]);
  });

  it("greets by the hour in Qatar (UTC+3)", () => {
    expect(greetingFor("2026-09-25T04:30:00Z")).toBe("Good morning"); // 07:30
    expect(greetingFor("2026-09-25T11:00:00Z")).toBe("Good afternoon"); // 14:00
    expect(greetingFor("2026-09-25T17:00:00Z")).toBe("Good evening"); // 20:00
  });
});

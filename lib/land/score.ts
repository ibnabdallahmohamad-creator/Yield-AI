/**
 * Transparent ranking of land uses for one site in Qatar. Six factors, each 0–1:
 *
 * | Factor | Weight | From                                                                   |
 * | water  | 30%    | FAO-29 salt tolerance at ECe ≈ 1.5 × ECw, or FAO-29 Table 30 for animals |
 * | goal   | 20%    | Gap to the National Food Security Strategy 2030 target                 |
 * | market | 15%    | Qatar supply baseline for the product                                  |
 * | budget | 15%    | Relative capital cost against the stated budget                        |
 * | policy | 10%    | Groundwater over-pumping and the TSE-for-fodder policy                 |
 * | site   | 10%    | Coast distance, humidity, heat and dust at the site                    |
 *
 * A hard limit (water too salty, a water source the use can't run on) caps the score at 15.
 * The weights are a product heuristic for comparing options, not a published index.
 */
import { leachingRequirement_fraction, relativeYield_pct } from "../agronomy";
import { NATIONAL_GOALS, WATER_POLICY, goalFor } from "../qatar/food-security";
import type { QatarLocation } from "../qatar/location";
import type { SiteClimate } from "./climate";
import type { Factor, FactorKey, GoalRow, RankedOption, WaterAssessment } from "./contract";
import { LAND_USE_OPTIONS, TYPICAL_WATER_EC, WATER_SOURCE_LABEL, type Level, type LandUseOption, type WaterSource } from "./options";

export const WEIGHTS: Record<FactorKey, number> = { water: 0.3, goal: 0.2, market: 0.15, budget: 0.15, policy: 0.1, site: 0.1 };
const BLOCKED_CAP = 15;
const LEVEL_RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };
/** Groundwater use per hectare above which the policy factor drops (m³/ha/yr). */
const HEAVY_WATER_M3_HA = 15_000;
const MODERATE_WATER_M3_HA = 8_000;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const thousands = (v: number) => Math.round(v).toLocaleString("en-US");

export interface SiteInput {
  location: QatarLocation;
  climate: SiteClimate;
  water: WaterAssessment;
  area_ha: number;
  budget: Level;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

/** FAO-29 Table 1: degree of restriction on use by irrigation water salinity. */
function waterClass(ecw: number): { label: string; note: string } {
  if (ecw < 0.7) return { label: "No restriction", note: "Fresh enough for every crop, including lettuce and strawberries." };
  if (ecw <= 3) return { label: "Slight to moderate restriction", note: "Fine for tolerant crops; sensitive crops need a leaching fraction or blending." };
  return { label: "Severe restriction", note: "Only salt-tolerant crops (date palm, forage barley) or brackish-water fish; vegetables need desalinated water." };
}

export function assessWater(source: WaterSource, measured: number | null | undefined, location: QatarLocation, farmEc: number | null): WaterAssessment {
  let ec: number;
  let origin: WaterAssessment["ec_origin"];
  if (measured != null) {
    ec = measured;
    origin = "measured";
  } else if (source === "groundwater" && farmEc != null) {
    ec = farmEc;
    origin = "farm";
  } else if (source === "groundwater") {
    const { low, high } = location.typical_groundwater_ec_dS_m;
    ec = r1((low + high) / 2);
    origin = "basin typical";
  } else {
    ec = TYPICAL_WATER_EC[source];
    origin = "source typical";
  }
  const cls = waterClass(ec);
  const range = location.typical_groundwater_ec_dS_m;
  const note =
    origin === "basin typical"
      ? `No measured EC, so this uses the middle of the ${location.groundwater_basin} basin range (${r1(range.low)}–${r1(range.high)} dS/m). Test the well: it changes the ranking. ${cls.note}`
      : origin === "source typical"
        ? `Typical for ${WATER_SOURCE_LABEL[source].toLowerCase()}; enter a measured EC if you have one. ${cls.note}`
        : cls.note;
  return { source, ec_dS_m: r1(ec), ec_origin: origin, ece_expected_dS_m: r1(1.5 * ec), class: cls.label, note };
}

/**
 * Irrigation (or pond evaporation) per hectare per year at this site, m³: monthly ET₀ × Kc over the
 * months the crop is grown, grossed up for the FAO-29 leaching requirement at 90% yield.
 */
export function waterNeed_m3_ha(option: LandUseOption, climate: SiteClimate, ecw: number): number | null {
  const w = option.water;
  if (w.kind === "livestock") return null;
  if (w.kind === "aquaculture") return Math.round(climate.et0_annual_mm * 1.05 * 10); // open-water Kc ≈ 1.05 (FAO-56)
  const net = w.months.reduce((sum, m) => sum + climate.et0_monthly_mm[m - 1], 0) * w.kc * (w.indoorFactor ?? 1);
  const eceTarget = w.threshold_dS_m + 10 / w.slope_pct_per_dS_m; // ECe at 90% yield
  const lr = Math.min(0.5, leachingRequirement_fraction(ecw, eceTarget));
  return Math.round((net / (1 - lr)) * 10);
}

/** FAO-29 Table 30: salinity limits for livestock and poultry drinking water. */
function livestockWater(ecw: number, poultry: boolean): { score: number; label: string; blocked: string | null } {
  if (ecw < 1.5) return { score: 1, label: `Drinking water: excellent (ECw ${ecw} dS/m, FAO-29)`, blocked: null };
  if (ecw < 5) return { score: poultry ? 0.7 : 0.95, label: `Drinking water: very satisfactory (ECw ${ecw} dS/m, FAO-29)${poultry ? "; may cause watery droppings" : ""}`, blocked: null };
  if (poultry) return { score: 0, label: `ECw ${ecw} dS/m is unfit for poultry (FAO-29)`, blocked: `Water at ${ecw} dS/m is unfit for poultry; use desalinated or RO water.` };
  if (ecw < 8) return { score: 0.8, label: `Drinking water: satisfactory for sheep and goats (ECw ${ecw} dS/m, FAO-29)`, blocked: null };
  if (ecw < 11) return { score: 0.5, label: `Limited use: ECw ${ecw} dS/m stresses pregnant and young animals`, blocked: null };
  if (ecw < 16) return { score: 0.2, label: `Very limited use (ECw ${ecw} dS/m)`, blocked: null };
  return { score: 0, label: `ECw ${ecw} dS/m is not recommended for livestock`, blocked: `Water at ${ecw} dS/m is too salty for livestock to drink.` };
}

function waterFactor(option: LandUseOption, water: WaterAssessment): { factor: Factor; blocked: string | null } {
  const ecw = water.ec_dS_m;
  if (!option.sources.includes(water.source)) {
    const blocked =
      option.id === "fodder-tse"
        ? water.source === "groundwater"
          ? "Qatar is moving all fodder to TSE by 2030; new fodder on groundwater isn't advised."
          : "Desalinated water is far too costly to grow fodder."
        : water.source === "tse"
          ? option.category === "aquaculture"
            ? "TSE isn't used to farm fish in Qatar."
            : "TSE isn't used on vegetables in Qatar; it's for fodder, trees and landscaping."
          : `${option.name} can't run on ${WATER_SOURCE_LABEL[water.source].toLowerCase()}.`;
    return { factor: { score: 0, label: blocked }, blocked };
  }
  const w = option.water;
  if (w.kind === "livestock") {
    if (water.source === "tse") {
      return {
        factor: { score: w.poultry ? 0.6 : 0.8, label: `TSE can grow ${w.poultry ? "shade trees" : "the fodder"}; drinking water must come from the network or a fresh well` },
        blocked: null,
      };
    }
    const l = livestockWater(ecw, w.poultry);
    return { factor: { score: l.score, label: l.label }, blocked: l.blocked };
  }
  if (w.kind === "aquaculture") {
    if (water.source === "desalinated") return { factor: { score: 0.55, label: "Desalinated water is costly for ponds; fine for a recirculating system" }, blocked: null };
    return ecw <= 25
      ? { factor: { score: 0.9, label: `Brackish well water (ECw ${ecw} dS/m) suits tilapia` }, blocked: null }
      : { factor: { score: 0.65, label: `ECw ${ecw} dS/m is close to seawater: marine species only` }, blocked: null };
  }
  if (w.reverseOsmosis) {
    if (water.source === "desalinated" || ecw <= 1) return { factor: { score: 1, label: `ECw ${ecw} dS/m is fresh enough for the nutrient solution` }, blocked: null };
    if (ecw > 15) return { factor: { score: 0, label: `ECw ${ecw} dS/m is too salty to treat economically` }, blocked: `Water at ${ecw} dS/m is too salty to treat with RO at farm scale.` };
    return { factor: { score: 0.6, label: `Needs RO treatment: ${w.crop} loses yield above ECe ${w.threshold_dS_m} dS/m and the well is ECw ${ecw}` }, blocked: null };
  }
  const ry = relativeYield_pct(water.ece_expected_dS_m, w.threshold_dS_m, w.slope_pct_per_dS_m);
  const label = `${Math.round(ry)}% of full ${w.crop} yield at ECw ${ecw} dS/m (ECe ≈ ${water.ece_expected_dS_m}, FAO-29)`;
  if (ry < 50) {
    return { factor: { score: 0, label }, blocked: `Too salty: ${w.crop} would give under half its yield at ECw ${ecw} dS/m.` };
  }
  return { factor: { score: clamp01((ry - 50) / 40), label }, blocked: null };
}

// ---------------------------------------------------------------------------
// Other factors
// ---------------------------------------------------------------------------

function goalFactor(option: LandUseOption): Factor {
  if (!option.goal) return { score: 0.3, label: "No national target" };
  const g = goalFor(option.goal);
  if (g.target_pct == null) {
    return option.goal === "green-fodder"
      ? { score: 0.45, label: `${g.label}: ${g.current_pct}% self-sufficient (${g.current_year}); TSE fodder is policy` }
      : { score: 0.15, label: `${g.label}: already ${g.current_pct}% self-sufficient (${g.current_year}), no 2030 target` };
  }
  const gap = Math.max(0, g.target_pct - g.current_pct);
  // Square root: a big gap matters more, but a small gap still counts.
  return { score: clamp01(Math.sqrt(gap / 45)), label: `${g.label}: ${g.current_pct}% (${g.current_year}) → ${g.target_pct}% by 2030` };
}

const MARKET_SCORE = { strong: 1, steady: 0.65, saturated: 0.3 } as const;

function budgetFactor(option: LandUseOption, budget: Level): Factor {
  const over = LEVEL_RANK[option.capex] - LEVEL_RANK[budget];
  if (over <= 0) return { score: 1, label: `Fits a ${budget} budget (${option.capex} set-up cost)` };
  return { score: over === 1 ? 0.45 : 0.1, label: `Needs a ${option.capex} budget: ${option.capexNote.toLowerCase()}` };
}

function policyFactor(option: LandUseOption, water: WaterAssessment, need: number | null): Factor {
  if (option.id === "fodder-tse" && water.source === "tse") return { score: 1, label: "Matches the policy to grow fodder on TSE" };
  if (need == null) return { score: 0.9, label: "Low water use (drinking and cooling)" };
  const perHa = `${thousands(need)} m³/ha a year`;
  if (water.source === "groundwater") {
    const overdraft = `Qatar pumps about ${WATER_POLICY.groundwaterAbstraction_Mm3_per_yr} Mm³ of groundwater a year against a safe yield of ${WATER_POLICY.groundwaterSafeYield_Mm3_per_yr}`;
    if (need > HEAVY_WATER_M3_HA) return { score: 0.3, label: `Uses about ${perHa} of groundwater. ${overdraft}.` };
    if (need > MODERATE_WATER_M3_HA) return { score: 0.65, label: `Uses about ${perHa} of groundwater` };
    return { score: 1, label: `Modest water use: about ${perHa}` };
  }
  if (water.source === "desalinated" && need > MODERATE_WATER_M3_HA) return { score: 0.55, label: `About ${perHa} of desalinated water is costly` };
  return { score: 0.9, label: `About ${perHa}` };
}

function siteFactor(option: LandUseOption, location: QatarLocation, climate: SiteClimate): Factor {
  const coastal = location.coast_band === "coastal";
  const nearCoast = location.coast_band === "near-coast";
  const hot = climate.days_above_45c > 10;
  switch (option.id) {
    case "greenhouse-veg":
      if (coastal || climate.summer_humidity_mean_pct > 60) return { score: 0.6, label: "Humid coastal air weakens pad-and-fan cooling in summer" };
      if (nearCoast) return { score: 0.8, label: `${location.distance_to_coast_km.toFixed(0)} km from the sea: humid summer nights raise cooling needs` };
      return { score: 1, label: "Inland, drier air: evaporative cooling works well" };
    case "hydroponic-leafy":
      return { score: 0.9, label: "Indoors, so the site's climate matters little beyond cooling cost" };
    case "openfield-winter-veg":
      return climate.dust_wind_days > 30
        ? { score: 0.65, label: `${climate.dust_wind_days} dusty, windy days a year: plan windbreaks` }
        : { score: 0.9, label: `Mild winters (mean low ${climate.winter_tmin_mean_c} °C) suit a Oct–Apr season` };
    case "date-palms":
      return coastal
        ? { score: 0.75, label: "Humid coastal air can spoil fruit as it ripens" }
        : { score: 1, label: `Summer highs around ${Math.round(climate.summer_tmax_mean_c)} °C ripen dates well` };
    case "fodder-tse":
      return { score: 0.8, label: `High water demand: ET₀ ${thousands(climate.et0_annual_mm)} mm a year here` };
    case "table-eggs":
    case "sheep-goats":
      return hot
        ? { score: 0.65, label: `${climate.days_above_45c} days above 45 °C last year: heat stress and cooling cost` }
        : { score: 0.85, label: `Hottest day last year ${Math.round(climate.hottest_c)} °C: shade and cooling needed in summer` };
    case "aquaculture":
      if (coastal) return { score: 1, label: `${location.distance_to_coast_km.toFixed(1)} km from the sea: seawater within reach` };
      if (nearCoast) return { score: 0.8, label: `${location.distance_to_coast_km.toFixed(0)} km from the sea` };
      return { score: 0.6, label: "Inland: brackish-well ponds or a recirculating system only" };
  }
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export function fitOf(score: number): RankedOption["fit"] {
  return score >= 70 ? "strong" : score >= 50 ? "possible" : "poor";
}

export function scoreOption(option: LandUseOption, input: SiteInput): RankedOption {
  const need = waterNeed_m3_ha(option, input.climate, input.water.ec_dS_m);
  const { factor: water, blocked } = waterFactor(option, input.water);
  const factors: Record<FactorKey, Factor> = {
    water,
    goal: goalFactor(option),
    market: { score: MARKET_SCORE[option.market], label: option.marketNote },
    budget: budgetFactor(option, input.budget),
    policy: policyFactor(option, input.water, need),
    site: siteFactor(option, input.location, input.climate),
  };
  let total = (Object.keys(WEIGHTS) as FactorKey[]).reduce((sum, k) => sum + WEIGHTS[k] * factors[k].score, 0) * 100;
  const small = input.area_ha < option.minAreaHa;
  if (small) total *= 0.8;
  if (blocked) total = Math.min(total, BLOCKED_CAP);
  const score = Math.round(total);

  // Why: the strongest factors; risks: the option's own plus the weakest factors.
  const sorted = (Object.keys(factors) as FactorKey[]).sort((a, b) => factors[b].score * WEIGHTS[b] - factors[a].score * WEIGHTS[a]);
  const why = sorted.filter((k) => factors[k].score >= 0.7).slice(0, 3).map((k) => factors[k].label);
  const weak = sorted.filter((k) => factors[k].score < 0.5 && k !== "market").map((k) => factors[k].label);
  const risks = [...(blocked ? [blocked] : []), ...weak.filter((l) => l !== blocked), ...option.risks];
  if (small) risks.push(`${input.area_ha} ha is small for this; it usually starts at ${option.minAreaHa} ha.`);

  return {
    id: option.id,
    name: option.name,
    category: option.category,
    summary: option.summary,
    score,
    base_score: score,
    fit: blocked ? "poor" : fitOf(score),
    blocked,
    factors,
    water_m3_ha_yr: need,
    water_m3_yr: need != null ? Math.round(need * input.area_ha) : null,
    capex: option.capex,
    capex_note: option.capexNote,
    first_income: option.firstIncome,
    why,
    risks: risks.slice(0, 4),
    first_steps: option.firstSteps,
    research_note: null,
    research_delta: 0,
  };
}

export function rankOptions(input: SiteInput): RankedOption[] {
  return LAND_USE_OPTIONS.map((o) => scoreOption(o, input)).sort((a, b) => b.score - a.score);
}

/** Apply research score changes (clamped to ±10) and re-sort. Blocked options stay capped. */
export function applyAdjustments(options: RankedOption[], adjustments: Array<{ id: string; delta: number; note: string }>): RankedOption[] {
  const byId = new Map(adjustments.map((a) => [a.id, a]));
  return options
    .map((o) => {
      const a = byId.get(o.id);
      if (!a) return o;
      const delta = Math.max(-10, Math.min(10, Math.round(a.delta)));
      const raw = Math.max(0, Math.min(100, o.base_score + delta));
      const score = o.blocked ? Math.min(raw, BLOCKED_CAP) : raw;
      return { ...o, score, fit: o.blocked ? o.fit : fitOf(score), research_delta: delta, research_note: a.note };
    })
    .sort((a, b) => b.score - a.score);
}

export function goalRows(): GoalRow[] {
  return NATIONAL_GOALS.map((g) => ({
    product: g.product,
    label: g.label,
    current_pct: g.current_pct,
    current_year: g.current_year,
    target_pct: g.target_pct,
    note: g.note,
    gap_pct: g.target_pct != null ? Math.max(0, g.target_pct - g.current_pct) : null,
    source_url: g.sources[0]?.url ?? null,
  })).sort((a, b) => (b.gap_pct ?? -1) - (a.gap_pct ?? -1));
}

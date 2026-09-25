/**
 * Rule-based insights: what our fine-tuned model writes to `ai_insights`, reproduced with
 * transparent rules from a farm's own readings, so every farm has an assessment before the model
 * writes one (and the demo farms always do). Every number in the text comes from the
 * FAO-56 / FAO-29 engine.
 *
 * The risk score is a product heuristic (0–100) that blends salinity and water stress; it is
 * not a published index.
 */
import { CROPS, ECE_CLASSES, type MarketStatus } from "../agronomy-tables";
import { RULES_INSIGHT_PREFIX, type AiInsight, type Recommendation, type RiskLevel } from "../ai/contract";
import {
  cropNoun,
  dayAt,
  extremeProbe,
  fmt,
  lastDataIndex,
  rankCrops,
  signedPct,
  trend,
  type ProbeExtreme,
} from "../ai/analysis";
import type { DashboardData, FarmBundle, FarmDay } from "../types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Farm-mean yield loss (%) below which salinity is reported as "at the threshold" rather than costing yield. */
const MEANINGFUL_LOSS_PCT = 2;

function salinityLabel(id: FarmDay["salinityClass"]): string {
  return ECE_CLASSES.find((c) => c.id === id)?.label.toLowerCase() ?? "";
}

const isLossy = (day: FarmDay) => (day.yieldLoss ?? 0) >= MEANINGFUL_LOSS_PCT;
const isStressed = (day: FarmDay) => (day.deficitPct ?? 0) > 100;

export function riskLevelFor(score: number): RiskLevel {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

interface FarmFacts {
  bundle: FarmBundle;
  day: FarmDay;
  threshold: number;
  ece: number | null;
  ece30: ReturnType<typeof trend>;
  moisture30: ReturnType<typeof trend>;
  k30: ReturnType<typeof trend>;
  ph30: ReturnType<typeof trend>;
  saltiest: ProbeExtreme | null;
  driest: ProbeExtreme | null;
}

function gatherFacts(bundle: FarmBundle, index: number): FarmFacts | null {
  const day = dayAt(bundle, index);
  if (!day) return null;
  return {
    bundle,
    day,
    threshold: CROPS[bundle.farm.main_crop].salinity.threshold_dS_per_m,
    ece: day.ece,
    ece30: trend(bundle, index, 30, (d) => d.ece),
    moisture30: trend(bundle, index, 30, (d) => d.moisture),
    k30: trend(bundle, index, 30, (d) => d.k),
    ph30: trend(bundle, index, 30, (d) => d.ph),
    saltiest: extremeProbe(bundle, day, (s) => s.ece, "max"),
    driest: extremeProbe(bundle, day, (s) => s.deficitPct, "max"),
  };
}

/** Salinity and water-stress sub-scores (0–100) and the blended risk score. */
export function scoreRisk(f: FarmFacts): { salinity: number; water: number; score: number } {
  const { day, threshold, ece } = f;
  let salinity = 0;
  if (ece != null) {
    salinity = isLossy(day)
      ? 40 + 0.9 * (day.yieldLoss ?? 0) + 0.1 * Math.max(0, f.ece30.changePct ?? 0)
      : 45 * Math.pow(Math.min(ece / threshold, 1), 2);
  }
  let water = 0;
  if (day.deficitPct != null) {
    water = isStressed(day)
      ? 35 + 0.12 * (day.deficitPct - 100) + 50 * (1 - (day.ks ?? 1))
      : 0.3 * day.deficitPct;
  }
  let extra = 0;
  if (day.ph != null && day.ph > 8.0) extra += 3;
  if ((f.k30.changePct ?? 0) < -10) extra += 3;
  const hi = Math.max(salinity, water);
  const lo = Math.min(salinity, water);
  const score = Math.round(clamp(hi + 0.1 * lo + extra, 5, 98));
  return { salinity, water, score };
}

function salinitySentence(f: FarmFacts): string | null {
  const { day, threshold, ece, bundle } = f;
  if (ece == null) return null;
  const crop = cropNoun(bundle.farm.main_crop);
  const cls = salinityLabel(day.salinityClass);
  if (isLossy(day)) {
    const rise =
      f.ece30.from != null && f.ece30.days >= 3 && (f.ece30.changePct ?? 0) > 5
        ? `ECe rose from ${fmt(f.ece30.from)} to ${fmt(ece)} dS/m in ${f.ece30.days} days (${signedPct(f.ece30.changePct)})`
        : `ECe is ${fmt(ece)} dS/m`;
    return `${rise} — ${cls} and above the ${fmt(threshold)} dS/m ${crop} threshold, so the predicted yield loss is ${fmt(day.yieldLoss, 0)}%.`;
  }
  if (ece >= 0.85 * threshold) {
    return `Salinity (ECe ${fmt(ece, 2)} dS/m) is right at the ${fmt(threshold)} dS/m ${crop} threshold: no yield loss yet, but any further rise will start to cost yield.`;
  }
  return null;
}

function waterSentence(f: FarmFacts): string | null {
  const { day } = f;
  if (!isStressed(day)) return null;
  const fall =
    f.moisture30.from != null && f.moisture30.days >= 3 && (f.moisture30.changePct ?? 0) < -5
      ? ` Soil moisture fell from ${fmt(f.moisture30.from)}% to ${fmt(day.moisture)}% in ${f.moisture30.days} days.`
      : "";
  return `The root zone is depleted to ${fmt(day.deficitPct, 0)}% of readily available water (Ks ${fmt(day.ks, 2)}), so the ${cropNoun(f.bundle.farm.main_crop)} crop is water-stressed now.${fall}`;
}

function buildRecommendations(f: FarmFacts): Recommendation[] {
  const { day, bundle, threshold, ece } = f;
  const farm = bundle.farm;
  const recs: Recommendation[] = [];
  const lossy = isLossy(day);
  const stressed = isStressed(day);
  const lrPct = day.lr * 100;

  if (stressed) {
    recs.push({
      title: `Irrigate today: ${fmt(day.netDepth, 0)} mm net (${fmt(day.grossDepth, 0)} mm gross)`,
      detail: `Root-zone depletion is ${fmt(day.dr, 0)} mm against a readily available water of ${fmt(day.raw, 0)} mm; Ks ${fmt(day.ks, 2)} means crop transpiration is already down about ${fmt((1 - (day.ks ?? 1)) * 100, 0)}%. Refill the root zone to field capacity (FAO-56 Eq. 84–87).`,
      priority: "high",
    });
    if (f.driest && f.driest.location !== "centre") {
      recs.push({
        title: `Check the irrigation lines in the ${f.driest.location} block`,
        detail: `Probe ${f.driest.sensor.id} is the driest at ${fmt(f.driest.sensor.moisture)}% VWC (${fmt(f.driest.value, 0)}% of RAW depleted). A blocked lateral, a leak or low pressure is likely if other blocks stay wetter.`,
        priority: "high",
      });
    }
    if (day.etc != null && day.raw > 0) {
      recs.push({
        title: "Irrigate more often, in smaller doses",
        detail: `At ${fmt(day.etc)} mm/day crop water use, the ${fmt(day.raw, 0)} mm of readily available water in this ${farm.soil_type.replace("_", " ")} lasts about ${fmt(day.raw / day.etc, 1)} day(s). Split irrigation into two pulses a day during the hot months.`,
        priority: "medium",
      });
    }
  }

  if (lossy && ece != null) {
    recs.push({
      title: `Apply a leaching irrigation (+${fmt(lrPct, 0)}% water)`,
      detail: `Irrigate ${fmt(day.grossDepth, 0)} mm instead of ${fmt(day.netDepth, 0)} mm at the next cycle. With irrigation water at ECw ${fmt(farm.irrigation_water_ec)} dS/m, a leaching requirement of ${fmt(lrPct, 0)}% keeps root-zone ECe near ${fmt(day.eceTarget)} dS/m (FAO-29 Eq. 7, 90% yield target).`,
      priority: "high",
    });
    if (f.saltiest && f.saltiest.location !== "centre") {
      recs.push({
        title: `Inspect the ${f.saltiest.location} hotspot around ${f.saltiest.sensor.id}`,
        detail: `ECe there is ${fmt(f.saltiest.value)} dS/m against a farm mean of ${fmt(ece)} dS/m. Check emitters for clogging or poor uniformity, and take a lab saturated-paste sample to confirm the probe calibration.`,
        priority: "high",
      });
    }
    if (farm.irrigation_water_ec > 1.5) {
      recs.push({
        title: "Lower the salt load of the irrigation water",
        detail: `Irrigation water at ${fmt(farm.irrigation_water_ec)} dS/m is the main salt source. Blending it with desalinated or treated water reduces the leaching requirement and the salt added with every irrigation.`,
        priority: "medium",
      });
    }
  } else if (ece != null && ece >= 0.85 * threshold) {
    recs.push({
      title: "Hold salinity below the threshold",
      detail: `ECe ${fmt(ece, 2)} dS/m is at the ${fmt(threshold)} dS/m ${cropNoun(farm.main_crop)} threshold. Keep the leaching fraction at ${fmt(lrPct, 0)}% (${fmt(day.grossDepth, 0)} mm gross per irrigation) and re-check after the next irrigations.`,
      priority: "medium",
    });
  }

  if (!stressed && day.daysToIrrigation != null && day.netDepth != null) {
    const when =
      day.daysToIrrigation < 0.5 ? "today" : day.daysToIrrigation < 1.5 ? "in about a day" : `in about ${fmt(day.daysToIrrigation, 0)} days`;
    recs.push({
      title: `Next irrigation ${when}: ${fmt(day.grossDepth, 0)} mm`,
      detail: `Depletion is ${fmt(day.dr, 0)} of ${fmt(day.raw, 0)} mm readily available water at ${fmt(day.etc)} mm/day crop water use. Apply ${fmt(day.netDepth, 0)} mm net plus the ${fmt(lrPct, 0)}% leaching fraction.`,
      priority: day.daysToIrrigation < 1 ? "medium" : "low",
    });
  }

  if ((f.k30.changePct ?? 0) < -8 && f.k30.from != null && f.k30.days >= 3) {
    recs.push({
      title: "Top up potassium in the next fertigation",
      detail: `K fell from ${fmt(f.k30.from, 0)} to ${fmt(f.k30.to, 0)} mg/kg in ${f.k30.days} days. Adequate potassium also helps the crop cope with salt stress.`,
      priority: "medium",
    });
  }

  if (day.ph != null && day.ph > 8.0) {
    recs.push({
      title: `Watch alkalinity (pH ${fmt(day.ph, 2)})`,
      detail: `pH ${f.ph30.change != null && f.ph30.days >= 3 && f.ph30.change > 0.05 ? `rose ${fmt(f.ph30.change, 2)} units in ${f.ph30.days} days and ` : ""}is above 8.0, where phosphorus and micronutrients (Fe, Zn, Mn) become less available. Prefer acid-forming fertilisers such as ammonium sulphate.`,
      priority: "low",
    });
  }

  if (recs.length < 2) {
    recs.push({
      title: "Keep the current schedule",
      detail: `All ${day.sensors.length} probes are within range. Keep monitoring salinity and moisture after each irrigation.`,
      priority: "low",
    });
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  return recs.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 4);
}

function marketContrast(best: keyof typeof CROPS, current: keyof typeof CROPS): string {
  const b: MarketStatus = CROPS[best].market.status;
  const c: MarketStatus = CROPS[current].market.status;
  const bn = CROPS[best].name.toLowerCase();
  const cn = CROPS[current].name.toLowerCase();
  if (b === "undersupplied" && c === "oversupplied") return `, and Qatar is short of ${bn} while ${cn} is oversupplied`;
  if (b === "undersupplied") return `, and Qatar's market is short of ${bn}`;
  if (c === "oversupplied") return `, and unlike ${cn} it is not oversupplied in Qatar`;
  return "";
}

function buildCropSuggestion(f: FarmFacts): AiInsight["crop_suggestion"] {
  const farm = f.bundle.farm;
  const current = CROPS[farm.main_crop];
  if (f.ece == null) return null;
  const ranked = rankCrops(farm.main_crop, f.ece);
  const best = ranked[0];
  const currentOption = ranked.find((o) => o.crop === farm.main_crop);
  const keep = !currentOption || best.crop === farm.main_crop || best.score - currentOption.score < 3;
  const bestCrop = CROPS[best.crop];
  const tol = (crop: typeof current) =>
    `${crop.name.toLowerCase()} (${fmt(crop.salinity.threshold_dS_per_m)} dS/m threshold, ${crop.salinity.source.split(" (")[0]})`;

  if (keep) {
    const cur = currentOption ?? best;
    const why =
      (f.day.deficitPct ?? 0) > 100
        ? `The yield risk here is water, not the crop choice: salinity (${fmt(f.ece)} dS/m) keeps ${current.name.toLowerCase()} at ~${fmt(cur.relativeYield, 0)}% of its yield potential.`
        : `At ECe ${fmt(f.ece)} dS/m ${current.name.toLowerCase()} keeps ~${fmt(cur.relativeYield, 0)}% of its yield potential (${current.salinity.source.split(" (")[0]}).`;
    return {
      crop: current.name,
      reason: `Keep ${current.name.toLowerCase()}. ${why}`,
      market_note: current.market.note,
    };
  }
  const reason =
    best.relativeYield - (currentOption?.relativeYield ?? 0) > 5
      ? `At ECe ${fmt(f.ece)} dS/m, ${tol(bestCrop)} keeps ~${fmt(best.relativeYield, 0)}% of its yield potential, against ~${fmt(currentOption?.relativeYield, 0)}% for ${current.name.toLowerCase()}.`
      : `ECe ${fmt(f.ece)} dS/m keeps ${tol(bestCrop)} at ~${fmt(best.relativeYield, 0)}% of its yield potential${marketContrast(best.crop, farm.main_crop)}.`;
  return { crop: bestCrop.name, reason, market_note: bestCrop.market.note };
}

/** Insight for one farm, as of `index` into the dashboard date axis. */
export function generateInsight(bundle: FarmBundle, index: number, createdAt: string): AiInsight | null {
  const f = gatherFacts(bundle, index);
  if (!f) return null;
  const { score } = scoreRisk(f);
  const water = waterSentence(f);
  // Lead with the acute problem; a near-threshold salinity note only when water is fine.
  const salinity = water && !isLossy(f.day) ? null : salinitySentence(f);
  const parts = [water, salinity].filter(Boolean) as string[];
  if (parts.length === 0) {
    const d = f.day;
    parts.push(
      `All ${d.sensors.length} probes are in range: ECe ${fmt(d.ece)} dS/m (${salinityLabel(d.salinityClass)}), root zone at ${fmt(d.deficitPct, 0)}% of readily available water, crop water use ${fmt(d.etc)} mm/day.`,
    );
  }
  const hotspot = isStressed(f.day) ? f.driest : isLossy(f.day) ? f.saltiest : null;
  if (hotspot && hotspot.location !== "centre") {
    parts.push(
      isStressed(f.day)
        ? `Driest spot: ${hotspot.sensor.id} in the ${hotspot.location} at ${fmt(hotspot.sensor.moisture)}% VWC.`
        : `Worst spot: ${hotspot.sensor.id} in the ${hotspot.location} at ${fmt(hotspot.value)} dS/m.`,
    );
  }
  return {
    id: `${RULES_INSIGHT_PREFIX}${bundle.farm.id}-${f.day.date}`,
    farm_id: bundle.farm.id,
    created_at: createdAt,
    risk_score: score,
    risk_level: riskLevelFor(score),
    summary: parts.join(" "),
    recommendations: buildRecommendations(f),
    crop_suggestion: buildCropSuggestion(f),
  };
}

/** Latest insight for every farm in the dataset. */
export function generateInsights(data: DashboardData, createdAt = new Date().toISOString()): AiInsight[] {
  return data.farms
    .map((bundle) => generateInsight(bundle, lastDataIndex(bundle), createdAt))
    .filter((i): i is AiInsight => i !== null);
}

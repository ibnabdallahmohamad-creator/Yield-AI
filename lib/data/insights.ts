/**
 * Rule-based insights: what our fine-tuned model writes to `ai_insights`, reproduced with
 * transparent rules so mock mode and the Supabase seed have realistic rows before the model
 * is connected. Every number in the text comes from the FAO-56 / FAO-29 engine.
 *
 * The risk score is a product heuristic (0–100) that blends salinity and water stress; it is
 * not a published index.
 */
import { CROPS, ECE_CLASSES, type MarketStatus } from "../agronomy-tables";
import type { AiInsight, Recommendation, RiskLevel } from "../ai/contract";
import { buildFarmFacts } from "../ai/farm-facts";
import { buildReportSections, type ReportSections } from "../ai/report";
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
import { formatLongWeekday } from "../format";
import type { DashboardData, FarmBundle, FarmDay, RiskPoint } from "../types";
import { addDays } from "./time";

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
      f.ece30.from != null && (f.ece30.changePct ?? 0) > 5
        ? `Salt in the soil rose from ${fmt(f.ece30.from)} to ${fmt(ece)} dS/m in ${f.ece30.days} days (${signedPct(f.ece30.changePct)})`
        : `Salt in the soil is at ${fmt(ece)} dS/m`;
    return `${rise}, above the ${fmt(threshold)} dS/m ${crop} limit, so about ${fmt(day.yieldLoss, 0)}% of the yield is at risk (${cls} soil).`;
  }
  if (ece >= 0.85 * threshold) {
    return `Salt in the soil (${fmt(ece, 2)} dS/m) is right at the ${fmt(threshold)} dS/m ${crop} limit: no yield lost yet, but any further rise will start to cost yield.`;
  }
  return null;
}

function waterSentence(f: FarmFacts): string | null {
  const { day } = f;
  if (!isStressed(day)) return null;
  const fall =
    f.moisture30.from != null && (f.moisture30.changePct ?? 0) < -5
      ? ` Soil moisture fell from ${fmt(f.moisture30.from)}% to ${fmt(day.moisture)}% in ${f.moisture30.days} days.`
      : "";
  return `The soil is too dry, so the ${cropNoun(f.bundle.farm.main_crop)} crop is water-stressed now and using about ${fmt((1 - (day.ks ?? 1)) * 100, 0)}% less water than it needs.${fall}`;
}

/** ", plus 4 mm to flush salt" when the gross depth includes a leaching share. */
function leachText(day: FarmDay): string {
  const leach = day.grossDepth != null && day.netDepth != null ? Math.round(day.grossDepth) - Math.round(day.netDepth) : 0;
  return leach >= 1 ? `, plus ${leach} mm to flush salt` : "";
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
      title: `Irrigate today: ${fmt(day.grossDepth, 0)} mm`,
      detail: `The crop is short of water and already using about ${fmt((1 - (day.ks ?? 1)) * 100, 0)}% less than it needs. Apply ${fmt(day.netDepth, 0)} mm to refill the root zone${leachText(day)}. Root-zone depletion is ${fmt(day.dr, 0)} mm against ${fmt(day.raw, 0)} mm of readily available water (Ks ${fmt(day.ks, 2)}, FAO-56 Eq. 84–87).`,
      priority: "high",
    });
    if (f.driest && f.driest.location !== "centre") {
      recs.push({
        title: `Check the irrigation lines in the ${f.driest.location} block`,
        detail: `Probe ${f.driest.sensor.id} there is the driest on the farm, at ${fmt(f.driest.sensor.moisture)}% moisture. A blocked lateral, a leak or low pressure is likely if other blocks stay wetter. It has used ${fmt(f.driest.value, 0)}% of its readily available water (RAW).`,
        priority: "high",
      });
    }
    if (day.etc != null && day.raw > 0) {
      recs.push({
        title: "Irrigate more often, in smaller doses",
        detail: `This ${farm.soil_type.replace("_", " ")} holds only about ${fmt(day.raw / day.etc, 1)} days of water the crop can easily use. Split irrigation into two pulses a day during the hot months. That is ${fmt(day.raw, 0)} mm of readily available water at ${fmt(day.etc)} mm a day of crop water use.`,
        priority: "medium",
      });
    }
  }

  // "today" / "tomorrow" / "on Sunday": the same days as the irrigation schedule (which says "Sun").
  const dueIn = (days: number) =>
    days < 0.5 ? "today" : days < 1.5 ? "tomorrow" : days < 6.5 ? `on ${formatLongWeekday(addDays(day.date, Math.round(days)))}` : `in about ${fmt(days, 0)} days`;
  // A salty farm's next irrigation is the leaching one: it says when, and there's no separate "Next irrigation".
  const leaching = lossy && ece != null;
  const leachWhen = !stressed && day.daysToIrrigation != null ? ` ${dueIn(day.daysToIrrigation)}` : "";

  if (leaching) {
    recs.push({
      title: `Apply a leaching irrigation${leachWhen} (+${fmt(lrPct, 0)}% water)`,
      detail: `Irrigate ${fmt(day.grossDepth, 0)} mm instead of ${fmt(day.netDepth, 0)} mm at the next cycle to flush salt. With irrigation water at ECw ${fmt(farm.irrigation_water_ec)} dS/m, a leaching requirement of ${fmt(lrPct, 0)}% keeps root-zone ECe near ${fmt(day.eceTarget)} dS/m (FAO-29 Eq. 7, 90% yield target).`,
      priority: "high",
    });
    if (f.saltiest && f.saltiest.location !== "centre") {
      recs.push({
        title: `Inspect the salty patch in the ${f.saltiest.location}, around ${f.saltiest.sensor.id}`,
        detail: `The soil there is saltier than the rest of the farm: ${fmt(f.saltiest.value)} dS/m against a farm mean of ${fmt(ece)} dS/m. Check emitters for clogging or poor uniformity, and take a lab saturated-paste sample to confirm the probe calibration.`,
        priority: "high",
      });
    }
    if (farm.irrigation_water_ec > 1.5) {
      recs.push({
        title: "Lower the salt load of the irrigation water",
        detail: `Most of the salt arrives with the irrigation water (${fmt(farm.irrigation_water_ec)} dS/m). Blending it with desalinated or treated water reduces the leaching requirement and the salt added with every irrigation.`,
        priority: "medium",
      });
    }
  } else if (ece != null && ece >= 0.85 * threshold) {
    recs.push({
      title: `Keep salt below the ${cropNoun(farm.main_crop)} limit`,
      detail: `Salt is right at the level where ${cropNoun(farm.main_crop)} yields start to fall (${fmt(ece, 2)} against ${fmt(threshold)} dS/m). Keep the leaching fraction at ${fmt(lrPct, 0)}% (${fmt(day.grossDepth, 0)} mm gross per irrigation) and re-check after the next irrigations.`,
      priority: "medium",
    });
  }

  if (!stressed && !leaching && day.daysToIrrigation != null && day.netDepth != null) {
    recs.push({
      title: `Next irrigation ${dueIn(day.daysToIrrigation)}: ${fmt(day.grossDepth, 0)} mm`,
      detail: `The crop has used ${fmt(day.dr, 0)} of the ${fmt(day.raw, 0)} mm of water it can easily reach, at ${fmt(day.etc)} mm a day. Apply ${fmt(day.netDepth, 0)} mm to refill the root zone${leachText(day)}.`,
      priority: day.daysToIrrigation < 1 ? "medium" : "low",
    });
  }

  if ((f.k30.changePct ?? 0) < -8 && f.k30.from != null) {
    recs.push({
      title: "Top up potassium in the next fertigation",
      detail: `Potassium fell from ${fmt(f.k30.from, 0)} to ${fmt(f.k30.to, 0)} mg/kg in ${f.k30.days} days. Enough potassium also helps the crop cope with salt.`,
      priority: "medium",
    });
  }

  if (day.ph != null && day.ph > 8.0) {
    recs.push({
      title: `Watch soil alkalinity (pH ${fmt(day.ph, 2)})`,
      detail: `The soil is alkaline, so the crop takes up less phosphorus, iron, zinc and manganese. pH ${f.ph30.change != null && f.ph30.change > 0.05 ? `rose ${fmt(f.ph30.change, 2)} units in ${f.ph30.days} days and ` : ""}is above 8.0. Prefer acid-forming fertilisers such as ammonium sulphate.`,
      priority: "low",
    });
  }

  if (recs.length < 2) {
    recs.push({
      title: "Keep the current schedule",
      detail: `${day.sensors.length === 1 ? "The probe is" : `All ${day.sensors.length} probes are`} within range. Keep monitoring salinity and moisture after each irrigation.`,
      priority: "low",
    });
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  return recs.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 4);
}

/** Why the market favours the switch, as a sentence (null when it doesn't). */
function marketContrast(best: keyof typeof CROPS, current: keyof typeof CROPS): string | null {
  const b: MarketStatus = CROPS[best].market.status;
  const c: MarketStatus = CROPS[current].market.status;
  const bn = CROPS[best].name.toLowerCase();
  const cn = CROPS[current].name.toLowerCase();
  if (b === "undersupplied" && c === "oversupplied") return `Qatar is short of ${bn} while ${cn} is oversupplied.`;
  if (b === "undersupplied") return `Qatar's market is short of ${bn}.`;
  if (c === "oversupplied") return `Unlike ${cn}, it is not oversupplied in Qatar.`;
  return null;
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
  const cn = current.name.toLowerCase();

  // Plain words here; the salt-tolerance tables and sources are on Farm details → Method.
  if (keep) {
    const cur = currentOption ?? best;
    const why =
      (f.day.deficitPct ?? 0) > 100
        ? `The risk here is water, not the crop: at this salinity ${cn} still reaches about ${fmt(cur.relativeYield, 0)}% of its full yield.`
        : `At ${fmt(f.ece)} dS/m it still reaches about ${fmt(cur.relativeYield, 0)}% of its full yield.`;
    return {
      crop: current.name,
      reason: `Keep ${cn}. ${why}`,
      market_note: current.market.note,
    };
  }
  const reason =
    best.relativeYield - (currentOption?.relativeYield ?? 0) > 5
      ? `${bestCrop.name} reaches about ${fmt(best.relativeYield, 0)}% of its full yield at ${fmt(f.ece)} dS/m, against about ${fmt(currentOption?.relativeYield, 0)}% for ${cn}.`
      : (marketContrast(best.crop, farm.main_crop) ?? `${bestCrop.name} copes slightly better with ${fmt(f.ece)} dS/m than ${cn}.`);
  return { crop: bestCrop.name, reason, market_note: bestCrop.market.note };
}

const NO_SECTIONS: ReportSections = { insights: [], warnings: [], forecast: null, economics: null, harvest: null };

/**
 * Insight for one farm, as of `index` into the dashboard date axis. `sections: false` skips the
 * report sections (Insights, Warnings, Forecast, Economics, Harvest) when only the risk score is needed.
 */
export function generateInsight(bundle: FarmBundle, index: number, createdAt: string, options: { sections?: boolean } = {}): AiInsight | null {
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
      d.ece != null
        ? `${d.sensors.length === 1 ? "The probe is" : `All ${d.sensors.length} probes are`} in range: salt ${fmt(d.ece)} dS/m (${salinityLabel(d.salinityClass)}), enough water in the root zone, crop water use ${fmt(d.etc)} mm a day.`
        : `${d.sensors.length === 1 ? "The probe is" : `All ${d.sensors.length} probes are`} in range: enough water in the root zone, crop water use ${fmt(d.etc)} mm a day.`,
    );
  }
  const hotspot = isStressed(f.day) ? f.driest : isLossy(f.day) ? f.saltiest : null;
  if (hotspot && hotspot.location !== "centre") {
    parts.push(
      isStressed(f.day)
        ? `Driest spot: ${hotspot.sensor.id} in the ${hotspot.location}, at ${fmt(hotspot.sensor.moisture)}% moisture.`
        : `Saltiest spot: ${hotspot.sensor.id} in the ${hotspot.location}, at ${fmt(hotspot.value)} dS/m.`,
    );
  }
  return {
    id: `seed-${bundle.farm.id}-${f.day.date}`,
    farm_id: bundle.farm.id,
    created_at: createdAt,
    risk_score: score,
    risk_level: riskLevelFor(score),
    summary: parts.join(" "),
    recommendations: buildRecommendations(f),
    crop_suggestion: buildCropSuggestion(f),
    ...(options.sections === false ? NO_SECTIONS : buildReportSections(bundle, index, f.day, buildFarmFacts(bundle, f.day))),
  };
}

/**
 * Stored insights written before migration 0003 (or by a model that skips the sections) have no
 * report sections; fill them from the rules so every farm shows Warnings, Forecast, Economics and
 * Harvest. Sections the row already has are kept.
 */
export function withReportSections(bundle: FarmBundle): AiInsight | null {
  const insight = bundle.insight;
  if (!insight) return null;
  const complete = insight.insights.length > 0 && insight.forecast && insight.economics && insight.harvest;
  if (complete) return insight;
  const index = lastDataIndex(bundle);
  const day = dayAt(bundle, index);
  if (!day) return insight;
  const rules = buildReportSections(bundle, index, day, buildFarmFacts(bundle, day));
  return {
    ...insight,
    insights: insight.insights.length ? insight.insights : rules.insights,
    warnings: insight.warnings.length ? insight.warnings : rules.warnings,
    forecast: insight.forecast ?? rules.forecast,
    economics: insight.economics ?? rules.economics,
    harvest: insight.harvest ?? rules.harvest,
  };
}

/**
 * Risk over the last `days` days when there is no stored insight history (demo data, real accounts):
 * the insight rules replayed for each day that has readings.
 */
export function replayRiskHistory(bundle: FarmBundle, dates: string[], days = 30): RiskPoint[] {
  const out: RiskPoint[] = [];
  for (let i = Math.max(0, dates.length - days); i < dates.length; i++) {
    if (!bundle.days[i]) continue;
    const insight = generateInsight(bundle, i, `${dates[i]}T09:00:00Z`, { sections: false });
    if (insight) out.push({ date: dates[i], score: Math.round(insight.risk_score) });
  }
  return out;
}

/** Latest insight for every farm in the dataset. */
export function generateInsights(data: DashboardData, createdAt = new Date().toISOString()): AiInsight[] {
  return data.farms
    .map((bundle) => generateInsight(bundle, lastDataIndex(bundle), createdAt))
    .filter((i): i is AiInsight => i !== null);
}

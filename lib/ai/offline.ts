/**
 * Offline agronomy responder: answers chat questions from the grounding context alone, with
 * no model call. Used when neither the AI service nor an LLM key is available (and for the
 * landing-page demo), so the chat always answers with the farm's real numbers.
 */
import type { CropId } from "../agronomy-tables";
import type { ChatContext } from "./contract";
import { fmt, rankCrops, signedPct } from "./analysis";

type Topic = "salinity" | "irrigation" | "crop" | "ph" | "nutrients" | "temperature" | "et" | "yield" | "hotspots" | "summary";

const TOPIC_PATTERNS: Array<[Topic, RegExp]> = [
  ["hotspots", /\b(where|hot ?spots?|problem (spots?|areas?)|which (probe|part|block|area|zone)|worst)\b/i],
  ["salinity", /salin|salt|\bece?\b|leach|conductiv|sodic/i],
  ["irrigation", /irrigat|\bwater(ing)?\b|moist|\bdry\b|drought|deficit|drip|how much|when should|schedul/i],
  ["crop", /\bcrops?\b|\bplant(ing)?\b|\bgrow\b|market|next season|switch|rotat|\bsell\b|price/i],
  ["ph", /\bph\b|alkalin|acidi|\blime\b/i],
  ["nutrients", /nitrogen|phosph|potass|\bnpk\b|fertili[sz]|nutrient|\bn\b|\bk\b/i],
  ["temperature", /temperat|\bheat\b|\bhot\b|\bcool/i],
  ["et", /evapotrans|\bet0\b|\beto\b|\bet₀|\betc\b|crop coefficient|\bkc\b|water use|penman|hargreaves/i],
  ["yield", /\byield|\bloss|harvest|production|revenue/i],
  ["summary", /risk|status|summary|overview|how is|how's|what should i do|priorit|first|doing|health|problem/i],
];

export function detectTopics(question: string): Topic[] {
  const topics = TOPIC_PATTERNS.filter(([, re]) => re.test(question)).map(([t]) => t);
  return topics.length ? topics : ["summary"];
}

const n1 = (v: number | null | undefined) => fmt(v, 1);
const n0 = (v: number | null | undefined) => fmt(v, 0);

function worstProbe(ctx: ChatContext, key: "ece_dS_m" | "water_deficit_pct_of_raw" | "moisture_pct", mode: "max" | "min") {
  let best: ChatContext["latest_readings"]["by_probe"][number] | null = null;
  for (const p of ctx.latest_readings.by_probe) {
    const v = p[key];
    if (v == null) continue;
    const b = best?.[key];
    if (b == null || (mode === "max" ? v > b : v < b)) best = p;
  }
  return best;
}

function where(location: string) {
  return location === "centre" ? "the centre of the field" : `the ${location} of the field`;
}

function salinity(ctx: ChatContext): string {
  const d = ctx.derived;
  const t = ctx.trends;
  const crop = ctx.farm.crop.toLowerCase();
  const worst = worstProbe(ctx, "ece_dS_m", "max");
  const rising = (t.ece_change_pct ?? 0) > 5;
  const lines: string[] = [];
  lines.push(
    `**Salinity at ${ctx.farm.name}:** ECe is ${n1(d.ece_dS_m)} dS/m (${d.salinity_class?.toLowerCase() ?? "unclassified"})` +
      (t.ece_start_dS_m != null ? `, ${rising ? "up" : (t.ece_change_pct ?? 0) < -5 ? "down" : "roughly flat"} from ${n1(t.ece_start_dS_m)} dS/m over ${t.window_days} days (${signedPct(t.ece_change_pct)}).` : "."),
  );
  const loss = d.predicted_yield_loss_pct ?? 0;
  if (loss >= 2) {
    lines.push(
      `That is above the ${n1(d.crop_salinity_threshold_dS_m)} dS/m ${crop} threshold (FAO-29), so the Maas–Hoffman model predicts about **${n0(loss)}% yield loss**.`,
    );
  } else {
    lines.push(`It is ${(d.ece_dS_m ?? 0) >= 0.85 * d.crop_salinity_threshold_dS_m ? "close to" : "below"} the ${n1(d.crop_salinity_threshold_dS_m)} dS/m ${crop} threshold, so yield is not affected yet.`);
  }
  if (worst && worst.ece_dS_m != null && d.ece_dS_m != null && worst.ece_dS_m > d.ece_dS_m * 1.1) {
    lines.push(`The saltiest spot is probe ${worst.sensor_id} in ${where(worst.location)} at ${n1(worst.ece_dS_m)} dS/m.`);
  }
  if (rising) {
    lines.push(
      `Likely cause: irrigation water at ECw ${n1(ctx.farm.irrigation_water_ec_dS_m)} dS/m under high evaporative demand (ET₀ ≈ ${n1(ctx.trends.et0_mean_mm_day ?? d.et0_mm_day)} mm/day) leaves salts behind when too little water drains below the roots.`,
    );
  }
  const steps = [
    `Add a **${n0(d.leaching_requirement_pct)}% leaching fraction**: apply ${n0(d.gross_irrigation_depth_with_leaching_mm)} mm instead of ${n0(d.net_irrigation_depth_mm)} mm per irrigation (FAO-29 LR).`,
  ];
  if (worst && worst.location !== "centre" && loss >= 2) steps.push(`Check drippers and pressure around ${worst.sensor_id}; clogged emitters concentrate salt.`);
  if (ctx.farm.irrigation_water_ec_dS_m > 1.5 && loss >= 2) steps.push("Blend in desalinated or treated water to lower the salt added with every irrigation.");
  steps.push("Confirm with a lab saturated-paste ECe sample before large changes.");
  return `${lines.join(" ")}\n\n**What to do:**\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
}

function irrigation(ctx: ChatContext): string {
  const d = ctx.derived;
  const deficit = d.water_deficit_pct_of_raw;
  const driest = worstProbe(ctx, "water_deficit_pct_of_raw", "max");
  const lastsDays = d.etc_mm_day ? d.raw_mm / d.etc_mm_day : null;
  if (deficit != null && deficit > 100) {
    const parts = [
      `**Irrigate today.** Root-zone depletion is ${n0(d.root_zone_depletion_mm)} mm against ${n0(d.raw_mm)} mm of readily available water (${n0(deficit)}% of RAW), so the crop is water-stressed (Ks ${fmt(d.water_stress_coefficient_ks, 2)}).`,
      `Apply **${n0(d.net_irrigation_depth_mm)} mm net, ${n0(d.gross_irrigation_depth_with_leaching_mm)} mm gross** including the ${n0(d.leaching_requirement_pct)}% leaching fraction.`,
    ];
    if (driest) parts.push(`The driest probe is ${driest.sensor_id} in ${where(driest.location)} at ${n1(driest.moisture_pct)}% moisture — check that block's laterals and pressure.`);
    if (lastsDays != null) {
      parts.push(
        `At ${n1(d.etc_mm_day)} mm/day crop water use the RAW lasts only ~${fmt(lastsDays, 1)} day in this ${ctx.farm.soil_type}, so split irrigation into short daily pulses.`,
      );
    }
    return parts.join(" ");
  }
  const days = d.days_until_irrigation;
  const when = days == null ? "soon" : days < 0.5 ? "today" : days < 1.5 ? "tomorrow" : `in about ${n0(days)} days`;
  return [
    `**Next irrigation ${when}.** Depletion is ${n0(d.root_zone_depletion_mm)} of ${n0(d.raw_mm)} mm readily available water (${n0(deficit)}% of RAW) and the crop uses ${n1(d.etc_mm_day)} mm/day (ET₀ ${n1(d.et0_mm_day)} × Kc ${fmt(d.kc, 2)}).`,
    `When you irrigate, apply **${n0(d.net_irrigation_depth_mm)} mm net, ${n0(d.gross_irrigation_depth_with_leaching_mm)} mm gross** with the ${n0(d.leaching_requirement_pct)}% leaching fraction` +
      (d.etc_mm_day ? ` — about ${n0((d.gross_irrigation_depth_with_leaching_mm ?? 0) * ctx.farm.area_ha * 10)} m³ for the ${n1(ctx.farm.area_ha)} ha.` : "."),
  ].join(" ");
}

function crop(ctx: ChatContext): string {
  const suggestion = ctx.latest_insight?.crop_suggestion;
  const ece = ctx.derived.ece_dS_m;
  const lines: string[] = [];
  if (suggestion) {
    const keep = suggestion.crop.toLowerCase() === ctx.farm.crop.toLowerCase();
    const reason = suggestion.reason.replace(/^Keep [^.]+\.\s*/, "");
    lines.push(`${keep ? `**Keep ${suggestion.crop.toLowerCase()}.**` : `**Suggested crop: ${suggestion.crop}.**`} ${reason}`);
    if (suggestion.market_note) lines.push(`Market: ${suggestion.market_note}`);
  }
  if (ece != null) {
    const ranked = rankCrops(ctx.farm.crop_id as CropId, ece).slice(0, 3);
    if (ranked.length > 1) {
      lines.push(
        `Salt tolerance at ECe ${n1(ece)} dS/m (relative yield, FAO-29 / FAO-61): ${ranked
          .map((o) => `${o.name} ${n0(o.relativeYield)}%`)
          .join(", ")}.`,
      );
    }
  }
  if (ctx.market.undersupplied.length) {
    lines.push(`Undersupplied in Qatar: ${ctx.market.undersupplied.join(", ")}. Oversupplied in peak season: ${ctx.market.oversupplied.join(", ")}.`);
  }
  return lines.join("\n\n") || "I don't have enough salinity data to rank crops for this farm yet.";
}

function ph(ctx: ChatContext): string {
  const v = ctx.latest_readings.ph;
  const probes = ctx.latest_readings.by_probe.map((p) => p.ph).filter((x): x is number => x != null);
  const cls =
    v == null ? "unknown" : v < 6.6 ? "acid" : v < 7.4 ? "neutral" : v < 7.9 ? "slightly alkaline" : v < 8.5 ? "moderately alkaline" : "strongly alkaline";
  const change = ctx.trends.ph_change;
  return [
    `**Soil pH is ${fmt(v, 2)} (${cls}, USDA classes)**${change != null ? `, ${change >= 0 ? "+" : "−"}${fmt(Math.abs(change), 2)} over ${ctx.trends.window_days} days` : ""}${probes.length > 1 ? `; probes range ${fmt(Math.min(...probes), 2)}–${fmt(Math.max(...probes), 2)}` : ""}.`,
    (v ?? 0) >= 7.9
      ? "Above ~7.9, phosphorus, iron, zinc and manganese become less available. Prefer acid-forming fertilisers (ammonium sulphate), chelated micronutrients (Fe-EDDHA) and, if the water is high in bicarbonate, acid injection into the drip line."
      : "That is a comfortable range for most vegetables — no correction needed; keep an eye on it after heavy fertigation.",
  ].join(" ");
}

function nutrients(ctx: ChatContext): string {
  const r = ctx.latest_readings;
  return [
    `**Latest probe estimates:** N ${n0(r.n_mg_kg)}, P ${n0(r.p_mg_kg)}, K ${n0(r.k_mg_kg)} mg/kg (farm mean of ${r.probes} probes).`,
    "Probe NPK values follow fertigation cycles and are best used for trends; confirm rates with a lab soil test before changing the programme.",
    (ctx.derived.predicted_yield_loss_pct ?? 0) >= 2
      ? "On this salinising field, use potassium sulphate rather than potassium chloride so fertiliser doesn't add chloride."
      : "Keep the current fertigation schedule and re-check after the next cycle.",
  ].join(" ");
}

function temperature(ctx: ChatContext): string {
  const t = ctx.latest_readings.soil_temperature_c;
  const change = ctx.trends.soil_temperature_change_c;
  return [
    `**Soil temperature is ${n1(t)} °C** (probe mean)${change != null ? `, ${change >= 0 ? "+" : "−"}${n1(Math.abs(change))} °C over ${ctx.trends.window_days} days` : ""}.`,
    (t ?? 0) >= 32
      ? "Root zones above ~32 °C slow root growth and raise water demand: irrigate early morning, and consider mulch or shade nets on young plants."
      : "That is workable for the crop; the late-summer cooling trend also lowers daily water demand.",
    `Crop water use today is ${n1(ctx.derived.etc_mm_day)} mm/day.`,
  ].join(" ");
}

function et(ctx: ChatContext): string {
  const d = ctx.derived;
  const method = d.et0_method === "penman-monteith" ? "FAO-56 Penman–Monteith" : "Hargreaves (estimated — a Penman–Monteith input was missing)";
  return [
    `**ET₀ is ${n1(d.et0_mm_day)} mm/day** (${method})${d.et0_open_meteo_mm_day != null ? `; Open-Meteo's own estimate is ${n1(d.et0_open_meteo_mm_day)} mm/day as a cross-check` : ""}.`,
    `With Kc ${fmt(d.kc, 2)} for ${ctx.farm.crop.toLowerCase()} in the ${ctx.farm.growth_stage.toLowerCase()} stage, crop water use ETc = Kc × ET₀ = **${n1(d.etc_mm_day)} mm/day**, about ${n0((d.etc_mm_day ?? 0) * ctx.farm.area_ha * 10)} m³/day for ${n1(ctx.farm.area_ha)} ha.`,
  ].join(" ");
}

function yieldAnswer(ctx: ChatContext): string {
  const d = ctx.derived;
  const parts = [
    `**Salinity:** predicted yield loss ${n0(d.predicted_yield_loss_pct)}% at ECe ${n1(d.ece_dS_m)} dS/m (threshold ${n1(d.crop_salinity_threshold_dS_m)} dS/m, Maas–Hoffman).`,
  ];
  if (d.water_stress_coefficient_ks != null && d.water_stress_coefficient_ks < 1) {
    parts.push(`**Water stress:** Ks ${fmt(d.water_stress_coefficient_ks, 2)} — transpiration, and with it growth, is down about ${n0((1 - d.water_stress_coefficient_ks) * 100)}% until the root zone is refilled.`);
  } else {
    parts.push("**Water:** no water stress today (Ks = 1).");
  }
  return parts.join("\n\n");
}

function hotspots(ctx: ChatContext): string {
  const salty = worstProbe(ctx, "ece_dS_m", "max");
  const dry = worstProbe(ctx, "water_deficit_pct_of_raw", "max");
  const lines = ["**Problem spots by probe:**"];
  if (salty) lines.push(`- Saltiest: ${salty.sensor_id} (${where(salty.location)}) — ECe ${n1(salty.ece_dS_m)} dS/m, yield loss ${n0(salty.yield_loss_pct)}%.`);
  if (dry) lines.push(`- Driest: ${dry.sensor_id} (${where(dry.location)}) — ${n1(dry.moisture_pct)}% moisture, ${n0(dry.water_deficit_pct_of_raw)}% of RAW depleted.`);
  lines.push("Switch the map layer to Salinity or Water deficit to see the interpolated pattern between probes.");
  return lines.join("\n");
}

function summary(ctx: ChatContext): string {
  const insight = ctx.latest_insight;
  if (!insight) {
    return `${irrigation(ctx)}\n\n${salinity(ctx).split("\n\n")[0]}`;
  }
  const top = insight.recommendations.slice(0, 3);
  return [
    `**${ctx.farm.name} is at ${insight.risk_level} risk (${insight.risk_score}/100).** ${insight.summary}`,
    top.length ? `**Do first:**\n${top.map((r, i) => `${i + 1}. ${r.title}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const RENDER: Record<Topic, (ctx: ChatContext) => string> = {
  salinity,
  irrigation,
  crop,
  ph,
  nutrients,
  temperature,
  et,
  yield: yieldAnswer,
  hotspots,
  summary,
};

export function answerOffline(question: string, ctx: ChatContext): string {
  const q = question.trim();
  if (/^(hi|hello|hey|salam|marhaba|good (morning|evening))\b/i.test(q) && q.length < 30) {
    return `Hello! I'm looking at ${ctx.farm.name} (${ctx.farm.crop.toLowerCase()}, ${ctx.farm.growth_stage.toLowerCase()} stage). Ask me about salinity, irrigation, crop choice or anything in today's readings.`;
  }
  if (/^(thanks|thank you|shukran|great|ok|okay)\b/i.test(q) && q.length < 30) {
    return "You're welcome — ask me anything else about this farm.";
  }
  const topics = detectTopics(q).slice(0, 2);
  // "Why is salinity rising / what should I plant" → one focused answer is better than two.
  const unique = topics.length === 2 && (topics[1] === "summary" || topics[0] === "hotspots") ? [topics[0]] : topics;
  return unique.map((t) => RENDER[t](ctx)).join("\n\n");
}

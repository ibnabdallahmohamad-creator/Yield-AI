/**
 * Offline agronomy responder: answers chat questions from the grounding context alone, with
 * no model call. Used when neither the AI service nor an LLM key is available (and for the
 * landing-page demo), so the chat always answers with the farm's real numbers.
 */
import type { CropId } from "../agronomy-tables";
import type { ChatContext } from "./contract";
import { fmt, rankCrops, signedPct } from "./analysis";

type Topic =
  | "weather"
  | "land"
  | "salinity"
  | "irrigation"
  | "crop"
  | "ph"
  | "nutrients"
  | "temperature"
  | "et"
  | "yield"
  | "hotspots"
  | "summary";

const TOPIC_PATTERNS: Array<[Topic, RegExp]> = [
  ["weather", /weather|forecast|tomorrow|this week|next (few |seven |7 )?days|coming days|\bwind(y|s)?\b|humid|\bstorm|\bdust|will it rain|rain (this|next|tomorrow|today)|heat ?wave/i],
  [
    "land",
    /soil (type|quality|here|like)|what (kind of )?soil|fertil(e|ity)|\bland\b|rawd|sabkha|groundwater|aquifer|well water|rainfall|how much (does it )?rain|climate|suitab|grow (here|well)|this (area|region|location|cell)|\bregion\b|municipal|\b(in|about|around|near) (al[ -])?(shamal|khor|sheehaniya|shahaniya|rayyan|wakrah?|daayen|umm salal|doha)\b/i,
  ],
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
  weather,
  land,
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

// ---------------------------------------------------------------------------
// Land atlas, weather and research (retrieved context)
// ---------------------------------------------------------------------------

const dayName = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function citeKnowledge(ctx: ChatContext, max = 1): string {
  const passages = (ctx.knowledge ?? []).slice(0, max);
  if (!passages.length) return "";
  return passages.map((p) => `**From the research — ${p.title}:** ${p.text} (Source: ${p.source}.)`).join("\n\n");
}

function land(ctx: ChatContext): string {
  const l = ctx.land;
  const regions = ctx.region_notes ?? [];
  if (!l) {
    return [regions.join("\n\n"), citeKnowledge(ctx)].filter(Boolean).join("\n\n") || "I don't have land-atlas data for this location.";
  }
  const well = l.crops.filter((c) => c.suitability === "well-suited").map((c) => c.crop);
  const managed = l.crops.filter((c) => c.suitability === "with-management").map((c) => `${c.crop} (${c.relative_yield_pct}%)`);
  const lines = [
    `**Land around ${ctx.farm.name}** (atlas cell ${l.cell_id}, ${l.municipality}): ${l.landform.toLowerCase()}, ${l.coast_distance_km < 1 ? "on the coast" : `${n1(l.coast_distance_km)} km from the coast`}. ` +
      `Fertility is **${l.fertility_class.toLowerCase()} (${l.fertility_index}/100 for Qatar)**; rawdat depressions are ${l.rawdat_density} here.`,
    `**Soil:** ${l.soil.texture}, ${l.soil.depth}; pH ${l.soil.ph}; organic matter ${l.soil.organic_matter}` +
      (l.soil.typical_ece_dS_m != null ? `; typical ECe before irrigation ≈${n1(l.soil.typical_ece_dS_m)} dS/m.` : "."),
    `**Climate:** ≈${n0(l.climate.annual_rain_mm)} mm of rain a year (${l.climate.rainy_season}, wettest ${l.climate.wettest_month}); July highs ≈${n1(l.climate.july_mean_max_c)} °C, January lows ≈${n1(l.climate.january_mean_min_c)} °C; mean humidity ${n0(l.climate.mean_rh_pct)}%. ` +
      `Reference ET₀ is ≈${n0(l.climate.annual_et0_mm)} mm/yr, so rain covers only ≈${n0(l.climate.rain_share_of_et0_pct)}% of crop water needs.`,
    `**Groundwater:** ${l.groundwater.basin}, ≈${n0(l.groundwater.tds_mg_l)} mg/L TDS (ECw ≈${n1(l.groundwater.ecw_dS_m)} dS/m — FAO-29 restriction ${l.groundwater.fao29_restriction.replace("-", " to ")}).`,
  ];
  if (well.length || managed.length) {
    lines.push(
      `**What grows here with the local water:** ${well.length ? `well suited — ${well.slice(0, 6).join(", ")}` : "no vegetable is fully tolerant"}` +
        (managed.length ? `; with extra leaching — ${managed.slice(0, 4).join(", ")}` : "") +
        ". Salt-sensitive vegetables need desalinated or blended water.",
    );
  }
  if (l.protected_area) lines.push(`Note: part of this area may lie in ${l.protected_area}.`);
  const extra = [regions.join("\n\n"), citeKnowledge(ctx)].filter(Boolean).join("\n\n");
  return `${lines.join("\n\n")}${extra ? `\n\n${extra}` : ""}\n\nLand-atlas values are modelled at 10 km² scale; a lab soil and water test on the field overrides them.`;
}

function weather(ctx: ChatContext): string {
  const w = ctx.weather;
  if (!w || (!w.current && w.forecast_7d.length === 0)) {
    return "I can't reach the weather service right now, so I don't have a forecast for this farm.";
  }
  const lines: string[] = [];
  const c = w.current;
  if (c) {
    lines.push(
      `**Now at ${ctx.farm.name}:** ${n0(c.temp_c)} °C${c.feels_like_c != null ? ` (feels ${n0(c.feels_like_c)} °C)` : ""}, humidity ${n0(c.humidity_pct)}%, wind ${c.wind_dir ?? ""} ${n0(c.wind_kph)} km/h${c.gust_kph ? ` gusting ${n0(c.gust_kph)}` : ""} — ${c.condition.toLowerCase()}.`,
    );
  }
  const days = w.forecast_7d;
  if (days.length) {
    lines.push(
      `**Next ${days.length} days:**\n${days
        .map(
          (d) =>
            `- ${dayName(d.date)}: ${n0(d.tmax_c)}/${n0(d.tmin_c)} °C, RH ${n0(d.rh_min_pct)}–${n0(d.rh_max_pct)}%, wind ${d.wind_dir ?? ""} ${n0(d.wind_mean_kph)} km/h (max ${n0(d.wind_max_kph)}), rain ${fmt(d.precip_mm, 1)} mm${d.et0_mm != null ? `, ET₀ ${n1(d.et0_mm)} mm` : ""}`,
        )
        .join("\n")}`,
    );
    const hottest = days.reduce((a, d) => ((d.tmax_c ?? -99) > (a.tmax_c ?? -99) ? d : a));
    const windiest = days.reduce((a, d) => ((d.wind_max_kph ?? 0) > (a.wind_max_kph ?? 0) ? d : a));
    const wet = days.filter((d) => (d.precip_mm ?? 0) >= 2);
    const tips: string[] = [];
    if ((hottest.tmax_c ?? 0) >= 42) tips.push(`${dayName(hottest.date)} peaks at ${n0(hottest.tmax_c)} °C — irrigate before sunrise and protect young plants with shade net.`);
    if ((windiest.wind_max_kph ?? 0) >= 35) tips.push(`Strong wind on ${dayName(windiest.date)} (up to ${n0(windiest.wind_max_kph)} km/h) — raises crop water use and dust; check greenhouse covers and windbreaks.`);
    if (wet.length) tips.push(`Rain expected on ${wet.map((d) => dayName(d.date)).join(", ")} — reduce irrigation that day and let it help leach salts.`);
    const et0s = days.map((d) => d.et0_mm).filter((v): v is number => v != null);
    const kc = ctx.derived.kc;
    if (et0s.length && kc != null) {
      const meanEt0 = et0s.reduce((a, b) => a + b, 0) / et0s.length;
      tips.push(
        `Crop water use this week ≈ Kc ${fmt(kc, 2)} × ET₀ ${n1(meanEt0)} = **${n1(kc * meanEt0)} mm/day** for ${ctx.farm.crop.toLowerCase()} (≈${n0(kc * meanEt0 * ctx.farm.area_ha * 10)} m³/day on ${n1(ctx.farm.area_ha)} ha, before leaching).`,
      );
    }
    if (tips.length) lines.push(`**What it means:**\n${tips.map((t, i) => `${i + 1}. ${t}`).join("\n")}`);
  }
  if (w.alerts.length) lines.push(`**Alerts:** ${w.alerts.join("; ")}`);
  lines.push(`Sources: ${w.sources.join(" + ") || "weather service"}.`);
  return lines.join("\n\n");
}

/** Topics that need probe readings, answered before the first reading arrives. */
function noReadings(ctx: ChatContext, topic: Topic): string {
  const intro = `**${ctx.farm.name} has no probe readings yet**, so I can't measure moisture or salinity there. Add sensors on the farm page and have them post to /api/readings; until then, here is what the land atlas and forecast say.`;
  const l = ctx.land;
  const parts = [intro];
  if (topic === "salinity" && l) {
    parts.push(
      `Local groundwater is ≈${n0(l.groundwater.tds_mg_l)} mg/L TDS (ECw ≈${n1(l.groundwater.ecw_dS_m)} dS/m). Irrigating with it at a 15–20% leaching fraction settles root-zone salinity near ECe ≈ ${n1(1.5 * l.groundwater.ecw_dS_m)} dS/m (FAO-29) — ` +
        `${1.5 * l.groundwater.ecw_dS_m > ctx.derived.crop_salinity_threshold_dS_m ? "above" : "within"} the ${n1(ctx.derived.crop_salinity_threshold_dS_m)} dS/m ${ctx.farm.crop.toLowerCase()} threshold. With your irrigation water (ECw ${n1(ctx.farm.irrigation_water_ec_dS_m)} dS/m) the leaching requirement is **${n0(ctx.derived.leaching_requirement_pct)}%**.`,
    );
  } else if ((topic === "irrigation" || topic === "et") && ctx.weather) {
    parts.push(weather(ctx));
    parts.push(
      `Your ${ctx.farm.soil_type} holds ≈${n0(ctx.derived.taw_mm)} mm of available water in the root zone, of which ${n0(ctx.derived.raw_mm)} mm can be used before stress (FAO-56) — irrigate in short, frequent pulses.`,
    );
    return parts.join("\n\n");
  } else if (topic === "crop" && l) {
    parts.push(land(ctx));
    return parts.join("\n\n");
  } else {
    if (l) parts.push(land(ctx).split("\n\n").slice(0, 3).join("\n\n"));
    if (ctx.weather?.forecast_7d.length) parts.push(weather(ctx).split("\n\n").slice(0, 1).join(""));
  }
  return parts.join("\n\n");
}

const NEEDS_READINGS = new Set<Topic>(["salinity", "irrigation", "ph", "nutrients", "temperature", "et", "yield", "hotspots", "summary", "crop"]);

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
  if (!ctx.has_readings) {
    const first = unique[0];
    return NEEDS_READINGS.has(first) ? noReadings(ctx, first) : RENDER[first](ctx);
  }
  return unique.map((t) => RENDER[t](ctx)).join("\n\n");
}

/**
 * Offline agronomy responder: answers chat questions from the grounding context alone, with
 * no model call. Used when neither the AI service nor an LLM key is available (and for the
 * landing-page demo), so the chat always answers with the farm's real numbers.
 *
 * Answers follow ANSWER_FORMAT (prompts.ts): one direct sentence with the key figure in bold, then
 * only the sections that help — Why, Do now, Warnings, Next 7 days, Cost, Harvest & next crop.
 */
import type { CropId } from "../agronomy-tables";
import { formatDay } from "../format";
import { PRICE_SIGNAL_LABEL } from "../qatar/market";
import type { ChatContext, Warning } from "./contract";
import { fmt, rankCrops, signedPct } from "./analysis";
import { WINDY_M_S, type OutlookDay, type Range } from "./farm-facts";
import { formatDays } from "./report";

type Topic =
  | "location"
  | "hotspots"
  | "forecast"
  | "economics"
  | "harvest"
  | "salinity"
  | "irrigation"
  | "crop"
  | "ph"
  | "nutrients"
  | "temperature"
  | "et"
  | "yield"
  | "summary";

/** Checked in order; the first two matches answer the question. */
const TOPIC_PATTERNS: Array<[Topic, RegExp]> = [
  ["location", /\b(locat|coordinat|latitude|longitude|gps|groundwater|aquifer|basin|municipalit|coast|how far from the sea)|where is (the|my|this) farm/i],
  ["hotspots", /hot ?spots?|problem (spots?|areas?)|which (probe|part|block|area|zone)|\bworst\b|\bwhere\b.*\b(problems?|dry|driest|salty|saltiest|stress)/i],
  ["forecast", /forecast|next (7 days|week|few days|12 hours|twelve hours|hours)|this week|tonight|weather|\bwind|dust|spray|humid|\bdew\b|fung|mildew|disease|\brain/i],
  ["crop", /(what|which) (crops?|to plant|to grow)|next (crop|season)|\bplant(ing)?\b|\bgrow\b|switch|rotat/i],
  ["economics", /\bcosts?\b|\bprice|revenue|profit|income|money|\bqar\b|riyal|worth|earn|\bsell|econom|budget|\bmarket\b/i],
  ["harvest", /harvest|\bpick(ing)?\b|\bcut(ting)?\b|ready|ripe|season end/i],
  ["salinity", /salin|salt|\bece?\b|leach|conductiv|sodic/i],
  ["irrigation", /irrigat|\bwater(ing)?\b|moist|\bdry\b|drought|deficit|drip|how much|when should|schedul/i],
  ["ph", /\bph\b|alkalin|acidi|\blime\b/i],
  ["nutrients", /nitrogen|phosph|potass|\bnpk\b|fertili[sz]|nutrient|\bn\b|\bk\b/i],
  ["temperature", /temperat|\bheat\b|\bhot\b|\bcool|\bair\b|vpd/i],
  ["et", /evapotrans|\bet0\b|\beto\b|\bet₀|\betc\b|crop coefficient|\bkc\b|water use|penman|hargreaves/i],
  ["yield", /\byield|\bloss|production/i],
  ["summary", /risk|status|summary|overview|how is|how's|what should i do|priorit|first|doing|health|problem|changed/i],
];

export function detectTopics(question: string): Topic[] {
  const topics = TOPIC_PATTERNS.filter(([, re]) => re.test(question)).map(([t]) => t);
  // "Where is the farm?" is about the location, not the problem spots.
  const focused = topics.includes("location") ? topics.filter((t) => t !== "hotspots") : topics;
  return focused.length ? focused : ["summary"];
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const n1 = (v: number | null | undefined) => fmt(v, 1);
const n0 = (v: number | null | undefined) => fmt(v, 0);
const kmh = (ms: number) => Math.round(ms * 3.6);
const qar = (r: Range) => (r.low === r.high ? `QAR ${n0(r.low)}` : `QAR ${n0(r.low)}–${n0(r.high)}`);
const tonnes = (r: Range) => (r.low === r.high ? `${n0(r.low)} t` : `${n0(r.low)}–${n0(r.high)} t`);

interface Section {
  title: "Why" | "Do now" | "Warnings" | "Next 12 hours" | "Next 7 days" | "Cost" | "Harvest & next crop";
  lines: string[];
}

/** A section with one line is a paragraph; "Do now" is always numbered; the rest are bullets. */
function renderSection({ title, lines }: Section): string {
  const body =
    title === "Do now"
      ? lines.map((l, i) => `${i + 1}. ${l}`).join("\n")
      : lines.length === 1
        ? lines[0]
        : lines.map((l) => `- ${l}`).join("\n");
  return `### ${title}\n${body}`;
}

const SECTION_ORDER: Section["title"][] = ["Why", "Do now", "Warnings", "Next 12 hours", "Next 7 days", "Cost", "Harvest & next crop"];

function answer(lead: string, sections: Array<Section | null>): string {
  const kept = sections
    .filter((s): s is Section => s != null && s.lines.length > 0)
    .sort((a, b) => SECTION_ORDER.indexOf(a.title) - SECTION_ORDER.indexOf(b.title));
  return [lead, ...kept.map(renderSection)].join("\n\n");
}

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

const cropLower = (ctx: ChatContext) => ctx.farm.crop.toLowerCase();

// ---------------------------------------------------------------------------
// Shared sections
// ---------------------------------------------------------------------------

/** The stored report's warnings (same rules as the Insights page), optionally filtered by title. */
function warningsSection(ctx: ChatContext, match?: RegExp, max = 2): Section | null {
  const all: Warning[] = ctx.latest_insight?.warnings ?? [];
  const picked = (match ? all.filter((w) => match.test(`${w.title} ${w.detail}`)) : all).slice(0, max);
  if (picked.length === 0) return null;
  return { title: "Warnings", lines: picked.map((w) => `**${w.title}** (${w.when}). ${firstSentence(w.detail)}`) };
}

function firstSentence(text: string): string {
  const m = text.match(/^.+?[.!?](\s|$)/);
  return (m ? m[0] : text).trim();
}

function irrigationDays(days: OutlookDay[]): OutlookDay[] {
  return days.filter((d) => (d.irrigate_mm ?? 0) > 0);
}

/** "Plan 3 irrigations (Fri 25 Sep 20 mm, Mon 28 Sep 26 mm, …), 71 mm gross, 11,329 m³." */
function irrigationPlanLine(ctx: ChatContext): string | null {
  const o = ctx.outlook;
  if (!o || o.irrigations == null) return null;
  const due = irrigationDays(o.days);
  if (due.length === 0) return `No irrigation is due in the next ${o.horizon_days} days at the forecast crop water use.`;
  const list = due.map((d) => `${formatDay(d.date)} ${n0(d.irrigate_mm)} mm`).join(", ");
  return `Plan ${o.irrigations} irrigation${o.irrigations === 1 ? "" : "s"}${o.assumes_irrigation_today ? " after today's" : ""}: ${list} — ${n0(o.irrigation_gross_mm)} mm gross, about ${n0(o.water_m3)} m³.`;
}

function weatherLines(ctx: ChatContext): string[] {
  const o = ctx.outlook;
  if (!o || o.days.length === 0) return [];
  const highs = o.days.map((d) => d.tmax_c).filter((v): v is number => v != null);
  const lines: string[] = [];
  if (highs.length) {
    const hot = o.heat_days.length ? ` — above the ${n0(o.heat_threshold_c)} °C ${cropLower(ctx)} heat line on ${formatDays(o.heat_days)}` : "";
    lines.push(`Highs ${n0(Math.min(...highs))}–${n0(Math.max(...highs))} °C${hot}.`);
  }
  if (o.strong_wind_days.length) lines.push(`Strong wind (dust risk) on ${formatDays(o.strong_wind_days)}.`);
  else if (o.windy_days.length) lines.push(`Windy on ${formatDays(o.windy_days)}; no spraying then.`);
  else lines.push("Light winds all week.");
  if (o.humid_days.length) lines.push(`Humid nights (≥ 90%) on ${formatDays(o.humid_days)}.`);
  lines.push(o.rain_mm > 0 ? `Rain: about ${n0(o.rain_mm)} mm in total.` : "No rain expected.");
  return lines;
}

/** The hourly forecast for the next 12 hours (refreshed at 00:00 and 12:00 Qatar time). */
function next12Lines(ctx: ChatContext): string[] {
  const f = ctx.weather_next_12h;
  if (!f) return [];
  const lines: string[] = [];
  if (f.temp_min_c != null && f.temp_max_c != null) lines.push(`${n0(f.temp_min_c)}–${n0(f.temp_max_c)} °C${f.hottest_at ? `, hottest around ${f.hottest_at}` : ""}.`);
  if (f.humidity_min_pct != null && f.humidity_max_pct != null) lines.push(`Humidity ${n0(f.humidity_min_pct)}–${n0(f.humidity_max_pct)}%.`);
  lines.push(
    f.rain_total_mm >= 0.1
      ? `Rain: about ${n1(f.rain_total_mm)} mm.`
      : (f.rain_max_chance_pct ?? 0) >= 30
        ? `Rain: up to ${n0(f.rain_max_chance_pct)}% chance, little expected.`
        : "No rain expected.",
  );
  if (f.wind_max_ms != null) {
    lines.push(`Wind up to ${n1(f.wind_max_ms)} m/s (${kmh(f.wind_max_ms)} km/h)${f.wind_from ? ` from the ${f.wind_from}` : ""}${f.gust_max_ms != null ? `, gusts ${n1(f.gust_max_ms)} m/s` : ""}.`);
  }
  return lines;
}

function next12Section(ctx: ChatContext): Section | null {
  const lines = next12Lines(ctx);
  return lines.length ? { title: "Next 12 hours", lines } : null;
}

function next7Section(ctx: ChatContext, opts: { weather?: boolean } = {}): Section | null {
  const plan = irrigationPlanLine(ctx);
  const lines = [plan, ...(opts.weather === false ? [] : weatherLines(ctx))].filter((l): l is string => Boolean(l));
  return lines.length ? { title: "Next 7 days", lines } : null;
}

function costSection(ctx: ChatContext, opts: { water?: boolean; risk?: boolean; revenue?: boolean } = {}): Section | null {
  const e = ctx.economics;
  const lines: string[] = [];
  if (opts.revenue) lines.push(`The ${n1(e.area_ha)} ha should bring **${qar(e.revenue_qar)}** this ${e.per} (${tonnes(e.expected_yield_t)} at QAR ${fmt(e.price_qar_kg.low, 1)}–${fmt(e.price_qar_kg.high, 1)}/kg, ${e.price_months}).`);
  if (opts.risk !== false && e.revenue_at_risk_qar && e.revenue_at_risk_qar.high > 0) {
    lines.push(`Salinity is costing about **${qar(e.revenue_at_risk_qar)}** (${e.yield_at_risk_t ? tonnes(e.yield_at_risk_t) : "yield"}) at today's ECe.`);
  }
  if (opts.water !== false && e.water_7d_m3 != null) {
    lines.push(`Water for the next 7 days: ${n0(e.water_7d_m3)} m³, about QAR ${n0(e.water_7d_cost_qar)} to pump.`);
  }
  if (lines.length === 0) return null;
  lines.push("Prices are indicative; check Mahaseel or the Al Sailiya Central Market for today's.");
  return { title: "Cost", lines };
}

function nextCropLines(ctx: ChatContext, max = 2): string[] {
  return ctx.harvest.next_crops.slice(0, max).map((c) => {
    const ry = c.relative_yield_pct != null ? `${n0(c.relative_yield_pct)}% of full yield here, ` : "";
    return `**${c.crop}**: plant ${c.plant_months}; ${ry}${PRICE_SIGNAL_LABEL[c.harvest_market].toLowerCase()} at harvest.`;
  });
}

function harvestTimingLine(ctx: ChatContext): string {
  const h = ctx.harvest;
  const market = PRICE_SIGNAL_LABEL[h.harvest_market].toLowerCase();
  switch (h.status) {
    case "establishing":
    case "growing":
      return h.first_harvest
        ? `First harvest in about **${n0(h.days_to_first_harvest)} days (${formatDay(h.first_harvest)})**, when the market should be: ${market}.`
        : "The first harvest date isn't known for this crop.";
    case "harvesting":
      return `Harvest is on until about **${h.last_harvest ? formatDay(h.last_harvest) : "the end of the season"}**; market now: ${market}.`;
    case "ending":
      return `The season ends in about **${n0(h.days_to_season_end)} days**${h.last_harvest ? ` (${formatDay(h.last_harvest)})` : ""}; plan the next crop now.`;
    case "finished":
      return "**The season is over**: clear the crop and prepare the next planting.";
    case "cutting":
      if (!h.first_harvest) return "Cut about every 30 days while the crop regrows.";
      return h.days_to_first_harvest === 0
        ? `**A cut is due now**; after that, about every 30 days.`
        : `Next cut in about **${n0(h.days_to_first_harvest)} days (${formatDay(h.first_harvest)})**.`;
  }
}

function harvestSection(ctx: ChatContext, opts: { timing?: boolean } = {}): Section | null {
  const lines = [opts.timing === false ? null : harvestTimingLine(ctx), ...nextCropLines(ctx)].filter((l): l is string => Boolean(l));
  return lines.length ? { title: "Harvest & next crop", lines } : null;
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

function salinity(ctx: ChatContext): string {
  const d = ctx.derived;
  const t = ctx.trends;
  if (d.ece_dS_m == null) {
    return answer(
      `**There's no salinity sensor on ${ctx.farm.name}**, so I can't measure the salt in the soil; only air temperature, humidity, soil moisture and wind are measured.`,
      [
        {
          title: "Why",
          lines: [
            `The irrigation water is ECw ${n1(ctx.farm.irrigation_water_ec_dS_m)} dS/m, and ${ctx.location.groundwater_basin} basin groundwater typically runs ${n1(ctx.location.typical_groundwater_ec_dS_m.low)}–${n1(ctx.location.typical_groundwater_ec_dS_m.high)} dS/m. Without leaching, that salt builds up in the root zone.`,
          ],
        },
        {
          title: "Do now",
          lines: [
            `Keep a **${n0(d.leaching_requirement_pct)}% leaching fraction**: apply ${n0(d.gross_irrigation_depth_with_leaching_mm)} mm instead of ${n0(d.net_irrigation_depth_mm)} mm per irrigation (FAO-29).`,
            "Send a saturated-paste soil sample (ECe) to a lab every season, or add an EC probe.",
          ],
        },
      ],
    );
  }
  const crop = cropLower(ctx);
  const worst = worstProbe(ctx, "ece_dS_m", "max");
  const change = t.ece_change_pct ?? 0;
  const rising = change > 5;
  const loss = d.predicted_yield_loss_pct ?? 0;
  const direction = rising ? "up" : change < -5 ? "down" : "roughly flat";
  const lead =
    `Soil salinity (ECe) is **${n1(d.ece_dS_m)} dS/m**` +
    (t.ece_start_dS_m != null ? `, ${direction} from ${n1(t.ece_start_dS_m)} dS/m in ${t.window_days} days (${signedPct(t.ece_change_pct)})` : "") +
    (loss >= 2 ? `, costing about **${n0(loss)}%** of the ${crop} yield.` : `; no yield lost yet.`);

  const why: string[] = [
    loss >= 2
      ? `${ctx.farm.crop} starts losing yield above ${n1(d.crop_salinity_threshold_dS_m)} dS/m (FAO-29); Maas–Hoffman predicts ${n0(loss)}% loss (${d.salinity_class?.toLowerCase() ?? "saline"} soil).`
      : `It is ${d.ece_dS_m >= 0.85 * d.crop_salinity_threshold_dS_m ? "close to" : "below"} the ${n1(d.crop_salinity_threshold_dS_m)} dS/m ${crop} threshold (FAO-29).`,
  ];
  if (rising) {
    why.push(
      `Irrigation water at ECw ${n1(ctx.farm.irrigation_water_ec_dS_m)} dS/m under ET₀ ≈ ${n1(t.et0_mean_mm_day ?? d.et0_mm_day)} mm/day leaves salt behind when too little water drains below the roots.`,
    );
  }
  if (worst?.ece_dS_m != null && worst.ece_dS_m > d.ece_dS_m * 1.1) {
    why.push(`Saltiest spot: probe ${worst.sensor_id} in ${where(worst.location)}, ${n1(worst.ece_dS_m)} dS/m.`);
  }

  const steps = [
    `Apply **${n0(d.gross_irrigation_depth_with_leaching_mm)} mm** instead of ${n0(d.net_irrigation_depth_mm)} mm per irrigation: a ${n0(d.leaching_requirement_pct)}% leaching fraction (FAO-29).`,
  ];
  if (worst && worst.location !== "centre" && loss >= 2) steps.push(`Check drippers and pressure around ${worst.sensor_id}; clogged emitters concentrate salt.`);
  if (ctx.farm.irrigation_water_ec_dS_m > 1.5 && loss >= 2) steps.push("Blend in desalinated water or switch to a better well to cut the salt added with each irrigation.");
  steps.push("Confirm with a lab saturated-paste ECe sample before big changes.");

  const e = ctx.economics;
  const cost: Section | null =
    loss >= 2 || e.leaching_m3_per_irrigation != null
      ? {
          title: "Cost",
          lines: [
            e.revenue_at_risk_qar && e.revenue_at_risk_qar.high > 0 ? `Salt is costing about **${qar(e.revenue_at_risk_qar)}** this ${e.per} at indicative prices.` : null,
            e.leaching_m3_per_irrigation != null ? `Leaching takes ${n0(e.leaching_m3_per_irrigation)} m³ extra per irrigation, about QAR ${n0(e.leaching_cost_qar_per_irrigation)} to pump.` : null,
          ].filter((l): l is string => Boolean(l)),
        }
      : null;

  return answer(lead, [{ title: "Why", lines: why }, { title: "Do now", lines: steps }, cost]);
}

function irrigation(ctx: ChatContext): string {
  const d = ctx.derived;
  if (d.root_zone_depletion_mm == null) {
    return answer(`**There's no soil moisture reading for today**, so I can't set the next irrigation from the water balance.`, [
      { title: "Do now", lines: ["Check that the moisture probes are sending data (Farm details → Probes).", "Meanwhile irrigate on your usual schedule."] },
      next7Section(ctx, { weather: false }),
    ]);
  }
  const deficit = d.water_deficit_pct_of_raw;
  const driest = worstProbe(ctx, "water_deficit_pct_of_raw", "max");
  const lastsDays = d.etc_mm_day ? d.raw_mm / d.etc_mm_day : null;
  const stressed = deficit != null && deficit > 100;
  // Not due today: the outlook's first irrigation has the depth the root zone will need by then.
  const nextDay = stressed ? null : (irrigationDays(ctx.outlook?.days ?? [])[0] ?? null);
  const gross = stressed || !nextDay ? d.gross_irrigation_depth_with_leaching_mm : nextDay.irrigate_mm;
  const days = d.days_until_irrigation;
  const when = stressed
    ? "today"
    : nextDay
      ? formatDay(nextDay.date)
      : days == null
        ? "soon"
        : days < 0.5
          ? "today"
          : days < 1.5
            ? "tomorrow"
            : `in about ${n0(days)} days`;
  const lead = stressed
    ? `**Irrigate ${n0(gross)} mm today**: the crop is already short of water.`
    : `Next irrigation **${when}: ${n0(gross)} mm gross**, including the ${n0(d.leaching_requirement_pct)}% leaching fraction.`;

  const why = [
    `Soil moisture is ${n1(ctx.latest_readings.moisture_pct)}%: ${n0(d.root_zone_depletion_mm)} mm used against ${n0(d.raw_mm)} mm the crop can take up easily${stressed ? `, so growth is slowing (Ks ${fmt(d.water_stress_coefficient_ks, 2)})` : ""}.`,
    `The crop uses ${n1(d.etc_mm_day)} mm/day (ET₀ ${n1(d.et0_mm_day)} × Kc ${fmt(d.kc, 2)})${nextDay ? `, so the root zone reaches the trigger by ${formatDay(nextDay.date)}` : ""}.`,
  ];
  const steps: string[] = [];
  const m3 = (gross ?? 0) * ctx.farm.area_ha * 10;
  steps.push(`Apply ${n0(gross)} mm (about ${n0(m3)} m³ for ${n1(ctx.farm.area_ha)} ha) ${stressed ? "today" : `on ${when}`}, before 7 am to cut evaporation losses.`);
  if (stressed && driest) steps.push(`Check laterals and pressure in ${where(driest.location)} (probe ${driest.sensor_id}, ${n1(driest.moisture_pct)}% moisture).`);
  if (lastsDays != null && lastsDays < 2) steps.push(`The easy water lasts only ~${fmt(lastsDays, 1)} day in ${ctx.farm.soil_type}: split irrigation into short daily pulses.`);

  return answer(lead, [
    { title: "Why", lines: why },
    { title: "Do now", lines: steps },
    next7Section(ctx, { weather: false }),
    costSection(ctx, { risk: false }),
  ]);
}

function crop(ctx: ChatContext): string {
  const suggestion = ctx.latest_insight?.crop_suggestion;
  const ece = ctx.derived.ece_dS_m;
  const keep = suggestion ? suggestion.crop.toLowerCase() === cropLower(ctx) : true;
  const best = ctx.harvest.next_crops[0];
  const lead = suggestion
    ? keep
      ? `**Keep ${cropLower(ctx)}** this season${best ? `, then **${best.crop.toLowerCase()}** is the best next crop` : ""}.`
      : `**Switch to ${suggestion.crop.toLowerCase()}** when this season ends.`
    : best
      ? `The best next crop is **${best.crop.toLowerCase()}** (plant ${best.plant_months}).`
      : `Keep ${cropLower(ctx)}; I don't have enough data to rank alternatives yet.`;

  const why: string[] = [];
  if (suggestion?.reason) why.push(suggestion.reason.replace(/^Keep [^.]+\.\s*/, "").trim() || suggestion.reason);
  if (ece != null) {
    const ranked = rankCrops(ctx.farm.crop_id as CropId, ece).slice(0, 3);
    if (!suggestion && ranked.length > 1) why.push(`At ECe ${n1(ece)} dS/m (FAO-29): ${ranked.map((o) => `${o.name} ${n0(o.relativeYield)}%`).join(", ")} of full yield.`);
  } else {
    why.push("No salinity sensor here, so the ranking uses market timing and planting windows, not salt tolerance.");
  }
  const m = ctx.market;
  const fodder = ctx.farm.crop_id === "alfalfa";
  if (m.scarce_now.length && !fodder) why.push(`Short in Qatar now, in the ${m.season}: ${m.scarce_now.join(", ").toLowerCase()}.`);
  if (m.glut_now.length) why.push(`Glut risk now: ${m.glut_now.join(", ").toLowerCase()}.`);
  const goal = ctx.national_goals[0];
  if (goal) {
    why.push(
      goal.target_pct != null
        ? `National goal: ${goal.label.toLowerCase()} self-sufficiency ${goal.current_pct}% (${goal.current_year}) → ${goal.target_pct}% by 2030.`
        : `${goal.label} is ${goal.current_pct}% self-sufficient (${goal.current_year}). ${firstSentence(goal.note)}`,
    );
  }

  return answer(lead, [{ title: "Why", lines: why.slice(0, 4) }, harvestSection(ctx, { timing: false })]);
}

function ph(ctx: ChatContext): string {
  const v = ctx.latest_readings.ph;
  if (v == null) {
    return answer(`**There's no pH sensor on ${ctx.farm.name}.** Qatari soils are usually alkaline (pH 7.8–8.5), but I won't guess this farm's value.`, [
      { title: "Do now", lines: ["Send a soil sample for a lab pH and bicarbonate test before the next season."] },
    ]);
  }
  const probes = ctx.latest_readings.by_probe.map((p) => p.ph).filter((x): x is number => x != null);
  const cls = v < 6.6 ? "acid" : v < 7.4 ? "neutral" : v < 7.9 ? "slightly alkaline" : v < 8.5 ? "moderately alkaline" : "strongly alkaline";
  const change = ctx.trends.ph_change;
  const lead = `Soil pH is **${fmt(v, 2)}** (${cls}, USDA classes).`;
  const why = [
    `${change != null ? `${change >= 0 ? "+" : "−"}${fmt(Math.abs(change), 2)} over ${ctx.trends.window_days} days` : "No trend yet"}${probes.length > 1 ? `; probes range ${fmt(Math.min(...probes), 2)}–${fmt(Math.max(...probes), 2)}` : ""}.`,
  ];
  if (v >= 7.9) why.push("Above ~7.9, phosphorus, iron, zinc and manganese become less available.");
  const steps =
    v >= 7.9
      ? [
          "Use acid-forming fertilisers (ammonium sulphate) and chelated iron (Fe-EDDHA).",
          "If the well water is high in bicarbonate, inject acid into the drip line.",
        ]
      : ["No correction needed; re-check after heavy fertigation."];
  return answer(lead, [
    { title: "Why", lines: why },
    { title: "Do now", lines: steps },
  ]);
}

function nutrients(ctx: ChatContext): string {
  const r = ctx.latest_readings;
  if (r.n_mg_kg == null && r.p_mg_kg == null && r.k_mg_kg == null) {
    return answer(`**There's no nutrient (NPK) sensor on ${ctx.farm.name}**, so I can't read nitrogen, phosphorus or potassium.`, [
      { title: "Do now", lines: ["Send a soil sample for a lab NPK test before changing the fertigation programme.", "Use potassium sulphate rather than potassium chloride on saline water."] },
    ]);
  }
  const lead = `Latest probe estimates: **N ${n0(r.n_mg_kg)}, P ${n0(r.p_mg_kg)}, K ${n0(r.k_mg_kg)} mg/kg** (${r.probes === 1 ? "one probe" : `mean of ${r.probes} probes`}).`;
  return answer(lead, [
    { title: "Why", lines: ["Probe NPK follows fertigation cycles: use it for trends and confirm rates with a lab soil test."] },
    {
      title: "Do now",
      lines: [
        (ctx.derived.predicted_yield_loss_pct ?? 0) >= 2
          ? "On this salinising field use potassium sulphate, not potassium chloride, so fertiliser doesn't add chloride."
          : "Keep the current fertigation schedule and re-check after the next cycle.",
      ],
    },
  ]);
}

function temperature(ctx: ChatContext): string {
  const air = ctx.latest_readings.air;
  const soil = ctx.latest_readings.soil_temperature_c;
  const o = ctx.outlook;
  const heatLine = o?.heat_threshold_c;
  const lead =
    air.temperature_max_c != null
      ? `Air reached **${n0(air.temperature_max_c)} °C** today${heatLine != null && air.temperature_max_c > heatLine ? `, above the ${n0(heatLine)} °C ${cropLower(ctx)} heat line` : ""}${soil != null ? `; the soil is ${n1(soil)} °C` : ""}.`
      : soil != null
        ? `Soil temperature is **${n1(soil)} °C** (probe mean).`
        : "**There's no temperature reading for today.**";
  const why: string[] = [];
  if (air.temperature_min_c != null && air.temperature_max_c != null) {
    why.push(
      `Air ${n0(air.temperature_min_c)}–${n0(air.temperature_max_c)} °C, humidity ${n0(air.humidity_min_pct)}–${n0(air.humidity_max_pct)}%${air.vpd_kpa != null ? `, VPD ${fmt(air.vpd_kpa, 1)} kPa` : ""} (${air.source ?? "no source"}).`,
    );
  }
  if (soil != null && ctx.trends.soil_temperature_change_c != null) {
    const c = ctx.trends.soil_temperature_change_c;
    why.push(`Soil ${n1(soil)} °C, ${c >= 0 ? "up" : "down"} ${n1(Math.abs(c))} °C over ${ctx.trends.window_days} days.`);
  }
  why.push(`Crop water use today: ${n1(ctx.derived.etc_mm_day)} mm/day.`);
  const hot = (air.temperature_max_c ?? 0) >= (heatLine ?? 35) || (soil ?? 0) >= 32;
  const steps = hot
    ? ["Irrigate before 7 am so the crop starts the heat with a full root zone.", "Use shade net on young plants and avoid midday field work.", "In greenhouses run pad-and-fan cooling from mid-morning."]
    : ["No heat action needed; the cooler days also lower water demand."];
  return answer(lead, [
    { title: "Why", lines: why },
    { title: "Do now", lines: steps },
    warningsSection(ctx, /heat/i, 1),
  ]);
}

function et(ctx: ChatContext): string {
  const d = ctx.derived;
  const method = d.et0_method === "penman-monteith" ? "FAO-56 Penman–Monteith" : "Hargreaves (a Penman–Monteith input was missing)";
  const lead = `The crop uses **${n1(d.etc_mm_day)} mm/day** (ETc = Kc ${fmt(d.kc, 2)} × ET₀ ${n1(d.et0_mm_day)} mm/day), about ${n0((d.etc_mm_day ?? 0) * ctx.farm.area_ha * 10)} m³/day for ${n1(ctx.farm.area_ha)} ha.`;
  const why = [
    `ET₀ is from ${method}${d.et0_open_meteo_mm_day != null ? `; Open-Meteo's own estimate is ${n1(d.et0_open_meteo_mm_day)} mm/day as a cross-check` : ""}.`,
    `Kc ${fmt(d.kc, 2)} is for ${cropLower(ctx)} in the ${ctx.farm.growth_stage.toLowerCase()} stage, adjusted for wind and humidity (FAO-56 Eq. 62).`,
  ];
  const o = ctx.outlook;
  const next = o?.crop_water_use_mm != null ? { title: "Next 7 days" as const, lines: [`Crop water use about ${n0(o.crop_water_use_mm)} mm over the week.`, ...(irrigationPlanLine(ctx) ? [irrigationPlanLine(ctx)!] : [])] } : null;
  return answer(lead, [{ title: "Why", lines: why }, next]);
}

function yieldAnswer(ctx: ChatContext): string {
  const d = ctx.derived;
  const e = ctx.economics;
  const loss = d.predicted_yield_loss_pct;
  const ks = d.water_stress_coefficient_ks;
  const lead =
    loss != null
      ? `Expected harvest is **${tonnes(e.expected_yield_t)}** this ${e.per}${loss >= 2 ? `, after about ${n0(loss)}% lost to salinity` : ""}.`
      : `Expected harvest is **${tonnes(e.expected_yield_t)}** this ${e.per} (no salinity sensor, so no salt loss is counted).`;
  const why: string[] = [];
  if (loss != null) why.push(`Salinity: ECe ${n1(d.ece_dS_m)} dS/m against a ${n1(d.crop_salinity_threshold_dS_m)} dS/m threshold (Maas–Hoffman).`);
  why.push(
    ks != null && ks < 1
      ? `Water stress: Ks ${fmt(ks, 2)}, so growth is down about ${n0((1 - ks) * 100)}% until the root zone is refilled.`
      : "Water: no water stress today (Ks = 1).",
  );
  why.push(`Yields are indicative Qatar ranges for ${cropLower(ctx)}.`);
  return answer(lead, [{ title: "Why", lines: why }, costSection(ctx, { water: false, revenue: true }), harvestSection(ctx, { timing: true })]);
}

function hotspots(ctx: ChatContext): string {
  const salty = worstProbe(ctx, "ece_dS_m", "max");
  const dry = worstProbe(ctx, "water_deficit_pct_of_raw", "max");
  const spots = [dry && `the ${dry.location} (${dry.sensor_id}, driest)`, salty && `the ${salty.location} (${salty.sensor_id}, saltiest)`].filter(Boolean);
  const lead = spots.length ? `Check **${spots.join(" and ")}** first.` : "**No probe stands out today.**";
  const why: string[] = [];
  if (dry) why.push(`${dry.sensor_id}: ${n1(dry.moisture_pct)}% moisture, ${n0(dry.water_deficit_pct_of_raw)}% of the easy water used.`);
  if (salty) why.push(`${salty.sensor_id}: ECe ${n1(salty.ece_dS_m)} dS/m, ${n0(salty.yield_loss_pct)}% yield loss.`);
  return answer(lead, [
    { title: "Why", lines: why },
    { title: "Do now", lines: ["Walk those blocks and check emitters, pressure and leaks.", "Switch the map layer to Salinity or Water deficit to see the pattern between probes."] },
  ]);
}

function forecast(ctx: ChatContext, question: string): string {
  const o = ctx.outlook;
  const f = ctx.weather_next_12h;
  // "Today", "tonight", "next hours": the hourly forecast answers it.
  if (f && /\b(today|tonight|this (morning|afternoon|evening)|next (few |12 |twelve )?hours?|right now|now|hourly)\b/i.test(question)) {
    const hot = f.temp_max_c != null ? `up to **${n0(f.temp_max_c)} °C**${f.hottest_at ? ` around ${f.hottest_at}` : ""}` : "";
    const rain = f.rain_total_mm >= 0.1 ? `${n1(f.rain_total_mm)} mm of rain` : "no rain";
    const wind = f.wind_max_ms != null ? `wind up to ${n1(f.wind_max_ms)} m/s` : "";
    // "What should I do today?" also wants the farm's own priorities, ahead of the weather tips.
    const wantsTasks = /what (should|do|can) i do|to ?do|priorit|plan|task/i.test(question);
    const steps: string[] = wantsTasks ? (ctx.latest_insight?.recommendations ?? []).slice(0, 2).map((r) => r.title) : [];
    if (f.wind_max_ms != null && f.wind_max_ms < WINDY_M_S && f.rain_total_mm < 0.1) steps.push("Calm and dry: a good window for spraying, early in the morning or late afternoon.");
    if (f.wind_max_ms != null && f.wind_max_ms >= WINDY_M_S) steps.push("Too windy to spray; secure shade nets and covers.");
    if (f.temp_max_c != null && f.temp_max_c >= 38) steps.push("Irrigate before 7 am and avoid working the field in the midday heat.");
    return answer(`Next 12 hours: ${[hot, rain, wind].filter(Boolean).join(", ")}.`, [
      { title: "Do now", lines: steps.slice(0, wantsTasks ? 4 : 3) },
      next12Section(ctx),
      wantsTasks ? warningsSection(ctx, undefined, 2) : null,
    ]);
  }
  if (!o || o.days.length === 0) {
    return answer("**There's no forecast for this date**: the 7-day outlook is only available for today's readings.", [
      { title: "Do now", lines: ["Switch the date back to today to see the week ahead."] },
    ]);
  }
  const wantsSpray = /spray|\bwind|dust/i.test(question);
  const wantsHumid = /humid|\bdew\b|fung|mildew|disease/i.test(question);
  const calm = o.calm_days;
  let lead: string;
  if (wantsSpray) {
    lead = calm.length
      ? `Best spray days: **${formatDays(calm)}** (wind under ${kmh(WINDY_M_S)} km/h, no rain).`
      : `**No good spray day this week**: wind stays above ${kmh(WINDY_M_S)} km/h or rain is due.`;
  } else if (wantsHumid) {
    lead = o.humid_days.length
      ? `**${o.humid_days.length} humid night${o.humid_days.length === 1 ? "" : "s"}** this week (≥ 90% humidity) — fungal disease risk.`
      : "**No humid nights this week**: fungal disease risk is low.";
  } else {
    const highs = o.days.map((d) => d.tmax_c).filter((v): v is number => v != null);
    const water =
      o.irrigations == null ? null : o.irrigations === 0 ? "no irrigation due" : `${o.irrigations} irrigation${o.irrigations === 1 ? "" : "s"} (${n0(o.irrigation_gross_mm)} mm)`;
    const parts = [highs.length ? `highs up to **${n0(Math.max(...highs))} °C**` : null, water, o.rain_mm > 0 ? `${n0(o.rain_mm)} mm rain` : "no rain"];
    lead = `Next 7 days: ${parts.filter(Boolean).join(", ")}.`;
  }

  const steps: string[] = [];
  if (calm.length && !wantsHumid) steps.push(`Spray or apply foliar feed on ${formatDays(calm.slice(0, 2))}, early morning.`);
  if (o.humid_days.length) steps.push("Irrigate in the morning so leaves dry by night; scout for mildew and blight after humid nights.");
  if (o.strong_wind_days.length) steps.push(`Secure shade nets and greenhouse covers before ${formatDay(o.strong_wind_days[0])}.`);
  if (o.heat_days.length && !wantsSpray && !wantsHumid) steps.push("Irrigate before 7 am on the hottest days.");
  const air = ctx.latest_readings.air;
  const why: Section | null =
    wantsHumid && air.dew_point_c != null
      ? { title: "Why", lines: [`Today the dew point is ${n0(air.dew_point_c)} °C and night humidity reached ${n0(air.humidity_max_pct)}%; ${ctx.location.distance_to_coast_km < 15 ? "this site is near the coast, so nights stay humid" : "leaves wet with dew stay wet until the sun is up"}.`] }
      : wantsSpray && air.wind_10m_m_s != null
        ? { title: "Why", lines: [`Wind today is ${n1(air.wind_10m_m_s)} m/s at 10 m (${kmh(air.wind_10m_m_s)} km/h, ${ctx.measured.wind === "station" ? "farm station" : "Open-Meteo"}); spray drifts above ${kmh(WINDY_M_S)} km/h.`] }
        : null;
  // A spray or disease question gets its own warnings; the whole week is for "what's the forecast".
  const focused = wantsSpray || wantsHumid;
  return answer(lead, [
    why,
    { title: "Do now", lines: steps.slice(0, 3) },
    focused ? null : next12Section(ctx),
    focused ? null : next7Section(ctx),
    warningsSection(ctx, wantsHumid ? /humid|fung/i : wantsSpray ? /wind|dust|spray/i : undefined),
  ]);
}

function economics(ctx: ChatContext): string {
  const e = ctx.economics;
  const lead = `At indicative prices the ${n1(e.area_ha)} ha of ${cropLower(ctx)} should bring **${qar(e.revenue_qar)}** this ${e.per}.`;
  const why = [
    `${tonnes(e.expected_yield_t)} at QAR ${fmt(e.price_qar_kg.low, 1)}–${fmt(e.price_qar_kg.high, 1)}/kg averaged over ${e.price_months === "all year" ? "the year" : e.price_months}${e.relative_yield_pct != null && e.relative_yield_pct < 100 ? `, after salinity (${n0(e.relative_yield_pct)}% of full yield)` : ""}.`,
    `Market now, in the ${ctx.market.season}: ${PRICE_SIGNAL_LABEL[e.market_now].toLowerCase()}; at harvest: ${PRICE_SIGNAL_LABEL[e.market_at_harvest].toLowerCase()}.`,
  ];
  const steps: string[] = [];
  if (e.market_now === "scarce") steps.push("Sell through Mahaseel or the Al Sailiya Central Market while prices are high; pick at first colour to move volume early.");
  if (e.market_at_harvest === "glut") steps.push("Contract part of the harvest (Mahaseel, hotels, retailers) before the winter glut.");
  if ((e.relative_yield_pct ?? 100) < 90) steps.push(`Leach salt now: it costs ${100 - Math.round(e.relative_yield_pct ?? 100)}% of the harvest, the biggest loss in this budget.`);
  return answer(lead, [
    { title: "Why", lines: why },
    { title: "Do now", lines: steps },
    costSection(ctx, { revenue: false }),
  ]);
}

function harvest(ctx: ChatContext): string {
  const h = ctx.harvest;
  const lead = harvestTimingLine(ctx);
  const steps: string[] = [];
  if (h.status === "harvesting") steps.push("Pick every 2–3 days in the cool early morning and get produce into shade or a cold room within an hour.");
  if (h.status === "cutting") steps.push("Cut at early bloom (about 10% flowers) for the best protein; leave 5–8 cm of stubble.");
  if ((h.status === "growing" || h.status === "establishing") && h.days_to_first_harvest != null && h.days_to_first_harvest <= 21) {
    steps.push("Line up pickers, crates and a buyer (Mahaseel or the Al Sailiya Central Market) now.");
  }
  if (h.status === "ending" || h.status === "finished") steps.push(`Order seed for the next crop and prepare beds; leach before planting if ECe is high.`);
  return answer(lead, [
    { title: "Do now", lines: steps },
    harvestSection(ctx, { timing: false }),
    costSection(ctx, { water: false, risk: false, revenue: true }),
  ]);
}

function location(ctx: ChatContext): string {
  const l = ctx.location;
  const lat = `${Math.abs(l.lat).toFixed(4)}° ${l.lat >= 0 ? "N" : "S"}`;
  const lng = `${Math.abs(l.lng).toFixed(4)}° ${l.lng >= 0 ? "E" : "W"}`;
  const lead = `${ctx.farm.name} is at **${lat}, ${lng}**, ${l.place} (${l.municipality}).`;
  const why = [
    `${n1(l.distance_to_coast_km)} km from the sea (${l.coast_band.replace("-", " ")}); ${l.groundwater_basin} groundwater basin, typically ECw ${n1(l.typical_groundwater_ec_dS_m.low)}–${n1(l.typical_groundwater_ec_dS_m.high)} dS/m.`,
    ...l.notes.slice(0, 2),
  ];
  return answer(lead, [{ title: "Why", lines: why }]);
}

function summary(ctx: ChatContext): string {
  const insight = ctx.latest_insight;
  if (!insight) return irrigation(ctx);
  const top = insight.recommendations.slice(0, 3);
  const lead = `${ctx.farm.name} is at **${insight.risk_level} risk (${Math.round(insight.risk_score)}/100)**. ${firstSentence(insight.summary)}`;
  return answer(lead, [
    { title: "Do now", lines: top.map((r) => r.title) },
    warningsSection(ctx, undefined, 2),
    next7Section(ctx, { weather: false }),
  ]);
}

const RENDER: Record<Topic, (ctx: ChatContext, question: string) => string> = {
  location,
  hotspots,
  forecast,
  economics,
  harvest,
  salinity,
  irrigation,
  crop,
  ph,
  nutrients,
  temperature,
  et,
  yield: yieldAnswer,
  summary,
};

export function answerOffline(question: string, ctx: ChatContext): string {
  const q = question.trim();
  if (/^(hi|hello|hey|salam|marhaba|good (morning|evening))\b/i.test(q) && q.length < 30) {
    return `Hello! I'm looking at ${ctx.farm.name} (${cropLower(ctx)}, ${ctx.farm.growth_stage.toLowerCase()} stage, ${ctx.location.place}). Ask me about irrigation, salinity, the week's weather, costs, harvest or what to plant next.`;
  }
  if (/^(thanks|thank you|shukran|great|ok|okay)\b/i.test(q) && q.length < 30) {
    return "You're welcome — ask me anything else about this farm.";
  }
  // One focused answer reads better than two stitched together; the chips cover the rest.
  const [topic] = detectTopics(q);
  return RENDER[topic](ctx, q);
}

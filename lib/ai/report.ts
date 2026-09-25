/**
 * The report sections of an insight — Insights, Warnings, Forecast, Economics, Harvest — written
 * from the farm facts with transparent rules. This is what the rule engine stores in `ai_insights`
 * and what the fine-tuning dataset teaches a model to write (see scripts/build-dataset.ts). Every
 * number in the text comes from `farm-facts.ts` or the FAO-56 / FAO-29 engine.
 */
import { CROPS } from "../agronomy-tables";
import { formatDay, formatShortDay } from "../format";
import { WATER_POLICY } from "../qatar/food-security";
import { PRICE_SIGNAL_LABEL, SEASON_LABEL } from "../qatar/market";
import type { FarmBundle, FarmDay } from "../types";
import { fmt, trend } from "./analysis";
import type { Economics, Finding, Forecast, ForecastDay, Harvest, Warning } from "./contract";
import { WINDY_M_S, type FarmFacts, type OutlookDay, type Range } from "./farm-facts";

export interface ReportSections {
  insights: Finding[];
  warnings: Warning[];
  forecast: Forecast | null;
  economics: Economics | null;
  harvest: Harvest | null;
}

const n0 = (v: number | null | undefined) => fmt(v, 0);
const n1 = (v: number | null | undefined) => fmt(v, 1);
const kmh = (ms: number) => Math.round(ms * 3.6);
const qar = (r: Range) => (r.low === r.high ? `QAR ${n0(r.low)}` : `QAR ${n0(r.low)}–${n0(r.high)}`);
const range = (r: Range, unit: string) => (r.low === r.high ? `${n0(r.low)} ${unit}` : `${n0(r.low)}–${n0(r.high)} ${unit}`);

/** "Thu 25 – Sat 27 Sep" for consecutive days, comma-separated runs otherwise. */
export function formatDays(dates: string[]): string {
  if (dates.length === 0) return "";
  const sorted = [...dates].sort();
  const runs: string[][] = [];
  for (const d of sorted) {
    const run = runs.at(-1);
    const prev = run?.at(-1);
    if (run && prev && Date.parse(`${d}T00:00:00Z`) - Date.parse(`${prev}T00:00:00Z`) === 86_400_000) run.push(d);
    else runs.push([d]);
  }
  return runs
    .map((r) => {
      if (r.length === 1) return formatDay(r[0]);
      const [first, last] = [formatDay(r[0]), formatDay(r[r.length - 1])];
      const sameMonth = r[0].slice(0, 7) === r[r.length - 1].slice(0, 7);
      return `${sameMonth ? first.replace(/ \w+$/, "") : first} – ${last}`;
    })
    .join(", ");
}

const hottest = (days: OutlookDay[], dates: string[]) => Math.max(...days.filter((d) => dates.includes(d.date)).map((d) => d.tmax_c ?? -Infinity));
const windiest = (days: OutlookDay[], dates: string[]) => Math.max(...days.filter((d) => dates.includes(d.date)).map((d) => d.wind_10m_m_s ?? 0));

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = { critical: 0, warning: 1, watch: 2 } as const;

export function buildWarnings(bundle: FarmBundle, day: FarmDay, facts: FarmFacts): Warning[] {
  const crop = CROPS[bundle.farm.main_crop];
  const cropNoun = crop.name.toLowerCase();
  const o = facts.outlook;
  const out: Warning[] = [];

  if ((day.deficitPct ?? 0) > 100) {
    out.push({
      severity: "critical",
      title: "The crop is short of water now",
      detail: `${n0(day.dr)} mm of water has been used from the root zone against ${n0(day.raw)} mm the crop can take up easily, so growth is already slowing (Ks ${fmt(day.ks, 2)}). Irrigate ${n0(day.grossDepth)} mm today.`,
      when: "Today",
    });
  }
  if (o && o.extreme_heat_days.length) {
    out.push({
      severity: "critical",
      title: `Extreme heat: up to ${n0(hottest(o.days, o.extreme_heat_days))} °C`,
      detail: "Irrigate before 7 am and keep the root zone moist, shade young plants, and don't transplant, prune or spray. Expect flower and fruit drop.",
      when: formatDays(o.extreme_heat_days),
    });
  }
  if (o) {
    const hot = o.heat_days.filter((d) => !o.extreme_heat_days.includes(d));
    if (hot.length) {
      out.push({
        severity: "warning",
        title: `Heat stress: highs up to ${n0(hottest(o.days, hot))} °C`,
        detail: `Above the ${o.heat_threshold_c} °C line where ${bundle.farm.main_crop === "alfalfa" ? `${cropNoun} growth slows` : `${cropNoun} drops flowers and sets less fruit`}. Irrigate early in the morning and avoid afternoon field work on the crop.`,
        when: formatDays(hot),
      });
    }
    if (o.strong_wind_days.length) {
      const w = windiest(o.days, o.strong_wind_days);
      out.push({
        severity: "warning",
        title: `Strong wind and dust: ${n1(w)} m/s (${kmh(w)} km/h)`,
        detail: "Secure greenhouse covers and shade nets, don't spray, and walk the drip lines afterwards for displaced or clogged emitters. Blowing dust also raises crop water use.",
        when: formatDays(o.strong_wind_days),
      });
    }
  }
  if ((day.yieldLoss ?? 0) >= 2 && day.ece != null) {
    const risk = facts.economics.revenue_at_risk_qar;
    out.push({
      severity: "warning",
      title: `Salt is costing about ${n0(day.yieldLoss)}% of the yield`,
      detail: `ECe ${n1(day.ece)} dS/m is above the ${n1(crop.salinity.threshold_dS_per_m)} dS/m ${cropNoun} limit${risk ? ` — about ${qar(risk)} this ${facts.economics.per} at indicative prices` : ""}. Apply ${n0(day.grossDepth)} mm per irrigation to flush salt.`,
      when: "Now",
    });
  }
  if (o) {
    const next = o.days.find((d) => (d.irrigate_mm ?? 0) > 0);
    if (!(day.deficitPct != null && day.deficitPct > 100) && next && next.date === o.days[0]?.date) {
      out.push({
        severity: "watch",
        title: `Irrigation due tomorrow: about ${n0(next.irrigate_mm)} mm`,
        detail: `Crop water use of ${n1(next.etc_mm)} mm a day brings the root zone to the trigger by ${formatDay(next.date)}.`,
        when: formatDay(next.date),
      });
    }
    const windyOnly = o.windy_days.filter((d) => !o.strong_wind_days.includes(d));
    if (windyOnly.length) {
      out.push({
        severity: "watch",
        title: `Windy: don't spray (over ${kmh(WINDY_M_S)} km/h)`,
        detail: `Spray drifts and sprinklers lose water in wind above about ${n1(WINDY_M_S)} m/s.${o.calm_days.length ? ` Calmer days for spraying: ${formatDays(o.calm_days.slice(0, 3))}.` : ""}`,
        when: formatDays(windyOnly),
      });
    }
    if (o.humid_days.length) {
      out.push({
        severity: "watch",
        title: "Humid nights: fungal disease risk",
        detail: `Night humidity reaches 90% or more, so leaves stay wet with dew${facts.location.coast_band !== "inland" ? " (this site is near the coast)" : ""}. Scout for mildew and blight, irrigate in the morning, and in greenhouses ventilate at dawn.`,
        when: formatDays(o.humid_days),
      });
    }
  }
  const h = facts.harvest;
  if (h.status === "growing" && h.days_to_first_harvest != null && h.days_to_first_harvest <= 14 && h.first_harvest) {
    out.push({
      severity: "watch",
      title: `First harvest in about ${h.days_to_first_harvest} days`,
      detail: `Line up labour, crates and a buyer (Mahaseel or the central market) before ${formatShortDay(h.first_harvest)}. The market then: ${PRICE_SIGNAL_LABEL[h.harvest_market]}.`,
      when: formatDay(h.first_harvest),
    });
  } else if (h.status === "ending" && h.last_harvest) {
    out.push({
      severity: "watch",
      title: "The season is ending",
      detail: `Plan the last picks and prepare the field for ${h.next_crops[0]?.crop.toLowerCase() ?? "the next crop"} (plant from ${h.next_crops[0]?.plant_from ?? "the next window"}).`,
      when: `By ${formatShortDay(h.last_harvest)}`,
    });
  }
  if (h.harvest_market === "glut" && (h.status === "growing" || h.status === "harvesting")) {
    out.push({
      severity: "watch",
      title: "The harvest lands in the winter glut",
      detail: `Local ${cropNoun} is plentiful in the peak season, so prices fall. Pre-sell to Mahaseel, stagger picking, or grade for premium outlets.`,
      when: SEASON_LABEL.peak,
    });
  }
  if (bundle.farm.main_crop === "alfalfa") {
    out.push({
      severity: "watch",
      title: "Fodder is moving off groundwater",
      detail: `Qatar plans to irrigate fodder with treated sewage effluent (TSE) instead of groundwater by 2030; groundwater is pumped at about ${Math.round(WATER_POLICY.groundwaterAbstraction_Mm3_per_yr / WATER_POLICY.groundwaterSafeYield_Mm3_per_yr)} times its safe yield. Ask the Ministry of Municipality about a TSE connection.`,
      when: "By 2030",
    });
  }
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, 6);
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export function buildFindings(bundle: FarmBundle, index: number, day: FarmDay, facts: FarmFacts): Finding[] {
  const crop = CROPS[bundle.farm.main_crop];
  const out: Finding[] = [];
  const air = facts.air;

  if (day.dr != null && day.deficitPct != null) {
    const days = day.daysToIrrigation;
    const stressed = day.deficitPct > 100;
    const next = stressed || days == null ? "" : days < 0.5 ? " Irrigation is due today." : ` Next irrigation in about ${n0(Math.max(1, days))} day${Math.round(days) === 1 ? "" : "s"}.`;
    const use = `The crop uses ${n1(day.etc)} mm a day (ET₀ ${n1(day.et0)} × Kc ${fmt(day.kc, 2)}).`;
    out.push(
      stressed
        ? {
            title: "Root zone past the irrigation trigger",
            detail: `Soil moisture is ${n1(day.moisture)}% (${day.sensors.length === 1 ? "one probe" : `mean of ${day.sensors.length} probes`}): ${n0(day.dr)} mm depleted against ${n0(day.raw)} mm of readily available water, so the crop is stressed (Ks ${fmt(day.ks, 2)}). ${use}`,
          }
        : {
            title: `Root zone: ${n0(day.deficitPct)}% of the easy water used`,
            detail: `Soil moisture is ${n1(day.moisture)}% (${day.sensors.length === 1 ? "one probe" : `mean of ${day.sensors.length} probes`}), ${n0(day.dr)} of ${n0(day.raw)} mm of readily available water used. ${use}${next}`,
          },
    );
  }

  if (air.temperature_max_c != null) {
    const dry = (air.vpd_kpa ?? 0) >= 2.5;
    const humid = (air.humidity_max_pct ?? 0) >= 90;
    const title = dry ? `Hot, dry air: VPD ${fmt(air.vpd_kpa, 1)} kPa` : humid ? "Humid night, dew likely" : `Air: ${n0(air.temperature_max_c)} °C, VPD ${fmt(air.vpd_kpa, 1)} kPa`;
    const parts = [
      `Air ${n0(air.temperature_min_c)}–${n0(air.temperature_max_c)} °C, humidity ${n0(air.humidity_min_pct)}–${n0(air.humidity_max_pct)}%${air.dew_point_c != null ? `, dew point ${n0(air.dew_point_c)} °C` : ""} (${air.source === "probe mast" ? "farm sensor" : "Open-Meteo"}).`,
      air.wind_10m_m_s != null ? `Wind ${n1(air.wind_10m_m_s)} m/s at 10 m (${n1(air.wind_2m_m_s)} m/s at crop height).` : null,
      dry
        ? "Dry air pulls water out of the leaves fast, which is why crop water use is high; irrigate early and don't let the root zone run down."
        : humid
          ? "Leaves stay wet overnight; that favours fungal disease."
          : null,
    ];
    out.push({ title, detail: parts.filter(Boolean).join(" ") });
  }

  if (facts.measured.salinity && day.ece != null) {
    const t = trend(bundle, index, 30, (d) => d.ece);
    out.push({
      title: `Salt: ECe ${n1(day.ece)} dS/m${(t.changePct ?? 0) > 5 ? `, up ${n0(t.changePct)}% in ${t.days} days` : ""}`,
      detail: `${crop.name} starts losing yield above ${n1(crop.salinity.threshold_dS_per_m)} dS/m (FAO-29). ${(day.yieldLoss ?? 0) >= 2 ? `Predicted loss today: ${n0(day.yieldLoss)}%.` : "No yield lost yet."} Irrigation water is ECw ${n1(bundle.farm.irrigation_water_ec)} dS/m.`,
    });
  } else {
    out.push({
      title: "Salinity isn't measured",
      detail: `There is no soil EC reading, so salt build-up can't be tracked. With irrigation water at ECw ${n1(bundle.farm.irrigation_water_ec)} dS/m, keep the ${n0(day.lr * 100)}% leaching fraction and send a soil sample to a lab each season.`,
    });
  }

  const moist = trend(bundle, index, 30, (d) => d.moisture);
  if (moist.changePct != null && Math.abs(moist.changePct) >= 10 && moist.from != null) {
    out.push({
      title: `Soil moisture ${moist.changePct < 0 ? "down" : "up"} ${n0(Math.abs(moist.changePct))}% in ${moist.days} days`,
      detail: `From ${n1(moist.from)}% to ${n1(moist.to)}%. ${moist.changePct < 0 ? "Irrigation isn't keeping up with crop water use; check run times and emitter flow." : "Wetter than a month ago; make sure the field drains and roots aren't sitting in water."}`,
    });
  } else {
    const loc = facts.location;
    out.push({
      title: `Site: ${loc.place}, ${n0(loc.distance_to_coast_km)} km from the sea`,
      detail: loc.notes.slice(0, 2).join(" "),
    });
  }
  return out.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

function dayLabel(d: OutlookDay): Pick<ForecastDay, "label" | "level"> {
  const parts: string[] = [];
  let level: ForecastDay["level"] = "ok";
  if (d.flags.includes("irrigate")) parts.push(`Irrigate ${n0(d.irrigate_mm)} mm`);
  if (d.flags.includes("extreme-heat")) {
    parts.push(`extreme heat ${n0(d.tmax_c)} °C`);
    level = "warning";
  } else if (d.flags.includes("heat")) {
    parts.push(`hot ${n0(d.tmax_c)} °C`);
    level = "watch";
  }
  if (d.flags.includes("strong-wind")) {
    parts.push("strong wind, secure covers");
    level = "warning";
  } else if (d.flags.includes("windy")) {
    parts.push("windy, don't spray");
    if (level === "ok") level = "watch";
  }
  if (d.flags.includes("humid")) {
    parts.push("humid night");
    if (level === "ok") level = "watch";
  }
  if (d.flags.includes("rain")) parts.push(`rain ${n1(d.rain_mm)} mm`);
  if (parts.length === 0) parts.push(d.tmax_c != null ? `${n0(d.tmax_c)} °C, calm` : "No alerts");
  const label = parts.join(", ");
  return { label: label.charAt(0).toUpperCase() + label.slice(1), level };
}

export function buildForecast(bundle: FarmBundle, facts: FarmFacts): Forecast | null {
  const o = facts.outlook;
  if (!o || o.days.length === 0) return null;
  const highs = o.days.map((d) => d.tmax_c).filter((v): v is number => v != null);
  const parts = [
    highs.length ? `highs ${n0(Math.min(...highs))}–${n0(Math.max(...highs))} °C` : null,
    o.windy_days.length ? `${o.windy_days.length} windy day${o.windy_days.length === 1 ? "" : "s"} (${formatDays(o.windy_days)})` : "light winds",
    o.humid_days.length ? `${o.humid_days.length} humid night${o.humid_days.length === 1 ? "" : "s"}` : null,
    o.rain_mm >= 1 ? `${n1(o.rain_mm)} mm of rain` : "no rain",
  ].filter(Boolean);
  const water =
    o.irrigations == null
      ? "No soil-moisture reading, so the irrigation plan can't be projected."
      : o.irrigations === 0
        ? "No irrigation needed."
        : `Plan ${o.irrigations} irrigation${o.irrigations === 1 ? "" : "s"}, about ${n0(o.irrigation_gross_mm)} mm gross (${n0(o.water_m3)} m³ for ${n1(bundle.farm.area_ha)} ha)${o.assumes_irrigation_today ? " after today's" : ""}.`;
  return {
    summary: `Next ${o.horizon_days} days: ${parts.join(", ")}. ${water}`,
    days: o.days.map((d) => ({ date: d.date, ...dayLabel(d) })),
  };
}

// ---------------------------------------------------------------------------
// Economics
// ---------------------------------------------------------------------------

export function buildEconomicsSection(bundle: FarmBundle, day: FarmDay, facts: FarmFacts): Economics {
  const e = facts.economics;
  const per = e.per === "year" ? "a year" : "this season";
  const lines: Economics["lines"] = [
    {
      label: "Expected harvest",
      value: range(e.expected_yield_t, "t"),
      detail: `${n1(e.area_ha)} ha${e.relative_yield_pct != null && e.relative_yield_pct < 100 ? `, after ${100 - e.relative_yield_pct}% salinity loss` : ""}, ${per}.`,
    },
    {
      label: "Harvest value",
      value: qar(e.revenue_qar),
      detail: `At QAR ${e.price_qar_kg.low}–${e.price_qar_kg.high}/kg averaged over ${e.price_months === "all year" ? "the year" : e.price_months}; market now: ${PRICE_SIGNAL_LABEL[e.market_now]}.`,
    },
  ];
  if (e.revenue_at_risk_qar && (day.yieldLoss ?? 0) >= 2) {
    lines.push({
      label: "Lost to salinity",
      value: qar(e.revenue_at_risk_qar),
      detail: `${n0(day.yieldLoss)}% of the yield at ECe ${n1(day.ece)} dS/m (${e.yield_at_risk_t ? range(e.yield_at_risk_t, "t") : ""}).`,
    });
  }
  if (e.water_7d_m3 != null) {
    lines.push({
      label: "Water, next 7 days",
      value: `${n0(e.water_7d_m3)} m³`,
      detail: `About QAR ${n0(e.water_7d_cost_qar)} in pumping energy.`,
    });
  }
  if (e.leaching_m3_per_irrigation != null && e.leaching_m3_per_irrigation >= 1) {
    lines.push({
      label: "Leaching water",
      value: `${n0(e.leaching_m3_per_irrigation)} m³ per irrigation`,
      detail: `About QAR ${n0(e.leaching_cost_qar_per_irrigation)} each time; it keeps salt below the crop's limit.`,
    });
  }
  const loss = e.revenue_at_risk_qar && (day.yieldLoss ?? 0) >= 2 ? ` Salinity is costing about ${qar(e.revenue_at_risk_qar)} of it.` : "";
  const water = e.water_7d_m3 != null ? ` Water for the next 7 days costs about QAR ${n0(e.water_7d_cost_qar)} to pump.` : "";
  return {
    summary: `The ${bundle.farm.area_ha.toLocaleString("en-US", { maximumFractionDigits: 1 })} ha of ${CROPS[bundle.farm.main_crop].name.toLowerCase()} should bring about ${qar(e.revenue_qar)} ${per} at indicative prices.${loss}${water}`,
    lines,
    assumptions: e.assumptions,
  };
}

// ---------------------------------------------------------------------------
// Harvest
// ---------------------------------------------------------------------------

export function buildHarvestSection(bundle: FarmBundle, facts: FarmFacts): Harvest {
  const h = facts.harvest;
  const crop = CROPS[bundle.farm.main_crop].name.toLowerCase();
  const market = PRICE_SIGNAL_LABEL[h.harvest_market];
  let summary: string;
  switch (h.status) {
    case "growing":
      summary = `First ${crop} harvest in about ${h.days_to_first_harvest} days (around ${formatShortDay(h.first_harvest!)}), picking until about ${formatShortDay(h.last_harvest!)}. It lands in the ${SEASON_LABEL[h.harvest_season]}: ${market}.`;
      break;
    case "harvesting":
      summary = `Harvest is on: pick every 2–3 days until about ${formatShortDay(h.last_harvest!)}. Market now: ${market}.`;
      break;
    case "ending":
      summary = `The season ends around ${formatShortDay(h.last_harvest!)}: plan the final picks and prepare the next crop.`;
      break;
    case "finished":
      summary = "The season is over: clear the crop residue, leach the salt out of the root zone and prepare the next crop.";
      break;
    case "establishing":
      summary = `The ${crop} stand is still establishing; first cut around ${formatShortDay(h.first_harvest!)}.`;
      break;
    case "cutting":
      summary =
        h.days_to_first_harvest === 0
          ? "A cut is due now; then about every 30 days in warm weather, at early bloom."
          : `Next cut around ${formatShortDay(h.first_harvest!)} (about every 30 days in warm weather, at early bloom).`;
      break;
  }
  return {
    status: h.status,
    summary,
    window: h.first_harvest ? { start: h.first_harvest, end: h.last_harvest } : null,
    next_crops: h.next_crops.map((c) => ({ crop: c.crop, reason: c.reason, plant_window: c.plant_months })),
  };
}

export function buildReportSections(bundle: FarmBundle, index: number, day: FarmDay, facts: FarmFacts): ReportSections {
  return {
    insights: buildFindings(bundle, index, day, facts),
    warnings: buildWarnings(bundle, day, facts),
    forecast: buildForecast(bundle, facts),
    economics: buildEconomicsSection(bundle, day, facts),
    harvest: buildHarvestSection(bundle, facts),
  };
}


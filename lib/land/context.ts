/**
 * Turns land-atlas cells and research passages into the compact shapes the AI receives (RAG).
 * Pure — no network — so it is shared by the chat route, the offline engine's tests and the API.
 */
import type { KnowledgeContext, LandContext } from "../ai/contract";
import { searchKnowledge } from "./knowledge";
import { QATAR_MUNICIPALITIES } from "./qatar-municipalities";
import { landCellAt, landNeighbours, municipalitySummary, type LandCell } from "./profile";

const fmt = (v: number, d = 0) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function surroundings(cell: LandCell): string {
  const around = landNeighbours(cell);
  if (around.length === 0) return "No land cells around (island or headland).";
  const arable = around.filter((c) => c.landscape.arable);
  const fert = arable.length ? arable.reduce((a, c) => a + c.landscape.fertilityIndex, 0) / arable.length : 0;
  const best = [...arable].sort((a, b) => b.landscape.fertilityIndex - a.landscape.fertilityIndex)[0];
  const forms = [...new Set(around.map((c) => c.landscape.landformName))].slice(0, 3).join("; ");
  return (
    `${around.length} neighbouring cells (${arable.length} arable): ${forms}. ` +
    (arable.length
      ? `Mean fertility ${fmt(fert)}/100; the most fertile neighbour is ${best.id} (${best.landscape.fertilityClass.toLowerCase()}, ${best.landscape.fertilityIndex}/100, groundwater ≈${fmt(best.landscape.groundwater.tds_mg_l)} mg/L).`
      : "None of them is farmable.")
  );
}

export function toLandContext(cell: LandCell): LandContext {
  const c = cell.climate;
  const l = cell.landscape;
  return {
    cell_id: cell.id,
    municipality: cell.municipality,
    landform: l.landformName,
    coast_distance_km: Math.round(cell.coastDistanceKm * 10) / 10,
    fertility_index: l.fertilityIndex,
    fertility_class: l.fertilityClass,
    rawdat_density: l.rawdatDensity,
    protected_area: l.protectedArea,
    soil: {
      description: l.soil.description,
      texture: l.soil.texture,
      depth: l.soil.depth,
      ph: l.soil.ph,
      organic_matter: l.soil.organicMatter,
      typical_ece_dS_m: l.soil.typicalEce_dS_m,
    },
    climate: {
      annual_rain_mm: c.annualRain_mm,
      rainy_season: c.rainyMonths,
      wettest_month: `${c.wettestMonth.month} (≈${fmt(c.wettestMonth.rain_mm)} mm)`,
      annual_mean_temp_c: c.annualMeanTemp_C,
      july_mean_max_c: c.monthly[6].tmax_C,
      january_mean_min_c: c.monthly[0].tmin_C,
      mean_rh_pct: c.meanRh_pct,
      mean_wind_10m_m_s: c.meanWind10_m_s,
      annual_et0_mm: c.annualEt0_mm,
      peak_et0_mm_day: c.peakEt0.et0_mm_day,
      rain_share_of_et0_pct: c.rainCoverOfEt0_pct,
      method: c.method,
    },
    groundwater: {
      basin: l.groundwater.basin,
      tds_mg_l: l.groundwater.tds_mg_l,
      ecw_dS_m: l.groundwater.ecw_dS_m,
      fao29_restriction: l.groundwater.restriction,
      note: l.groundwater.note,
    },
    crops: cell.crops.slice(0, 10).map((crop) => ({
      crop: crop.name,
      relative_yield_pct: crop.relativeYield,
      with_low_salt_water_pct: crop.relativeYieldLowSaltWater,
      suitability: crop.suitability,
      season: crop.season,
    })),
    description: cell.description,
    surroundings: surroundings(cell),
    sources: cell.sources,
  };
}

/** Land context for a point, or null outside Qatar. */
export function landContextAt(lat: number, lng: number): LandContext | null {
  const cell = landCellAt(lat, lng);
  return cell ? toLandContext(cell) : null;
}

/** Research passages for a question (BM25 over lib/land/knowledge.ts). */
export function knowledgeFor(question: string, k = 3): KnowledgeContext[] {
  return searchKnowledge(question, k).map(({ id, title, text, source, url }) => ({ id, title, text, source, url }));
}

/** Common spellings of the municipality names people type. */
const MUNICIPALITY_ALIASES: Record<string, RegExp> = {
  "Al Shamal": /\b(al[ -]?)?shamal\b|madinat ash shamal|ruwais/i,
  "Al Khor & Al Thakhira": /\b(al[ -]?)?khor\b|thakhira/i,
  "Al Daayen": /\b(al[ -]?)?daayen\b|lusail/i,
  "Umm Salal": /\bumm[ -]?sa?lal\b/i,
  Doha: /\bdoha\b/i,
  "Al Rayyan": /\b(al[ -]?)?rayyan\b|dukhan|abu samra/i,
  "Al Sheehaniya": /\b(al[ -]?)?(sheehaniya|shahaniya|shahaniyah)\b/i,
  "Al Wakrah": /\b(al[ -]?)?wakr(a|ah)\b|mesaieed|khor al udeid/i,
};

/** Summaries of the municipalities a question names (at most two). */
export function regionNotesFor(question: string): string[] {
  const out: string[] = [];
  for (const m of QATAR_MUNICIPALITIES) {
    if (MUNICIPALITY_ALIASES[m.name]?.test(question)) {
      const note = municipalitySummary(m.name);
      if (note) out.push(note);
    }
    if (out.length >= 2) break;
  }
  return out;
}

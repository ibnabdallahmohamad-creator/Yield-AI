/**
 * The land profile of one 10 km² cell: geometry + climate + landscape + crop suitability, and a
 * plain-language description. This is the document the AI retrieves (RAG) for a farm's location.
 */
import { FARM_SEEDS } from "../data/seed-farms";
import { polygonCentroid } from "../geo";
import { climateAt, type ClimateSummary } from "./climate";
import { rankLandCrops, type CropSuitability } from "./crops";
import { cellGeometryAt, cellGeometryById, landCells, neighbourCells, type CellGeometry } from "./grid";
import { landscapeAt, type Landscape } from "./landscape";

export interface LandCell extends CellGeometry {
  climate: ClimateSummary;
  landscape: Landscape;
  /** Every crop ranked for irrigation with the local groundwater, best first. */
  crops: CropSuitability[];
  /** One-paragraph summary. */
  summary: string;
  /** Full description (a few short paragraphs) — the RAG document. */
  description: string;
  /** Demo farms (built-in dataset) inside this cell. */
  demoFarms: string[];
  sources: string[];
}

export const LAND_SOURCES = {
  soils: "Scheibert et al. (2005), The Atlas of Soils for the State of Qatar, Ministry of Municipal Affairs and Agriculture",
  farming: "Karanisa et al. (2021), Agricultural Production in Qatar's Hot Arid Climate, Sustainability 13: 4059",
  rainfall: "Mamoon & Rahman (2017), Rainfall in Qatar: Is it changing?, Natural Hazards 85: 453–470",
  climate: "Qatar Meteorology Department, Doha International Airport climate normals 1962–2013",
  groundwater: "UN-ESCWA & BGR (2013), Inventory of Shared Water Resources in Western Asia, ch. 15",
  salinity: "Ayers & Westcot (1985), FAO Irrigation and Drainage Paper 29 Rev.1, Tables 1 and 4",
  et0: "Allen et al. (1998), FAO Irrigation and Drainage Paper 56 (Hargreaves, Eq. 52)",
  boundaries: "geoBoundaries QAT ADM1 (Runfola et al. 2020, PLoS ONE 15: e0231866), CC BY 4.0",
} as const;

const NOT_ARABLE: Partial<Record<Landscape["landform"], string>> = {
  sabkha: "salt flats over a saline water table",
  dukhan: "saline and gypsiferous soils in an oil-field concession",
  dunes: "mobile sand dunes",
  urban: "built-up land",
  industrial: "industrial land",
};

const fmt = (v: number, d = 0) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function direction(cell: CellGeometry): string {
  const ns = cell.lat >= 25.6 ? "north" : cell.lat >= 25.1 ? "" : "south";
  const ew = cell.lng <= 51.0 ? "west" : cell.lng >= 51.45 ? "east" : "";
  if (!ns && !ew) return "central";
  return ns && ew ? `${ns}-${ew}ern` : `${ns || ew}ern`;
}

function cropSentence(crops: CropSuitability[], arable: boolean): string {
  if (!arable) return "Not suitable for farming.";
  const well = crops.filter((c) => c.suitability === "well-suited");
  const managed = crops.filter((c) => c.suitability === "with-management");
  const parts: string[] = [];
  if (well.length) parts.push(`well suited with the local groundwater: ${well.slice(0, 6).map((c) => c.name).join(", ")}`);
  if (managed.length) parts.push(`possible with extra leaching: ${managed.slice(0, 5).map((c) => `${c.name} (${c.relativeYield}%)`).join(", ")}`);
  const needsLowSalt = crops.filter((c) => c.suitability === "poor" && c.relativeYieldLowSaltWater >= 90 && c.group === "vegetable");
  if (needsLowSalt.length) parts.push(`only with desalinated or blended water: ${needsLowSalt.slice(0, 5).map((c) => c.name).join(", ")}`);
  return parts.length ? `${parts.join("; ")}.` : "Only the most salt-tolerant crops, and only with low-salinity water.";
}

function buildProfile(geo: CellGeometry): LandCell {
  const climate = climateAt(geo.lat, geo.lng, geo.coastDistanceKm);
  const landscape = landscapeAt(geo.lat, geo.lng, geo.coastDistanceKm, climate.annualRain_mm);
  const crops = landscape.arable ? rankLandCrops(landscape.groundwater.ecw_dS_m) : [];
  const demoFarms = FARM_SEEDS.filter((s) => {
    const [lng, lat] = polygonCentroid({ type: "Polygon", coordinates: [s.ring] });
    return lat >= geo.bounds.south && lat < geo.bounds.north && lng >= geo.bounds.west && lng < geo.bounds.east;
  }).map((s) => s.name);

  const where =
    geo.coastDistanceKm < 1
      ? "on the coast"
      : `${fmt(geo.coastDistanceKm, geo.coastDistanceKm < 10 ? 1 : 0)} km from the coast`;
  const gw = landscape.groundwater;
  const c = climate;
  const s = landscape.soil;

  const summary =
    `${landscape.landformName} in ${geo.municipality} (${direction(geo)} Qatar), ${where}. ` +
    `Fertility ${landscape.fertilityClass.toLowerCase()} (${landscape.fertilityIndex}/100 for Qatar); ` +
    `rain ≈${c.annualRain_mm} mm/yr; July highs ≈${fmt(c.summerTmax_C)} °C, January lows ≈${fmt(c.winterTmin_C)} °C; ` +
    `groundwater ≈${fmt(gw.tds_mg_l)} mg/L TDS (ECw ${fmt(gw.ecw_dS_m, 1)} dS/m).`;

  const paragraphs = [
    `Land cell ${geo.id} covers ≈${fmt(geo.landAreaKm2, 1)} km² of land around ${geo.lat.toFixed(3)}° N, ${geo.lng.toFixed(3)}° E in ${geo.municipality}, ${where}. ` +
      `Landform: ${landscape.landformName}; rawdat depressions are ${landscape.rawdatDensity} here.` +
      (landscape.protectedArea ? ` Part of the area may fall within ${landscape.protectedArea} — check with the Ministry of Environment before developing land.` : ""),
    `Soil: ${s.description} Texture ${s.texture}; depth ${s.depth}; pH ${s.ph}; organic matter ${s.organicMatter}` +
      (s.typicalEce_dS_m != null ? `; typical topsoil ECe ≈${fmt(s.typicalEce_dS_m, 1)} dS/m before irrigation.` : ".") +
      ` Fertility: ${landscape.fertilityClass} (${landscape.fertilityIndex}/100 relative to Qatari soils).`,
    `Climate (long-term, modelled): ≈${c.annualRain_mm} mm of rain a year, falling ${c.rainyMonths} (wettest ${c.wettestMonth.month}, ≈${fmt(c.wettestMonth.rain_mm)} mm) and almost none from June to September. ` +
      `Mean temperature ${fmt(c.annualMeanTemp_C, 1)} °C; ${c.hottestMonth.month} highs ≈${fmt(c.hottestMonth.tmax_C, 1)} °C and ${c.coolestMonth.month} lows ≈${fmt(c.coolestMonth.tmin_C, 1)} °C; mean humidity ${c.meanRh_pct}%; mean wind ${fmt(c.meanWind10_m_s, 1)} m/s at 10 m (north-westerly Shamal most common). ` +
      `Reference evapotranspiration ≈${fmt(c.annualEt0_mm)} mm/yr (peak ≈${fmt(c.peakEt0.et0_mm_day, 1)} mm/day in ${c.peakEt0.month}), so rain covers only ≈${fmt(c.rainCoverOfEt0_pct, 0)}% of crop water demand — every crop needs irrigation.`,
    `Groundwater: ${gw.basin}, ≈${fmt(gw.tds_mg_l)} mg/L TDS (ECw ≈${fmt(gw.ecw_dS_m, 1)} dS/m, FAO-29 restriction: ${gw.restriction.replace("-", " to ")}). ${gw.note}`,
    landscape.arable
      ? `What to grow (Maas–Hoffman relative yield with local groundwater, ECe ≈ 1.5 × ECw): ${cropSentence(crops, true)} Open-field vegetables are grown October–April; summer production needs cooled greenhouses or hydroponics.`
      : `Farming: not suitable (${NOT_ARABLE[landscape.landform] ?? "unsuitable land"}).`,
  ];
  if (demoFarms.length) paragraphs.push(`Monitored demo farms in this cell: ${demoFarms.join(", ")}.`);

  return {
    ...geo,
    climate,
    landscape,
    crops,
    summary,
    description: paragraphs.join("\n\n"),
    demoFarms,
    sources: [LAND_SOURCES.soils, LAND_SOURCES.farming, LAND_SOURCES.rainfall, LAND_SOURCES.climate, LAND_SOURCES.groundwater, LAND_SOURCES.salinity, LAND_SOURCES.et0, LAND_SOURCES.boundaries],
  };
}

const profiles = new Map<string, LandCell>();

export function landCellById(id: string): LandCell | null {
  const cached = profiles.get(id);
  if (cached) return cached;
  const geo = cellGeometryById(id);
  if (!geo) return null;
  const profile = buildProfile(geo);
  profiles.set(id, profile);
  return profile;
}

/** The land cell under a point (or the nearest land cell for points just off the coast). */
export function landCellAt(lat: number, lng: number): LandCell | null {
  const geo = cellGeometryAt(lat, lng);
  return geo ? landCellById(geo.id) : null;
}

export function landNeighbours(cell: LandCell): LandCell[] {
  return neighbourCells(cell)
    .map((g) => landCellById(g.id))
    .filter((c): c is LandCell => c !== null);
}

/** Every land cell with its profile (≈1,200). */
export function allLandCells(): LandCell[] {
  return landCells().map((g) => landCellById(g.id)!);
}

/** Aggregate profile of a municipality — used when a question names a region. */
export function municipalitySummary(name: string): string | null {
  const cells = allLandCells().filter((c) => c.municipality.toLowerCase() === name.toLowerCase());
  if (cells.length === 0) return null;
  const area = cells.reduce((a, c) => a + c.landAreaKm2, 0);
  const arable = cells.filter((c) => c.landscape.arable);
  const mean = (f: (c: LandCell) => number, list = cells) => list.reduce((a, c) => a + f(c), 0) / Math.max(1, list.length);
  const best = [...arable].sort((a, b) => b.landscape.fertilityIndex - a.landscape.fertilityIndex)[0];
  const landforms = new Map<string, number>();
  for (const c of cells) landforms.set(c.landscape.landformName, (landforms.get(c.landscape.landformName) ?? 0) + c.landAreaKm2);
  const top = [...landforms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    `${cells[0].municipality}: ${cells.length} land cells (≈${fmt(area)} km²), ${fmt((arable.reduce((a, c) => a + c.landAreaKm2, 0) / area) * 100)}% potentially arable. ` +
    `Main landforms: ${top.map(([n, a]) => `${n.toLowerCase()} (${fmt((a / area) * 100)}%)`).join(", ")}. ` +
    `Rain ≈${fmt(mean((c) => c.climate.annualRain_mm))} mm/yr, July highs ≈${fmt(mean((c) => c.climate.summerTmax_C), 1)} °C, ` +
    `groundwater ≈${fmt(Math.round(mean((c) => c.landscape.groundwater.tds_mg_l, arable.length ? arable : cells) / 50) * 50)} mg/L TDS on average. ` +
    (best ? `Most fertile cell: ${best.id} (${best.landscape.fertilityClass.toLowerCase()}, ${best.landscape.fertilityIndex}/100).` : "No arable land.")
  );
}


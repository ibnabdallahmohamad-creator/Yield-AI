/**
 * Input 3 ("ecosystem") and input 4 ("what can be grown") for any point in Qatar, derived from the FAO
 * datasets in Datasets/ via `scripts/dataset/extract_site_grid.py` → data/dataset/qatar-site-grid.json:
 *
 *  - FAO AQUASTAT aridity index, CRU CL 2.0 rainfall, AQUASTAT ET₀ (~20 km)
 *  - FAO major agricultural systems, GMIA v5 irrigated area and its groundwater share (5 arc-min)
 *  - FAO proportion of irrigated land salinized, HWSD soil water via GlobWat (5 arc-min)
 *  - AgERA5 monthly Tmax / Tmin / rain / ET₀, 1979–2026, as 1991–2020 normals and trends (0.1°)
 *
 * plus the Qatar location facts from `lib/qatar/location.ts` (coast, groundwater basin, municipality).
 */
import grid from "../../data/dataset/qatar-site-grid.json";
import { describeLocation, isInQatar, type QatarLocation } from "../qatar/location";
import { growableCrops, type GrowableCrop } from "./crops";

export interface GridClimate {
  normal_period: Record<string, [number, number]>;
  tmax_monthly_c: number[] | null;
  tmin_monthly_c: number[] | null;
  precip_monthly_mm: number[] | null;
  et0_monthly_mm: number[] | null;
  precip_annual_mm: number | null;
  et0_annual_mm: number | null;
  precip_annual_cv_pct: number | null;
  precip_recent_mean_mm: number | null;
  precip_wettest_year: { year: number; mm: number } | null;
  summer_tmax_trend_c_per_decade: number | null;
  summer_tmax_last5_c: number | null;
  et0_trend_mm_per_decade: number | null;
  series_years: { tmax: [number, number] | null; precip: [number, number] | null };
}

export interface GridCell {
  lat: number;
  lng: number;
  aridity_index?: number | null;
  precip_annual_mm_cru?: number | null;
  et0_annual_mm_aquastat?: number | null;
  farming_system_id?: number | null;
  farming_system?: string;
  irrigated_share_pct?: number | null;
  irrigated_ha?: number | null;
  irrigated_groundwater_pct?: number | null;
  salinized_share_pct?: number | null;
  soil_water_max_mm?: number | null;
  root_depth_m?: number | null;
  wet_days_per_year?: number | null;
  climate: GridClimate | null;
}

const CELLS = (grid as unknown as { cells: GridCell[] }).cells;
export const SITE_GRID_GENERATED = (grid as unknown as { generated: string }).generated;

/** Cells whose centre is on Qatar land and that have climate data. */
export const LAND_CELLS: GridCell[] = CELLS.filter((c) => c.climate?.tmax_monthly_c && isInQatar(c.lat, c.lng));

/** The nearest land cell to a point (cells over the sea are skipped, so coastal points still resolve). */
export function nearestCell(lat: number, lng: number): GridCell {
  let best = LAND_CELLS[0];
  let bestD = Infinity;
  for (const c of LAND_CELLS) {
    const d = (c.lat - lat) ** 2 + ((c.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * `count` cells spread over the land (every k-th cell north to south), plus the cell of each extra point
 * (the demo farms), without duplicates.
 */
export function datasetSites(count: number, extra: Array<{ lat: number; lng: number }> = []): GridCell[] {
  const sorted = [...LAND_CELLS].sort((a, b) => b.lat - a.lat || a.lng - b.lng);
  const picked = new Map<string, GridCell>();
  const key = (c: GridCell) => `${c.lat},${c.lng}`;
  for (const p of extra) picked.set(key(nearestCell(p.lat, p.lng)), nearestCell(p.lat, p.lng));
  const step = sorted.length / Math.max(1, count - picked.size);
  for (let i = 0; picked.size < count && i < sorted.length; i++) {
    const c = sorted[Math.floor(i * step) % sorted.length];
    picked.set(key(c), c);
    if (i * step >= sorted.length) break;
  }
  return [...picked.values()];
}

export type AridityClass = "hyper-arid" | "arid" | "semi-arid" | "dry sub-humid" | "humid";

/** UNEP aridity classes on P/PET. */
export function aridityClass(ai: number): AridityClass {
  if (ai < 0.05) return "hyper-arid";
  if (ai < 0.2) return "arid";
  if (ai < 0.5) return "semi-arid";
  if (ai < 0.65) return "dry sub-humid";
  return "humid";
}

const r0 = (v: number) => Math.round(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function argmax(xs: number[]) {
  return xs.reduce((best, v, i) => (v > xs[best] ? i : best), 0);
}
function argmin(xs: number[]) {
  return xs.reduce((best, v, i) => (v < xs[best] ? i : best), 0);
}

/** Soil texture from the HWSD root-zone water ceiling: the desert sands hold little. */
export function soilTypeOf(cell: GridCell): "sand" | "loamy_sand" {
  return (cell.soil_water_max_mm ?? 90) <= 100 ? "sand" : "loamy_sand";
}

/** Input 3: the ecosystem at a point, from the datasets. */
export function ecosystemInput(lat: number, lng: number) {
  const cell = nearestCell(lat, lng);
  const loc = describeLocation([lng, lat]);
  const c = cell.climate!;
  const tmax = c.tmax_monthly_c!;
  const tmin = c.tmin_monthly_c ?? tmax.map((t) => t - 12);
  const hot = argmax(tmax);
  const cold = argmin(tmin);
  const ai = cell.aridity_index ?? 0.03;
  const et0 = c.et0_annual_mm ?? cell.et0_annual_mm_aquastat ?? 2200;
  const rain = c.precip_annual_mm ?? cell.precip_annual_mm_cru ?? 70;
  const irrigatedPct = cell.irrigated_share_pct ?? 0;
  const cls = aridityClass(ai);
  const setting =
    irrigatedPct >= 1
      ? `inside a mapped irrigated farming cluster (${r1(irrigatedPct)}% of the 10 km cell equipped for irrigation)`
      : irrigatedPct > 0
        ? "with scattered irrigated farms nearby"
        : "with no irrigated farmland mapped in the cell";
  return {
    type: `${cls[0].toUpperCase()}${cls.slice(1)} ${(cell.farming_system ?? "desert").toLowerCase()}, ${loc.coast_band}, ${setting}`,
    place: loc.place,
    municipality: loc.municipality,
    distance_to_coast_km: loc.distance_to_coast_km,
    aridity_index: ai,
    aridity_class: cls,
    farming_system: cell.farming_system ?? "Desert",
    climate_normal: {
      period: `${c.normal_period.tmax?.[0] ?? 1991}–${c.normal_period.tmax?.[1] ?? 2020}`,
      hottest_month: MONTHS[hot],
      hottest_month_mean_max_c: tmax[hot],
      coldest_month: MONTHS[cold],
      coldest_month_mean_min_c: tmin[cold],
      rain_annual_mm: r0(rain),
      rain_year_to_year_variation_pct: c.precip_annual_cv_pct,
      et0_annual_mm: r0(et0),
      water_deficit_mm: r0(et0 - rain),
      wet_days_per_year: cell.wet_days_per_year ?? null,
    },
    climate_trend: {
      period: c.series_years.tmax ? `${c.series_years.tmax[0]}–${c.series_years.tmax[1]}` : null,
      summer_max_temp_change_c_per_decade: c.summer_tmax_trend_c_per_decade,
      summer_mean_max_last_5_years_c: c.summer_tmax_last5_c,
      et0_change_mm_per_decade: c.et0_trend_mm_per_decade,
    },
    soil: {
      texture: soilTypeOf(cell) === "sand" ? "sand" : "loamy sand",
      root_zone_water_max_mm: cell.soil_water_max_mm ?? null,
      rooting_depth_m: cell.root_depth_m ?? null,
    },
    irrigation: {
      irrigated_area_ha_in_cell: cell.irrigated_ha != null ? r0(cell.irrigated_ha) : null,
      groundwater_share_of_irrigation_pct: cell.irrigated_groundwater_pct != null ? r0(cell.irrigated_groundwater_pct) : null,
      irrigated_land_salinized_pct: cell.salinized_share_pct ?? null,
    },
    groundwater: {
      basin: loc.groundwater_basin,
      typical_ec_dS_m: loc.typical_groundwater_ec_dS_m,
    },
  };
}

export type EcosystemInput = ReturnType<typeof ecosystemInput>;

/** Input 4: what can be grown at the point on its typical groundwater (the middle of the basin range). */
export function growableInput(eco: EcosystemInput): { water_assumed: string; crops: GrowableCrop[] } {
  const { low, high } = eco.groundwater.typical_ec_dS_m;
  const ecw = r1((low + high) / 2);
  return {
    water_assumed: `local groundwater, ECw ≈ ${ecw} dS/m (${eco.groundwater.basin} basin typical)`,
    crops: growableCrops(ecw, eco.climate_normal.hottest_month_mean_max_c),
  };
}

export function locationOf(lat: number, lng: number): QatarLocation {
  return describeLocation([lng, lat]);
}

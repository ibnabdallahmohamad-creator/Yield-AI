/**
 * Where a point sits in Qatar: inside the country or not, how far from the sea, the nearest town
 * and its municipality, and which groundwater basin lies under it. Pure functions, no network.
 *
 * Sources
 *  - Outline: Natural Earth 1:10m Admin 0 (public domain), see `outline.ts`.
 *  - Towns: GeoNames via the Open-Meteo geocoding API (coordinates and admin area as returned).
 *  - Groundwater: the northern half of Qatar has a freshwater lens floating on brackish water
 *    (Rus / upper Umm er Radhuma aquifers, TDS about 500–3,000 mg/L); the southern half is
 *    brackish (Abu Samra and other southern aquifers, TDS about 4,000–6,000 mg/L).
 *    Baalousha (2016), "Approaches to achieve sustainable use and management of groundwater
 *    resources in Qatar: A review"; HBKU QEERI, "Qatar's groundwater challenges". The basin line
 *    below (`NORTHERN_BASIN_MIN_LAT`) is an approximation of that split, not a surveyed boundary.
 *  - TDS → EC: TDS (mg/L) ≈ 640 × EC (dS/m), FAO-29 Table 3 note.
 */
import { compassDirection, localProjector, pointInRing, type LngLat } from "../geo";
import { LAND_BORDER_FROM, QATAR_OUTLINE } from "./outline";

export const QATAR_MUNICIPALITIES = [
  "Doha",
  "Al Rayyan",
  "Al Wakrah",
  "Al Khor",
  "Al Shamal",
  "Umm Salal",
  "Al Daayen",
  "Al Sheehaniya",
] as const;
export type Municipality = (typeof QATAR_MUNICIPALITIES)[number];

interface Place {
  name: string;
  lat: number;
  lng: number;
  municipality: Municipality;
}

/** Reference towns and farming villages (GeoNames coordinates and admin area). */
export const QATAR_PLACES: Place[] = [
  { name: "Doha", lat: 25.28545, lng: 51.53096, municipality: "Doha" },
  { name: "Al Rayyan", lat: 25.29194, lng: 51.42444, municipality: "Al Rayyan" },
  { name: "Umm Bab", lat: 25.21417, lng: 50.80722, municipality: "Al Rayyan" },
  { name: "Abu Samra", lat: 24.7437, lng: 50.83174, municipality: "Al Rayyan" },
  { name: "Al Wakrah", lat: 25.17151, lng: 51.60337, municipality: "Al Wakrah" },
  { name: "Al Wukair", lat: 25.15107, lng: 51.53718, municipality: "Al Wakrah" },
  { name: "Al Kharrara", lat: 24.90325, lng: 51.17582, municipality: "Al Wakrah" },
  { name: "Al Khor", lat: 25.68389, lng: 51.50583, municipality: "Al Khor" },
  { name: "Al Thakhira", lat: 25.73201, lng: 51.54377, municipality: "Al Khor" },
  { name: "Umm Birka", lat: 25.7472, lng: 51.45082, municipality: "Al Khor" },
  { name: "Al Ghuwairiya", lat: 25.82882, lng: 51.24567, municipality: "Al Khor" },
  { name: "Madinat ash Shamal", lat: 26.12933, lng: 51.2009, municipality: "Al Shamal" },
  { name: "Al Ruwais", lat: 26.13978, lng: 51.21493, municipality: "Al Shamal" },
  { name: "Al Ghariya", lat: 26.07996, lng: 51.35745, municipality: "Al Shamal" },
  { name: "Fuwairit", lat: 26.02565, lng: 51.36971, municipality: "Al Shamal" },
  { name: "Al Khisah (north)", lat: 25.92442, lng: 51.33994, municipality: "Al Shamal" },
  { name: "Umm Salal Mohammed", lat: 25.41524, lng: 51.40647, municipality: "Umm Salal" },
  { name: "Lusail", lat: 25.4175, lng: 51.5075, municipality: "Al Daayen" },
  { name: "Umm Qarn", lat: 25.55267, lng: 51.431, municipality: "Al Daayen" },
  { name: "Al Kheesa", lat: 25.41644, lng: 51.45905, municipality: "Al Daayen" },
  { name: "Al Sheehaniya", lat: 25.37088, lng: 51.22264, municipality: "Al Sheehaniya" },
  { name: "Rawdat Rashid", lat: 25.23306, lng: 51.20467, municipality: "Al Sheehaniya" },
  { name: "Al Jemailiya", lat: 25.61068, lng: 51.09108, municipality: "Al Sheehaniya" },
  { name: "Dukhan", lat: 25.42485, lng: 50.78227, municipality: "Al Sheehaniya" },
];

/** Approximate southern edge of the Northern Groundwater Basin (freshwater lens), °N. */
export const NORTHERN_BASIN_MIN_LAT = 25.35;
/** Rough box around the peninsula, for input validation before the outline test. */
export const QATAR_BOUNDS = { south: 24.4, west: 50.7, north: 26.2, east: 51.7 } as const;

export type CoastBand = "coastal" | "near-coast" | "inland";
export type GroundwaterBasin = "northern" | "southern";

/** The location section of the AI context, also shown on the Land use page. */
export interface QatarLocation {
  lat: number;
  lng: number;
  /** Inside mainland Qatar (Natural Earth outline). */
  in_qatar: boolean;
  /** e.g. "8 km south-west of Al Khor". */
  place: string;
  nearest_town: string;
  nearest_town_km: number;
  /** Municipality of the nearest reference town — approximate near municipal borders. */
  municipality: Municipality;
  /** Straight-line distance to the sea (the land border with Saudi Arabia is not counted). */
  distance_to_coast_km: number;
  coast_band: CoastBand;
  groundwater_basin: GroundwaterBasin;
  /** Typical groundwater salinity for the basin, as ECw (dS/m) converted from TDS. */
  typical_groundwater_ec_dS_m: { low: number; high: number };
  notes: string[];
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const TDS_PER_EC = 640;

/** Distance (km) from `p` to segment a–b, all in a local projection centred on `p`. */
function segmentDistanceKm(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]) / 1000;
}

export function isInQatar(lat: number, lng: number): boolean {
  if (lat < QATAR_BOUNDS.south || lat > QATAR_BOUNDS.north || lng < QATAR_BOUNDS.west || lng > QATAR_BOUNDS.east) return false;
  return pointInRing(lng, lat, QATAR_OUTLINE);
}

/** Straight-line distance to the coast in km (0 at sea). Ignores the southern land border. */
export function distanceToCoastKm(lat: number, lng: number): number {
  const proj = localProjector(lat, lng);
  const p: [number, number] = [0, 0];
  let best = Infinity;
  const n = QATAR_OUTLINE.length;
  for (let i = 0; i < n; i++) {
    if (i >= LAND_BORDER_FROM) continue;
    const [aLng, aLat] = QATAR_OUTLINE[i];
    const [bLng, bLat] = QATAR_OUTLINE[(i + 1) % n];
    best = Math.min(best, segmentDistanceKm(p, proj.toXY(aLng, aLat), proj.toXY(bLng, bLat)));
  }
  return isInQatar(lat, lng) ? best : 0;
}

export function nearestPlace(lat: number, lng: number): { place: Place; km: number; direction: string } {
  const proj = localProjector(lat, lng);
  let best = QATAR_PLACES[0];
  let bestKm = Infinity;
  for (const place of QATAR_PLACES) {
    const km = Math.hypot(...proj.toXY(place.lng, place.lat)) / 1000;
    if (km < bestKm) {
      best = place;
      bestKm = km;
    }
  }
  // Direction of the point as seen from the town.
  const [x, y] = localProjector(best.lat, best.lng).toXY(lng, lat);
  return { place: best, km: bestKm, direction: compassDirection((Math.atan2(x, y) * 180) / Math.PI) };
}

export function coastBand(km: number): CoastBand {
  if (km < 5) return "coastal";
  if (km < 15) return "near-coast";
  return "inland";
}

export function groundwaterBasin(lat: number): GroundwaterBasin {
  return lat >= NORTHERN_BASIN_MIN_LAT ? "northern" : "southern";
}

const BASIN_TDS: Record<GroundwaterBasin, { low: number; high: number }> = {
  northern: { low: 500, high: 3000 },
  southern: { low: 4000, high: 6000 },
};

/** Everything the AI and the Land use page need to know about a point in Qatar. */
export function describeLocation([lng, lat]: LngLat, knownMunicipality?: string | null): QatarLocation {
  const inQatar = isInQatar(lat, lng);
  const near = nearestPlace(lat, lng);
  const coastKm = distanceToCoastKm(lat, lng);
  const band = coastBand(coastKm);
  const basin = groundwaterBasin(lat);
  const tds = BASIN_TDS[basin];
  const municipality = (QATAR_MUNICIPALITIES as readonly string[]).includes(knownMunicipality ?? "")
    ? (knownMunicipality as Municipality)
    : near.place.municipality;
  const place = near.km < 1 ? `in ${near.place.name}` : `${Math.round(near.km)} km ${near.direction} of ${near.place.name}`;

  const notes: string[] = [];
  if (!inQatar) notes.push("This point is outside mainland Qatar (at sea or across the border); the Qatar reference data may not apply.");
  if (band === "coastal") {
    notes.push("Coastal: humid nights and dew (fungal disease risk), salt spray, and a shallow groundwater lens that seawater can intrude.");
  } else if (band === "near-coast") {
    notes.push("Near the coast: more humid than inland sites, so evaporative (pad-and-fan) greenhouse cooling works less well in summer.");
  } else {
    notes.push("Inland: hotter afternoons and drier air than the coast; evaporative cooling works better, but water demand (ET₀) is higher.");
  }
  notes.push(
    basin === "northern"
      ? `Northern Groundwater Basin: a freshwater lens over brackish water (TDS about ${tds.low.toLocaleString("en-US")}–${tds.high.toLocaleString("en-US")} mg/L). Over-pumping raises salinity.`
      : `Southern basin: brackish groundwater (TDS about ${tds.low.toLocaleString("en-US")}–${tds.high.toLocaleString("en-US")} mg/L); plan for desalinated water or treated sewage effluent (TSE).`,
  );
  if (lat >= 25.9) notes.push("Far north (Al Shamal): exposed to the summer Shamal north-westerly winds; windbreaks help.");

  return {
    lat: round(lat, 5),
    lng: round(lng, 5),
    in_qatar: inQatar,
    place,
    nearest_town: near.place.name,
    nearest_town_km: round(near.km, 1),
    municipality,
    distance_to_coast_km: round(coastKm, 1),
    coast_band: band,
    groundwater_basin: basin,
    typical_groundwater_ec_dS_m: { low: round(tds.low / TDS_PER_EC, 1), high: round(tds.high / TDS_PER_EC, 1) },
    notes,
  };
}

/**
 * Landform, soil and groundwater model for any point in Qatar. Every class, range and number is
 * either taken from the cited literature or is a named model parameter — never random noise —
 * so two cells only differ where the inputs (position, distance to the coast) differ.
 *
 * Sources
 *  - Scheibert, C., Stietiya, M.H., Sommer, J., Abdalla, O.E.S., Schramm, H. & Al Memah, M. (2005).
 *    The Atlas of Soils for the State of Qatar. Ministry of Municipal Affairs and Agriculture, Doha.
 *    (Rawdat soils; shallow calcareous soils on the limestone plateau; sabkha soils.)
 *  - Karanisa, T. et al. (2021). Agricultural Production in Qatar's Hot Arid Climate.
 *    Sustainability 13(7): 4059. https://doi.org/10.3390/su13074059
 *    (Rawdat depressions hold 30–150 cm of calcareous loam / sandy loam colluvium and carry most of
 *    Qatar's farming; the north has the better soils and rainfall.)
 *  - Groundwater: the Rus and Umm er Radhuma aquifers in northern and central Qatar hold water of
 *    ~500–3,000 mg/L TDS, rising toward the sea to ~10,000 mg/L near the coast; the northern basin
 *    is the freshest and the small southern basin has poor-quality water (UN-ESCWA & BGR 2013,
 *    Inventory of Shared Water Resources in Western Asia, ch. 15 "Umm er Radhuma-Dammam Aquifer
 *    System (Centre)"; Fanack Water, "Water Resources in Qatar"). The anchor values below place a
 *    smooth surface through those published ranges.
 *  - Salinity classes of irrigation water: FAO-29 (Ayers & Westcot 1985) Table 1; TDS ≈ 640 × ECw.
 */
import type { SoilType } from "../agronomy-tables";
import { pointInRing, type LngLat } from "../geo";

export type LandformId = "rawdat-plain" | "limestone-plateau" | "coastal-flat" | "sabkha" | "dunes" | "dukhan" | "urban" | "industrial";

interface Zone {
  id: LandformId;
  name: string;
  ring: LngLat[];
}

/**
 * Hand-digitised outlines of the landforms and land uses that rule out or dominate farming.
 * Approximate (±2–3 km) — they classify 10 km² cells, not fields.
 */
const ZONES: Zone[] = [
  {
    id: "urban",
    name: "Greater Doha urban area (Doha, Al Rayyan, Lusail, Al Wakrah)",
    ring: [[51.33, 25.25], [51.4, 25.21], [51.55, 25.12], [51.64, 25.12], [51.64, 25.47], [51.47, 25.49], [51.4, 25.39], [51.33, 25.33], [51.33, 25.25]],
  },
  { id: "industrial", name: "Ras Laffan Industrial City", ring: [[51.47, 25.85], [51.63, 25.85], [51.63, 25.97], [51.47, 25.97], [51.47, 25.85]] },
  { id: "industrial", name: "Mesaieed Industrial City", ring: [[51.5, 24.93], [51.62, 24.93], [51.62, 25.05], [51.5, 25.05], [51.5, 24.93]] },
  {
    id: "dukhan",
    name: "Dukhan anticline and sabkha (oil-field concession)",
    ring: [[50.74, 25.02], [50.89, 25.02], [50.89, 25.66], [50.74, 25.66], [50.74, 25.02]],
  },
  {
    id: "sabkha",
    name: "South-western coastal sabkhas (Salwa Bay)",
    ring: [[50.75, 24.55], [51.02, 24.55], [51.02, 24.95], [50.75, 24.95], [50.75, 24.55]],
  },
  {
    id: "dunes",
    name: "Southern sand-dune belt (Mesaieed – Khor Al Udeid)",
    ring: [[51.18, 24.45], [51.62, 24.45], [51.62, 24.93], [51.4, 25.02], [51.18, 24.9], [51.18, 24.45]],
  },
];

/** Areas worth a regulatory check before farming (approximate outlines). */
const PROTECTED: Zone[] = [
  {
    id: "limestone-plateau",
    name: "Al Reem Biosphere Reserve (UNESCO MAB, 2007)",
    ring: [[50.95, 25.55], [51.25, 25.55], [51.25, 25.92], [50.95, 25.92], [50.95, 25.55]],
  },
  {
    id: "dunes",
    name: "Khor Al Udeid (Inland Sea) protected area",
    ring: [[51.2, 24.45], [51.5, 24.45], [51.5, 24.72], [51.2, 24.72], [51.2, 24.45]],
  },
];

/**
 * Where rawdat depressions cluster (0–1). Smooth bumps centred on the northern and central farm
 * belts described by Karanisa et al. (2021) and the soil atlas: highest in the north-central
 * plain, fading to the south. A density, not a map of individual rawdat.
 */
const RAWDAT_BUMPS = [
  { lat: 25.76, lng: 51.22, sLat: 0.22, sLng: 0.2, amp: 1.0 }, // Al Ghuwariyah – Al Shamal plain
  { lat: 25.52, lng: 51.3, sLat: 0.18, sLng: 0.2, amp: 0.95 }, // Umm Salal – Al Khor inland
  { lat: 25.3, lng: 51.18, sLat: 0.15, sLng: 0.22, amp: 0.7 }, // Al Sheehaniya – Rawdat Rashid
  { lat: 25.0, lng: 51.05, sLat: 0.15, sLng: 0.2, amp: 0.4 }, // Al Karaana – Umm Al Houl hinterland
];

export function rawdatIndex(lat: number, lng: number): number {
  let v = 0.08;
  for (const b of RAWDAT_BUMPS) {
    const g = b.amp * Math.exp(-0.5 * (((lat - b.lat) / b.sLat) ** 2 + ((lng - b.lng) / b.sLng) ** 2));
    v = Math.max(v, g);
  }
  return Math.min(1, v);
}

export interface Landscape {
  landform: LandformId;
  landformName: string;
  /** Can this cell be farmed at all (not urban, industrial, sabkha or dunes)? */
  arable: boolean;
  rawdatIndex: number;
  rawdatDensity: "frequent" | "common" | "scattered" | "rare";
  protectedArea: string | null;
  soil: {
    description: string;
    texture: string;
    depth: string;
    /** Default soil class for new farms here (FAO-56 Table 19 classes used by the engine). */
    farmSoilType: SoilType;
    /** Typical topsoil ECe before irrigation, dS/m (estimate). */
    typicalEce_dS_m: number | null;
    ph: string;
    organicMatter: string;
  };
  groundwater: {
    /** Estimated total dissolved solids, mg/L. */
    tds_mg_l: number;
    /** ECw ≈ TDS / 640 (FAO-29), dS/m. */
    ecw_dS_m: number;
    restriction: "none" | "slight-moderate" | "severe";
    basin: "Northern basin" | "Central basin" | "Southern basin";
    note: string;
  };
  /** 0–100 relative to Qatar's own soils (not a global scale). */
  fertilityIndex: number;
  fertilityClass: "Very low" | "Low" | "Moderate" | "Good" | "High (for Qatar)";
}

const zoneAt = (lng: number, lat: number, zones: Zone[]) => zones.find((z) => pointInRing(lng, lat, z.ring)) ?? null;

export function fertilityClassFor(index: number): Landscape["fertilityClass"] {
  if (index >= 70) return "High (for Qatar)";
  if (index >= 50) return "Good";
  if (index >= 30) return "Moderate";
  if (index >= 15) return "Low";
  return "Very low";
}

/** Groundwater TDS north → south along the aquifers, away from the coast (mg/L, model anchors). */
const INLAND_TDS = [
  { lat: 24.6, tds: 7000 },
  { lat: 25.0, tds: 4500 },
  { lat: 25.3, tds: 2500 },
  { lat: 25.7, tds: 1500 },
  { lat: 26.15, tds: 2000 },
];

function inlandTds(lat: number): number {
  if (lat <= INLAND_TDS[0].lat) return INLAND_TDS[0].tds;
  for (let i = 1; i < INLAND_TDS.length; i++) {
    const a = INLAND_TDS[i - 1];
    const b = INLAND_TDS[i];
    if (lat <= b.lat) return a.tds + ((lat - a.lat) / (b.lat - a.lat)) * (b.tds - a.tds);
  }
  return INLAND_TDS.at(-1)!.tds;
}

export function groundwaterAt(lat: number, coastKm: number, urban: boolean): Landscape["groundwater"] {
  // Sea-water intrusion raises salinity toward the coast (to ~10,000 mg/L at the shore).
  const tds = Math.min(12_000, inlandTds(lat) + 8000 * Math.exp(-coastKm / 4) + (urban ? 2000 : 0));
  const ecw = tds / 640;
  const restriction = ecw < 0.7 ? "none" : ecw <= 3 ? "slight-moderate" : "severe";
  const basin = lat >= 25.45 ? "Northern basin" : lat >= 25.05 ? "Central basin" : "Southern basin";
  const note =
    basin === "Northern basin"
      ? "The Rus / Umm er Radhuma aquifers here are Qatar's freshest, but decades of over-pumping keep pushing salinity up."
      : basin === "Central basin"
        ? "More saline than the north but still used for irrigation; blending with treated or desalinated water helps."
        : "The small southern basin has poor-quality water; most farms here need desalinated water or treated sewage effluent.";
  return {
    tds_mg_l: Math.round(tds / 50) * 50,
    ecw_dS_m: Math.round(ecw * 10) / 10,
    restriction,
    basin,
    note,
  };
}

export function landscapeAt(lat: number, lng: number, coastKm: number, annualRain_mm: number): Landscape {
  const zone = zoneAt(lng, lat, ZONES);
  const rawdat = zone ? 0.05 : rawdatIndex(lat, lng);
  const coastal = !zone && coastKm < 1.5;
  const landform: LandformId = zone?.id ?? (coastal ? "coastal-flat" : rawdat >= 0.45 ? "rawdat-plain" : "limestone-plateau");
  const landformName =
    zone?.name ??
    (coastal
      ? "Coastal flat with saline (sabkha) patches"
      : landform === "rawdat-plain"
        ? "Limestone plain with rawdat depressions"
        : "Rocky limestone plateau (hamada)");
  const arable = landform === "rawdat-plain" || landform === "limestone-plateau" || landform === "coastal-flat";
  const density = rawdat >= 0.7 ? "frequent" : rawdat >= 0.45 ? "common" : rawdat >= 0.2 ? "scattered" : "rare";

  const soil = soilFor(landform, rawdat, coastKm);
  const groundwater = groundwaterAt(lat, coastKm, landform === "urban");

  let fertility: number;
  if (!arable) {
    fertility = landform === "dukhan" ? 8 : 4;
  } else {
    const salinityPenalty = Math.min(20, 2 * Math.max(0, (soil.typicalEce_dS_m ?? 2) - 2));
    const coastPenalty = 10 * Math.exp(-coastKm / 3);
    const rainBonus = ((annualRain_mm - 55) / 50) * 5;
    fertility = 20 + 45 * rawdat - salinityPenalty - coastPenalty + rainBonus;
    fertility = Math.max(5, Math.min(85, fertility));
  }
  const fertilityIndex = Math.round(fertility);

  return {
    landform,
    landformName,
    arable,
    rawdatIndex: Math.round(rawdat * 100) / 100,
    rawdatDensity: density,
    protectedArea: zoneAt(lng, lat, PROTECTED)?.name ?? null,
    soil,
    groundwater,
    fertilityIndex,
    fertilityClass: fertilityClassFor(fertilityIndex),
  };
}

function soilFor(landform: LandformId, rawdat: number, coastKm: number): Landscape["soil"] {
  const coastSalt = 6 * Math.exp(-coastKm / 2);
  const ph = "7.8–8.5 (calcareous, alkaline)";
  const om = "typically below 1 %";
  const r = (v: number) => Math.round(v * 10) / 10;
  switch (landform) {
    case "rawdat-plain":
      return {
        description:
          "Rawdat (depression) soils — calcareous loamy sand to sandy loam colluvium washed in from the surrounding plateau, between patches of shallow stony soil. The best farmland in Qatar.",
        texture: "loamy sand to sandy loam",
        depth: "30–150 cm in the rawdat, under 30 cm on the ridges between them",
        farmSoilType: "loamy_sand",
        typicalEce_dS_m: r(2 + (1 - rawdat) * 2 + coastSalt),
        ph,
        organicMatter: om,
      };
    case "limestone-plateau":
      return {
        description:
          "Shallow, stony calcareous sand and loamy sand (lithosols) over Eocene limestone, with only occasional rawdat. Low water-holding capacity — farms need drip irrigation and imported soil or compost.",
        texture: "sand to loamy sand, gravelly",
        depth: "mostly under 30 cm over limestone",
        farmSoilType: "sand",
        typicalEce_dS_m: r(3.5 + coastSalt),
        ph,
        organicMatter: om,
      };
    case "coastal-flat":
      return {
        description:
          "Low coastal flats with saline sandy soils and sabkha patches; a shallow saline water table limits rooting and leaching.",
        texture: "saline silty sand",
        depth: "shallow water table (often under 1.5 m)",
        farmSoilType: "sand",
        typicalEce_dS_m: r(12 + coastSalt),
        ph,
        organicMatter: om,
      };
    case "sabkha":
    case "dukhan":
      return {
        description:
          landform === "sabkha"
            ? "Sabkha — salt flats with a gypsum and halite crust over a saline water table. Not farmable."
            : "Gypsiferous and saline soils on the Dukhan anticline and its sabkha (Qatar's lowest point, below sea level); an oil-field concession.",
        texture: "saline silty sand with gypsum",
        depth: "saline water table near the surface",
        farmSoilType: "sand",
        typicalEce_dS_m: landform === "sabkha" ? 40 : 10,
        ph,
        organicMatter: "negligible",
      };
    case "dunes":
      return {
        description: "Mobile barchan dunes and sand sheets. No soil development and moving sand — not farmable.",
        texture: "sand",
        depth: "deep loose sand",
        farmSoilType: "sand",
        typicalEce_dS_m: 2,
        ph,
        organicMatter: "negligible",
      };
    default:
      return {
        description: "Built-up or industrial land; original soils are sealed or disturbed.",
        texture: "made ground",
        depth: "—",
        farmSoilType: "sand",
        typicalEce_dS_m: null,
        ph,
        organicMatter: "—",
      };
  }
}

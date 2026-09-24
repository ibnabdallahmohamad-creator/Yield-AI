/**
 * The 8 demo farms in northern Qatar.
 *
 * Field boundaries are real farmland polygons from OpenStreetMap (© OpenStreetMap contributors,
 * ODbL — way IDs noted below) so they line up with the satellite basemap. Elevations are from the
 * Open-Meteo elevation API. Farm names and owners are fictional.
 *
 * `scenario` only drives the synthetic data generator; it is not stored in the database.
 */
import type { CropId, SoilType } from "../agronomy-tables";
import type { GeoPolygon, LngLat } from "../geo";

export type ScenarioKind = "healthy" | "salinity-rising" | "salinity-rising-strong" | "low-moisture";

export interface FarmScenario {
  kind: ScenarioKind;
  /** Field-mean ECe path (dS/m) from the first to the last day of the window. */
  ece: { start: number; end: number };
  /** Extra ECe (dS/m) at the hotspot by the end of the window. */
  eceHotspot: number;
  /** Mean root-zone depletion as a fraction of RAW (1.0 = irrigation trigger). */
  deficit: { base: number; dryFromDay?: number; dryEnd?: number; dryHotspot?: number };
  /** Bearing (degrees clockwise from north) of the hotspot from the field centre. */
  hotspotBearing_deg: number;
  ph: { base: number; drift: number };
  nutrients: { n: number; p: number; k: number };
  /** Local climate offsets vs the regional mean (coastal farms are more humid, inland hotter). */
  climate: { tmaxOffset_C: number; rhOffset_pct: number };
}

export interface FarmSeed {
  id: string;
  name: string;
  owner: string;
  region: string;
  main_crop: CropId;
  /** Planting / establishment date expressed as days before "today" (keeps stages sensible whenever the demo runs). */
  plantedDaysAgo: number;
  soil_type: SoilType;
  elevation_m: number;
  ec_calibration_factor: number;
  irrigation_water_ec: number;
  sensorPrefix: string;
  sensorCount: number;
  osmWayId: number;
  ring: LngLat[];
  scenario: FarmScenario;
}

export const FARM_SEEDS: FarmSeed[] = [
  {
    id: "khor-north",
    name: "Al Khor North Farm",
    owner: "Al Khor Growers Co-op",
    region: "Al Khor",
    main_crop: "tomato",
    plantedDaysAgo: 84,
    soil_type: "sand",
    elevation_m: 16,
    ec_calibration_factor: 3.2,
    irrigation_water_ec: 2.6,
    sensorPrefix: "KN",
    sensorCount: 5,
    osmWayId: 415363926,
    ring: [[51.371501,25.749009],[51.371374,25.74743],[51.371389,25.745957],[51.37217,25.744792],[51.373397,25.744581],[51.373521,25.744447],[51.374448,25.744829],[51.374343,25.744944],[51.37455,25.745824],[51.37533,25.748908],[51.373206,25.749094],[51.371501,25.749009]],
    scenario: {
      kind: "salinity-rising",
      ece: { start: 2.4, end: 5.6 },
      eceHotspot: 1.9,
      deficit: { base: 0.5 },
      hotspotBearing_deg: 40,
      ph: { base: 7.8, drift: 0.2 },
      nutrients: { n: 38, p: 20, k: 150 },
      climate: { tmaxOffset_C: -0.5, rhOffset_pct: 5 },
    },
  },
  {
    id: "khor-pivot",
    name: "Al Khor Pivot 3",
    owner: "Northern Fodder Co.",
    region: "Al Khor",
    main_crop: "alfalfa",
    plantedDaysAgo: 400,
    soil_type: "sand",
    elevation_m: 3,
    ec_calibration_factor: 3.1,
    irrigation_water_ec: 1.6,
    sensorPrefix: "KP",
    sensorCount: 5,
    osmWayId: 569297375,
    ring: [[51.47287,25.63758],[51.472924,25.637144],[51.473071,25.636726],[51.473304,25.63634],[51.473615,25.636003],[51.473993,25.635727],[51.474423,25.635521],[51.474889,25.635394],[51.475373,25.635351],[51.475857,25.635393],[51.476324,25.635518],[51.476754,25.635723],[51.477137,25.636002],[51.477451,25.636342],[51.477686,25.636732],[51.477832,25.637155],[51.477883,25.637596],[51.477838,25.638037],[51.477699,25.638462],[51.47747,25.638855],[51.47716,25.639199],[51.476782,25.639482],[51.47635,25.639694],[51.475877,25.639826],[51.475383,25.639871],[51.474889,25.639828],[51.474414,25.639698],[51.473977,25.639485],[51.473594,25.6392],[51.473282,25.638852],[51.473052,25.638456],[51.472913,25.638026],[51.47287,25.63758]],
    scenario: {
      kind: "healthy",
      ece: { start: 1.5, end: 1.6 },
      eceHotspot: 0.3,
      deficit: { base: 0.42 },
      hotspotBearing_deg: 200,
      ph: { base: 7.9, drift: 0 },
      nutrients: { n: 30, p: 18, k: 180 },
      climate: { tmaxOffset_C: -0.8, rhOffset_pct: 8 },
    },
  },
  {
    id: "shamal-greenhouses",
    name: "Al Shamal Greenhouses",
    owner: "Shamal Fresh Produce",
    region: "Al Shamal",
    main_crop: "cucumber",
    plantedDaysAgo: 75,
    soil_type: "loamy_sand",
    elevation_m: 16,
    ec_calibration_factor: 2.9,
    irrigation_water_ec: 3.4,
    sensorPrefix: "SG",
    sensorCount: 6,
    osmWayId: 226300244,
    ring: [[51.236925,26.014135],[51.238272,26.011547],[51.239027,26.009396],[51.236651,26.006258],[51.234553,26.008282],[51.234141,26.008857],[51.233615,26.009476],[51.23403,26.010396],[51.234567,26.011739],[51.235024,26.013408],[51.235734,26.013753],[51.236166,26.013907],[51.236925,26.014135]],
    scenario: {
      kind: "salinity-rising-strong",
      ece: { start: 3.0, end: 5.4 },
      eceHotspot: 3.2,
      deficit: { base: 0.5 },
      hotspotBearing_deg: 320,
      ph: { base: 7.9, drift: 0.3 },
      nutrients: { n: 42, p: 24, k: 135 },
      climate: { tmaxOffset_C: -0.6, rhOffset_pct: 6 },
    },
  },
  {
    id: "shamal-east",
    name: "Al Shamal East Farm",
    owner: "Shamal Fresh Produce",
    region: "Al Shamal",
    main_crop: "zucchini",
    plantedDaysAgo: 65,
    soil_type: "loamy_sand",
    elevation_m: 9,
    ec_calibration_factor: 3.0,
    irrigation_water_ec: 2.2,
    sensorPrefix: "SE",
    sensorCount: 5,
    osmWayId: 224215157,
    ring: [[51.282967,26.077513],[51.282136,26.079262],[51.280248,26.083165],[51.276595,26.081748],[51.279421,26.075489],[51.282967,26.077513]],
    scenario: {
      kind: "healthy",
      ece: { start: 2.5, end: 2.7 },
      eceHotspot: 0.5,
      deficit: { base: 0.45 },
      hotspotBearing_deg: 90,
      ph: { base: 7.8, drift: 0.02 },
      nutrients: { n: 40, p: 22, k: 170 },
      climate: { tmaxOffset_C: -0.7, rhOffset_pct: 7 },
    },
  },
  {
    id: "ummsalal-west",
    name: "Umm Salal West Farm",
    owner: "Umm Salal Family Farms",
    region: "Umm Salal",
    main_crop: "eggplant",
    plantedDaysAgo: 100,
    soil_type: "loamy_sand",
    elevation_m: 22,
    ec_calibration_factor: 3.3,
    irrigation_water_ec: 0.9,
    sensorPrefix: "UW",
    sensorCount: 6,
    osmWayId: 1173573852,
    ring: [[51.313316,25.506041],[51.309982,25.510551],[51.312631,25.512177],[51.312762,25.512251],[51.315438,25.513894],[51.317276,25.511521],[51.318816,25.509439],[51.315988,25.507694],[51.313316,25.506041]],
    scenario: {
      kind: "healthy",
      ece: { start: 0.95, end: 1.0 },
      eceHotspot: 0.25,
      deficit: { base: 0.4 },
      hotspotBearing_deg: 150,
      ph: { base: 7.7, drift: 0 },
      nutrients: { n: 45, p: 26, k: 190 },
      climate: { tmaxOffset_C: 0.3, rhOffset_pct: 0 },
    },
  },
  {
    id: "ummsalal-east",
    name: "Umm Salal Garden Farm",
    owner: "Umm Salal Family Farms",
    region: "Umm Salal",
    main_crop: "tomato",
    plantedDaysAgo: 90,
    soil_type: "loamy_sand",
    elevation_m: 16,
    ec_calibration_factor: 3.1,
    irrigation_water_ec: 1.3,
    sensorPrefix: "UE",
    sensorCount: 5,
    osmWayId: 224154850,
    ring: [[51.35648,25.486918],[51.361868,25.489266],[51.36469,25.48434],[51.359132,25.481901],[51.35648,25.486918]],
    scenario: {
      kind: "healthy",
      ece: { start: 1.6, end: 1.7 },
      eceHotspot: 0.35,
      deficit: { base: 0.48 },
      hotspotBearing_deg: 250,
      ph: { base: 7.8, drift: 0.01 },
      nutrients: { n: 36, p: 21, k: 165 },
      climate: { tmaxOffset_C: 0.3, rhOffset_pct: 0 },
    },
  },
  {
    id: "sheehaniya-west",
    name: "Al Sheehaniya West Farm",
    owner: "Sheehaniya Agri Holdings",
    region: "Al Sheehaniya",
    main_crop: "sweet_pepper",
    plantedDaysAgo: 95,
    soil_type: "sand",
    elevation_m: 31,
    ec_calibration_factor: 3.0,
    irrigation_water_ec: 1.2,
    sensorPrefix: "HW",
    sensorCount: 5,
    osmWayId: 1258524375,
    ring: [[51.072635,25.408274],[51.072758,25.407261],[51.072499,25.404685],[51.072448,25.404617],[51.07216,25.404613],[51.071772,25.404629],[51.071429,25.404592],[51.071029,25.40463],[51.070189,25.404396],[51.068374,25.404679],[51.06778,25.404899],[51.067226,25.405131],[51.067029,25.405334],[51.066662,25.40631],[51.067127,25.407133],[51.067715,25.408036],[51.06814,25.408365],[51.072635,25.408274]],
    scenario: {
      kind: "low-moisture",
      ece: { start: 1.3, end: 1.4 },
      eceHotspot: 0.25,
      deficit: { base: 0.55, dryFromDay: 34, dryEnd: 1.65, dryHotspot: 0.75 },
      hotspotBearing_deg: 235,
      ph: { base: 7.9, drift: 0.01 },
      nutrients: { n: 44, p: 23, k: 175 },
      climate: { tmaxOffset_C: 0.6, rhOffset_pct: -2 },
    },
  },
  {
    id: "sheehaniya-south",
    name: "Al Sheehaniya South Farm",
    owner: "Sheehaniya Agri Holdings",
    region: "Al Sheehaniya",
    main_crop: "cucumber",
    plantedDaysAgo: 70,
    soil_type: "sand",
    elevation_m: 45,
    ec_calibration_factor: 3.0,
    irrigation_water_ec: 1.5,
    sensorPrefix: "HS",
    sensorCount: 5,
    osmWayId: 223539474,
    ring: [[51.144807,25.330983],[51.146888,25.33222],[51.148466,25.333139],[51.149819,25.334032],[51.147529,25.336329],[51.146689,25.336498],[51.145396,25.336475],[51.142938,25.3344],[51.14256,25.334641],[51.142231,25.334329],[51.144807,25.330983]],
    scenario: {
      kind: "healthy",
      ece: { start: 1.6, end: 1.75 },
      eceHotspot: 0.35,
      deficit: { base: 0.46 },
      hotspotBearing_deg: 10,
      ph: { base: 7.9, drift: 0.01 },
      nutrients: { n: 41, p: 22, k: 172 },
      climate: { tmaxOffset_C: 0.5, rhOffset_pct: -2 },
    },
  },
];

export function seedPolygon(seed: FarmSeed): GeoPolygon {
  return { type: "Polygon", coordinates: [seed.ring] };
}

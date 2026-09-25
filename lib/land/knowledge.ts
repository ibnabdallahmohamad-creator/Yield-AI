/**
 * Research knowledge base for the AI (RAG): short passages summarising published work on
 * Qatar's soils, climate, water and crops, each with its citation. The chat retrieves the
 * passages that match the question (BM25) alongside the land cell under the farm.
 *
 * Passages marked "General agronomic practice" are standard extension advice, not a specific paper.
 */

export interface KnowledgePassage {
  id: string;
  title: string;
  text: string;
  source: string;
  url?: string;
  tags: string[];
}

export const KNOWLEDGE: KnowledgePassage[] = [
  {
    id: "qatar-rawdat-soils",
    title: "Rawdat soils — Qatar's farmland",
    text:
      "Qatar's best agricultural soils are in rawdat (singular rawdha): shallow depressions where runoff collects and deposits calcareous loam, sandy loam and sandy clay loam colluvium 30–150 cm deep. More than 850 of these depressions, from a few to about 60 ha, are scattered mainly across the north and centre of the peninsula and carry most of the country's farming. Soils in the northern depressions hold more clay than those in central and southern Qatar, which improves structure, water holding and fertility.",
    source: "Karanisa et al. (2021), Agricultural Production in Qatar's Hot Arid Climate, Sustainability 13(7): 4059; Scheibert et al. (2005), The Atlas of Soils for the State of Qatar",
    url: "https://doi.org/10.3390/su13074059",
    tags: ["soil", "rawdat", "rawdha", "fertility", "north", "depression", "farmland", "clay", "loam"],
  },
  {
    id: "qatar-soils-general",
    title: "Soils outside the rawdat",
    text:
      "Most of Qatar is a low limestone plateau covered by shallow, stony calcareous soils (lithosols) usually less than 30 cm deep, with coastal sabkha (salt flats) and, in the south-east, sand dunes. Soils are alkaline (pH about 7.8–8.5), rich in calcium carbonate and very low in organic matter (typically below 1 %), so they hold little water or nitrogen. Farms outside the rawdat rely on drip irrigation, compost or imported soil, and greenhouses.",
    source: "Scheibert et al. (2005), The Atlas of Soils for the State of Qatar, Ministry of Municipal Affairs and Agriculture, Doha",
    tags: ["soil", "limestone", "calcareous", "organic", "matter", "shallow", "ph", "alkaline", "texture"],
  },
  {
    id: "qatar-sabkha",
    title: "Sabkha and coastal flats",
    text:
      "Sabkhas are flat, salt-encrusted coastal and inland plains with a saline water table close to the surface — including the Dukhan sabkha on the west coast (Qatar's lowest point, below sea level) and the flats around Salwa Bay and Khor Al Udeid. Soil salinity is extreme (ECe commonly well above 16 dS/m, the 'very strongly saline' class) and salts rise by capillarity, so leaching cannot work. They are not suitable for farming; low coastal land nearby tends to have saline soils and brackish groundwater from sea-water intrusion.",
    source: "Scheibert et al. (2005), The Atlas of Soils for the State of Qatar; FAO-29 (Ayers & Westcot 1985) salinity classes",
    tags: ["sabkha", "salt", "salinity", "coast", "coastal", "water table", "dukhan", "salwa"],
  },
  {
    id: "qatar-rainfall",
    title: "How much it rains in Qatar",
    text:
      "An analysis of 29 rain gauges (1962–2010) found mean annual rainfall of about 80 mm, with a sharp north–south gradient: roughly 105 mm in the north and 55 mm in the south. Rain falls almost only between November and April, often in a few storms, and year-to-year variation is large. Trends are mixed: annual totals and daily maxima rose at some stations and fell at others, while the number of rainy days increased.",
    source: "Mamoon, A.A. & Rahman, A. (2017), Rainfall in Qatar: Is it changing?, Natural Hazards 85: 453–470",
    url: "https://doi.org/10.1007/s11069-016-2576-6",
    tags: ["rain", "rainfall", "precipitation", "north", "south", "climate", "storm", "winter", "trend"],
  },
  {
    id: "qatar-climate-normals",
    title: "Temperature and humidity through the year",
    text:
      "Qatar has a hot desert climate. At Doha (Qatar Meteorology Department normals 1962–2013) January is the coolest month, with mean highs around 22 °C and relative humidity around 74 %, and July the hottest, with mean highs of 41–42 °C and humidity around 50 %; summer days above 45 °C occur inland. Coasts are more humid and have milder summer days; the interior has hotter days and cooler winter nights. The north-westerly Shamal wind is the most frequent. Annual mean temperature rose by about 1 °C between 1987 and 2016.",
    source: "Qatar Meteorology Department climate normals (Doha International Airport, 1962–2013); Bilal, Govindan & Al-Ansari (2021), Water 13: 2464",
    url: "https://doi.org/10.3390/w13182464",
    tags: ["temperature", "heat", "hot", "humidity", "climate", "summer", "winter", "wind", "shamal", "average"],
  },
  {
    id: "qatar-groundwater",
    title: "Groundwater quality and depletion",
    text:
      "Groundwater from the Rus and Umm er Radhuma limestone aquifers is the main water source for Qatari farms. In northern and central Qatar its salinity ranges from about 500 to 3,000 mg/L TDS and rises toward the sea, reaching about 10,000 mg/L near the coasts; the northern basin is the freshest and the small southern basin has poor-quality water. Pumping far exceeds natural recharge: satellite gravity data show groundwater storage falling by 0.24 ± 0.20 cm of water a year over 2002–2020, and salinity rises where aquifers are over-drawn.",
    source: "UN-ESCWA & BGR (2013), Inventory of Shared Water Resources in Western Asia, ch. 15; Bilal, Govindan & Al-Ansari (2021), Investigation of Groundwater Depletion in the State of Qatar, Water 13: 2464",
    url: "https://doi.org/10.3390/w13182464",
    tags: ["groundwater", "aquifer", "well", "water", "salinity", "tds", "depletion", "over-pumping", "quality", "brackish"],
  },
  {
    id: "qatar-recharge",
    title: "Where groundwater recharge happens",
    text:
      "Natural recharge in Qatar is small and episodic: during heavy winter storms, runoff collects in land depressions (rawdat) and infiltrates the fractured karst limestone. A GIS soil-water-budget model estimated total recharge of about 14 million m³ for the 2013/2014 hydrological year, concentrated in the northern part of the country. Protecting rawdat from sealing and compaction therefore protects both farmland and aquifer recharge.",
    source: "Baalousha, H.M. et al. (2018), Groundwater recharge estimation and its spatial distribution in arid regions using GIS: a case study from Qatar karst aquifer, Modeling Earth Systems and Environment 4; Baalousha (2015), MODSIM 2015 pp. 2026–2032",
    url: "https://link.springer.com/article/10.1007/s40808-018-0503-4",
    tags: ["recharge", "groundwater", "aquifer", "rawdat", "rain", "infiltration", "karst", "storm"],
  },
  {
    id: "fao29-water-classes",
    title: "Is my irrigation water too salty? (FAO-29)",
    text:
      "FAO-29 grades irrigation water by its electrical conductivity ECw: below 0.7 dS/m there is no restriction on use, 0.7–3.0 dS/m is a slight-to-moderate restriction, and above 3.0 dS/m a severe restriction. Total dissolved solids convert approximately as TDS (mg/L) ≈ 640 × ECw (dS/m). Most Qatari well water falls in the moderate-to-severe range, so salt-tolerant crops, leaching and blending with desalinated or treated water are standard practice.",
    source: "Ayers, R.S. & Westcot, D.W. (1985), Water Quality for Agriculture, FAO Irrigation and Drainage Paper 29 Rev.1, Table 1",
    url: "https://www.fao.org/4/t0234e/T0234E00.htm",
    tags: ["water", "quality", "salinity", "ecw", "tds", "irrigation", "salt", "conductivity"],
  },
  {
    id: "fao29-leaching",
    title: "Leaching salts out of the root zone",
    text:
      "Salts added with irrigation water accumulate unless extra water drains below the roots. The leaching requirement LR = ECw / (5 ECe − ECw) (FAO-29 Eq. 7) gives the fraction of extra water needed to hold the root zone at a target ECe. With a leaching fraction of 15–20 %, long-term root-zone salinity settles at about ECe ≈ 1.5 × ECw. Sandy Qatari soils leach easily, but a shallow saline water table or a hardpan stops leaching.",
    source: "Ayers & Westcot (1985), FAO Irrigation and Drainage Paper 29 Rev.1",
    url: "https://www.fao.org/4/t0234e/T0234E00.htm",
    tags: ["leaching", "salinity", "salt", "irrigation", "drainage", "ece", "requirement"],
  },
  {
    id: "maas-hoffman",
    title: "Crop salt tolerance (Maas–Hoffman)",
    text:
      "Crop yield stays at 100 % until soil salinity (ECe) passes a crop-specific threshold, then falls linearly: relative yield = 100 − slope × (ECe − threshold). Examples from FAO-29 Table 4 (threshold dS/m / % loss per dS/m): barley 8.0 / 5.0, Bermuda grass 6.9 / 6.4, sorghum 6.8 / 16, wheat 6.0 / 7.1, zucchini 4.7 / 9.4, date palm 4.0 / 3.6, tomato 2.5 / 9.9, cucumber 2.5 / 13, alfalfa 2.0 / 7.3, pepper 1.5 / 14, lettuce 1.3 / 13, onion 1.2 / 16.",
    source: "Maas, E.V. & Hoffman, G.J. (1977), Crop salt tolerance — current assessment, J. Irrig. Drain. Div. ASCE 103(IR2): 115–134; FAO-29 Table 4",
    tags: ["salt", "tolerance", "salinity", "yield", "crop", "threshold", "barley", "date", "tomato", "grow"],
  },
  {
    id: "fao56-et",
    title: "Crop water use (FAO-56)",
    text:
      "Reference evapotranspiration ET₀ is computed with the FAO-56 Penman–Monteith equation from temperature, humidity, wind and solar radiation, or with the Hargreaves equation when only temperature is known. Crop water use is ETc = Kc × ET₀, with Kc from FAO-56 Table 12 by growth stage. In Qatar ET₀ runs from about 3 mm/day in winter to 7–10 mm/day in early summer — roughly 1,700–1,950 mm a year, some 20 times the rainfall.",
    source: "Allen, R.G., Pereira, L.S., Raes, D. & Smith, M. (1998), Crop Evapotranspiration, FAO Irrigation and Drainage Paper 56",
    url: "https://www.fao.org/4/x0490e/x0490e00.htm",
    tags: ["evapotranspiration", "et0", "etc", "water use", "kc", "penman", "hargreaves", "irrigation", "demand"],
  },
  {
    id: "fao56-water-balance",
    title: "When and how much to irrigate (FAO-56)",
    text:
      "Total available water TAW = 1000 (θFC − θWP) Zr and readily available water RAW = p × TAW (FAO-56 Eq. 82–83). Irrigate when root-zone depletion reaches RAW; below that, the water-stress coefficient Ks drops and yield suffers. Sandy soils have a small TAW (sand θFC ≈ 0.12, θWP ≈ 0.045 m³/m³), so in Qatar's heat RAW can be used up in a day or two — short, frequent drip pulses work best.",
    source: "Allen et al. (1998), FAO Irrigation and Drainage Paper 56, Chapter 8",
    url: "https://www.fao.org/4/x0490e/x0490e00.htm",
    tags: ["irrigation", "schedule", "moisture", "depletion", "taw", "raw", "stress", "drip", "when", "how much"],
  },
  {
    id: "qatar-agriculture",
    title: "Farming in Qatar today",
    text:
      "Since the 2017 blockade Qatar has pushed to grow more of its own food. Production is concentrated in the northern and central farm belts and relies on groundwater, greenhouses and increasingly hydroponics. The main constraints are scarce and salinising water, extreme summer heat and poor, shallow soils; the main opportunities are protected cultivation, water-efficient irrigation and better use of treated sewage effluent for fodder.",
    source: "Karanisa et al. (2021), Agricultural Production in Qatar's Hot Arid Climate, Sustainability 13(7): 4059",
    url: "https://doi.org/10.3390/su13074059",
    tags: ["agriculture", "food security", "greenhouse", "hydroponics", "farm", "production", "blockade", "strategy"],
  },
  {
    id: "qatar-seasons",
    title: "Growing seasons",
    text:
      "Open-field vegetables in Qatar are grown in the cool season, planted from late September to November and harvested through April. From May to September day temperatures above 40 °C stop most open-field vegetables, so summer production moves into evaporatively cooled greenhouses or hydroponics. Winter cereals (barley, wheat) are sown in November–December; fodder (alfalfa, Bermuda/Rhodes grass) and date palms are grown year-round, with dates harvested in summer.",
    source: "General agronomic practice in Qatar; Karanisa et al. (2021)",
    tags: ["season", "planting", "when to plant", "winter", "summer", "greenhouse", "calendar", "harvest", "grow"],
  },
  {
    id: "alkaline-nutrients",
    title: "Nutrients in alkaline, calcareous soils",
    text:
      "At pH above about 7.9, phosphorus, iron, zinc and manganese become less available to plants even when they are present in the soil. Acid-forming fertilisers (ammonium sulphate), chelated micronutrients such as Fe-EDDHA, organic matter and, where irrigation water is high in bicarbonate, acid injection into the drip line are the usual fixes. On salinising fields potassium sulphate is preferred to potassium chloride.",
    source: "General agronomic practice",
    tags: ["nutrient", "fertiliser", "fertilizer", "ph", "alkaline", "iron", "zinc", "phosphorus", "npk", "chelate"],
  },
  {
    id: "heat-management",
    title: "Managing heat stress",
    text:
      "Fruit set in tomato, pepper and cucumber falls sharply when day temperatures stay above the mid-30s °C. Shade nets, mulch, early-morning irrigation, evaporative cooling pads in greenhouses and planting dates that avoid flowering in April–May reduce losses. Root zones above about 32 °C slow root growth and raise water demand.",
    source: "General agronomic practice",
    tags: ["heat", "temperature", "hot", "summer", "shade", "stress", "greenhouse", "cooling"],
  },
  {
    id: "date-palm",
    title: "Date palm",
    text:
      "The date palm is Qatar's traditional tree crop and one of the most salt-tolerant fruit crops: yield stays at 100 % up to ECe 4.0 dS/m and falls only 3.6 % per dS/m beyond that (FAO-29 Table 4). It tolerates heat and brackish groundwater that would ruin vegetables, which makes it the default perennial crop on saltier land.",
    source: "Ayers & Westcot (1985), FAO-29 Table 4 (after Maas & Hoffman 1977)",
    tags: ["date", "palm", "tree", "fruit", "salt", "tolerant", "perennial", "grow"],
  },
  {
    id: "fodder",
    title: "Fodder crops",
    text:
      "Fodder is a large share of Qatar's irrigated area. Alfalfa gives high-quality hay but uses a lot of water and is only moderately salt-sensitive (threshold ECe 2.0 dS/m). Barley (8.0 dS/m), Bermuda grass (6.9 dS/m) and sorghum (6.8 dS/m) tolerate far more salt (FAO-29 Table 4), and treated sewage effluent is an important water source for fodder.",
    source: "Ayers & Westcot (1985), FAO-29 Table 4; Karanisa et al. (2021)",
    tags: ["fodder", "alfalfa", "barley", "grass", "sorghum", "livestock", "hay", "tse", "effluent"],
  },
  {
    id: "land-grid-method",
    title: "How the Yield AI land atlas is built",
    text:
      "The land atlas divides Qatar into ≈1,200 cells of 10 km² clipped to the municipality boundaries. Each cell's climate is modelled from the Doha station normals and the published north–south rainfall gradient; its soil and landform from the soil atlas classes (rawdat, limestone plateau, sabkha, dunes) and distance to the coast; its groundwater salinity from the published aquifer ranges; and its crop list from FAO-29 salt tolerance with ECe ≈ 1.5 × ECw. It is a planning guide at 10 km² scale — a lab soil and water test on the actual field overrides it.",
    source: "Yield AI methodology",
    tags: ["atlas", "grid", "method", "model", "accuracy", "cell", "land", "data", "how"],
  },
];

// ---------------------------------------------------------------------------
// Retrieval (BM25)
// ---------------------------------------------------------------------------

const STOP = new Set(
  "a an and are as at be but by can do does for from how i if in into is it its me my of on or our should so than that the their them then there these this to was we what when where which who why will with you your".split(" "),
);

/** Map common variants onto one term so "salty", "salt" and "saline" meet. */
const SYNONYMS: Record<string, string> = {
  salty: "salt",
  saline: "salinity",
  salinisation: "salinity",
  salinization: "salinity",
  rains: "rain",
  rainy: "rain",
  precipitation: "rain",
  rainfall: "rain",
  fertile: "fertility",
  fertiliser: "fertilizer",
  temperatures: "temperature",
  temp: "temperature",
  humid: "humidity",
  crops: "crop",
  grow: "crop",
  growing: "crop",
  plant: "crop",
  planting: "crop",
  harvest: "crop",
  wells: "well",
  aquifers: "aquifer",
  soils: "soil",
  dates: "date",
  palms: "palm",
  irrigate: "irrigation",
  irrigating: "irrigation",
  watering: "irrigation",
  rawdha: "rawdat",
  rawda: "rawdat",
  roda: "rawdat",
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9₀\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => SYNONYMS[t] ?? (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
    .map((t) => SYNONYMS[t] ?? t);
}

interface IndexedDoc {
  passage: KnowledgePassage;
  terms: Map<string, number>;
  length: number;
}

let index: { docs: IndexedDoc[]; df: Map<string, number>; avgLength: number } | null = null;

function getIndex() {
  if (index) return index;
  const docs = KNOWLEDGE.map((passage) => {
    const tokens = tokenize(`${passage.title} ${passage.title} ${passage.tags.join(" ")} ${passage.text}`);
    const terms = new Map<string, number>();
    for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1);
    return { passage, terms, length: tokens.length };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.terms.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  index = { docs, df, avgLength: docs.reduce((a, d) => a + d.length, 0) / docs.length };
  return index;
}

/** The `k` passages that best match `query` (BM25, k1 = 1.2, b = 0.75); empty when nothing matches. */
export function searchKnowledge(query: string, k = 3): Array<KnowledgePassage & { score: number }> {
  const { docs, df, avgLength } = getIndex();
  const q = [...new Set(tokenize(query))];
  if (q.length === 0) return [];
  const N = docs.length;
  const scored = docs.map((d) => {
    let score = 0;
    for (const t of q) {
      const f = d.terms.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * 2.2) / (f + 1.2 * (1 - 0.75 + (0.75 * d.length) / avgLength));
    }
    return { ...d.passage, score: Math.round(score * 100) / 100 };
  });
  return scored
    .filter((d) => d.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

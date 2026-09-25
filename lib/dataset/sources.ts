/**
 * The reference library for the Land Analysis task: newspapers, government statements, research
 * papers and FAO reports on Qatar's food market, trade politics and farming economics, plus the data
 * sources behind the inputs. Each fact is a short statement taken from the cited item (checked
 * 2026-09-24); the dataset builder hands the relevant items to the model as evidence and the model
 * cites them by id.
 *
 * `available_from` is when the item could first be known. The builder only shows an item to an
 * example dated on or after it, so no example "knows" the future. When only the year or month of an
 * item was certain, the date is set late (conservative).
 */

export type SourceKind = "news" | "government" | "paper" | "report" | "law" | "dataset" | "method";

export type Topic =
  | "vegetables"
  | "greenhouse"
  | "hydroponics"
  | "eggs"
  | "red-meat"
  | "poultry"
  | "dairy"
  | "fish"
  | "dates"
  | "fodder"
  | "water"
  | "groundwater"
  | "tse"
  | "trade"
  | "tariffs"
  | "prices"
  | "support"
  | "reserves"
  | "climate"
  | "heat"
  | "strategy";

export interface LibrarySource {
  id: string;
  kind: SourceKind;
  publisher: string;
  title: string;
  /** As published: YYYY-MM-DD, YYYY-MM or YYYY. */
  date: string;
  available_from: string;
  url: string;
  topics: Topic[];
  facts: string[];
}

export const LIBRARY: LibrarySource[] = [
  // --- Newspapers and government news -----------------------------------------------------------
  {
    id: "N1",
    kind: "news",
    publisher: "The Peninsula",
    title: "Qatar's local vegetable production to reach 120,000 tonnes by end of 2026, achieving 70% self-sufficiency",
    date: "2026-03-26",
    available_from: "2026-03-26",
    url: "https://thepeninsulaqatar.com/article/26/03/2026/qatars-local-vegetable-production-to-reach-120000-tonnes-by-end-of-2026-achieving-70-self-sufficiency",
    topics: ["vegetables", "greenhouse", "dates", "strategy"],
    facts: [
      "Local vegetable output rose from about 66,000 t to more than 113,000 t in recent seasons and is expected to reach about 120,000 t by the end of 2026.",
      "Vegetable self-sufficiency is expected to pass 70% during certain periods of the year.",
      "The greenhouse farming market is expected to grow about 11%, to around US$200 million by the end of 2026 from about US$170 million in 2024.",
      "Date self-sufficiency is around 86%, with potential to reach 95%.",
    ],
  },
  {
    id: "N2",
    kind: "news",
    publisher: "The Peninsula",
    title: "Qatar advances food self-sufficiency with strong growth in local production",
    date: "2026-03-22",
    available_from: "2026-03-22",
    url: "https://thepeninsulaqatar.com/article/22/03/2026/qatar-advances-food-self-sufficiency-with-strong-growth-in-local-production",
    topics: ["greenhouse", "red-meat", "fish", "strategy"],
    facts: [
      "Qatar had 8,420 greenhouse units in 2025.",
      "Greenhouse programmes are raising strategic vegetable output, livestock fattening projects are raising red-meat self-sufficiency and aquaculture projects support fish supply (Ministry of Municipality, 2025 figures).",
    ],
  },
  {
    id: "N3",
    kind: "news",
    publisher: "The Peninsula",
    title: "45 livestock production projects drive Qatar's food security goals",
    date: "2026-06-03",
    available_from: "2026-06-03",
    url: "http://thepeninsulaqatar.com/article/03/06/2026/45-livestock-production-projects-drive-qatars-food-security-goals",
    topics: ["eggs", "red-meat", "poultry", "strategy"],
    facts: [
      "Qatar licensed 45 livestock and animal production projects in 2025, including 6 table-egg projects, 14 meat production farms and 8 broiler projects.",
      "Table eggs have the widest gap of any product to the 2030 self-sufficiency target.",
    ],
  },
  {
    id: "N4",
    kind: "news",
    publisher: "The Peninsula",
    title: "Qatar has achieved full self-sufficiency in dairy and fresh poultry: Official",
    date: "2025-06-05",
    available_from: "2025-06-05",
    url: "https://thepeninsulaqatar.com/article/05/06/2025/qatar-has-achieved-full-self-sufficiency-in-dairy-and-fresh-poultry-official",
    topics: ["dairy", "poultry"],
    facts: ["Dairy and fresh poultry have reached full self-sufficiency, so new entrants face a saturated local market."],
  },
  {
    id: "N5",
    kind: "government",
    publisher: "Qatar News Agency (QNA)",
    title: "Qatar's food security: significant efforts in local production expansion, pivotal role for private sector",
    date: "2025-08-25",
    available_from: "2025-08-25",
    url: "https://qna.org.qa/en/news/news-details?id=qatars-food-security-significant-efforts-in-local-production-expansion-pivotal-role-for-private-sector-1&date=25/08/2025",
    topics: ["vegetables", "eggs", "red-meat", "fish", "strategy"],
    facts: [
      "The National Food Security Strategy 2030 sets product targets including 55% for strategic vegetables, 70% for table eggs, 30% for red meat and 80% for fresh fish.",
      "The strategy gives the private sector a pivotal role in expanding local production.",
    ],
  },
  {
    id: "N6",
    kind: "news",
    publisher: "The Peninsula",
    title: "Customs tariff raised on chicken, some vegetables in Qatar: Official Gazette",
    date: "2026-09-17",
    available_from: "2026-09-17",
    url: "http://thepeninsulaqatar.com/article/17/09/2026/customs-duty-raised-on-chicken-some-vegetables-in-qatar-official-gazette",
    topics: ["tariffs", "trade", "vegetables", "poultry", "prices"],
    facts: [
      "Decree No. 45 of 2026 adds a temporary 15% customs tariff on selected imported vegetables in the months local produce is available.",
      "Imported fresh or chilled tomatoes pay the 15% tariff from January to May.",
      "Imported eggplants pay it from January to April and in November and December; zucchini from January to April and from October to December.",
      "The tariff on whole fresh or chilled chicken rises to 18%.",
    ],
  },
  {
    id: "N7",
    kind: "news",
    publisher: "The Peninsula",
    title: "Qatar Customs clarifies exemptions from increased poultry, vegetable tariffs",
    date: "2026-09-24",
    available_from: "2026-09-24",
    url: "http://thepeninsulaqatar.com/article/24/09/2026/qatar-customs-clarifies-exemptions-from-increased-poultry-vegetable-tariffs",
    topics: ["tariffs", "trade", "vegetables", "poultry"],
    facts: [
      "Tomatoes, eggplants and zucchini imported from GCC countries are exempt from the seasonal tariff.",
      "Chilled chicken from GCC countries, several Arab countries and Türkiye is exempt from the higher chicken tariff.",
    ],
  },
  {
    id: "N8",
    kind: "news",
    publisher: "The Peninsula",
    title: "Qatar develops integrated food security system with strategic grain reserve",
    date: "2026-03-15",
    available_from: "2026-03-15",
    url: "https://thepeninsulaqatar.com/article/15/03/2026/qatar-develops-integrated-food-security-system-with-strategic-grain-reserve",
    topics: ["reserves", "strategy", "trade"],
    facts: [
      "Strategic grain storage capacity is about 320,000 t.",
      "The National Food Security Strategy 2030 keeps a strategic reserve of essential foods for two to eight months.",
      "The strategy has 17 initiatives in three pillars: domestic production and markets, strategic storage and early warning, and international trade and investment.",
    ],
  },
  {
    id: "N9",
    kind: "news",
    publisher: "The Peninsula / QNA",
    title: "Qatar reaps benefits of diversification in food security, crisis resilience",
    date: "2026-04-06",
    available_from: "2026-04-06",
    url: "https://thepeninsulaqatar.com/article/06/04/2026/qatar-reaps-benefits-of-diversification-in-food-security-crisis-resilience",
    topics: ["trade", "reserves", "prices", "support"],
    facts: [
      "Officials say local production of dairy and vegetables in protected farms, plus strategic reserves, kept Qatar's markets stable during the 2026 regional war.",
      "Mahaseel provides marketing services to more than 400 local farmers.",
      "The Ministry of Commerce and Industry runs about 3,000 market inspections a day to monitor prices and stocks.",
    ],
  },
  {
    id: "N10",
    kind: "news",
    publisher: "The Peninsula",
    title: "Ministry of Municipality starts providing support to farmers for new crop season",
    date: "2024-09-04",
    available_from: "2024-09-04",
    url: "http://thepeninsulaqatar.com/article/04/09/2024/ministry-of-municipality-starts-providing-support-to-farmers-for-new-crop-season",
    topics: ["support", "greenhouse", "hydroponics"],
    facts: [
      "The Ministry of Municipality supplies farmers with greenhouse structures, hydroponic systems, irrigation technology, fertilisers and seeds.",
      "The plan was to support 441 farms in the 2024–2025 season.",
    ],
  },
  {
    id: "N11",
    kind: "news",
    publisher: "Gulf Times",
    title: "Smart farms seen as key to next phase of food security",
    date: "2026",
    available_from: "2026-09-01",
    url: "https://www.gulf-times.com/article/732856/qatar/smart-farms-seen-as-key-to-next-phase-of-food-security",
    topics: ["greenhouse", "hydroponics", "water", "prices"],
    facts: [
      "Farm owners and specialists see controlled-environment greenhouses, hydroponics, vertical farming and automated irrigation as the way to grow more with less water, energy and fertiliser.",
      "High start-up cost, narrow profit margins in the local market and few specialised service providers are the main obstacles.",
    ],
  },
  {
    id: "N12",
    kind: "news",
    publisher: "Qatar News Agency (QNA)",
    title: "Holy Month of Ramadan boosts demand for Qatari dates as national production reaches 24,000 tons in 2025",
    date: "2026-02-19",
    available_from: "2026-02-19",
    url: "https://qna.org.qa/en/news/news-details?id=holy-month-of-ramadan-boosts-demand-for-qatari-dates-as-national-production-reaches-24000-tons-in-2025&date=19%2F02%2F2026",
    topics: ["dates", "support"],
    facts: [
      "National date production reached about 24,000 t in 2025; the main varieties are Khalas, Shishi, Barhi and Khunaizi.",
      "Growers get technical assistance, pest control programmes and better irrigation technology.",
    ],
  },
  {
    id: "N13",
    kind: "news",
    publisher: "The Peninsula",
    title: "10th Local Dates Festival concludes with over 90,000 visitors",
    date: "2025-08-08",
    available_from: "2025-08-08",
    url: "http://thepeninsulaqatar.com/article/08/08/2025/10th-local-dates-festival-concludes-with-over-90000-visitors",
    topics: ["dates", "prices"],
    facts: ["The summer Local Dates Festival at Souq Waqif lets farms sell fresh dates directly to consumers; the 10th edition drew over 90,000 visitors."],
  },
  {
    id: "N14",
    kind: "news",
    publisher: "FreshPlaza",
    title: "Vegetable prices up in Qatar due to constrained local production",
    date: "2024-07-08",
    available_from: "2024-07-08",
    url: "https://www.freshplaza.com/asia/article/9642425/",
    topics: ["vegetables", "prices"],
    facts: ["Once the local season ends, tomatoes, capsicum, leafy greens, eggplants and zucchini become scarce and prices rise at the Al Sailiya Central Market."],
  },
  {
    id: "N15",
    kind: "news",
    publisher: "The Peninsula",
    title: "Local vegetable production exceeds consumption: official",
    date: "2023-01-23",
    available_from: "2023-01-23",
    url: "https://thepeninsulaqatar.com/article/23/01/2023/local-vegetable-production-exceeds-consumption-official",
    topics: ["vegetables", "prices"],
    facts: [
      "In the winter peak local vegetable production exceeds consumption, which pushes prices down.",
      "The market needs about 2,000 t of cucumber and 5,000–6,000 t of tomato a month.",
    ],
  },
  {
    id: "N16",
    kind: "news",
    publisher: "Euronews",
    title: "Planting the seeds of change: Qatar's Food Security Strategy",
    date: "2026-07-08",
    available_from: "2026-07-08",
    url: "https://www.euronews.com/2026/07/08/planting-the-seeds-of-change-qatars-food-security-strategy",
    topics: ["strategy", "greenhouse", "trade"],
    facts: [
      "Only about 2% of Qatar's land is arable, with intense heat and scarce rain.",
      "The 2017 blockade made food self-sufficiency a necessity; the National Food Security Strategy 2024–2030 guides the build-up of local production.",
    ],
  },
  {
    id: "N17",
    kind: "news",
    publisher: "Fast Company Middle East",
    title: "Qatar to slash water use in agriculture by 40% by 2030",
    date: "2025",
    available_from: "2025-06-01",
    url: "https://fastcompanyme.com/news/qatar-to-slash-water-use-in-agriculture-by-40-by-2030/",
    topics: ["water", "strategy", "tse"],
    facts: ["The food security strategy aims to cut water used per tonne of crops by 40% by 2030."],
  },
  // --- Reports and research papers --------------------------------------------------------------
  {
    id: "R1",
    kind: "report",
    publisher: "FAO",
    title: "Global Agrifood Implications of the 2026 Conflict in the Middle East",
    date: "2026-03",
    available_from: "2026-03-31",
    url: "https://www.fao.org/agrifood-economics/publications/detail/en/c/1758065/",
    topics: ["trade", "prices", "reserves"],
    facts: [
      "The conflict that began on 28 February 2026 disrupted shipping through the Strait of Hormuz, the only sea route to Qatar's ports; tanker traffic fell by more than 90% within days.",
      "Urea prices rose by more than 20% after the disruption, so fertiliser for Qatar's farms costs more and can arrive late.",
      "Qatar imports most of its food, which makes its supply highly exposed to shipping disruptions.",
      "FAO recommends alternative trade routes, closer market monitoring and financial support for farmers.",
    ],
  },
  {
    id: "R2",
    kind: "paper",
    publisher: "Sustainability (MDPI) 13(7):4059 — Karanisa et al.",
    title: "Agricultural Production in Qatar's Hot Arid Climate",
    date: "2021-04",
    available_from: "2021-04-30",
    url: "https://doi.org/10.3390/su13074059",
    topics: ["greenhouse", "hydroponics", "fish", "climate", "strategy"],
    facts: [
      "Open-field agriculture in Qatar has traditionally been limited to October–April.",
      "Greenhouses, hydroponics and aquaculture suit the hot arid climate; hydroponics and aquaponics make greenhouses less resource-intensive.",
      "The 3.5-year blockade renewed interest in what local agriculture can do for food security.",
    ],
  },
  {
    id: "R3",
    kind: "paper",
    publisher: "HBKU (Smart Agricultural Technology, 2025)",
    title: "Economic assessment of greenhouse and vertical farm production systems in arid regions: a case study of Qatar",
    date: "2025-05",
    available_from: "2025-05-31",
    url: "https://www.sciencedirect.com/science/article/pii/S2772801325000181",
    topics: ["greenhouse", "hydroponics", "prices", "water"],
    facts: [
      "Levelized cost of tomato: US$3.19/kg in a greenhouse against US$3.77/kg in a vertical farm, so greenhouses are the cheaper option in Qatar.",
      "The authors note that water use must also be weighed in a country as water-scarce as Qatar.",
    ],
  },
  {
    id: "R4",
    kind: "paper",
    publisher: "Frontiers in Sustainable Food Systems (2025)",
    title: "From crisis to resilience: food security policy development in Qatar",
    date: "2025-06",
    available_from: "2025-06-30",
    url: "https://www.frontiersin.org/journals/sustainable-food-systems/articles/10.3389/fsufs.2025.1446264/full",
    topics: ["fodder", "strategy", "tse", "trade"],
    facts: [
      "Qatar's food security policy moved from import reliance to a mix of local production, strategic storage and diversified trade after the 2017 blockade.",
      "Green fodder self-sufficiency was about 55% in 2022; policy is to move fodder irrigation from groundwater to treated sewage effluent (TSE).",
    ],
  },
  {
    id: "R5",
    kind: "paper",
    publisher: "Groundwater for Sustainable Development — Baalousha et al.",
    title: "Approaches to achieve sustainable use and management of groundwater resources in Qatar: A review",
    date: "2019",
    available_from: "2019-12-31",
    url: "https://www.sciencedirect.com/science/article/abs/pii/S2352801X19304321",
    topics: ["groundwater", "water"],
    facts: [
      "Groundwater abstraction is about 250 million m³ a year, several times the natural recharge, so water levels fall and salinity rises.",
      "The north has a freshwater lens over brackish water; the south is brackish.",
    ],
  },
  {
    id: "R6",
    kind: "paper",
    publisher: "Groundwater (Wiley) — Shomar, 2024",
    title: "Groundwater Contamination in Arid Coastal Areas: Qatar as a Case Study",
    date: "2024",
    available_from: "2024-12-31",
    url: "https://ngwa.onlinelibrary.wiley.com/doi/10.1111/gwat.13411",
    topics: ["groundwater", "water"],
    facts: ["Groundwater is most saline in coastal and southern Qatar, consistent with seawater intrusion from over-pumping."],
  },
  {
    id: "R7",
    kind: "paper",
    publisher: "Desalination and Water Treatment (2024)",
    title: "Evaluation of the current state and perspective of wastewater treatment and reuse in Qatar",
    date: "2024",
    available_from: "2024-12-31",
    url: "https://www.sciencedirect.com/science/article/pii/S1944398624147467",
    topics: ["tse", "fodder", "water"],
    facts: [
      "Treated sewage effluent (TSE) is used mainly for fodder and landscape irrigation, while a large share is still discharged unused.",
      "The target is for fodder to be irrigated fully with TSE by 2030.",
    ],
  },
  {
    id: "R8",
    kind: "paper",
    publisher: "Scientific Reports (2026)",
    title: "Large and regional-scale processes influencing Heat Waves: Insights from Qatar",
    date: "2026",
    available_from: "2026-07-01",
    url: "https://www.nature.com/articles/s41598-026-54666-y",
    topics: ["heat", "climate"],
    facts: ["Maximum temperatures in Qatar show a rising trend of about 0.028 °C a year; 32 heat waves were detected, mostly May–September, with about 0.1 more a year."],
  },
  {
    id: "R9",
    kind: "government",
    publisher: "HBKU QEERI",
    title: "Hydroponics and Aquaponics with AIoT in Qatar (HAIAT)",
    date: "2025",
    available_from: "2025-12-31",
    url: "https://elmi.hbku.edu.qa/en/projects/hydroponics-and-aquaponics-with-aiot-in-qatar-haiat/",
    topics: ["hydroponics", "greenhouse", "water", "heat"],
    facts: ["From April to October indoor farms need a lot of water and electricity for cooling; monitoring and control systems are being developed to cut both."],
  },
  {
    id: "R10",
    kind: "government",
    publisher: "Qatar News Agency (QNA)",
    title: "Head of Aquatic Research Center: Qatar achieved aquaculture successes in contribution to food security",
    date: "2023-02-05",
    available_from: "2023-02-05",
    url: "https://www.qna.org.qa/en/News-Area/News/2023-02/05/0024-head-of-aquatic-research-center-to-qna-qatar-achieved-aquaculture-successes-in-contribution-to-food-security",
    topics: ["fish"],
    facts: ["The Aquatic and Fisheries Research Center at Ras Matbakh (Al Khor) produces hatchlings of local fish such as rabbitfish, grouper and yellowfin seabream for farms."],
  },
  // --- Data and methods behind the inputs -------------------------------------------------------
  {
    id: "D1",
    kind: "dataset",
    publisher: "FAO AQUASTAT / AQUAMAPS",
    title: "Aridity, major agricultural systems, GMIA v5 irrigation areas, salinized land, HWSD soil water (GlobWat)",
    date: "2026",
    available_from: "2000-01-01",
    url: "https://data.apps.fao.org/aquamaps/",
    topics: ["water", "groundwater", "climate"],
    facts: ["Location inputs (ecosystem, soil, irrigation) come from these FAO layers."],
  },
  {
    id: "D2",
    kind: "dataset",
    publisher: "Copernicus C3S / FAO",
    title: "AgERA5 monthly temperature, rainfall and reference evapotranspiration, 1979–2026",
    date: "2026",
    available_from: "2000-01-01",
    url: "https://doi.org/10.24381/cds.6c68c9bb",
    topics: ["climate", "heat"],
    facts: ["Climate normals and trends in the ecosystem input come from AgERA5."],
  },
  {
    id: "D3",
    kind: "dataset",
    publisher: "FAOSTAT",
    title: "Value of Agricultural Production (QV), Qatar",
    date: "2026",
    available_from: "2000-01-01",
    url: "https://www.fao.org/faostat/en/#data/QV",
    topics: ["prices", "vegetables", "eggs", "dates", "dairy", "poultry", "red-meat"],
    facts: ["Gross production value by product in constant 2014–2016 US$; recent years are FAO estimates."],
  },
  {
    id: "D4",
    kind: "dataset",
    publisher: "Open-Meteo",
    title: "Weather forecast and historical weather (ERA5) APIs",
    date: "2026",
    available_from: "2000-01-01",
    url: "https://open-meteo.com/",
    topics: ["climate"],
    facts: ["Air temperature, humidity, wind, rain and ET₀ inputs."],
  },
  {
    id: "M1",
    kind: "method",
    publisher: "FAO",
    title: "Irrigation and Drainage Paper 56: Crop evapotranspiration",
    date: "1998",
    available_from: "1998-01-01",
    url: "https://www.fao.org/4/x0490e/x0490e00.htm",
    topics: ["water"],
    facts: ["Reference ET₀, crop coefficients and the root-zone water balance used for irrigation advice."],
  },
  {
    id: "M2",
    kind: "method",
    publisher: "FAO",
    title: "Irrigation and Drainage Paper 29: Water quality for agriculture",
    date: "1985",
    available_from: "1985-01-01",
    url: "https://www.fao.org/4/t0234e/t0234e00.htm",
    topics: ["water", "groundwater"],
    facts: ["Crop salt tolerance (Maas–Hoffman), water restriction classes and leaching requirement."],
  },
];

export function source(id: string): LibrarySource {
  const s = LIBRARY.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown source ${id}`);
  return s;
}

/** Items a reader could have known on `asOf`, matching any of `topics`, newest first. */
export function sourcesFor(asOf: string, topics: Topic[], kinds: SourceKind[] = ["news", "government", "paper", "report", "law"]): LibrarySource[] {
  return LIBRARY.filter((s) => kinds.includes(s.kind) && s.available_from <= asOf && s.topics.some((t) => topics.includes(t))).sort((a, b) =>
    b.available_from.localeCompare(a.available_from),
  );
}

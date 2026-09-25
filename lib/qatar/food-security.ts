/**
 * Qatar's food-security goals and where local production stands, for the Land use advisor and the
 * AI context ("what is needed to reach the country's goals").
 *
 * Targets are from the National Food Security Strategy 2030 (launched by the Prime Minister in
 * April 2025, Ministry of Municipality). Current levels are the latest figures reported in the
 * press from Ministry of Municipality data; each row carries its source and year. Update this file
 * when the ministry publishes new numbers — the AI treats it as the baseline and checks the news
 * for anything newer.
 */

export type GoalProduct = "vegetables" | "table-eggs" | "red-meat" | "fresh-fish" | "dates" | "dairy" | "fresh-poultry" | "green-fodder";

export interface Source {
  title: string;
  url: string;
  /** Publication date, YYYY-MM-DD, when known. */
  date?: string;
}

export interface NationalGoal {
  product: GoalProduct;
  label: string;
  /** Latest reported self-sufficiency, %. */
  current_pct: number;
  current_year: number;
  /** 2030 target, % (null when the strategy sets none we could find). */
  target_pct: number | null;
  /** What local land and farms can do about it. */
  note: string;
  sources: Source[];
}

const PENINSULA_TARGETS: Source = {
  title: "Qatar eyes 55% self-sufficiency in vegetables by 2030 (The Peninsula)",
  url: "https://thepeninsulaqatar.com/article/12/01/2025/qatar-eyes-55-self-sufficiency-in-vegetables-by-2030",
  date: "2025-01-12",
};
const QNA_2025: Source = {
  title: "Qatar's food security: significant efforts in local production expansion (QNA)",
  url: "https://qna.org.qa/en/news/news-details?id=qatars-food-security-significant-efforts-in-local-production-expansion-pivotal-role-for-private-sector-1&date=25/08/2025",
  date: "2025-08-25",
};
const PENINSULA_LIVESTOCK_2026: Source = {
  title: "45 livestock production projects drive Qatar's food security goals (The Peninsula)",
  url: "http://thepeninsulaqatar.com/article/03/06/2026/45-livestock-production-projects-drive-qatars-food-security-goals",
  date: "2026-06-03",
};
const GULF_TIMES_2026: Source = {
  title: "Qatar nears food self-sufficiency after growth decade (Gulf Times)",
  url: "https://www.gulf-times.com/article/720940/qatar/qatar-nears-food-self-sufficiency-after-growth-decade",
  date: "2026-02-19",
};
const PENINSULA_DATES_2025: Source = {
  title: "Qatar achieves over 75 percent self-sufficiency in date production (The Peninsula)",
  url: "https://thepeninsulaqatar.com/article/21/07/2025/qatar-achieves-over-75-percent-self-sufficiency-in-date-production",
  date: "2025-07-21",
};
const FRONTIERS_2025: Source = {
  title: "From crisis to resilience: food security policy development in Qatar (Frontiers, 2025), Table 1",
  url: "https://www.frontiersin.org/journals/sustainable-food-systems/articles/10.3389/fsufs.2025.1446264/full",
};

export const NATIONAL_GOALS: NationalGoal[] = [
  {
    product: "table-eggs",
    label: "Table eggs",
    current_pct: 27,
    current_year: 2025,
    target_pct: 70,
    note: "The widest gap of any product. Egg units need little land or water but a ministry licence, biosecurity and cooled houses.",
    sources: [PENINSULA_LIVESTOCK_2026, QNA_2025],
  },
  {
    product: "red-meat",
    label: "Red meat (sheep and goat)",
    current_pct: 19,
    current_year: 2025,
    target_pct: 30,
    note: "Depends on feed. Fodder is moving off groundwater, so herds pair best with farms that have treated sewage effluent (TSE) or bought-in feed.",
    sources: [PENINSULA_LIVESTOCK_2026, QNA_2025],
  },
  {
    product: "vegetables",
    label: "Strategic vegetables",
    current_pct: 39,
    current_year: 2024,
    target_pct: 55,
    note: "The gap is summer: local supply collapses from June to September while winter can glut. Cooled greenhouses and hydroponics close it.",
    sources: [QNA_2025, PENINSULA_TARGETS],
  },
  {
    product: "fresh-fish",
    label: "Fresh fish",
    current_pct: 65,
    current_year: 2025,
    target_pct: 80,
    note: "Land-based aquaculture needs seawater or brackish water, so it suits coastal sites.",
    sources: [GULF_TIMES_2026, QNA_2025],
  },
  {
    product: "dates",
    label: "Dates",
    current_pct: 72,
    current_year: 2025,
    target_pct: null,
    note: "Largely supplied locally (about 25,000 t from some 638,000 palms). Growth is in premium varieties and processing rather than volume.",
    sources: [PENINSULA_DATES_2025],
  },
  {
    product: "green-fodder",
    label: "Green fodder",
    current_pct: 55,
    current_year: 2022,
    target_pct: null,
    note: "Policy is to irrigate fodder with treated sewage effluent (TSE) instead of groundwater by 2030; don't plan new fodder on groundwater.",
    sources: [FRONTIERS_2025],
  },
  {
    product: "dairy",
    label: "Dairy",
    current_pct: 99,
    current_year: 2025,
    target_pct: 100,
    note: "Met. Little room for new producers without a contract with the large dairies.",
    sources: [PENINSULA_LIVESTOCK_2026],
  },
  {
    product: "fresh-poultry",
    label: "Fresh poultry",
    current_pct: 99,
    current_year: 2025,
    target_pct: 100,
    note: "Met. Little room for new producers.",
    sources: [PENINSULA_LIVESTOCK_2026],
  },
];

/** Gap to target in percentage points (0 when met or no target). */
export function goalGap(goal: NationalGoal): number {
  return goal.target_pct == null ? 0 : Math.max(0, goal.target_pct - goal.current_pct);
}

export function goalFor(product: GoalProduct): NationalGoal {
  const goal = NATIONAL_GOALS.find((g) => g.product === product);
  if (!goal) throw new Error(`Unknown goal product ${product}`);
  return goal;
}

/** Water policy facts that shape every land-use decision in Qatar. */
export const WATER_POLICY = {
  groundwaterAbstraction_Mm3_per_yr: 250,
  groundwaterSafeYield_Mm3_per_yr: 47.5,
  waterPerTonneCut2030_pct: 40,
  note: "Groundwater is pumped at several times its recharge, so salinity rises where aquifers are over-used. The strategy aims to cut water use per tonne of crops by 40% by 2030 and to move fodder irrigation to treated sewage effluent (TSE).",
  sources: [
    {
      title: "Approaches to achieve sustainable use and management of groundwater resources in Qatar: A review (Groundwater for Sustainable Development)",
      url: "https://www.sciencedirect.com/science/article/abs/pii/S2352801X19304321",
    },
    {
      title: "Qatar to slash water use in agriculture by 40% by 2030 (Fast Company Middle East)",
      url: "https://fastcompanyme.com/news/qatar-to-slash-water-use-in-agriculture-by-40-by-2030/",
    },
  ] satisfies Source[],
};

/** Date the figures in this file were last checked. */
export const FOOD_SECURITY_REVIEWED = "2026-09-24";

/**
 * The land-use advisor: resolves the site (a farm or coordinates in Qatar), reads its climate,
 * water and sensors, ranks the options with the rules in score.ts, then — when a Claude key is
 * configured — adjusts the ranking with live research on Qatar's markets and news.
 * Reports are cached in memory for six hours per site and inputs, so repeat visits cost nothing.
 */
import "server-only";
import { CROPS, type CropId } from "../agronomy-tables";
import { lastDataIndex } from "../ai/analysis";
import { askModelAboutLand } from "../ai/land-model";
import { modelConfigured } from "../ai/model-client";
import type { RobotSurvey } from "../dataset/soil";
import { qatarDateString } from "../data/time";
import { formatShortDay } from "../format";
import { FOOD_SECURITY_REVIEWED, NATIONAL_GOALS, WATER_POLICY, goalFor, type Source } from "../qatar/food-security";
import { describeLocation, isInQatar } from "../qatar/location";
import { MARKET_REFERENCE_NOTE, SEASON_LABEL, priceSignal, qatarSeason } from "../qatar/market";
import type { DashboardData, FarmBundle } from "../types";
import { getSiteClimate } from "./climate";
import type { LandReport, LandRequest, LandResearch, ResearchSource, SiteSensors } from "./contract";
import { researchAvailable, researchLandUse } from "./research";
import { applyAdjustments, assessWater, goalRows, rankOptions } from "./score";

const CACHE_TTL_MS = 6 * 3600_000;
const SENSOR_WINDOW_DAYS = 30;

const globalCache = globalThis as unknown as { __yieldLandCache?: Map<string, { at: number; report: LandReport }> };
const cache = (globalCache.__yieldLandCache ??= new Map());

export class LandInputError extends Error {}

const meanOf = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

function sensorSummary(bundle: FarmBundle): SiteSensors | null {
  const last = lastDataIndex(bundle);
  const days = bundle.days
    .slice(Math.max(0, last - SENSOR_WINDOW_DAYS + 1), last + 1)
    .filter((d): d is NonNullable<typeof d> => d != null && d.sensors.length > 0);
  if (days.length === 0) return null;
  const probeAir = days.some((d) => d.airSource === "probe");
  const measured = ["soil moisture", ...(probeAir ? ["air temperature", "humidity"] : []), ...(days.some((d) => d.ece != null) ? ["salinity"] : []), ...(days.some((d) => d.ph != null) ? ["pH"] : [])];
  return {
    farm_id: bundle.farm.id,
    farm_name: bundle.farm.name,
    crop: CROPS[bundle.farm.main_crop].name,
    days: days.length,
    soil_moisture_pct: meanOf(days.map((d) => d.moisture)),
    air_tmax_mean_c: meanOf(days.map((d) => d.airTmax)),
    humidity_mean_pct: meanOf(days.map((d) => (d.rhMax != null && d.rhMin != null ? (d.rhMax + d.rhMin) / 2 : null))),
    ece_dS_m: meanOf([days[days.length - 1].ece]),
    measured,
  };
}

/** The farm's latest daily soil-moisture survey across its probes, in the model's input shape. */
function probeSurvey(bundle: FarmBundle): RobotSurvey | null {
  const last = lastDataIndex(bundle);
  const values = (i: number) => (bundle.days[i]?.sensors ?? []).map((s) => s.moisture).filter((v): v is number => v != null);
  const now = last >= 0 ? values(last) : [];
  if (!now.length) return null;
  const week = last >= 7 ? values(last - 7) : [];
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    mean_vwc_pct: r1(avg(now)),
    min_vwc_pct: r1(Math.min(...now)),
    max_vwc_pct: r1(Math.max(...now)),
    readings: now.length,
    change_7d_pct_points: week.length ? r1(avg(now) - avg(week)) : 0,
  };
}

function uniqueSources(sources: Source[]): ResearchSource[] {
  const seen = new Map<string, ResearchSource>();
  for (const s of sources) if (!seen.has(s.url)) seen.set(s.url, { title: s.title, url: s.url });
  return [...seen.values()];
}

/** Without a Claude key: the built-in, sourced Qatar reference instead of live research. */
function referenceResearch(month: number, scarce: string[], glut: string[], reason: string): LandResearch {
  const eggs = goalFor("table-eggs");
  const veg = goalFor("vegetables");
  const season = qatarSeason(month);
  const highlights: LandResearch["highlights"] = [
    {
      title: "Eggs have the biggest gap to the 2030 goal",
      detail: `Local eggs cover ${eggs.current_pct}% of demand (${eggs.current_year}) against a ${eggs.target_pct}% target.`,
      signal: "opportunity",
      sources: uniqueSources(eggs.sources),
    },
    season === "summer"
      ? {
          title: "Vegetables are short in the summer",
          detail: `From June to September local supply drops and prices rise${scarce.length ? ` for ${scarce.join(", ").toLowerCase()}` : ""}. Local vegetables cover ${veg.current_pct}% of demand (${veg.current_year}), against ${veg.target_pct}% by 2030.`,
          signal: "opportunity",
          sources: uniqueSources(veg.sources),
        }
      : season === "peak"
        ? {
            title: "Winter glut",
            detail: `December to March is the peak of local supply: prices fall${glut.length ? ` for ${glut.join(", ").toLowerCase()}` : ""}. Sell early or late, or grow for the summer.`,
            signal: "risk",
            sources: uniqueSources(veg.sources),
          }
        : {
            title: "Between seasons",
            detail: `Local vegetables cover ${veg.current_pct}% of demand (${veg.current_year}); the winter glut starts in December and the summer shortage in June.`,
            signal: "neutral",
            sources: uniqueSources(veg.sources),
          },
    {
      title: "Groundwater is over-pumped",
      detail: `About ${WATER_POLICY.groundwaterAbstraction_Mm3_per_yr} Mm³ a year is pumped against a safe yield of ${WATER_POLICY.groundwaterSafeYield_Mm3_per_yr} Mm³. The strategy aims to cut water per tonne of crops by ${WATER_POLICY.waterPerTonneCut2030_pct}% by 2030.`,
      signal: "risk",
      sources: uniqueSources(WATER_POLICY.sources),
    },
  ];
  return {
    status: "offline",
    model: null,
    searched_at: null,
    headline: reason,
    highlights,
    advice: "",
    caveats: [`Built-in figures were last reviewed on ${formatShortDay(FOOD_SECURITY_REVIEWED)} ${FOOD_SECURITY_REVIEWED.slice(0, 4)}; check the sources for anything newer.`],
    sources: uniqueSources(NATIONAL_GOALS.flatMap((g) => g.sources)),
  };
}

export interface AdviseOptions {
  /** Run live research when possible (the API route); the page's first render skips it. */
  research: boolean;
}

export async function adviseLandUse(req: LandRequest, data: DashboardData, options: AdviseOptions): Promise<LandReport> {
  const bundle = req.farm_id ? data.farms.find((b) => b.farm.id === req.farm_id) : undefined;
  if (req.farm_id && !bundle) throw new LandInputError(`There's no farm called "${req.farm_id}".`);
  const lat = bundle ? bundle.farm.lat : req.lat!;
  const lng = bundle ? bundle.farm.lng : req.lng!;
  if (!isInQatar(lat, lng)) throw new LandInputError("That point isn't in Qatar. Enter a latitude around 24.5–26.2 and a longitude around 50.7–51.7.");

  const research = options.research && req.research && (researchAvailable() || modelConfigured());
  const key = JSON.stringify([lat.toFixed(4), lng.toFixed(4), req.area_ha, req.water_source, req.water_ec_dS_m ?? null, req.budget, bundle?.farm.id ?? null, research]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.report;

  const asOf = qatarDateString(new Date());
  const month = Number(asOf.slice(5, 7));
  const location = describeLocation([lng, lat], bundle?.farm.region);
  const climate = await getSiteClimate(lat, lng, asOf);
  const farmEc = bundle ? bundle.farm.irrigation_water_ec : null;
  const water = assessWater(req.water_source, req.water_ec_dS_m, location, farmEc);
  const sensors = bundle ? sensorSummary(bundle) : null;
  const ranked = rankOptions({ location, climate, water, area_ha: req.area_ha, budget: req.budget });

  const cropIds = Object.keys(CROPS) as CropId[];
  const scarce = cropIds.filter((c) => priceSignal(c, month) === "scarce").map((c) => CROPS[c].name);
  const glut = cropIds.filter((c) => priceSignal(c, month) === "glut").map((c) => CROPS[c].name);
  const season = SEASON_LABEL[qatarSeason(month)];

  let researchOut: LandResearch;
  let adjusted = ranked;
  // The fine-tuned model answers the land question first (AI_MODEL_URL); Claude's web research is the fallback.
  let fromModel: LandResearch | null = null;
  if (options.research && req.research && modelConfigured()) {
    try {
      fromModel = await askModelAboutLand({
        lat,
        lng,
        area_ha: req.area_ha,
        budget: req.budget,
        water: { source: req.water_source, ec: water.ec_dS_m },
        robot: bundle ? probeSurvey(bundle) : null,
      });
    } catch (error) {
      console.warn("[land] Harvestar AI model unavailable, falling back:", error instanceof Error ? error.message : error);
    }
  }
  const live = fromModel
    ? { research: fromModel, adjustments: [] }
    : research
    ? await researchLandUse({ as_of: asOf, season, location, area_ha: req.area_ha, budget: req.budget, water, climate, sensors, options: ranked })
    : null;
  if (live) {
    researchOut = live.research;
    adjusted = applyAdjustments(ranked, live.adjustments);
  } else {
    const reason = !researchAvailable()
      ? "From Harvestar AI's built-in Qatar market and news notes."
      : "Run the analysis to search current Qatar news and markets; this first view uses the built-in Qatar reference data.";
    researchOut = referenceResearch(month, scarce, glut, reason);
  }
  if (live?.research.status === "failed") {
    // Keep the failure message but show the reference highlights underneath.
    const ref = referenceResearch(month, scarce, glut, live.research.headline);
    researchOut = { ...ref, status: "failed" };
  }

  const report: LandReport = {
    generated_at: new Date().toISOString(),
    as_of: asOf,
    location,
    area_ha: req.area_ha,
    budget: req.budget,
    water,
    climate,
    sensors,
    goals: goalRows(),
    market_now: { season, scarce, glut, note: MARKET_REFERENCE_NOTE },
    options: adjusted,
    research: researchOut,
    method: [
      "Water fit: FAO-29 salt tolerance (Maas–Hoffman) at ECe ≈ 1.5 × ECw with a 15–20% leaching fraction; livestock drinking water from FAO-29 Table 30.",
      "Water need: the site's monthly ET₀ over the last year (Open-Meteo archive, FAO-56 Penman–Monteith) × crop coefficient, plus the FAO-29 leaching requirement.",
      "National goals: Qatar National Food Security Strategy 2030 targets and the latest reported self-sufficiency.",
      "Score: water 30%, national goal 20%, market 15%, budget 15%, water policy 10%, site 10%. A product heuristic for comparing options, not a published index.",
      ...(fromModel
        ? ["Harvestar AI model: the fine-tuned model answered the land question from the same nine inputs it was trained on (site, FAO grid, a year of Open-Meteo climate, the 7-day forecast, water and probes)."]
        : researchOut.status === "live"
          ? ["Live research: Claude searched current news and markets and moved scores by up to ±10 where it found evidence."]
          : []),
    ],
  };
  cache.set(key, { at: Date.now(), report });
  return report;
}

/** The planner's starting inputs for a farm. */
export function defaultLandRequest(bundle: FarmBundle): LandRequest {
  return {
    farm_id: bundle.farm.id,
    area_ha: Math.round(bundle.farm.area_ha * 10) / 10,
    water_source: "groundwater",
    water_ec_dS_m: null,
    budget: "medium",
    research: true,
  };
}

import type { Metadata } from "next";
import { LandPlanner, type PlannerFarm } from "@/components/land/land-planner";
import { CROPS } from "@/lib/agronomy-tables";
import { requireUser } from "@/lib/auth/session";
import { rankFarms } from "@/lib/dashboard";
import { getDashboardFor } from "@/lib/data/repository";
import { adviseLandUse, defaultLandRequest } from "@/lib/land/advisor";
import { researchAvailable } from "@/lib/land/research";

export const metadata: Metadata = { title: "Land use" };

export default async function LandPage({ searchParams }: PageProps<"/dashboard/land">) {
  const user = await requireUser("/dashboard/land");
  const [{ farm }, data] = await Promise.all([searchParams, getDashboardFor(user)]);
  const ranked = rankFarms(data.farms);
  const selected = (typeof farm === "string" ? ranked.find((b) => b.farm.id === farm) : undefined) ?? ranked[0];
  const farms: PlannerFarm[] = ranked.map((b) => ({
    id: b.farm.id,
    name: b.farm.name,
    crop: CROPS[b.farm.main_crop].name,
    region: b.farm.region,
    lat: b.farm.lat,
    lng: b.farm.lng,
    area_ha: Math.round(b.farm.area_ha * 10) / 10,
    water_ec_dS_m: b.farm.irrigation_water_ec,
  }));

  // First view: the rules only (fast); the planner runs live research when the user asks.
  const request = selected
    ? defaultLandRequest(selected)
    : { lat: 25.68, lng: 51.49, area_ha: 5, water_source: "groundwater" as const, water_ec_dS_m: null, budget: "medium" as const, research: true };
  const report = await adviseLandUse(request, data, { research: false });

  return (
    <div className="yai-enter px-4 pt-5 pb-10 sm:px-6 lg:px-8 lg:pt-6">
      <LandPlanner farms={farms} initialRequest={request} initialReport={report} researchAvailable={researchAvailable()} />
    </div>
  );
}

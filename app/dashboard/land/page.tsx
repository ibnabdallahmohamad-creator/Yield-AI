import type { Metadata } from "next";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { LandAtlas } from "@/components/land/land-atlas";
import { requireUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/data/repository";
import { isDemoUser, scopeFor } from "@/lib/farms/scope";
import type { AtlasCell } from "@/lib/land/layers";
import { allLandCells, landCellAt } from "@/lib/land/profile";

export const metadata: Metadata = { title: "Land atlas" };

const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export default async function LandAtlasPage({ searchParams }: PageProps<"/dashboard/land">) {
  const user = await requireUser("/dashboard/land");
  const [{ cell, lat, lng }, data] = await Promise.all([searchParams, getDashboardData(scopeFor(user))]);

  const cells: AtlasCell[] = allLandCells().map((c) => ({
    id: c.id,
    b: [r(c.bounds.south, 5), r(c.bounds.west, 5), r(c.bounds.north, 5), r(c.bounds.east, 5)],
    m: c.municipality,
    lf: c.landscape.landform,
    arable: c.landscape.arable,
    fertility: c.landscape.fertilityIndex,
    rain: c.climate.annualRain_mm,
    tmax: c.climate.monthly[6].tmax_C,
    tmin: c.climate.monthly[0].tmin_C,
    rh: c.climate.meanRh_pct,
    tds: c.landscape.groundwater.tds_mg_l,
    et0: c.climate.annualEt0_mm,
  }));
  const initialCellId =
    typeof cell === "string" ? cell.toUpperCase() : typeof lat === "string" && typeof lng === "string" ? landCellAt(Number(lat), Number(lng))?.id : undefined;

  return (
    <div className="min-h-dvh">
      <DashboardHeader className="sticky top-0" user={{ name: user.name, email: user.email }} canEdit={!isDemoUser(user)} title="Land atlas" />
      <h1 className="sr-only">Qatar land atlas</h1>
      <LandAtlas
        cells={cells}
        farms={data.farms.map((b) => ({ id: b.farm.id, name: b.farm.name, lat: b.farm.lat, lng: b.farm.lng }))}
        initialCellId={initialCellId}
      />
    </div>
  );
}

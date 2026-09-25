import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FarmDetails } from "@/components/farm/farm-details";
import { farmLocation } from "@/lib/ai/farm-facts";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { isChartTab } from "@/lib/charts";
import { getFarmBundleFor } from "@/lib/data/repository";
import { METRICS, type MetricKey } from "@/lib/metrics";
import { parseFarmTab } from "@/lib/routes";

export async function generateMetadata({ params }: PageProps<"/dashboard/farm/[id]">): Promise<Metadata> {
  // Farm names are only for signed-in users (the page itself redirects everyone else).
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user) return { title: "Farm" };
  const found = await getFarmBundleFor(user, id).catch(() => null);
  return { title: found ? found.bundle.farm.name : "Farm not found" };
}

export default async function FarmPage({ params, searchParams }: PageProps<"/dashboard/farm/[id]">) {
  const { id } = await params;
  const user = await requireUser(`/dashboard/farm/${encodeURIComponent(id)}`);
  const [{ tab, view, chart, layer }, found] = await Promise.all([searchParams, getFarmBundleFor(user, id)]);
  if (!found) notFound();
  const parsed = parseFarmTab(tab);

  return (
    <FarmDetails
      // A new farm starts from its own defaults (tab state isn't carried across farms).
      key={found.bundle.farm.id}
      data={found.data}
      bundle={found.bundle}
      location={farmLocation(found.bundle)}
      initialTab={parsed.tab}
      initialView={view === "readings" ? "readings" : parsed.view}
      initialChart={isChartTab(chart) ? chart : undefined}
      initialLayer={typeof layer === "string" && layer in METRICS ? (layer as MetricKey) : undefined}
    />
  );
}

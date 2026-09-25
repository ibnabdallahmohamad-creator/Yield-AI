import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FarmDetail } from "@/components/dashboard/farm-detail";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { getFarmBundle } from "@/lib/data/repository";
import { isDemoUser, scopeFor } from "@/lib/farms/scope";
import { METRICS, type MetricKey } from "@/lib/metrics";

export async function generateMetadata({ params }: PageProps<"/dashboard/farm/[id]">): Promise<Metadata> {
  // Farm names are only for signed-in users (the page itself redirects everyone else).
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user) return { title: "Farm details" };
  const found = await getFarmBundle(scopeFor(user), id).catch(() => null);
  return { title: found ? found.bundle.farm.name : "Farm not found" };
}

export default async function FarmPage({ params, searchParams }: PageProps<"/dashboard/farm/[id]">) {
  const { id } = await params;
  const user = await requireUser(`/dashboard/farm/${encodeURIComponent(id)}`);
  const [{ layer }, found] = await Promise.all([searchParams, getFarmBundle(scopeFor(user), id)]);
  if (!found) notFound();
  const initialMetric = typeof layer === "string" && layer in METRICS ? (layer as MetricKey) : undefined;

  return (
    <FarmDetail
      data={found.data}
      bundle={found.bundle}
      user={{ name: user.name, email: user.email }}
      canEdit={!isDemoUser(user)}
      initialMetric={initialMetric}
    />
  );
}

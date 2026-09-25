import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Home } from "@/components/home/home";
import { requireUser } from "@/lib/auth/session";
import { getDashboardFor } from "@/lib/data/repository";
import { METRICS, type MetricKey } from "@/lib/metrics";
import { greetingFor } from "@/lib/portfolio";

export const metadata: Metadata = { title: "Home" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser("/dashboard");
  const [{ farm, layer, chart }, data] = await Promise.all([searchParams, getDashboardFor(user)]);

  // Old links (/dashboard?farm=…) opened one farm's snapshot, which now lives in its workspace.
  if (typeof farm === "string" && data.farms.some((b) => b.farm.id === farm)) {
    const query = new URLSearchParams();
    if (typeof layer === "string") query.set("layer", layer);
    if (typeof chart === "string") query.set("chart", chart);
    redirect(`/dashboard/farm/${encodeURIComponent(farm)}${query.size ? `?${query}` : ""}`);
  }

  return (
    <Home
      data={data}
      userName={user.name}
      greeting={greetingFor(new Date().toISOString())}
      initialLayer={typeof layer === "string" && layer in METRICS ? (layer as MetricKey) : undefined}
    />
  );
}

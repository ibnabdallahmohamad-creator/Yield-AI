import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/data/repository";
import { isDemoUser, scopeFor } from "@/lib/farms/scope";
import { METRICS, type MetricKey } from "@/lib/metrics";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser("/dashboard");
  const [{ farm, layer }, data] = await Promise.all([searchParams, getDashboardData(scopeFor(user))]);
  const initialFarmId = typeof farm === "string" ? farm : undefined;
  const initialMetric = typeof layer === "string" && layer in METRICS ? (layer as MetricKey) : undefined;

  return (
    <DashboardShell
      data={data}
      user={{ name: user.name, email: user.email }}
      canEdit={!isDemoUser(user)}
      initialFarmId={initialFarmId}
      initialMetric={initialMetric}
    />
  );
}

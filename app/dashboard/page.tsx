import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { isDashboardTab } from "@/components/dashboard/tabs";
import { requireUser } from "@/lib/auth/session";
import { getDashboardData, getViewerSettings } from "@/lib/data/repository";
import { METRICS, type MetricKey } from "@/lib/metrics";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser("/dashboard");
  const [{ farm, layer, tab }, data, settings] = await Promise.all([searchParams, getDashboardData(user), getViewerSettings(user)]);
  // A new account has nothing to show yet: start with adding a farm and connecting an ESP32.
  if (!user.demo && data.farms.length === 0 && !data.sourceNote) redirect("/dashboard/setup");

  const initialFarmId = typeof farm === "string" ? farm : undefined;
  const initialMetric = typeof layer === "string" && layer in METRICS ? (layer as MetricKey) : undefined;
  const initialTab = isDashboardTab(tab) ? tab : undefined;

  return (
    <DashboardShell
      data={data}
      user={{ name: user.name, email: user.email, demo: user.demo }}
      settings={settings}
      initialFarmId={initialFarmId}
      initialMetric={initialMetric}
      initialTab={initialTab}
    />
  );
}

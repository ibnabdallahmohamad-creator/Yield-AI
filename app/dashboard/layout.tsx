import { AppShell } from "@/components/shell/app-shell";
import type { ShellFarm } from "@/components/shell/shell-context";
import { CROPS } from "@/lib/agronomy-tables";
import { getCurrentUser } from "@/lib/auth/session";
import { rankFarms, riskReason } from "@/lib/dashboard";
import { getDashboardFor } from "@/lib/data/repository";

/** Shared frame for every /dashboard page. Pages still check the session themselves (and redirect). */
export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const user = await getCurrentUser();
  if (!user) return children;
  const data = await getDashboardFor(user);
  const farms: ShellFarm[] = rankFarms(data.farms).map((b) => {
    const reason = riskReason(b);
    return {
      id: b.farm.id,
      name: b.farm.name,
      crop: CROPS[b.farm.main_crop].name,
      region: b.farm.region,
      riskLevel: b.insight?.risk_level ?? null,
      riskScore: b.insight ? Math.round(b.insight.risk_score) : null,
      reason: reason.label,
      reasonTone: reason.tone,
      doFirst: b.insight?.recommendations.filter((r) => r.priority === "high").length ?? 0,
    };
  });
  return (
    <AppShell
      user={{ name: user.name, email: user.email }}
      farms={farms}
      status={{
        source: data.source,
        sourceNote: data.sourceNote,
        // With no farms there is nothing to look up, which isn't an outage.
        weatherOffline: data.farms.length > 0 && data.weather.source === "unavailable",
        weatherNote: data.weather.note,
        account: data.account ? { devices: data.account.devices.length, interval_s: data.account.interval_s, error: data.account.error } : null,
      }}
    >
      {children}
    </AppShell>
  );
}

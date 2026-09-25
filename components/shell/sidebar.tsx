"use client";

/**
 * Desktop navigation: a sidebar with the sections and, below them, every farm ranked by risk — one
 * click to any farm from any page. From 1280 px it shows labels (unless the user collapses it);
 * narrower desktops get a 68 px rail with tooltips and farm monograms.
 */
import { ChevronsLeft, ChevronsRight, Cpu, House, LandPlot, ListChecks } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { HealthDot, RISK_TONE, riskLabel } from "@/components/dashboard/risk-badge";
import { farmHref, sectionHref, useShell, type Section, type ShellFarm } from "@/components/shell/shell-context";
import { UserMenu } from "@/components/shell/user-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/** Visible only when the sidebar shows labels (≥ 1280 px and not collapsed). */
const WIDE = "hidden xl:flex xl:group-data-[collapsed=true]/shell:hidden";
/** Visible only in the narrow rail. */
const RAIL = "flex xl:hidden xl:group-data-[collapsed=true]/shell:flex";

interface NavItem {
  section: Exclude<Section, "other" | "assistant">;
  label: string;
  icon: React.ReactNode;
}

const NAV: NavItem[] = [
  { section: "home", label: "Home", icon: <House /> },
  { section: "insights", label: "Plan", icon: <ListChecks /> },
  { section: "land", label: "Land use", icon: <LandPlot /> },
  { section: "devices", label: "Farms & devices", icon: <Cpu /> },
];

/** Two letters for a farm in the rail: "Al Khor North Farm" → "KN", "Al Khor Pivot 3" → "K3". */
export function farmMonogram(name: string): string {
  const words = name.split(/\s+/).filter((w) => !/^(al|farm|farms|the)$/i.test(w));
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : (words[0][1] ?? "");
  return `${first}${last}`.toUpperCase();
}

function RailTip({ label, rail, children }: { label: React.ReactNode; rail: boolean; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className={rail ? undefined : "hidden"}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

const ROW =
  "relative flex w-full items-center gap-3 rounded-lg text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none";

function FarmRow({ farm, active, rail }: { farm: ShellFarm; active: boolean; rail: boolean }) {
  const tone = farm.riskLevel ? RISK_TONE[farm.riskLevel] : "none";
  const risk = farm.riskLevel ? `${riskLabel(farm.riskLevel)}${farm.riskScore != null ? ` ${farm.riskScore}` : ""}` : "No assessment yet";
  return (
    <li>
      <RailTip
        rail={rail}
        label={
          <span className="block">
            <span className="block font-semibold">{farm.name}</span>
            <span className="block opacity-80">
              {farm.reason} · {risk}
            </span>
          </span>
        }
      >
        <Link
          href={farmHref(farm.id)}
          aria-current={active ? "page" : undefined}
          aria-label={`${farm.name}: ${farm.reason}, ${risk}`}
          className={cn(
            ROW,
            "px-2.5 py-1.5",
            active ? "bg-card text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
          )}
        >
          {/* Rail: a monogram with the risk dot on its corner. */}
          <span className={cn(RAIL, "relative size-8 shrink-0 items-center justify-center rounded-lg bg-card text-xs font-semibold text-foreground ring-1 ring-border")}>
            {farmMonogram(farm.name)}
            <HealthDot tone={tone} className="absolute -top-0.5 -right-0.5 size-2.5" />
          </span>
          {/* Wide: one line — dot, name, score (the reason is on Home and the farm's own page). */}
          <span className={cn(WIDE, "min-w-0 flex-1 items-center gap-2.5")} title={`${farm.reason} · ${risk}`}>
            <HealthDot tone={tone} className="ring-0" />
            <span className={cn("min-w-0 flex-1 truncate font-medium", active && "text-foreground")}>{farm.name}</span>
            {farm.riskScore != null ? <span className="text-xs font-medium tabular text-muted-foreground">{farm.riskScore}</span> : null}
          </span>
        </Link>
      </RailTip>
    </li>
  );
}

export function Sidebar({ user }: { user: { name: string; email: string } }) {
  const { section, farmId, farms, sidebarCollapsed, setSidebarCollapsed } = useShell();
  const wide = useMediaQuery("(min-width: 1280px)", true);
  const rail = !wide || sidebarCollapsed;
  const doFirst = farms.reduce((n, f) => n + f.doFirst, 0);

  return (
    <nav
      aria-label="Main"
      data-chrome
      className="fixed inset-y-0 left-0 z-30 hidden w-[4.25rem] flex-col border-r bg-sidebar lg:flex xl:w-64 xl:group-data-[collapsed=true]/shell:w-[4.25rem]"
    >
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <Link href="/dashboard" aria-label="Yield AI home" className="-m-1 rounded-lg p-1 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
          <LogoMark className="size-7" />
        </Link>
        <span className={cn(WIDE, "flex-1 items-baseline gap-1 text-base font-semibold tracking-tight")}>
          Yield <span className="text-primary">AI</span>
        </span>
        <button
          type="button"
          onClick={() => setSidebarCollapsed(true)}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className={cn(WIDE, "size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none [&_svg]:size-4")}
        >
          <ChevronsLeft />
        </button>
      </div>

      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pt-2 pb-3">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = section === item.section;
            const badge = item.section === "insights" && doFirst > 0 ? doFirst : null;
            return (
              <li key={item.section}>
                <RailTip rail={rail} label={badge ? `${item.label} · ${badge} to do first` : item.label}>
                  <Link
                    href={sectionHref(item.section, farmId)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      ROW,
                      "h-10 px-3.5 font-medium [&_svg]:size-5 [&_svg]:shrink-0",
                      active ? "bg-card text-foreground shadow-xs ring-1 ring-border [&_svg]:text-primary" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                    )}
                  >
                    <span className="relative">
                      {item.icon}
                      {badge ? <span className={cn(RAIL, "absolute -top-1 -right-1 size-2.5 rounded-full bg-risk-high ring-2 ring-sidebar")} aria-hidden="true" /> : null}
                    </span>
                    <span className={cn(WIDE, "flex-1 items-center justify-between")}>
                      {item.label}
                      {badge ? (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-risk-high-soft px-1.5 text-xs font-semibold tabular text-risk-high-ink" aria-label={`${badge} to do first`}>
                          {badge}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </RailTip>
              </li>
            );
          })}
        </ul>

        {farms.length > 0 ? (
          <div className="mt-6">
            <p className={cn(WIDE, "items-baseline justify-between px-3.5 pb-1.5 text-xs font-semibold text-muted-foreground")}>
              <span>Farms</span>
              <span className="font-normal tabular">by risk</span>
            </p>
            <div className={cn(RAIL, "mx-auto mb-2 h-px w-8 bg-border")} aria-hidden="true" />
            <ul className="space-y-0.5" aria-label="Farms ranked by risk">
              {farms.map((f) => (
                <FarmRow key={f.id} farm={f} active={section === "farm" && f.id === farmId} rail={rail} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-1 border-t px-2.5 py-2.5">
        {sidebarCollapsed ? (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="hidden size-12 items-center justify-center self-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none xl:flex [&_svg]:size-4"
          >
            <ChevronsRight />
          </button>
        ) : null}
        <UserMenu user={user} variant="sidebar" />
      </div>
    </nav>
  );
}

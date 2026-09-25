"use client";

import { ChevronDown, ChevronRight, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LogoMark } from "@/components/brand/logo";
import { HealthDot, RISK_TONE } from "@/components/dashboard/risk-badge";
import { FarmPicker } from "@/components/shell/farm-picker";
import { sectionHref, useShell, type Section } from "@/components/shell/shell-context";
import { StatusMenu } from "@/components/shell/status-menu";
import { UserMenu } from "@/components/shell/user-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

const TITLE: Record<Section, string> = {
  home: "Home",
  insights: "Plan",
  farm: "Farms",
  land: "Land use",
  devices: "Farms & devices",
  assistant: "Assistant",
  other: "Yield AI",
};

/** "Farms › Al Khor North Farm ▾": the ▾ switches farm without leaving the tab you're on. */
function FarmCrumb() {
  const { farms, farmId, switchFarm, setFarmsSheetOpen } = useShell();
  const [open, setOpen] = useState(false);
  const desktop = useMediaQuery("(min-width: 1024px)", true);
  const farm = farms.find((f) => f.id === farmId);
  if (!farm) return null;
  const trigger = (
    <button
      type="button"
      onClick={desktop ? undefined : () => setFarmsSheetOpen(true)}
      className="inline-flex h-9 max-w-full min-w-0 items-center gap-2 rounded-lg px-2 text-base font-semibold hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none aria-expanded:bg-muted pointer-coarse:h-11"
      aria-label={`Switch farm (now ${farm.name})`}
    >
      <HealthDot tone={farm.riskLevel ? RISK_TONE[farm.riskLevel] : "none"} className="ring-0" />
      <span className="truncate">{farm.name}</span>
      <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
  if (!desktop) return trigger;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <p className="px-3 pt-1 pb-2 text-xs font-semibold text-muted-foreground">Switch farm · ranked by risk</p>
        <FarmPicker
          farms={farms}
          selectedId={farmId}
          onSelect={(id) => {
            setOpen(false);
            switchFarm(id);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Slim page header: where you are, search (Ctrl K), Ask AI (Ctrl J) and one status dot. */
export function AppHeader({ user }: { user: { name: string; email: string } }) {
  const { section, setPaletteOpen, farms, farmId } = useShell();
  const farmName = farms.find((f) => f.id === farmId)?.name;
  return (
    <header data-chrome className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md sm:px-4 lg:px-6">
      <Link
        href="/dashboard"
        aria-label="Yield AI home"
        className="-ml-1.5 flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none lg:hidden"
      >
        <LogoMark className="size-8" />
      </Link>
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex min-w-0 items-center gap-1 text-base">
          {section === "farm" ? (
            <>
              <li className="hidden sm:block">
                <Link href="/dashboard" className="rounded-md px-1 font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
                  Farms
                </Link>
              </li>
              <li aria-hidden="true" className="hidden text-muted-foreground/60 sm:block">
                <ChevronRight className="size-4" />
              </li>
              <li className="flex min-w-0">
                <FarmCrumb />
              </li>
            </>
          ) : (
            <li className="truncate px-1 font-semibold" aria-current="page">
              {TITLE[section]}
            </li>
          )}
        </ol>
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="inline-flex size-11 items-center justify-center gap-2 rounded-full text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:size-10 md:h-9 md:w-56 md:justify-start md:rounded-lg md:border md:bg-card md:px-3 md:hover:bg-card md:hover:ring-1 md:hover:ring-border"
          aria-label="Search farms and pages (Ctrl K)"
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="hidden flex-1 text-left md:inline">Search farms…</span>
          <kbd className="hidden rounded border bg-muted px-1.5 font-sans text-xs md:inline">Ctrl K</kbd>
        </button>
        <Link
          href={sectionHref("assistant", farmId)}
          aria-label={farmName ? `Ask AI about ${farmName} (Ctrl J)` : "Ask AI (Ctrl J)"}
          title="Ask AI · Ctrl J"
          className={cn(
            "hidden h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-forest-800 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:inline-flex",
          )}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          Ask AI
        </Link>
        <StatusMenu />
        <div className="lg:hidden">
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}

"use client";

/**
 * "Soil & weather" (ui_improvement §7.3): one card, five tabs, one shared time range. Every tab
 * shows a headline and a sentence, then the chart, its legend, secondary stats, the data source
 * and a hand-off to the assistant. The only colour on the tab row is a dot on a tab in a risk class.
 */
import { Ellipsis, Maximize2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { NpkPanel, MoisturePanel, SalinityPanel, type PanelProps } from "@/components/charts/soil-panels";
import { RainPanel, TemperaturePanel } from "@/components/charts/weather-panels";
import { HealthDot } from "@/components/dashboard/risk-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AllPanel } from "@/components/charts/all-panel";
import { CHART_TABS, tabAlert, type ChartTab } from "@/lib/charts";
import { hasPreviousPeriod, type ChartOverlay } from "@/lib/dashboard";
import { assistantHref } from "@/lib/routes";
import type { FarmBundle } from "@/lib/types";
import { cn } from "@/lib/utils";

export const RANGES = [7, 30, 60] as const;
export type RangeDays = (typeof RANGES)[number];

const TONE_WORD = { bad: "at risk", warn: "watch", ok: "", none: "" } as const;

const PANELS: Record<ChartTab, (p: PanelProps) => React.ReactNode> = {
  salinity: SalinityPanel,
  moisture: MoisturePanel,
  npk: NpkPanel,
  temperature: TemperaturePanel,
  rain: RainPanel,
};

export function askAiHref(farmId: string, question: string): string {
  return assistantHref(farmId, question);
}

export interface SoilWeatherCardProps {
  bundle: FarmBundle;
  /** All farms, for "Compare with another farm". */
  farms: FarmBundle[];
  dates: string[];
  /** Last day shown (today, or the day being viewed). */
  index: number;
  tab: ChartTab;
  onTabChange: (tab: ChartTab) => void;
  variant?: "compact" | "full";
  markers?: PanelProps["markers"];
  /** Link to the full-size chart (shown on the compact card). */
  expandHref?: string;
  className?: string;
}

export function SoilWeatherCard({
  bundle,
  farms,
  dates,
  index,
  tab,
  onTabChange,
  variant = "compact",
  markers = [],
  expandHref,
  className,
}: SoilWeatherCardProps) {
  const compact = variant === "compact";
  const narrow = useMediaQuery(PHONE_QUERY);
  const [range, setRange] = useState<RangeDays>(30);
  const [compare, setCompare] = useState<string>("none");
  const [showProbes, setShowProbes] = useState(false);
  const [showSoil, setShowSoil] = useState(false);
  // "All" (full-size card only) is held against the tab it was opened from, so a tab change from
  // outside (a map layer, an action's "See the chart") leaves it without an effect.
  const [allFrom, setAllFrom] = useState<ChartTab | null>(null);
  const [prevTab, setPrevTab] = useState(tab);
  if (tab !== prevTab) {
    setPrevTab(tab);
    setAllFrom(null);
  }
  const showAll = !compact && allFrom === tab;

  const end = Math.min(index, dates.length - 1);
  const start = Math.max(0, end - range + 1);
  const canPrevious = hasPreviousPeriod(start, end);
  const others = useMemo(() => farms.filter((f) => f.farm.id !== bundle.farm.id), [farms, bundle.farm.id]);

  // A compare choice that no longer applies (farm switched, range too long) quietly falls back.
  const overlay: ChartOverlay = useMemo(() => {
    if (compare === "previous" && canPrevious) return { kind: "previous" };
    const other = compare.startsWith("farm:") ? others.find((f) => f.farm.id === compare.slice(5)) : undefined;
    return other ? { kind: "farm", bundle: other } : { kind: "none" };
  }, [compare, canPrevious, others]);
  const overlayLabel = overlay.kind === "previous" ? `Previous ${range} days` : overlay.kind === "farm" ? overlay.bundle.farm.name : null;

  const soilTab = !showAll && (tab === "salinity" || tab === "moisture");
  const tempTab = !showAll && tab === "temperature";
  const hasOptions = soilTab || tempTab || (compact && expandHref);

  const panel: PanelProps = {
    bundle,
    dates,
    start,
    end,
    height: narrow ? 200 : compact ? 220 : 300,
    compact,
    narrow,
    markers,
    overlay: soilTab ? overlay : { kind: "none" },
    overlayLabel: soilTab ? overlayLabel : null,
    showProbes: soilTab && showProbes,
    showSoil: tempTab && showSoil,
    askHref: (q) => askAiHref(bundle.farm.id, q),
  };
  const Panel = showAll ? AllPanel : PANELS[tab];

  return (
    <section aria-labelledby="soil-weather-title" className={cn("rounded-2xl border bg-card p-4 shadow-xs sm:p-5", className)}>
      <div className="flex items-center gap-2">
        <h2 id="soil-weather-title" className="mr-auto text-base font-semibold">
          Soil &amp; weather
        </h2>
        <Select value={String(range)} onValueChange={(v) => setRange(Number(v) as RangeDays)}>
          <SelectTrigger aria-label="Time range" className="h-11 lg:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {RANGES.map((r) => (
              <SelectItem key={r} value={String(r)}>
                {r} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-11 lg:size-9" aria-label="Chart options" disabled={!hasOptions}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {soilTab ? (
              <>
                <DropdownMenuLabel>Compare with</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={overlay.kind === "none" ? "none" : compare} onValueChange={setCompare}>
                  <DropdownMenuRadioItem value="none" className="min-h-9">
                    Nothing
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="previous" disabled={!canPrevious} className="min-h-9">
                    Previous {range} days{canPrevious ? "" : " (no data)"}
                  </DropdownMenuRadioItem>
                  {others.map((f) => (
                    <DropdownMenuRadioItem key={f.farm.id} value={`farm:${f.farm.id}`} className="min-h-9">
                      {f.farm.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={showProbes} onCheckedChange={(v) => setShowProbes(v === true)} className="min-h-9">
                  Show each probe
                </DropdownMenuCheckboxItem>
              </>
            ) : null}
            {tempTab ? (
              <DropdownMenuCheckboxItem checked={showSoil} onCheckedChange={(v) => setShowSoil(v === true)} className="min-h-9">
                Show soil temperature
              </DropdownMenuCheckboxItem>
            ) : null}
            {compact && expandHref ? (
              <>
                {soilTab || tempTab ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem asChild className="min-h-9">
                  <Link href={expandHref}>
                    <Maximize2 /> Open full-size charts
                  </Link>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Tabs
        value={showAll ? "all" : tab}
        onValueChange={(v) => {
          if (v === "all") return setAllFrom(tab);
          setAllFrom(null);
          onTabChange(v as ChartTab);
        }}
        className="mt-2 gap-4"
      >
        <TabsList aria-label="Soil and weather charts" className="-mx-1 px-1">
          {CHART_TABS.map((t) => {
            const tone = tabAlert(bundle, t.key, end);
            return (
              <TabsTrigger key={t.key} value={t.key} className="gap-1.5 px-2 sm:gap-2 sm:px-3">
                {t.key === "temperature" ? (
                  <>
                    <span className="sm:hidden">Temp.</span>
                    <span className="hidden sm:inline">Temperature</span>
                  </>
                ) : (
                  t.label
                )}
                {tone === "bad" || tone === "warn" ? <HealthDot tone={tone} label={TONE_WORD[tone]} className="ring-0" /> : null}
              </TabsTrigger>
            );
          })}
          {!compact ? (
            <TabsTrigger value="all" className="px-2 sm:px-3">
              All
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value={showAll ? "all" : tab}>
          <Panel {...panel} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

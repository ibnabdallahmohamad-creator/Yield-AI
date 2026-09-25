"use client";

/**
 * A farm's workspace (`/dashboard/farm/[id]`): everything about one farm, in tabs under a stable
 * header. Today (headline numbers, the field map beside what to do, the soil & weather charts and
 * the next 12 hours) · Advice (the full assessment) · Trends (charts at full size) · Probes (the
 * daily table per probe, or every reading) · Method. Tab, chart and view live in the URL.
 */
import { Fragment, useEffect, useState } from "react";
import { Next12hCard } from "@/components/charts/next-12h-card";
import { SoilWeatherCard } from "@/components/charts/soil-weather-card";
import { RiskBadge } from "@/components/dashboard/risk-badge";
import { Segmented } from "@/components/dashboard/segmented";
import { GetStarted } from "@/components/devices/get-started";
import { AdvicePanel } from "@/components/farm/advice-panel";
import { MethodPanel } from "@/components/farm/method-panel";
import { ProbesPanel } from "@/components/farm/probes-panel";
import { ReadingsExplorer } from "@/components/farm/readings-explorer";
import { KpiRow } from "@/components/overview/kpi-row";
import { OverviewMap } from "@/components/overview/overview-map";
import { WhatToDo } from "@/components/overview/what-to-do";
import { useShell, useShellFarm } from "@/components/shell/shell-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLiveDashboard } from "@/hooks/use-live-dashboard";
import { GROWTH_STAGE_LABEL } from "@/lib/agronomy";
import { CROPS } from "@/lib/agronomy-tables";
import { lastDataIndex } from "@/lib/ai/analysis";
import { defaultChartTab, layerForTab, nutrientSummary, tabForLayer, type ChartTab } from "@/lib/charts";
import { sortedActions } from "@/lib/dashboard";
import { formatShortDay, plural } from "@/lib/format";
import type { MetricKey } from "@/lib/metrics";
import type { QatarLocation } from "@/lib/qatar/location";
import { FARM_TABS, replaceUrl, type FarmTab, type ProbesView } from "@/lib/routes";
import type { DashboardData, FarmBundle } from "@/lib/types";
import { cn } from "@/lib/utils";

export function FarmDetails({
  data: serverData,
  bundle: serverBundle,
  location,
  initialTab = "today",
  initialView = "daily",
  initialChart,
  initialLayer,
}: {
  data: DashboardData;
  bundle: FarmBundle;
  location: QatarLocation;
  initialTab?: FarmTab;
  initialView?: ProbesView;
  initialChart?: ChartTab;
  initialLayer?: MetricKey;
}) {
  const shell = useShell();
  // Live readings update today's values here too.
  const { data, pulse, flashes } = useLiveDashboard(serverData);
  const bundle = data.farms.find((b) => b.farm.id === serverBundle.farm.id) ?? serverBundle;
  const { dates } = data;
  const last = dates.length - 1;
  const { farm, insight } = bundle;
  useShellFarm(farm.id);

  const [tab, setTab] = useState<FarmTab>(initialTab);
  const [view, setView] = useState<ProbesView>(initialView);
  const [chartChoice, setChartChoice] = useState<ChartTab | null>(initialChart ?? (initialLayer ? tabForLayer(initialLayer) : null));
  const [layerChoice, setLayerChoice] = useState<MetricKey | null>(initialLayer ?? null);
  // In-page links (e.g. "See the chart" under an action) change the URL: follow them.
  const [prevInitial, setPrevInitial] = useState({ initialTab, initialView, initialChart });
  if (prevInitial.initialTab !== initialTab || prevInitial.initialView !== initialView || prevInitial.initialChart !== initialChart) {
    setPrevInitial({ initialTab, initialView, initialChart });
    setTab(initialTab);
    setView(initialView);
    if (initialChart) setChartChoice(initialChart);
  }
  const chart = chartChoice ?? defaultChartTab(bundle);
  const metricKey: MetricKey = layerChoice ?? layerForTab(chart, "ece") ?? "ece";

  // The last day with readings; today before the farm's first reading.
  const waiting = data.source === "account" && lastDataIndex(bundle) < 0;
  const latest = waiting ? last : Math.max(0, lastDataIndex(bundle));
  const farmDevice = waiting ? data.account?.devices.find((d) => d.farm_id === farm.id) : undefined;
  const [dateIndex, setDateIndex] = useState(latest);
  const [compare, setCompare] = useState(false);
  const [thenIndex, setThenIndex] = useState(Math.max(0, latest - 30));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);
  // Live mode always shows today.
  const shownIndex = shell.live && !compare ? last : dateIndex;

  // Shareable URL: ?tab=…, ?view=…, ?chart=… and ?layer=… (defaults are left out).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (tab === "today") params.delete("tab");
    else params.set("tab", tab);
    if (tab === "probes" && view === "readings") params.set("view", "readings");
    else params.delete("view");
    if (chartChoice) params.set("chart", chartChoice);
    else params.delete("chart");
    if (layerChoice) params.set("layer", layerChoice);
    else params.delete("layer");
    const query = params.toString();
    replaceUrl(query ? `?${query}` : window.location.pathname);
  }, [tab, view, chartChoice, layerChoice]);

  const nutrient = nutrientSummary(bundle.days[latest] ?? null)[0]?.key ?? "n";
  const changeChart = (next: ChartTab) => {
    setChartChoice(next);
    const layer = layerForTab(next, metricKey, nutrient);
    if (layer) setLayerChoice(layer);
  };
  const changeLayer = (next: MetricKey) => {
    setLayerChoice(next);
    const t = tabForLayer(next);
    if (t) setChartChoice(t);
  };
  const changeDate = (index: number) => {
    if (shell.live && index !== last) shell.setLive(false);
    setDateIndex(index);
  };
  const changeCompare = (on: boolean) => {
    setCompare(on);
    if (on && thenIndex >= dateIndex) setThenIndex(Math.max(0, dateIndex - 30));
  };
  const openTab = (next: FarmTab) => {
    setTab(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const day = bundle.days[lastDataIndex(bundle, shownIndex)] ?? null;
  const flashKey = flashes[farm.id] && shownIndex === last ? flashes[farm.id] : undefined;
  const facts = [
    CROPS[farm.main_crop].name,
    `${farm.area_ha.toLocaleString("en-US", { maximumFractionDigits: 1 })} ha`,
    farm.region,
    ...(day ? [`${GROWTH_STAGE_LABEL[day.stage].toLowerCase()}, day ${day.dap}`] : []),
    plural(bundle.sensors.length, "probe"),
  ];
  const markers = compare
    ? [
        { index: thenIndex, label: "Then" },
        { index: shownIndex, label: "Now" },
      ]
    : shownIndex < last
      ? [{ index: shownIndex, label: formatShortDay(dates[shownIndex]) }]
      : [];
  const actionCount = sortedActions(insight).length;

  return (
    <div className="px-4 pt-5 pb-10 sm:px-6 lg:px-8 lg:pt-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">{farm.name}</h1>
        {insight ? <RiskBadge level={insight.risk_level} score={Math.round(insight.risk_score)} /> : null}
        {/* Lines break only between facts, never inside "6 probes". */}
        <p className="w-full text-sm text-muted-foreground">
          {facts.map((f, i) => (
            <Fragment key={f}>
              {i > 0 ? " " : null}
              <span className="whitespace-nowrap">
                {f}
                {i < facts.length - 1 ? " ·" : null}
              </span>
            </Fragment>
          ))}
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as FarmTab)} className="mt-3 gap-5">
        <TabsList
          aria-label="Farm details"
          className="scrollbar-none sticky top-14 z-10 -mx-4 justify-start overflow-x-auto bg-background/90 px-2 backdrop-blur-md sm:-mx-6 sm:px-5 lg:-mx-8 lg:px-7"
        >
          {FARM_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="px-2 sm:px-3">
              {t.label}
              {t.key === "advice" && actionCount > 0 ? (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold tabular text-muted-foreground" aria-label={`, ${actionCount} actions`}>
                  {actionCount}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="today" className="yai-enter flex flex-col gap-4 lg:gap-6">
          {waiting ? (
            <section aria-label="Waiting for readings" className="rounded-2xl border bg-card shadow-xs">
              <GetStarted hasFarms device={farmDevice ? { name: farmDevice.name, paired: Boolean(farmDevice.paired_at) } : null} />
            </section>
          ) : (
            <KpiRow
              bundle={bundle}
              day={day}
              dates={dates}
              index={lastDataIndex(bundle, shownIndex)}
              thenDay={compare ? (bundle.days[thenIndex] ?? null) : null}
              flashKey={flashKey}
              className="md:grid-cols-4"
            />
          )}
          {/* Below xl the pair dissolves into the column (contents), so on phones "What to do" can lead. */}
          <div className="contents xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:items-stretch xl:gap-6">
            <WhatToDo
              bundle={bundle}
              limit={4}
              onAllActions={() => openTab("advice")}
              className={cn("xl:col-start-2 xl:row-start-1", !waiting && "max-md:order-first")}
            />
            <OverviewMap
              farms={[bundle]}
              bundle={bundle}
              metricKey={metricKey}
              onMetricChange={changeLayer}
              onSelect={() => {}}
              dates={dates}
              dateIndex={shownIndex}
              onDateIndex={changeDate}
              compare={compare}
              onCompareChange={changeCompare}
              thenIndex={thenIndex}
              onThenIndex={setThenIndex}
              historyOpen={historyOpen}
              onHistoryOpenChange={setHistoryOpen}
              pulse={pulse}
              single
              // Header, tabs and KPIs take ~400px: the map fills the rest of the first screen.
              heightClassName="h-[max(320px,45vh)] lg:h-[clamp(360px,calc(100dvh-400px),620px)]"
              className="xl:col-start-1 xl:row-start-1"
            />
          </div>
          {waiting ? null : (
            <SoilWeatherCard bundle={bundle} farms={data.farms} dates={dates} index={last} tab={chart} onTabChange={changeChart} markers={markers} />
          )}
          <Next12hCard forecast={bundle.next12h} />
        </TabsContent>

        <TabsContent value="advice" className="yai-enter">
          <AdvicePanel bundle={bundle} location={location} />
        </TabsContent>

        <TabsContent value="trends" className="yai-enter">
          <SoilWeatherCard bundle={bundle} farms={data.farms} dates={dates} index={last} tab={chart} onTabChange={changeChart} variant="full" markers={markers} />
        </TabsContent>

        <TabsContent value="probes" className="yai-enter space-y-4">
          <Segmented
            ariaLabel="Probe data"
            value={view}
            onChange={setView}
            options={[
              { value: "daily", label: "Daily, by probe" },
              { value: "readings", label: "Every reading" },
            ]}
          />
          {view === "daily" ? (
            <ProbesPanel bundle={bundle} dates={dates} index={dateIndex} onIndex={setDateIndex} lastIndex={last} showMore={showMore} onShowMore={setShowMore} />
          ) : (
            <ReadingsExplorer farmId={farm.id} farmName={farm.name} probeIds={bundle.sensors.map((s) => s.id)} />
          )}
        </TabsContent>

        <TabsContent value="method" className="yai-enter">
          <MethodPanel bundle={bundle} day={bundle.days[latest] ?? null} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

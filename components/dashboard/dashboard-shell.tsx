"use client";

import {
  Activity,
  ClipboardList,
  CloudRain,
  CloudSun,
  Crosshair,
  Droplets,
  LayoutDashboard,
  Layers,
  MapIcon,
  Maximize2,
  RefreshCw,
  SatelliteIcon,
  Sparkles,
  Thermometer,
  Wind,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tabs } from "radix-ui";
import { useCallback, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { updateSettingsAction } from "@/app/dashboard/actions";
import { askAgronomist } from "@/components/dashboard/ask";
import { ChatPanel, type AskFn } from "@/components/dashboard/chat-panel";
import { DashboardHeader, type HeaderUser, type LiveEvent } from "@/components/dashboard/dashboard-header";
import { DeviceStrip } from "@/components/dashboard/device-strip";
import { FarmList, type FarmListItem } from "@/components/dashboard/farm-list";
import { InfoTip } from "@/components/dashboard/info-tip";
import { InsightPanel } from "@/components/dashboard/insight-panel";
import { KpiTiles } from "@/components/dashboard/kpi-tiles";
import { LayerSwitcher, ToolbarCaption } from "@/components/dashboard/layer-switcher";
import { createMapSync, FarmMap, MapLegend, type Basemap, type MapFarm, type MapPadding } from "@/components/dashboard/map";
import { MetricChart } from "@/components/dashboard/metric-chart";
import { RiskBadge } from "@/components/dashboard/risk-badge";
import { ScrollFade } from "@/components/dashboard/scroll-fade";
import { Segmented } from "@/components/dashboard/segmented";
import { DASHBOARD_TABS, TAB_LABEL, type DashboardTab } from "@/components/dashboard/tabs";
import { Timeline } from "@/components/dashboard/timeline";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { lastDataIndex } from "@/lib/ai/analysis";
import { farmFacts, farmValueAt, hasPreviousPeriod, probeSamples, rankFarms, suggestedQuestions, type ChartOverlay } from "@/lib/dashboard";
import { formatShortDay } from "@/lib/format";
import { computeDelta, METRICS, type MetricKey } from "@/lib/metrics";
import type { DashboardData, Device, FarmBundle, FarmDay, LiveUpdate, UserSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

function TabLoading() {
  return <div className="h-72 animate-pulse rounded-2xl border bg-card/60" aria-label="Loading" />;
}

// Heavier tabs load when first opened.
const ReadingsExplorer = dynamic(() => import("@/components/dashboard/readings-explorer").then((m) => m.ReadingsExplorer), {
  ssr: false,
  loading: TabLoading,
});
const WeatherTab = dynamic(() => import("@/components/weather/weather-tab").then((m) => m.WeatherTab), { ssr: false, loading: TabLoading });
const InsightsTab = dynamic(() => import("@/components/insights/insights-tab").then((m) => m.InsightsTab), { ssr: false, loading: TabLoading });

const TAB_ICON: Record<DashboardTab, LucideIcon> = {
  overview: LayoutDashboard,
  readings: Activity,
  weather: CloudSun,
  temperature: Thermometer,
  humidity: Droplets,
  rain: CloudRain,
  wind: Wind,
  insights: Sparkles,
};

type RangeDays = 7 | 30 | 60;

// Room around the fitted farm for the controls floating over the map (the compare maps also
// carry the "Now" chip) and for the name tag above the field.
const SINGLE_PADDING: MapPadding = { top: 72, right: 48, bottom: 40, left: 48 };
const COMPARE_PADDING: MapPadding = { top: 100, right: 40, bottom: 36, left: 40 };

export type DashboardUser = HeaderUser;

function mergeLive(data: DashboardData, liveDays: Record<string, { index: number; day: FarmDay }>): DashboardData {
  const ids = Object.keys(liveDays);
  if (ids.length === 0) return data;
  return {
    ...data,
    farms: data.farms.map((b) => {
      const live = liveDays[b.farm.id];
      if (!live) return b;
      const days = b.days.slice();
      days[live.index] = live.day;
      return { ...b, days };
    }),
  };
}

/** "Then · 25 Aug" / "Now · 24 Sep" label on a compare-mode map. */
function MapChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none inline-flex h-7 items-center rounded-full bg-forest-900/90 px-3 text-[12px] font-semibold whitespace-nowrap text-primary-foreground shadow-md",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function DashboardShell({
  data: serverData,
  user,
  settings,
  initialFarmId,
  initialMetric,
  initialTab,
}: {
  data: DashboardData;
  user: DashboardUser;
  settings: UserSettings;
  initialFarmId?: string;
  initialMetric?: MetricKey;
  initialTab?: DashboardTab;
}) {
  const router = useRouter();

  // Live readings re-derive today's values per farm; merge them over the server data.
  const [liveDays, setLiveDays] = useState<Record<string, { index: number; day: FarmDay }>>({});
  const [prevServerData, setPrevServerData] = useState(serverData);
  if (prevServerData !== serverData) {
    setPrevServerData(serverData);
    setLiveDays({});
  }
  const data = useMemo(() => mergeLive(serverData, liveDays), [serverData, liveDays]);
  const { dates } = data;
  const last = dates.length - 1;
  const ranked = useMemo(() => rankFarms(data.farms), [data.farms]);

  // The latest day any farm has data for; today when nothing has reported yet.
  const latestWithData = useMemo(() => {
    const latest = Math.max(-1, ...serverData.farms.map((b) => lastDataIndex(b)));
    return latest >= 0 ? latest : serverData.dates.length - 1;
  }, [serverData.farms, serverData.dates.length]);

  const [farmId, setFarmId] = useState(() =>
    initialFarmId && serverData.farms.some((b) => b.farm.id === initialFarmId)
      ? initialFarmId
      : (rankFarms(serverData.farms)[0]?.farm.id ?? ""),
  );
  const [metricKey, setMetricKey] = useState<MetricKey>(initialMetric ?? "ece");
  const [dateIndex, setDateIndex] = useState(latestWithData);
  const [compare, setCompare] = useState(false);
  const [thenIndex, setThenIndex] = useState(Math.max(0, latestWithData - 30));
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  // Accounts watch their own ESP32s: live updates start on. The demo feed is opt-in.
  const [live, setLive] = useState(!user.demo);
  const [tab, setTab] = useState<DashboardTab>(initialTab ?? "overview");
  const [intervalS, setIntervalS] = useState(settings.reading_interval_s);
  const [savingInterval, startSavingInterval] = useTransition();
  const [devices, setDevices] = useState<Device[]>(serverData.devices);
  const [prevDevices, setPrevDevices] = useState(serverData.devices);
  if (prevDevices !== serverData.devices) {
    setPrevDevices(serverData.devices);
    setDevices(serverData.devices);
  }
  const [readingsTick, setReadingsTick] = useState(0);
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [overlayChoice, setOverlayChoice] = useState("none");
  const [fitAllSignal, setFitAllSignal] = useState(0);
  const [focusSignal, setFocusSignal] = useState(0);
  const [fieldView, setFieldView] = useState(true);
  const [farmsOpen, setFarmsOpen] = useState(false);
  const [chatActive, setChatActive] = useState(false);
  const [pulse, setPulse] = useState<{ farmId: string; at: number } | null>(null);
  const [flashes, setFlashes] = useState<Record<string, number>>({});
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null);
  const [sync] = useState(createMapSync);

  const metric = METRICS[metricKey];
  const bundle: FarmBundle | undefined = data.farms.find((b) => b.farm.id === farmId) ?? ranked[0];
  const mapIndex = useDeferredValue(dateIndex);
  const mapThenIndex = useDeferredValue(thenIndex);

  // Keep the URL shareable: ?farm=…&layer=…&tab=…
  useEffect(() => {
    if (!farmId) return;
    const params = new URLSearchParams(window.location.search);
    params.set("farm", farmId);
    params.set("layer", metricKey);
    if (tab === "overview") params.delete("tab");
    else params.set("tab", tab);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [farmId, metricKey, tab]);

  // ---- Live mode ---------------------------------------------------------
  const onLiveUpdate = useCallback(
    (update: LiveUpdate) => {
      if (!user.demo) setDevices(update.devices);
      if (update.readings.length > 0) setReadingsTick((n) => n + 1);
      const index = serverData.dates.indexOf(update.date);
      if (index < 0) {
        router.refresh(); // the day rolled over — fetch the new 60-day window
        return;
      }
      const entries = Object.entries(update.farms);
      if (entries.length === 0) return;
      setLiveDays((prev) => {
        const next = { ...prev };
        for (const [id, day] of entries) next[id] = { index, day };
        return next;
      });
      const at = Date.now();
      setFlashes((prev) => {
        const next = { ...prev };
        for (const [id] of entries) next[id] = at;
        return next;
      });
      const [firstId] = entries[0];
      setPulse({ farmId: firstId, at });
      const readings = update.readings.filter((r) => r.farm_id === firstId);
      setLastEvent({
        farmName: serverData.farms.find((b) => b.farm.id === firstId)?.farm.name ?? firstId,
        probes: new Set(readings.map((r) => r.sensor_id)).size,
        at: update.serverTime,
        simulated: readings.some((r) => r.simulated),
      });
    },
    [serverData, router, user.demo],
  );
  const liveStatus = useLiveUpdates(live, intervalS, onLiveUpdate);

  const changeInterval = (seconds: number) => {
    const previous = intervalS;
    setIntervalS(seconds);
    // The demo account is shared: its interval only changes this page's refresh rate.
    if (user.demo) return;
    startSavingInterval(async () => {
      const result = await updateSettingsAction({ reading_interval_s: seconds });
      if (!result.ok) setIntervalS(previous);
    });
  };

  const toggleLive = (on: boolean) => {
    setLive(on);
    if (on) setDateIndex(last);
  };

  // ---- Selection helpers -------------------------------------------------
  const ensureVisible = (index: number) => {
    const needed = last - index + 1;
    if (needed > rangeDays) setRangeDays(needed <= 30 ? 30 : 60);
  };
  const changeDate = (index: number) => {
    setDateIndex(index);
    ensureVisible(index);
  };
  const changeThen = (index: number) => {
    setThenIndex(index);
    ensureVisible(index);
  };
  const toggleCompare = (on: boolean) => {
    setCompare(on);
    // The map pane changes size: re-centre on what the user was looking at.
    if (fieldView) setFocusSignal((n) => n + 1);
    else setFitAllSignal((n) => n + 1);
    if (on && thenIndex >= dateIndex) {
      const then = Math.max(0, dateIndex - 30);
      setThenIndex(then);
      ensureVisible(then);
    } else if (on) {
      ensureVisible(thenIndex);
    }
  };
  const selectFarm = (id: string) => {
    setFarmId(id);
    setFarmsOpen(false);
  };

  // ---- Derived view data -------------------------------------------------
  const mapFarms: MapFarm[] = useMemo(
    () =>
      ranked.map((b) => {
        const value = farmValueAt(b, metric, mapIndex);
        return {
          id: b.farm.id,
          name: b.farm.name,
          polygon: b.farm.polygon,
          value,
          samples: probeSamples(b, metric, mapIndex),
          delta: compare ? computeDelta(metric, farmValueAt(b, metric, mapThenIndex), value) : null,
        };
      }),
    [ranked, metric, mapIndex, mapThenIndex, compare],
  );
  const thenFarms: MapFarm[] = useMemo(
    () =>
      compare
        ? ranked.map((b) => ({
            id: b.farm.id,
            name: b.farm.name,
            polygon: b.farm.polygon,
            value: farmValueAt(b, metric, mapThenIndex),
            samples: probeSamples(b, metric, mapThenIndex),
          }))
        : [],
    [ranked, metric, mapThenIndex, compare],
  );

  const listItems: FarmListItem[] = ranked.map((b) => {
    const value = farmValueAt(b, metric, dateIndex);
    return {
      bundle: b,
      value,
      delta: compare ? computeDelta(metric, farmValueAt(b, metric, thenIndex), value) : null,
      flashAt: flashes[b.farm.id],
    };
  });

  const previousAvailable = hasPreviousPeriod(last - rangeDays + 1, last);
  const overlayBundle = overlayChoice !== "none" && overlayChoice !== "previous" ? data.farms.find((b) => b.farm.id === overlayChoice) : undefined;
  const overlay: ChartOverlay = useMemo(() => {
    if (overlayChoice === "previous" && previousAvailable) return { kind: "previous" };
    if (overlayBundle && overlayBundle.farm.id !== farmId) return { kind: "farm", bundle: overlayBundle };
    return { kind: "none" };
  }, [overlayChoice, previousAvailable, overlayBundle, farmId]);
  const overlayLabel =
    overlay.kind === "previous" ? `Previous ${rangeDays} days` : overlay.kind === "farm" ? overlay.bundle.farm.name : null;

  const ask: AskFn = useCallback(
    (question, history) => askAgronomist(farmId, dates[dateIndex], question, history),
    [farmId, dates, dateIndex],
  );

  if (!bundle) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold">{data.sourceNote ? "Your farms couldn't be loaded" : "No farms yet"}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {data.sourceNote ?? "Add your farm and connect its ESP32 to see it here."}
        </p>
        <div className="flex gap-2">
          {data.sourceNote ? (
            <Button variant="outline" onClick={() => router.refresh()}>
              <RefreshCw /> Try again
            </Button>
          ) : null}
          <Button asChild>
            <Link href="/dashboard/setup">Farms &amp; devices</Link>
          </Button>
        </div>
      </div>
    );
  }

  const { farm, insight } = bundle;
  const day = bundle.days[dateIndex] ?? null;
  const thenDay = compare ? (bundle.days[thenIndex] ?? null) : null;
  const selectedMapValue = farmValueAt(bundle, metric, mapIndex);
  const chips = suggestedQuestions(bundle.days[lastDataIndex(bundle, dateIndex)] ?? null);
  const flashKey = flashes[farm.id] && dateIndex === last ? flashes[farm.id] : undefined;

  const farmList = (
    <FarmList
      items={listItems}
      metric={metric}
      selectedId={farm.id}
      onSelect={selectFarm}
      compare={compare}
      dayLabel={dateIndex === last ? "today" : formatShortDay(dates[dateIndex])}
    />
  );

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <DashboardHeader
        user={user}
        source={data.source}
        sourceError={Boolean(data.sourceNote)}
        weatherOffline={data.weather.source === "unavailable" && data.farms.length > 0}
        live={live}
        onLiveChange={toggleLive}
        liveStatus={liveStatus}
        lastEvent={lastEvent}
        interval={{ value: intervalS, onChange: changeInterval, pending: savingInterval }}
        onOpenFarms={() => setFarmsOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="scrollbar-thin relative hidden w-[264px] shrink-0 overflow-y-auto border-r bg-sidebar/70 p-3 xl:block 2xl:w-[308px]">
          {farmList}
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <main className="scrollbar-thin relative min-w-0 flex-1 space-y-3 p-3 sm:p-4 lg:overflow-y-auto" id="main">
            {/* Farm heading */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="font-display text-[26px] leading-tight font-semibold tracking-tight">{farm.name}</h1>
              {insight ? <RiskBadge level={insight.risk_level} score={Math.round(insight.risk_score)} /> : null}
              <div className="ml-auto flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/dashboard/farm/${encodeURIComponent(farm.id)}?layer=${metricKey}`}>
                    <ClipboardList /> Details
                  </Link>
                </Button>
                <Button variant="outline" size="sm" className="xl:hidden" onClick={() => setFarmsOpen(true)}>
                  <Layers /> Farms
                </Button>
              </div>
              <p className="w-full text-[13px] text-muted-foreground">{farmFacts(bundle, day)}</p>
            </div>

            <Tabs.Root value={tab} onValueChange={(v) => setTab(v as DashboardTab)} className="space-y-3">
              <Tabs.List
                aria-label="Dashboard views"
                className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto border-b px-1 pb-px"
              >
                {DASHBOARD_TABS.map((t) => {
                  const Icon = TAB_ICON[t];
                  return (
                    <Tabs.Trigger
                      key={t}
                      value={t}
                      className="-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2 text-[13.5px] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=active]:border-primary data-[state=active]:text-foreground [&_svg]:hidden [&_svg]:size-4 2xl:[&_svg]:block"
                    >
                      <Icon aria-hidden="true" />
                      {TAB_LABEL[t]}
                    </Tabs.Trigger>
                  );
                })}
              </Tabs.List>

              <Tabs.Content value="overview" className="space-y-3 outline-none">
                {!user.demo ? (
                  <DeviceStrip devices={devices.filter((d) => d.farm_id === farm.id)} intervalS={intervalS} farmId={farm.id} />
                ) : null}

                {/* Map */}
                <section aria-label="Farm map" className="overflow-hidden rounded-2xl border bg-card shadow-xs">
                  <div className="@container border-b px-3 py-2">
                    <LayerSwitcher value={metricKey} onChange={setMetricKey}>
                      <ToolbarCaption>Map</ToolbarCaption>
                      <Segmented
                        ariaLabel="Base map"
                        value={basemap}
                        onChange={setBasemap}
                        options={[
                          {
                            value: "satellite",
                            label: <span className="hidden sm:inline">Satellite</span>,
                            icon: <SatelliteIcon />,
                            ariaLabel: "Satellite",
                            title: "Satellite imagery",
                          },
                          {
                            value: "streets",
                            label: <span className="hidden sm:inline">Streets</span>,
                            icon: <MapIcon />,
                            ariaLabel: "Streets",
                            title: "Street map",
                          },
                        ]}
                      />
                    </LayerSwitcher>
                  </div>
                  <div
                    className={cn(
                      // isolate: keeps Leaflet's z-indexes (400–1000) below sheets, menus and tooltips.
                      "relative isolate grid min-h-[340px]",
                      compare
                        ? "h-[min(84vh,720px)] grid-rows-2 sm:h-[clamp(340px,calc(100dvh_-_340px),560px)] sm:grid-cols-2 sm:grid-rows-1"
                        : "h-[clamp(340px,calc(100dvh_-_340px),560px)] grid-cols-1",
                    )}
                  >
                    {compare ? (
                      <div className="relative min-h-0 border-b sm:border-r sm:border-b-0">
                        <FarmMap
                          farms={thenFarms}
                          metric={metric}
                          selectedId={farm.id}
                          onSelect={selectFarm}
                          basemap={basemap}
                          role="follower"
                          sync={sync}
                          showSelectedName={false}
                          padding={COMPARE_PADDING}
                        />
                        <MapChip className="absolute top-3 left-3 z-[1000]">Then · {formatShortDay(dates[thenIndex])}</MapChip>
                      </div>
                    ) : null}
                    <div className="relative min-h-0">
                      <FarmMap
                        farms={mapFarms}
                        metric={metric}
                        selectedId={farm.id}
                        onSelect={selectFarm}
                        basemap={basemap}
                        pulse={pulse}
                        role="leader"
                        sync={compare ? sync : null}
                        fitAllSignal={fitAllSignal}
                        focusSignal={focusSignal}
                        onFieldViewChange={setFieldView}
                        padding={compare ? COMPARE_PADDING : SINGLE_PADDING}
                      />
                      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2">
                        {compare ? <MapChip>Now · {formatShortDay(dates[dateIndex])}</MapChip> : null}
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-card/90 shadow-md backdrop-blur-sm"
                          onClick={() => (fieldView ? setFitAllSignal((n) => n + 1) : setFocusSignal((n) => n + 1))}
                        >
                          {fieldView ? <Maximize2 /> : <Crosshair />}
                          {fieldView ? "All farms" : "Zoom to farm"}
                        </Button>
                      </div>
                      {!compare ? (
                        <MapLegend
                          metric={metric}
                          marker={{ value: selectedMapValue, label: farm.name }}
                          className="absolute bottom-6 left-3 z-[1000] hidden sm:block"
                        />
                      ) : null}
                    </div>
                  </div>
                  <MapLegend
                    metric={metric}
                    marker={{ value: selectedMapValue, label: farm.name }}
                    variant="strip"
                    className={cn("border-t", compare ? undefined : "sm:hidden")}
                  />
                  <div className="border-t px-3 py-3 sm:px-4">
                    <Timeline
                      dates={dates}
                      dateIndex={dateIndex}
                      onDateIndex={changeDate}
                      compare={compare}
                      onCompareChange={toggleCompare}
                      thenIndex={thenIndex}
                      onThenIndex={changeThen}
                    />
                  </div>
                </section>

                {/* Headline numbers */}
                <KpiTiles bundle={bundle} day={day} thenDay={thenDay} flashKey={flashKey} />

                {/* Chart */}
                <section aria-labelledby="chart-heading" className="rounded-2xl border bg-card p-3 shadow-xs sm:p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h3 id="chart-heading" className="text-[15px] font-semibold">
                      {metric.label}
                      <span className="font-normal text-muted-foreground"> · {metric.unit === "pH" ? "pH units" : metric.unit}</span>
                    </h3>
                    <InfoTip label={`About ${metric.label}`}>{metric.method}</InfoTip>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      <Select value={overlay.kind === "none" ? "none" : overlayChoice} onValueChange={setOverlayChoice}>
                        <SelectTrigger size="sm" className="min-w-40 bg-card text-[13px]" aria-label="Compare the chart with">
                          <SelectValue placeholder="Compare with…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No comparison</SelectItem>
                          <SelectItem value="previous" disabled={!previousAvailable}>
                            Previous {rangeDays} days{previousAvailable ? "" : " (no data)"}
                          </SelectItem>
                          <SelectSeparator />
                          {ranked
                            .filter((b) => b.farm.id !== farm.id)
                            .map((b) => (
                              <SelectItem key={b.farm.id} value={b.farm.id}>
                                {b.farm.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Segmented<`${RangeDays}`>
                        ariaLabel="Chart range"
                        size="sm"
                        value={`${rangeDays}`}
                        onChange={(v) => setRangeDays(Number(v) as RangeDays)}
                        options={[
                          { value: "7", label: "7 d", ariaLabel: "Last 7 days" },
                          { value: "30", label: "30 d", ariaLabel: "Last 30 days" },
                          { value: "60", label: "60 d", ariaLabel: "Last 60 days" },
                        ]}
                      />
                    </div>
                  </div>
                  <MetricChart
                    bundle={bundle}
                    metric={metric}
                    dates={dates}
                    endIndex={last}
                    rangeDays={rangeDays}
                    overlay={overlay}
                    overlayLabel={overlayLabel}
                    markers={
                      compare
                        ? [
                            { index: thenIndex, label: "Then" },
                            { index: dateIndex, label: "Now" },
                          ]
                        : dateIndex < last
                          ? [{ index: dateIndex, label: formatShortDay(dates[dateIndex]) }]
                          : []
                    }
                  />
                </section>
              </Tabs.Content>

              <Tabs.Content value="readings" className="outline-none">
                <ReadingsExplorer key={farm.id} bundle={bundle} demo={user.demo} refreshKey={readingsTick} />
              </Tabs.Content>
              {(["weather", "temperature", "humidity", "rain", "wind"] as const).map((view) => (
                <Tabs.Content key={view} value={view} className="outline-none">
                  <WeatherTab view={view} bundles={ranked} selectedFarmId={farm.id} onSelectFarm={selectFarm} userKey={user.email} />
                </Tabs.Content>
              ))}
              <Tabs.Content value="insights" className="outline-none">
                <InsightsTab key={farm.id} bundle={bundle} dates={dates} />
              </Tabs.Content>
            </Tabs.Root>
          </main>

          <aside
            aria-label="AI agronomist"
            className="relative flex w-full shrink-0 flex-col gap-4 border-t bg-sidebar/50 p-3 sm:p-4 lg:w-[360px] lg:overflow-hidden lg:border-t-0 lg:border-l xl:w-[368px] 2xl:w-[440px]"
          >
            <ScrollFade
              className={cn(
                "shrink-0 transition-[max-height] duration-300 ease-out",
                chatActive ? "lg:max-h-[32%]" : "lg:max-h-[62%]",
              )}
              viewportClassName="-mr-2 pr-2"
            >
              <InsightPanel insight={insight} farmName={farm.name} />
            </ScrollFade>
            <ChatPanel
              conversationKey={farm.id}
              subject={farm.name}
              chips={chips}
              ask={ask}
              onActiveChange={setChatActive}
              className="min-h-[340px] lg:min-h-[240px] lg:flex-1"
            />
          </aside>
        </div>
      </div>

      <Sheet open={farmsOpen} onOpenChange={setFarmsOpen}>
        <SheetContent
          side="left"
          className="w-[88vw] max-w-sm gap-0 bg-sidebar p-0"
          onOpenAutoFocus={(e) => {
            // Focus the selected farm, not the first focusable element (an info icon that would pop its tooltip).
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[aria-current=true]")?.focus();
          }}
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle>Farms</SheetTitle>
            <SheetDescription>Ranked by AI risk score.</SheetDescription>
          </SheetHeader>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">{farmList}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

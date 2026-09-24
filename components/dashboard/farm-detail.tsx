"use client";

import { ArrowLeft, Crosshair, MapIcon, SatelliteIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { askAgronomist } from "@/components/dashboard/ask";
import { ChatPanel, type AskFn } from "@/components/dashboard/chat-panel";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import type { DashboardUser } from "@/components/dashboard/dashboard-shell";
import { FarmProfile } from "@/components/dashboard/farm-profile";
import { InfoTip } from "@/components/dashboard/info-tip";
import { InsightPanel } from "@/components/dashboard/insight-panel";
import { KpiTiles } from "@/components/dashboard/kpi-tiles";
import { LayerSwitcher, ToolbarCaption } from "@/components/dashboard/layer-switcher";
import { FarmMap, MapLegend, type Basemap, type MapFarm, type MapPadding } from "@/components/dashboard/map";
import { ChartKey, MetricChart } from "@/components/dashboard/metric-chart";
import { ProbeTable } from "@/components/dashboard/probe-table";
import { RiskBadge } from "@/components/dashboard/risk-badge";
import { ScrollFade } from "@/components/dashboard/scroll-fade";
import { Segmented } from "@/components/dashboard/segmented";
import { Timeline } from "@/components/dashboard/timeline";
import { Button } from "@/components/ui/button";
import { lastDataIndex } from "@/lib/ai/analysis";
import { farmFacts, farmValueAt, probeSamples, suggestedQuestions } from "@/lib/dashboard";
import { formatDay, formatShortDay } from "@/lib/format";
import { classFor, colorFor, formatValue, METRICS, type MetricKey } from "@/lib/metrics";
import type { DashboardData, FarmBundle } from "@/lib/types";
import { cn } from "@/lib/utils";

type TrendRange = 30 | 60;

// Salinity leads and spans two columns, so the eleven charts fill both the 2- and the 3-column grid.
const TREND_METRICS: MetricKey[] = ["ece", "moisture", "ph", "temperature", "n", "p", "k", "et0", "etc", "deficit", "yieldLoss"];

// Room for the re-centre button above the field; there is no name tag (the page title names the farm).
const MAP_PADDING: MapPadding = { top: 56, right: 40, bottom: 40, left: 40 };

function TrendCard({
  bundle,
  metricKey,
  dates,
  dateIndex,
  rangeDays,
  className,
}: {
  bundle: FarmBundle;
  metricKey: MetricKey;
  dates: string[];
  dateIndex: number;
  rangeDays: TrendRange;
  className?: string;
}) {
  const metric = METRICS[metricKey];
  const last = dates.length - 1;
  const value = farmValueAt(bundle, metric, dateIndex);
  const cls = classFor(metric, value);
  return (
    <div className={cn("min-w-0 rounded-xl border p-3", className)}>
      <div className="mb-1.5 flex items-start gap-1.5">
        <h3 className="text-[13.5px] leading-snug font-semibold">
          {metric.label}
          <span className="font-normal text-muted-foreground"> · {metric.unit === "pH" ? "pH units" : metric.unit}</span>
        </h3>
        <InfoTip label={`About ${metric.label}`}>{metric.method}</InfoTip>
        <span className="ml-auto flex flex-col items-end text-right">
          <span className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold whitespace-nowrap tabular">
            <span className="size-2 rounded-full ring-1 ring-black/15" style={{ background: colorFor(metric, value) }} aria-hidden="true" />
            {formatValue(metric, value)}
          </span>
          {cls ? <span className="text-[11.5px] whitespace-nowrap text-muted-foreground">{cls.label}</span> : null}
        </span>
      </div>
      <MetricChart
        bundle={bundle}
        metric={metric}
        dates={dates}
        endIndex={last}
        rangeDays={rangeDays}
        height={156}
        showLegend="specific"
        markers={dateIndex < last ? [{ index: dateIndex, label: formatShortDay(dates[dateIndex]) }] : []}
      />
    </div>
  );
}

/** Everything about one farm on one page: field map, trends for every layer, probes, agronomy inputs and the assistant. */
export function FarmDetail({
  data,
  bundle,
  user,
  initialMetric,
}: {
  data: DashboardData;
  bundle: FarmBundle;
  user: DashboardUser;
  initialMetric?: MetricKey;
}) {
  const { dates } = data;
  const last = dates.length - 1;
  const { farm, insight } = bundle;

  const [metricKey, setMetricKey] = useState<MetricKey>(initialMetric ?? "ece");
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [dateIndex, setDateIndex] = useState(() => Math.max(0, lastDataIndex(bundle)));
  const [trendRange, setTrendRange] = useState<TrendRange>(30);
  const [focusSignal, setFocusSignal] = useState(0);
  const [chatActive, setChatActive] = useState(false);
  const mapIndex = useDeferredValue(dateIndex);

  const metric = METRICS[metricKey];
  const mapFarms: MapFarm[] = useMemo(
    () => [
      {
        id: farm.id,
        name: farm.name,
        polygon: farm.polygon,
        value: farmValueAt(bundle, metric, mapIndex),
        samples: probeSamples(bundle, metric, mapIndex),
      },
    ],
    [bundle, farm, metric, mapIndex],
  );

  const ask: AskFn = useCallback(
    (question, history) => askAgronomist(farm.id, dates[dateIndex], question, history),
    [farm.id, dates, dateIndex],
  );

  const changeDate = (index: number) => {
    setDateIndex(index);
    if (last - index + 1 > trendRange) setTrendRange(60);
  };

  const day = bundle.days[dateIndex] ?? null;
  const chips = suggestedQuestions(bundle.days[lastDataIndex(bundle, dateIndex)] ?? null);
  const selectedMapValue = farmValueAt(bundle, metric, mapIndex);

  return (
    <div className="min-h-dvh">
      <DashboardHeader
        className="sticky top-0"
        user={user}
        source={data.source}
        sourceFallback={Boolean(data.sourceNote)}
        weatherOffline={data.weather.source === "unavailable"}
        title="Farm details"
      />

      <div className="mx-auto grid max-w-[1720px] gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <main id="main" className="min-w-0 space-y-4">
          <div>
            <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
              <Link href={`/dashboard?farm=${encodeURIComponent(farm.id)}&layer=${metricKey}`}>
                <ArrowLeft /> All farms
              </Link>
            </Button>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="font-display text-[28px] leading-tight font-semibold tracking-tight">{farm.name}</h1>
              {insight ? <RiskBadge level={insight.risk_level} score={Math.round(insight.risk_score)} /> : null}
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">{farmFacts(bundle, day)}</p>
          </div>

          {/* Field map */}
          <section aria-label="Field map" className="overflow-hidden rounded-2xl border bg-card shadow-xs">
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
            {/* isolate: keeps Leaflet's z-indexes (400–1000) below menus and tooltips. */}
            <div className="relative isolate h-[clamp(320px,calc(100dvh_-_360px),520px)]">
              <FarmMap
                farms={mapFarms}
                metric={metric}
                selectedId={farm.id}
                basemap={basemap}
                showSelectedName={false}
                focusSignal={focusSignal}
                padding={MAP_PADDING}
              />
              <Button
                variant="outline"
                size="sm"
                className="absolute top-3 left-3 z-[1000] bg-card/90 shadow-md backdrop-blur-sm"
                onClick={() => setFocusSignal((n) => n + 1)}
              >
                <Crosshair /> Re-centre
              </Button>
              <MapLegend
                metric={metric}
                marker={{ value: selectedMapValue, label: farm.name }}
                className="absolute bottom-6 left-3 z-[1000] hidden sm:block"
              />
            </div>
            <MapLegend
              metric={metric}
              marker={{ value: selectedMapValue, label: farm.name }}
              variant="strip"
              className="border-t sm:hidden"
            />
            <div className="border-t px-3 py-3 sm:px-4">
              <Timeline dates={dates} dateIndex={dateIndex} onDateIndex={changeDate} />
            </div>
          </section>

          <KpiTiles bundle={bundle} day={day} />

          {/* Every layer over time */}
          <section aria-labelledby="trends-heading" className="rounded-2xl border bg-card p-3 shadow-xs sm:p-4">
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <h2 id="trends-heading" className="text-[16px] font-semibold">
                Trends
              </h2>
              <ChartKey />
              <Segmented<`${TrendRange}`>
                ariaLabel="Trend range"
                size="sm"
                className="ml-auto"
                value={`${trendRange}`}
                onChange={(v) => setTrendRange(Number(v) as TrendRange)}
                options={[
                  { value: "30", label: "30 d", ariaLabel: "Last 30 days" },
                  { value: "60", label: "60 d", ariaLabel: "Last 60 days" },
                ]}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {TREND_METRICS.map((key) => (
                <TrendCard
                  key={key}
                  bundle={bundle}
                  metricKey={key}
                  dates={dates}
                  dateIndex={dateIndex}
                  rangeDays={trendRange}
                  className={key === "ece" ? "md:col-span-2" : undefined}
                />
              ))}
            </div>
          </section>

          {/* Probes */}
          <section aria-labelledby="probes-heading" className="overflow-hidden rounded-2xl border bg-card shadow-xs">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b px-3 py-3 sm:px-4">
              <h2 id="probes-heading" className="text-[16px] font-semibold">
                Probes
              </h2>
              <p className="text-[13px] text-muted-foreground">
                Daily means on {formatDay(dates[dateIndex])} · ECe estimated from bulk EC with the farm&apos;s calibration
              </p>
            </div>
            <ProbeTable bundle={bundle} index={dateIndex} className="px-1 pb-1 sm:px-2" />
          </section>

          {/* Coefficients */}
          <section aria-labelledby="profile-heading" className="rounded-2xl border bg-card shadow-xs">
            <div className="border-b px-3 py-3 sm:px-4">
              <h2 id="profile-heading" className="text-[16px] font-semibold">
                Agronomy inputs
              </h2>
              <p className="text-[13px] text-muted-foreground">The coefficients behind every number on this page, and where each comes from.</p>
            </div>
            <FarmProfile bundle={bundle} day={day} className="px-3 sm:px-4" />
          </section>
        </main>

        <aside
          aria-label="AI agronomist"
          className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(3.5rem_+_1rem)] lg:h-[calc(100dvh_-_3.5rem_-_2rem)] lg:self-start"
        >
          <ScrollFade
            className={cn("shrink-0 transition-[max-height] duration-300 ease-out", chatActive ? "lg:max-h-[32%]" : "lg:max-h-[58%]")}
            viewportClassName="-mr-2 pr-2"
            fadeClassName="from-background"
          >
            <InsightPanel insight={insight} farmName={farm.name} />
          </ScrollFade>
          <ChatPanel
            conversationKey={`detail-${farm.id}`}
            subject={farm.name}
            chips={chips}
            ask={ask}
            onActiveChange={setChatActive}
            className="min-h-[420px] lg:min-h-[240px] lg:flex-1"
          />
        </aside>
      </div>
    </div>
  );
}

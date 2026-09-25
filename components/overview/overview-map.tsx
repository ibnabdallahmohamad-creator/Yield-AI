"use client";

/**
 * The Overview map (ui_improvement §7.1): one layer dropdown, a ⧉ Layers popover for the base map
 * and live updates, icon-only extent buttons, a static legend chip, and History (the timeline and
 * Then-vs-Now compare) in a sheet over the map instead of always on screen.
 */
import {
  Crosshair,
  Droplet,
  FlaskConical,
  Gauge,
  History,
  Layers,
  Leaf,
  MapIcon,
  Maximize2,
  SatelliteIcon,
  Sprout,
  SunMedium,
  Thermometer,
  TrendingDown,
  Undo2,
  Waves,
  X,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { createMapSync, FarmMap, MapLegend, type Basemap, type MapFarm, type MapPadding } from "@/components/dashboard/map";
import { Segmented } from "@/components/dashboard/segmented";
import { Timeline } from "@/components/dashboard/timeline";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { farmValueAt, probeSamples } from "@/lib/dashboard";
import { formatShortDay } from "@/lib/format";
import { computeDelta, METRICS, type MetricKey } from "@/lib/metrics";
import type { FarmBundle } from "@/lib/types";
import { cn } from "@/lib/utils";

const SINGLE_PADDING: MapPadding = { top: 72, right: 64, bottom: 72, left: 48 };
const COMPARE_PADDING: MapPadding = { top: 96, right: 48, bottom: 48, left: 40 };

const LAYER_GROUPS: { label: string; items: { value: MetricKey; label: string; icon: React.ReactNode }[] }[] = [
  {
    label: "Main",
    items: [
      { value: "ece", label: "Salinity", icon: <Waves /> },
      { value: "moisture", label: "Soil moisture", icon: <Droplet /> },
      { value: "yieldLoss", label: "Yield at risk", icon: <TrendingDown /> },
      { value: "deficit", label: "Water deficit", icon: <Gauge /> },
    ],
  },
  {
    label: "More",
    items: [
      { value: "ph", label: "Soil pH", icon: <FlaskConical /> },
      { value: "temperature", label: "Soil temperature", icon: <Thermometer /> },
      { value: "n", label: "Nitrogen (N)", icon: <Sprout /> },
      { value: "p", label: "Phosphorus (P)", icon: <Sprout /> },
      { value: "k", label: "Potassium (K)", icon: <Sprout /> },
      { value: "et0", label: "Reference ET₀", icon: <SunMedium /> },
      { value: "etc", label: "Crop water use ETc", icon: <Leaf /> },
    ],
  },
];

const LIVE_TEXT = {
  off: "Off",
  connecting: "Connecting…",
  live: "On · every 5 s",
  retrying: "Reconnecting…",
  "signed-out": "Signed out",
} as const;

/** "Then · 25 Aug" / "Now · 24 Sep" on the compare maps. */
function MapChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("pointer-events-none inline-flex h-7 items-center rounded-full bg-forest-900/90 px-3 text-xs font-semibold whitespace-nowrap text-primary-foreground shadow-md", className)}>
      {children}
    </span>
  );
}

/** A floating map button: 36 px with a mouse, 44 px on touch screens. */
const MAP_BUTTON = "size-11 sm:size-9 sm:pointer-coarse:size-11 rounded-xl bg-card/95 shadow-md backdrop-blur-sm hover:bg-card";

function IconTip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export interface OverviewMapProps {
  farms: FarmBundle[];
  /** The selected farm, or null for the portfolio view (every farm, none picked yet). */
  bundle: FarmBundle | null;
  metricKey: MetricKey;
  onMetricChange: (key: MetricKey) => void;
  onSelect: (id: string) => void;
  dates: string[];
  dateIndex: number;
  onDateIndex: (index: number) => void;
  compare: boolean;
  onCompareChange: (on: boolean) => void;
  thenIndex: number;
  onThenIndex: (index: number) => void;
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  pulse: { farmId: string; at: number } | null;
  /** One farm only (Farm details): the extent button re-centres the field, no name tag. */
  single?: boolean;
  /** Shown over the map's top-left corner, under the layer menu (e.g. the picked farm's card). */
  overlay?: React.ReactNode;
  /** Map height classes (default: a tall map that follows the window). */
  heightClassName?: string;
  className?: string;
}

export function OverviewMap({
  farms,
  bundle,
  metricKey,
  onMetricChange,
  onSelect,
  dates,
  dateIndex,
  onDateIndex,
  compare,
  onCompareChange,
  thenIndex,
  onThenIndex,
  historyOpen,
  onHistoryOpenChange,
  pulse,
  single = false,
  overlay,
  heightClassName = "h-[max(320px,45vh)] lg:h-[clamp(360px,calc(100dvh-340px),620px)]",
  className,
}: OverviewMapProps) {
  const { live, setLive, liveStatus } = useShell();
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [fitAllSignal, setFitAllSignal] = useState(0);
  const [focusSignal, setFocusSignal] = useState(0);
  const [fieldView, setFieldView] = useState(true);
  const [sync] = useState(createMapSync);
  const liveId = useId();
  const phone = useMediaQuery(PHONE_QUERY);
  const metric = METRICS[metricKey];
  const last = dates.length - 1;
  const farm = bundle?.farm ?? null;
  // Deselecting (portfolio view) zooms back out to every farm.
  const [prevFarmId, setPrevFarmId] = useState(farm?.id ?? null);
  if ((farm?.id ?? null) !== prevFarmId) {
    setPrevFarmId(farm?.id ?? null);
    if (!farm) setFitAllSignal((n) => n + 1);
  }

  const mapFarms: MapFarm[] = useMemo(
    () =>
      farms.map((b) => {
        const value = farmValueAt(b, metric, dateIndex);
        return {
          id: b.farm.id,
          name: b.farm.name,
          polygon: b.farm.polygon,
          value,
          samples: probeSamples(b, metric, dateIndex),
          delta: compare ? computeDelta(metric, farmValueAt(b, metric, thenIndex), value) : null,
        };
      }),
    [farms, metric, dateIndex, thenIndex, compare],
  );
  const thenFarms: MapFarm[] = useMemo(
    () =>
      compare
        ? farms.map((b) => ({
            id: b.farm.id,
            name: b.farm.name,
            polygon: b.farm.polygon,
            value: farmValueAt(b, metric, thenIndex),
            samples: probeSamples(b, metric, thenIndex),
          }))
        : [],
    [farms, metric, thenIndex, compare],
  );

  const toggleCompare = (on: boolean) => {
    onCompareChange(on);
    // The map pane changes size: re-centre on what the user was looking at.
    if (fieldView) setFocusSignal((n) => n + 1);
    else setFitAllSignal((n) => n + 1);
  };

  const viewingPast = dateIndex < last && !compare;
  const selectedValue = bundle ? farmValueAt(bundle, metric, dateIndex) : null;
  const legendMarker = farm ? { value: selectedValue, label: farm.name } : null;

  const historyButton = (
    <Button
      variant="outline"
      className={cn(
        "h-11 rounded-xl sm:h-9 sm:pointer-coarse:h-11",
        !phone && "absolute right-2.5 bottom-2.5 z-[1000] bg-card/95 shadow-md backdrop-blur-sm hover:bg-card",
      )}
      onClick={() => onHistoryOpenChange(true)}
      aria-expanded={false}
    >
      <History /> History
    </Button>
  );

  const historyPanel = (
    <div
      role="region"
      aria-label="History"
      className={cn(
        "bg-card p-4 animate-in fade-in duration-200",
        phone
          ? "border-t"
          : "absolute inset-x-2.5 bottom-2.5 z-[1000] rounded-2xl bg-card/97 shadow-lg ring-1 ring-black/5 backdrop-blur-sm slide-in-from-bottom-2",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-semibold">History</p>
        <p className="hidden text-xs text-muted-foreground sm:block">Scrub back up to {last} days, or compare two days side by side.</p>
        <Button
          variant="ghost"
          size="icon"
          className="-my-1 ml-auto size-11 sm:size-9 sm:pointer-coarse:size-11"
          aria-label="Close history"
          onClick={() => {
            onHistoryOpenChange(false);
            if (compare) toggleCompare(false);
          }}
        >
          <X />
        </Button>
      </div>
      <Timeline
        dates={dates}
        dateIndex={dateIndex}
        onDateIndex={onDateIndex}
        compare={compare}
        onCompareChange={toggleCompare}
        thenIndex={thenIndex}
        onThenIndex={onThenIndex}
      />
    </div>
  );

  return (
    <section aria-label="Farm map" className={cn("relative overflow-hidden rounded-2xl border bg-card shadow-xs", className)}>
      <div
        className={cn(
          // isolate: keeps Leaflet's z-indexes (400–1000) below sheets, menus and tooltips.
          "relative isolate grid",
          compare
            ? "h-[min(84vh,720px)] grid-rows-2 sm:h-[clamp(360px,calc(100dvh-340px),620px)] sm:grid-cols-2 sm:grid-rows-1"
            : cn("grid-cols-1", heightClassName),
        )}
      >
        {compare ? (
          <div className="relative min-h-0 border-b sm:border-r sm:border-b-0">
            <FarmMap
              farms={thenFarms}
              metric={metric}
              selectedId={farm?.id ?? null}
              onSelect={onSelect}
              basemap={basemap}
              role="follower"
              sync={sync}
              showSelectedName={false}
              padding={COMPARE_PADDING}
              scrollWheelZoom={false}
              touchDrag={false}
              gestureZoom
              attributionPosition="bottomleft"
            />
            <MapChip className="absolute top-16 left-3 z-[1000]">Then · {formatShortDay(dates[thenIndex])}</MapChip>
          </div>
        ) : null}
        <div className="relative min-h-0">
          <FarmMap
            farms={mapFarms}
            metric={metric}
            selectedId={farm?.id ?? null}
            onSelect={onSelect}
            basemap={basemap}
            pulse={pulse}
            role="leader"
            sync={compare ? sync : null}
            fitAllSignal={fitAllSignal}
            focusSignal={focusSignal}
            onFieldViewChange={setFieldView}
            showSelectedName={!single}
            padding={compare ? COMPARE_PADDING : SINGLE_PADDING}
            scrollWheelZoom={false}
            touchDrag={false}
            gestureZoom
            attributionPosition="bottomleft"
          />
          {compare ? <MapChip className="absolute top-16 left-3 z-[1000]">Now · {formatShortDay(dates[dateIndex])}</MapChip> : null}
        </div>

        {/* Top row: the layer, then the map options and extent next to Leaflet's zoom buttons. */}
        <div className="pointer-events-none absolute inset-x-2.5 top-2.5 z-[1000] flex items-start gap-2">
          <Select value={metricKey} onValueChange={(v) => onMetricChange(v as MetricKey)}>
            <SelectTrigger aria-label="Map layer" className="pointer-events-auto h-11 min-w-0 bg-card/95 font-medium shadow-md backdrop-blur-sm sm:h-9 sm:pointer-coarse:h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start" className="max-h-[min(560px,var(--radix-select-content-available-height))]">
              {LAYER_GROUPS.map((group, i) => (
                <SelectGroup key={group.label}>
                  {i > 0 ? <SelectSeparator /> : null}
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.items.map((item) => (
                    <SelectItem key={item.value} value={item.value} className="min-h-9">
                      {item.icon}
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <div className="pointer-events-auto mr-[54px] ml-auto flex gap-2 sm:mr-[42px] sm:pointer-coarse:mr-[54px]">
            <Popover>
              <IconTip label="Map options">
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon" className={MAP_BUTTON} aria-label="Map options: base map and live updates">
                    <Layers />
                  </Button>
                </PopoverTrigger>
              </IconTip>
              <PopoverContent align="end" className="w-64 space-y-4">
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Base map</p>
                  <Segmented
                    ariaLabel="Base map"
                    value={basemap}
                    onChange={setBasemap}
                    options={[
                      { value: "satellite", label: "Satellite", icon: <SatelliteIcon /> },
                      { value: "streets", label: "Streets", icon: <MapIcon /> },
                    ]}
                  />
                </div>
                <div className="flex items-start justify-between gap-3 border-t pt-4">
                  <label htmlFor={liveId} className="cursor-pointer">
                    <span className="block text-sm font-semibold">Live updates</span>
                    <span className="block text-xs text-muted-foreground">{LIVE_TEXT[liveStatus]}</span>
                  </label>
                  <Switch
                    id={liveId}
                    checked={live}
                    onCheckedChange={(on) => {
                      setLive(on);
                      if (on) onDateIndex(last);
                    }}
                  />
                </div>
              </PopoverContent>
            </Popover>
            {single ? (
              <IconTip label="Re-centre the field">
                <Button variant="outline" size="icon" className={MAP_BUTTON} aria-label="Re-centre the field" onClick={() => setFocusSignal((n) => n + 1)}>
                  <Crosshair />
                </Button>
              </IconTip>
            ) : (
              <IconTip label={fieldView || !farm ? "Show all farms" : `Zoom to ${farm.name}`}>
                <Button
                  variant="outline"
                  size="icon"
                  className={MAP_BUTTON}
                  aria-label={fieldView || !farm ? "Show all farms" : `Zoom to ${farm.name}`}
                  onClick={() => (fieldView || !farm ? setFitAllSignal((n) => n + 1) : setFocusSignal((n) => n + 1))}
                >
                  {fieldView || !farm ? <Maximize2 /> : <Crosshair />}
                </Button>
              </IconTip>
            )}
          </div>
        </div>

        {viewingPast && !historyOpen ? (
          <div className="absolute top-16 left-2.5 z-[1000] sm:top-2.5 sm:left-1/2 sm:-translate-x-1/2">
            <div className="flex h-11 items-center gap-1 rounded-full bg-forest-900/95 pl-3 text-sm text-primary-foreground shadow-md sm:h-9 sm:pointer-coarse:h-11">
              <span className="font-medium whitespace-nowrap">Viewing {formatShortDay(dates[dateIndex])}</span>
              <button
                type="button"
                onClick={() => onDateIndex(last)}
                className="inline-flex h-full items-center gap-1 rounded-full px-3 font-semibold whitespace-nowrap hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
              >
                <Undo2 className="size-4" aria-hidden="true" />
                Back to today
              </button>
            </div>
          </div>
        ) : null}

        {!historyOpen && !compare ? (
          <MapLegend metric={metric} marker={legendMarker} variant="chip" className="absolute bottom-8 left-2.5 z-[1000] hidden sm:block" />
        ) : null}

        {overlay && !historyOpen && !compare ? <div className="absolute top-16 left-2.5 z-[1000] w-[min(20rem,calc(100%-1.25rem))]">{overlay}</div> : null}

        {!historyOpen && !phone ? historyButton : null}
        {historyOpen && !phone ? historyPanel : null}
      </div>
      {historyOpen && phone ? historyPanel : null}
      <MapLegend
        metric={metric}
        marker={legendMarker}
        variant="strip"
        info={false}
        action={phone && !historyOpen ? historyButton : null}
        className={cn("border-t", compare || phone ? undefined : "hidden")}
      />
    </section>
  );
}


"use client";

/**
 * The Overview map (ui_improvement §7.1): one layer dropdown, a ⧉ Layers popover for the base map
 * and live updates, icon-only extent buttons, a static legend chip, and History (the timeline and
 * Then-vs-Now compare) in a sheet over the map instead of always on screen.
 *
 * The menu's Weather forecast group (wind, temperature, rain, humidity, …) swaps the soil map for
 * the Windy-style weather map (components/weather): the Gulf forecast with an hourly timeline.
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
import { CROPS } from "@/lib/agronomy-tables";
import { farmValueAt, probeSamples, triggerMoisturePct } from "@/lib/dashboard";
import { formatShortDay } from "@/lib/format";
import { computeDelta, METRICS, type MetricKey } from "@/lib/metrics";
import type { FarmBundle } from "@/lib/types";
import { cn } from "@/lib/utils";
import { WEATHER_LAYERS, type WeatherLayerKey } from "@/lib/weather/layers";
import { usePlayback } from "@/components/weather/use-playback";
import { useWeatherGrid } from "@/components/weather/use-weather-grid";
import { DEFAULT_WEATHER_OPTIONS, WeatherOptions, type WeatherOptionsState } from "@/components/weather/weather-options";
import { WEATHER_LAYER_ICON } from "@/components/weather/layer-icons";
import { WeatherLegend } from "@/components/weather/weather-legend";
import { WeatherStage } from "@/components/weather/weather-stage";

// Bottom clears the legend chip (bottom-left, ~95 px tall) so no farm sits under it.
const SINGLE_PADDING: MapPadding = { top: 72, right: 64, bottom: 132, left: 48 };
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

/** The weather layers in the same menu; their values carry a `wx:` prefix. */
const WX = "wx:";
const WEATHER_ITEMS: WeatherLayerKey[] = ["wind", "temp", "rain", "rh", "gust", "feels", "precipProb", "clouds", "pressure"];

const LIVE_TEXT = {
  off: "Off",
  connecting: "Connecting…",
  live: "On · every 5 s",
  retrying: "Reconnecting…",
  "signed-out": "Signed out",
} as const;

/** The line a field's isoline marks: the crop's salinity limit, or that day's irrigation trigger. */
function fieldLimit(b: FarmBundle, key: MetricKey, index: number): { value: number; label: string } | null {
  if (key === "ece") {
    const crop = CROPS[b.farm.main_crop];
    return { value: crop.salinity.threshold_dS_per_m, label: `${crop.name} limit` };
  }
  if (key === "moisture") {
    const day = b.days[index];
    const trigger = day ? triggerMoisturePct(b.farm, day) : null;
    return trigger != null ? { value: trigger, label: "Irrigate below" } : null;
  }
  return null;
}

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

/** The soil map's ⧉ options: base map and live updates. */
function SoilMapOptions({
  basemap,
  onBasemap,
  liveId,
  liveText,
  live,
  onLive,
}: {
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  liveId: string;
  liveText: string;
  live: boolean;
  onLive: (on: boolean) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Base map</p>
        <Segmented
          ariaLabel="Base map"
          value={basemap}
          onChange={onBasemap}
          options={[
            { value: "satellite", label: "Satellite", icon: <SatelliteIcon /> },
            { value: "streets", label: "Streets", icon: <MapIcon /> },
          ]}
        />
      </div>
      <div className="flex items-start justify-between gap-3 border-t pt-4">
        <label htmlFor={liveId} className="cursor-pointer">
          <span className="block text-sm font-semibold">Live updates</span>
          <span className="block text-xs text-muted-foreground">{liveText}</span>
        </label>
        <Switch id={liveId} checked={live} onCheckedChange={onLive} />
      </div>
    </>
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
  // Weather mode: the regional forecast instead of the soil map.
  const [weatherLayer, setWeatherLayer] = useState<WeatherLayerKey | null>(null);
  const [wxOptions, setWxOptions] = useState<WeatherOptionsState>(DEFAULT_WEATHER_OPTIONS);
  const [wxPin, setWxPin] = useState<{ lat: number; lng: number } | null>(null);
  const [wxFit, setWxFit] = useState(0);
  const [wxFocus, setWxFocus] = useState(0);
  const grid = useWeatherGrid(weatherLayer != null);
  const playback = usePlayback(grid.field?.nt ?? 1);
  const wxFarms = useMemo(() => farms.map((b) => ({ id: b.farm.id, name: b.farm.name, lat: b.farm.lat, lng: b.farm.lng })), [farms]);
  const wxHome = farm ? { lat: farm.lat, lng: farm.lng, name: farm.name } : { lat: 25.29, lng: 51.53, name: "Doha" };
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
          limit: fieldLimit(b, metric.key, dateIndex),
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
            limit: fieldLimit(b, metric.key, thenIndex),
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
  // The key to the red field lines (drawn in field view only): the selected farm's limit, the one
  // limit every field shares, or a general note when the fields' crops differ.
  const fieldLimits = mapFarms.flatMap((f) => (f.limit ? [f.limit] : []));
  const legendLimit = !fieldView
    ? null
    : farm
      ? (mapFarms.find((f) => f.id === farm.id)?.limit ?? null)
      : fieldLimits.length === 0
        ? null
        : fieldLimits.every((l) => l.value === fieldLimits[0].value && l.label === fieldLimits[0].label)
          ? fieldLimits[0]
          : { value: null, label: metric.key === "ece" ? "Each farm's crop limit" : "Each farm's irrigation trigger" };

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
          // The floating History button owns the bottom-right corner: the map credit wraps before it.
          !phone && !historyOpen && "[&_.leaflet-bottom.leaflet-left]:right-28",
          compare && !weatherLayer
            ? "h-[min(84vh,720px)] grid-rows-2 sm:h-[clamp(360px,calc(100dvh-340px),620px)] sm:grid-cols-2 sm:grid-rows-1"
            : cn("grid-cols-1", heightClassName),
        )}
      >
        {weatherLayer ? (
          <WeatherStage
            field={grid.field}
            error={grid.error}
            onRetry={grid.retry}
            layer={weatherLayer}
            farms={wxFarms}
            selectedId={farm?.id ?? null}
            onSelectFarm={onSelect}
            options={wxOptions}
            t={playback.t}
            onT={playback.setT}
            playing={playback.playing}
            onPlayingChange={playback.setPlaying}
            pin={wxPin}
            onPin={setWxPin}
            focus={wxHome}
            fitSignal={wxFit}
            focusSignal={wxFocus}
            initialFocus={farm ? { lat: farm.lat, lng: farm.lng, zoom: 9 } : null}
            compact
          />
        ) : null}
        {!weatherLayer && compare ? (
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
        {weatherLayer ? null : (
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
        )}

        {/* Top row: the layer, then the map options and extent next to Leaflet's zoom buttons. */}
        <div className="pointer-events-none absolute inset-x-2.5 top-2.5 z-[1000] flex items-start gap-2">
          <Select
            value={weatherLayer ? `${WX}${weatherLayer}` : metricKey}
            onValueChange={(v) => {
              if (v.startsWith(WX)) {
                setWeatherLayer(v.slice(WX.length) as WeatherLayerKey);
                if (historyOpen) onHistoryOpenChange(false);
                if (compare) onCompareChange(false);
              } else {
                playback.setPlaying(false);
                setWeatherLayer(null);
                onMetricChange(v as MetricKey);
              }
            }}
          >
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
              <SelectGroup>
                <SelectSeparator />
                <SelectLabel>Weather forecast</SelectLabel>
                {WEATHER_ITEMS.map((key) => {
                  const Icon = WEATHER_LAYER_ICON[key];
                  return (
                    <SelectItem key={key} value={`${WX}${key}`} className="min-h-9">
                      <Icon />
                      {WEATHER_LAYERS[key].label}
                    </SelectItem>
                  );
                })}
              </SelectGroup>
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
              <PopoverContent align="end" className={cn("space-y-4", weatherLayer ? "w-72" : "w-64")}>
                {weatherLayer ? (
                  <WeatherOptions value={wxOptions} onChange={setWxOptions} hasIsolines={Boolean(WEATHER_LAYERS[weatherLayer].isolines)} />
                ) : (
                  <SoilMapOptions
                    basemap={basemap}
                    onBasemap={setBasemap}
                    liveId={liveId}
                    liveText={LIVE_TEXT[liveStatus]}
                    live={live}
                    onLive={(on) => {
                      setLive(on);
                      if (on) onDateIndex(last);
                    }}
                  />
                )}
              </PopoverContent>
            </Popover>
            {weatherLayer ? (
              <IconTip label={farm ? `Zoom to ${farm.name}` : "Show all of Qatar"}>
                <Button
                  variant="outline"
                  size="icon"
                  className={MAP_BUTTON}
                  aria-label={farm ? `Zoom to ${farm.name}` : "Show all of Qatar"}
                  onClick={() => (farm ? setWxFocus((n) => n + 1) : setWxFit((n) => n + 1))}
                >
                  {farm ? <Crosshair /> : <Maximize2 />}
                </Button>
              </IconTip>
            ) : single ? (
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

        {viewingPast && !historyOpen && !weatherLayer ? (
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

        {!historyOpen && !compare && !weatherLayer ? (
          <MapLegend metric={metric} marker={legendMarker} limit={legendLimit} variant="chip" className="absolute bottom-8 left-2.5 z-[1000] hidden sm:block" />
        ) : null}

        {overlay && !historyOpen && !compare && !(weatherLayer && wxPin) ? <div className="absolute top-16 left-2.5 z-[1000] w-[min(20rem,calc(100%-1.25rem))]">{overlay}</div> : null}

        {!historyOpen && !phone && !weatherLayer ? historyButton : null}
        {historyOpen && !phone ? historyPanel : null}
      </div>
      {historyOpen && phone ? historyPanel : null}
      {weatherLayer ? (
        <WeatherLegend def={WEATHER_LAYERS[weatherLayer]} compact className="border-t px-3 py-2 sm:hidden" />
      ) : (
        <MapLegend
          metric={metric}
          marker={legendMarker}
          limit={legendLimit}
          variant="strip"
          info={false}
          action={phone && !historyOpen ? historyButton : null}
          className={cn("border-t", compare || phone ? undefined : "hidden")}
        />
      )}
    </section>
  );
}


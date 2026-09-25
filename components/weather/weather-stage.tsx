"use client";

/**
 * The weather map with everything that floats over it: the colour legend, the hourly timeline with
 * play, a "forecast couldn't refresh" note, and the readout of a dropped pin. Used inside the farm
 * map card (layer menu → Weather) and, larger, on the Weather page.
 */
import { CloudOff, RotateCcw } from "lucide-react";
import { useMemo } from "react";
import { MapSkeleton } from "@/components/dashboard/map";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import { pointValues, type WeatherField } from "@/lib/weather/field";
import { WEATHER_LAYERS, type WeatherLayerKey } from "@/lib/weather/layers";
import { cn } from "@/lib/utils";
import { WeatherMap, type WeatherMapFarm } from "./index";
import { PointReadout } from "./point-readout";
import type { WeatherOptionsState } from "./weather-options";
import { WeatherLegend } from "./weather-legend";
import { WeatherTimeline } from "./weather-timeline";

export interface WeatherFocus {
  lat: number;
  lng: number;
  name: string;
}

export function WeatherUnavailable({ error, onRetry, className }: { error: string; onRetry: () => void; className?: string }) {
  return (
    <div className={cn("flex size-full flex-col items-center justify-center gap-2 bg-muted/40 px-6 text-center", className)}>
      <CloudOff className="size-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-semibold">Weather map unavailable</p>
      <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw /> Retry
      </Button>
    </div>
  );
}

export function WeatherStage({
  field,
  error,
  onRetry,
  layer,
  farms,
  selectedId,
  onSelectFarm,
  options,
  t,
  onT,
  playing,
  onPlayingChange,
  pin,
  onPin,
  focus,
  fitSignal,
  focusSignal,
  initialFocus,
  showPinReadout = true,
  pinAction,
  compact = false,
  className,
}: {
  field: WeatherField | null;
  error: string | null;
  onRetry: () => void;
  layer: WeatherLayerKey;
  farms: WeatherMapFarm[];
  selectedId: string | null;
  onSelectFarm?: (id: string) => void;
  options: WeatherOptionsState;
  t: number;
  onT: (t: number) => void;
  playing: boolean;
  onPlayingChange: (on: boolean) => void;
  pin: { lat: number; lng: number } | null;
  onPin: (p: { lat: number; lng: number } | null) => void;
  /** The spot the timeline strip and the legend marker describe. */
  focus: WeatherFocus;
  fitSignal?: number;
  focusSignal?: number;
  /** Start zoomed on a farm instead of all of Qatar. */
  initialFocus?: { lat: number; lng: number; zoom: number } | null;
  showPinReadout?: boolean;
  pinAction?: React.ReactNode;
  /** Smaller legend (the farm map card). */
  compact?: boolean;
  className?: string;
}) {
  const def = WEATHER_LAYERS[layer];
  const strip = useMemo(() => (field ? pointValues(field, def.field, focus.lat, focus.lng) : null), [field, def.field, focus.lat, focus.lng]);

  if (error && !field) return <WeatherUnavailable error={error} onRetry={onRetry} className={className} />;
  if (!field) return <MapSkeleton label="Loading the weather map…" />;

  const markerValue = strip ? interpolate(strip, t) : NaN;

  return (
    <div
      className={cn(
        "relative size-full",
        // Leaflet's bottom controls (the credit) sit above the timeline. `!`: leaflet.css is unlayered, so it beats utilities.
        "[&_.leaflet-bottom]:bottom-[78px]! sm:[&_.leaflet-bottom]:bottom-[84px]!",
        className,
      )}
    >
      <WeatherMap
        field={field}
        layer={layer}
        t={t}
        fast={playing}
        farms={farms}
        selectedId={selectedId}
        onSelectFarm={onSelectFarm}
        pin={pin}
        onPin={onPin}
        basemap={options.basemap}
        streaks={options.streaks}
        isolines={options.isolines}
        opacity={options.opacity}
        focus={initialFocus}
        scrollWheelZoom={false}
        gestureZoom
        touchDrag={false}
        fitSignal={fitSignal}
        focusSignal={focusSignal}
        attributionPosition="bottomright"
      />

      {field.stale ? (
        <p className="pointer-events-none absolute top-16 right-2.5 z-[1000] rounded-full bg-risk-medium-soft px-3 py-1 text-xs font-medium text-risk-medium-ink shadow-sm sm:top-2.5 sm:right-auto sm:left-1/2 sm:-translate-x-1/2">
          Couldn&apos;t refresh · forecast from {formatTime(field.fetchedAt)}
        </p>
      ) : null}

      {showPinReadout && pin ? (
        <PointReadout
          field={field}
          t={t}
          lat={pin.lat}
          lng={pin.lng}
          title="Dropped pin"
          onClose={() => onPin(null)}
          action={pinAction}
          className="absolute top-16 left-2.5 z-[1000] w-[min(20rem,calc(100%-1.25rem))]"
        />
      ) : null}

      <WeatherLegend
        def={def}
        marker={Number.isFinite(markerValue) ? { value: markerValue, label: focus.name } : null}
        compact={compact}
        className="absolute bottom-[84px] left-2.5 z-[1000] hidden sm:block"
      />

      <WeatherTimeline
        times={field.times}
        t={t}
        onT={onT}
        playing={playing}
        onPlayingChange={onPlayingChange}
        strip={strip}
        def={def}
        place={focus.name}
        lat={focus.lat}
        lng={focus.lng}
        className="absolute inset-x-2.5 bottom-2.5 z-[1000]"
      />
    </div>
  );
}

function interpolate(values: number[], t: number): number {
  const i = Math.max(0, Math.min(values.length - 1, Math.floor(t)));
  const j = Math.min(values.length - 1, i + 1);
  const f = t - i;
  return values[i] + (values[j] - values[i]) * f;
}

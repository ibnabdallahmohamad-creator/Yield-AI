"use client";

/**
 * The colour scale of a weather layer, Windy-style: a gradient bar with the unit and round values,
 * and a marker at the value of the selected farm or pin.
 */
import { formatWeather, type WeatherLayerDef } from "@/lib/weather/layers";
import { legendPos, paletteGradient } from "@/lib/weather/palettes";
import { cn } from "@/lib/utils";

export function WeatherLegend({
  def,
  marker,
  className,
  compact = false,
}: {
  def: WeatherLayerDef;
  marker?: { value: number; label: string } | null;
  className?: string;
  compact?: boolean;
}) {
  const { min, max, ticks } = def.legend;
  const gradient = paletteGradient(def.palette, min, max);
  const markerPos = marker && Number.isFinite(marker.value) ? legendPos(def.palette, marker.value, min, max) : null;
  return (
    <div className={cn("rounded-xl bg-card/95 px-3 pt-2 pb-1.5 shadow-md ring-1 ring-black/5 backdrop-blur-sm", compact ? "w-56" : "w-72", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-semibold">{def.label}</span>
        <span className="shrink-0 text-muted-foreground">{def.unit}</span>
      </div>
      <div className="relative mt-1.5">
        <div
          className="h-2.5 rounded-full ring-1 ring-black/10 ring-inset"
          style={{ background: gradient }}
          role="img"
          aria-label={`${def.label} colour scale from ${formatWeather(def, min)} to ${formatWeather(def, max)}`}
        />
        {markerPos != null ? (
          <span
            className="absolute -top-1 h-4.5 w-1 -translate-x-1/2 rounded-full bg-foreground ring-2 ring-card"
            style={{ left: `${markerPos * 100}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="relative mt-1 h-4 text-xs text-muted-foreground tabular" aria-hidden="true">
        {ticks.map((v, i) => {
          const p = legendPos(def.palette, v, min, max) * 100;
          // The end labels hug the edges so they never spill out of the card.
          const shift = i === 0 ? "translate-x-0" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2";
          return (
            <span key={v} className={cn("absolute", shift, compact && i % 2 === 1 && i !== ticks.length - 1 && "hidden")} style={{ left: `${p}%` }}>
              {v}
            </span>
          );
        })}
      </div>
      {marker && Number.isFinite(marker.value) ? (
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{formatWeather(def, marker.value)}</span> at {marker.label}
        </p>
      ) : null}
    </div>
  );
}

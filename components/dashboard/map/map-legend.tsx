"use client";

import { InfoTip } from "@/components/dashboard/info-tip";
import { classFor, formatValue, legendGradient, legendPosition, type MetricDef } from "@/lib/metrics";
import { cn } from "@/lib/utils";

function boundaryLabel(metric: MetricDef, value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: metric.key === "ph" ? 1 : 0 });
}

const LIMIT_RED = "#c0262d";

function Scale({ metric, marker, limit }: { metric: MetricDef; marker?: { value: number | null } | null; limit?: MapLimit | null }) {
  const n = metric.classes.length;
  const boundaries = metric.classes.slice(0, -1).map((c) => c.max);
  return (
    <>
      <div className="relative">
        <div
          className="h-2.5 rounded-full ring-1 ring-black/10 ring-inset"
          style={{ background: legendGradient(metric) }}
          role="img"
          aria-label={`${metric.label} colour scale: ${metric.classes.map((c) => c.label).join(", ")}`}
        />
        {boundaries.map((_, i) => (
          <span key={i} className="absolute top-0 h-2.5 w-px bg-black/25" style={{ left: `${((i + 1) / n) * 100}%` }} />
        ))}
        {limit && limit.value != null ? (
          <span
            className="absolute -top-0.5 h-3.5 w-0.5 -translate-x-1/2 rounded-full ring-1 ring-white"
            style={{ left: `${legendPosition(metric, limit.value) * 100}%`, background: LIMIT_RED }}
            aria-hidden="true"
          />
        ) : null}
        {marker && marker.value != null ? (
          <span
            className="absolute -top-1 h-4.5 w-1 -translate-x-1/2 rounded-full bg-foreground ring-2 ring-card"
            style={{ left: `${legendPosition(metric, marker.value) * 100}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="relative mt-1 h-4 text-xs text-muted-foreground tabular">
        {boundaries.map((b, i) => (
          <span key={i} className="absolute -translate-x-1/2" style={{ left: `${((i + 1) / n) * 100}%` }}>
            {boundaryLabel(metric, b)}
          </span>
        ))}
      </div>
    </>
  );
}

export interface MapLimit {
  /** Null when the fields' limits differ: the key names the line without a value or a tick. */
  value: number | null;
  label: string;
}

/** The key to the red isoline on the field. */
function LimitKey({ metric, limit }: { metric: MetricDef; limit: MapLimit }) {
  return (
    <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
      <span className="h-[3px] w-4 shrink-0 rounded-full ring-1 ring-white" style={{ background: LIMIT_RED }} aria-hidden="true" />
      <span className="truncate">
        {limit.label}
        {limit.value != null ? ` ${formatValue(metric, limit.value)}` : ""}
      </span>
    </p>
  );
}

/**
 * Colour scale with the fixed class thresholds and a marker for the selected farm. `card` floats
 * over the map; `strip` is a full-width row under it (compare mode and phones).
 */
export function MapLegend({
  metric,
  marker,
  limit = null,
  variant = "card",
  info: showInfo = true,
  action,
  className,
}: {
  metric: MetricDef;
  marker?: { value: number | null; label: string } | null;
  /** The selected farm's limit, drawn on the field as a red isoline. */
  limit?: MapLimit | null;
  /** `chip`: the compact floating legend with no controls (the method lives on Farm details → Method). */
  variant?: "card" | "strip" | "chip";
  /** Show the ⓘ method tip (off where every control must be a 44 px touch target). */
  info?: boolean;
  /** A control at the end of the strip (e.g. History on phones). */
  action?: React.ReactNode;
  className?: string;
}) {
  const cls = marker ? classFor(metric, marker.value) : null;
  const title = (
    <>
      <span className="truncate">{metric.label}</span>
      <span className="shrink-0 font-normal text-muted-foreground">{metric.unit === "pH" ? "" : metric.unit}</span>
    </>
  );
  const info = !showInfo ? null : (
    <InfoTip label={`About ${metric.label}`} className={variant === "card" ? "ml-auto" : undefined}>
      {metric.method}
    </InfoTip>
  );
  const readout = marker ? (
    <p className="truncate text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">{formatValue(metric, marker.value)}</span>
      {cls ? ` · ${cls.label}` : ""}
      <span className="sr-only"> at {marker.label}</span>
    </p>
  ) : null;
  const note = !metric.spatial ? "Farm-level value (weather-driven)" : null;

  if (variant === "chip") {
    return (
      <div className={cn("w-56 rounded-xl bg-card/95 px-3 pt-2 pb-1.5 shadow-md ring-1 ring-black/5 backdrop-blur-sm", className)}>
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate font-semibold">{metric.label}</span>
          <span className="shrink-0 text-muted-foreground">{metric.unit === "pH" ? "" : metric.unit}</span>
        </div>
        <div className="mt-1.5">
          <Scale metric={metric} marker={marker} limit={limit} />
        </div>
        {readout}
        {limit ? <LimitKey metric={metric} limit={limit} /> : null}
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
    );
  }

  if (variant === "strip") {
    return (
      <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-1.5 px-3 py-2.5 sm:px-4", className)}>
        <div className="flex min-w-0 items-center gap-1.5 text-xs leading-none font-semibold">
          {title}
          {info}
        </div>
        <div className="order-last w-full pt-1 sm:order-none sm:w-auto sm:max-w-sm sm:min-w-48 sm:flex-1 sm:pt-1.5">
          <Scale metric={metric} marker={marker} limit={limit} />
        </div>
        <div className="ml-auto min-w-0">
          {readout}
          {limit ? <LimitKey metric={metric} limit={limit} /> : null}
          {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
        </div>
        {action ? <div className="order-last w-full pt-1 [&>*]:w-full">{action}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-60 rounded-xl bg-card/95 px-3 pt-2.5 pb-2 shadow-md ring-1 ring-black/5 backdrop-blur-sm sm:w-64",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-xs leading-none font-semibold">
        {title}
        {info}
      </div>
      <div className="mt-2.5">
        <Scale metric={metric} marker={marker} limit={limit} />
      </div>
      {marker ? <div className="mt-1">{readout}</div> : null}
      {limit ? <LimitKey metric={metric} limit={limit} /> : null}
      {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

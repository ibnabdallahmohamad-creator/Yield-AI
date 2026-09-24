"use client";

import { Droplet, FlaskConical, Gauge, Leaf, Sprout, SunMedium, Thermometer, TrendingDown, Waves } from "lucide-react";
import { Segmented, type SegmentedOption } from "@/components/dashboard/segmented";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isNutrient, METRICS, type MetricKey } from "@/lib/metrics";
import { cn } from "@/lib/utils";

type ProbeLayer = "ece" | "moisture" | "ph" | "temperature" | "npk";
type DerivedLayer = "et0" | "etc" | "deficit" | "yieldLoss";

const PROBE_OPTIONS: SegmentedOption<ProbeLayer>[] = [
  { value: "ece", label: "Salinity", icon: <Waves />, title: METRICS.ece.label },
  { value: "moisture", label: "Moisture", icon: <Droplet />, title: METRICS.moisture.label },
  { value: "ph", label: "pH", icon: <FlaskConical />, title: METRICS.ph.label },
  { value: "temperature", label: "Temp.", icon: <Thermometer />, title: METRICS.temperature.label, ariaLabel: "Soil temperature" },
  { value: "npk", label: "NPK", icon: <Sprout />, title: "Nitrogen, phosphorus, potassium", ariaLabel: "NPK nutrients" },
];

const DERIVED_OPTIONS: SegmentedOption<DerivedLayer>[] = [
  { value: "et0", label: "ET₀", icon: <SunMedium />, title: METRICS.et0.label, ariaLabel: "Reference evapotranspiration ET0" },
  { value: "etc", label: "ETc", icon: <Leaf />, title: METRICS.etc.label, ariaLabel: "Crop water use ETc" },
  { value: "deficit", label: "Water deficit", icon: <Gauge />, title: METRICS.deficit.label },
  { value: "yieldLoss", label: "Yield loss", icon: <TrendingDown />, title: METRICS.yieldLoss.label },
];

const NUTRIENT_OPTIONS: SegmentedOption<"n" | "p" | "k">[] = [
  { value: "n", label: "N", ariaLabel: "Nitrogen" },
  { value: "p", label: "P", ariaLabel: "Phosphorus" },
  { value: "k", label: "K", ariaLabel: "Potassium" },
];

// Phones get one compact menu instead of two rows of buttons.
const MENU_GROUPS: { label: string; items: { value: MetricKey; icon: React.ReactNode }[] }[] = [
  {
    label: "Probe readings",
    items: [
      { value: "ece", icon: <Waves /> },
      { value: "moisture", icon: <Droplet /> },
      { value: "ph", icon: <FlaskConical /> },
      { value: "temperature", icon: <Thermometer /> },
      { value: "n", icon: <Sprout /> },
      { value: "p", icon: <Sprout /> },
      { value: "k", icon: <Sprout /> },
    ],
  },
  {
    label: "Derived (FAO-56 / FAO-29)",
    items: [
      { value: "et0", icon: <SunMedium /> },
      { value: "etc", icon: <Leaf /> },
      { value: "deficit", icon: <Gauge /> },
      { value: "yieldLoss", icon: <TrendingDown /> },
    ],
  },
];

/** Small uppercase group caption; shown only when the surrounding `@container` toolbar has room. */
export function ToolbarCaption({ children }: { children: React.ReactNode }) {
  return (
    <span className="hidden text-[11px] font-semibold tracking-wide text-muted-foreground uppercase @[46rem]:inline">
      {children}
    </span>
  );
}

/** Map layer picker: probe readings and derived agronomy layers. Place it in an `@container`. */
export function LayerSwitcher({
  value,
  onChange,
  className,
  children,
}: {
  value: MetricKey;
  onChange: (metric: MetricKey) => void;
  className?: string;
  /** Extra controls at the end of the row (e.g. the base map switch). */
  children?: React.ReactNode;
}) {
  const nutrient = isNutrient(value);
  const probeValue: ProbeLayer | "" = nutrient
    ? "npk"
    : value === "ece" || value === "moisture" || value === "ph" || value === "temperature"
      ? value
      : "";
  const derivedValue: DerivedLayer | "" =
    value === "et0" || value === "etc" || value === "deficit" || value === "yieldLoss" ? value : "";

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      <Select value={value} onValueChange={(v) => onChange(v as MetricKey)}>
        <SelectTrigger className="min-w-0 flex-1 bg-card sm:hidden" aria-label="Map layer">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {MENU_GROUPS.map((group, i) => (
            <SelectGroup key={group.label}>
              {i > 0 ? <SelectSeparator /> : null}
              <SelectLabel>{group.label}</SelectLabel>
              {group.items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.icon}
                  {METRICS[item.value].label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      <div className="hidden items-center gap-2 sm:flex">
        <ToolbarCaption>Probe</ToolbarCaption>
        <Segmented
          ariaLabel="Probe data layers"
          value={probeValue}
          options={PROBE_OPTIONS}
          onChange={(v) => onChange(v === "npk" ? (nutrient ? value : "n") : v)}
        />
        {nutrient ? (
          <Segmented
            ariaLabel="Nutrient"
            size="sm"
            value={value as "n" | "p" | "k"}
            options={NUTRIENT_OPTIONS}
            onChange={(v) => onChange(v)}
          />
        ) : null}
      </div>
      <div className="hidden items-center gap-2 sm:flex">
        <ToolbarCaption>Derived</ToolbarCaption>
        <Segmented ariaLabel="Derived layers" value={derivedValue} options={DERIVED_OPTIONS} onChange={(v) => onChange(v)} />
      </div>
      {children ? <div className="ml-auto flex items-center gap-2">{children}</div> : null}
    </div>
  );
}

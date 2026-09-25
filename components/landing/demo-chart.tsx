"use client";

import { Droplet, FlaskConical, Waves } from "lucide-react";
import { useState } from "react";
import { MetricChart } from "@/components/dashboard/metric-chart";
import { Segmented } from "@/components/dashboard/segmented";
import type { ChartOverlay } from "@/lib/dashboard";
import { computeDelta, formatValue, METRICS } from "@/lib/metrics";
import type { FarmBundle } from "@/lib/types";
import { cn } from "@/lib/utils";

type ChartMetric = "ece" | "moisture" | "ph";

const NO_OVERLAY: ChartOverlay = { kind: "none" };

/** Landing-page chart: the dashboard's metric chart for one demo farm over 30 days. */
export function DemoChart({ bundle, dates }: { bundle: FarmBundle; dates: string[] }) {
  const [key, setKey] = useState<ChartMetric>("ece");
  const metric = METRICS[key];
  const values = bundle.days.map((d) => (d ? metric.farmValue(d) : null)).filter((v): v is number => v != null);
  const first = values[0] ?? null;
  const last = values.at(-1) ?? null;
  const delta = computeDelta(metric, first, last);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<ChartMetric>
          ariaLabel="Chart metric"
          size="sm"
          value={key}
          onChange={setKey}
          options={[
            { value: "ece", label: "Salinity", icon: <Waves />, title: METRICS.ece.label },
            { value: "moisture", label: "Moisture", icon: <Droplet />, title: METRICS.moisture.label },
            { value: "ph", label: "pH", icon: <FlaskConical />, title: METRICS.ph.label },
          ]}
        />
        <p className="ml-auto text-xs text-muted-foreground tabular">
          {formatValue(metric, first)} → <span className="font-semibold text-foreground">{formatValue(metric, last)}</span>
          {delta ? (
            <span
              className={cn(
                "ml-1.5 rounded-full px-1.5 py-px text-xs font-bold",
                delta.tone === "bad" && "bg-risk-high-soft text-risk-high-ink",
                delta.tone === "good" && "bg-risk-low-soft text-risk-low-ink",
                delta.tone === "neutral" && "bg-muted text-muted-foreground",
              )}
            >
              {delta.text}
            </span>
          ) : null}
        </p>
      </div>
      <MetricChart
        bundle={bundle}
        metric={metric}
        dates={dates}
        endIndex={dates.length - 1}
        rangeDays={30}
        overlay={NO_OVERLAY}
        overlayLabel={null}
        height={250}
        className="mt-3"
      />
    </div>
  );
}

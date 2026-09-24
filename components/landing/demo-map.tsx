"use client";

import { ArrowUpRight, MousePointerClick } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FarmMap, MapLegend, type MapFarm } from "@/components/dashboard/map";
import { RiskBadge } from "@/components/dashboard/risk-badge";
import type { ShowcaseFarm } from "@/lib/data/showcase";
import { formatValue, METRICS } from "@/lib/metrics";

const metric = METRICS.ece;
const PADDING = { top: 56, right: 40, bottom: 32, left: 40 };

/** Landing-page map: the dashboard's farm map on demo data. Click a pin for its risk and headline insight. */
export function DemoMap({ farms }: { farms: ShowcaseFarm[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(farms[0]?.id ?? null);
  const mapFarms = useMemo<MapFarm[]>(
    () => farms.map((f) => ({ id: f.id, name: f.name, polygon: f.polygon, value: f.ece, samples: f.samples })),
    [farms],
  );
  const farm = farms.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="flex flex-col">
      <div className="relative isolate h-[300px] sm:h-[340px]">
        <FarmMap
          farms={mapFarms}
          metric={metric}
          selectedId={selectedId}
          onSelect={setSelectedId}
          basemap="satellite"
          initialView="all"
          scrollWheelZoom={false}
          followSelection={false}
          touchDrag={false}
          padding={PADDING}
        />
        <span className="pointer-events-none absolute top-3 left-3 z-[1000] inline-flex items-center gap-1.5 rounded-full bg-card/95 px-2.5 py-1 text-[12px] font-medium shadow-md">
          <MousePointerClick className="size-3.5 text-primary" aria-hidden="true" />
          Click a farm
        </span>
      </div>
      <MapLegend metric={metric} marker={farm ? { value: farm.ece, label: farm.name } : null} variant="strip" className="border-t" />
      {farm ? (
        <div className="border-t px-4 py-3.5" aria-live="polite">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{farm.name}</p>
              <p className="truncate text-[12.5px] text-muted-foreground">
                {farm.crop} · {farm.areaHa.toLocaleString("en-US", { maximumFractionDigits: 1 })} ha · {farm.region} · ECe{" "}
                {formatValue(metric, farm.ece)}
              </p>
            </div>
            {farm.risk ? <RiskBadge level={farm.risk.level} score={farm.risk.score} className="shrink-0" /> : null}
          </div>
          {/* Fixed three-line height so the card (and the hero) does not jump between farms. */}
          <p className="mt-2 line-clamp-3 min-h-[4.125rem] text-[13.5px] leading-[1.375rem] text-foreground/90">{farm.summary ?? "No insight yet."}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {farm.action ? (
              <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                <span className="font-semibold text-foreground">Next step:</span> {farm.action.title}
              </p>
            ) : null}
            <Link
              href={`/dashboard?farm=${encodeURIComponent(farm.id)}`}
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md text-[13px] font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            >
              Open in dashboard <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

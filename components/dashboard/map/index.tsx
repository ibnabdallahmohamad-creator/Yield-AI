"use client";

import dynamic from "next/dynamic";
import { MapIcon } from "lucide-react";

export type { Basemap, MapFarm, FarmMapProps, MapPadding } from "./farm-map";
export { createMapSync, type MapSync } from "./map-sync";
export { MapLegend } from "./map-legend";

export function MapSkeleton({ label = "Loading map…" }: { label?: string }) {
  return (
    <div className="flex size-full items-center justify-center bg-[repeating-linear-gradient(135deg,var(--sand-100)_0_14px,var(--sand-200)_14px_28px)]">
      <span className="inline-flex items-center gap-2 rounded-full bg-card/90 px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
        <MapIcon className="size-4 animate-pulse" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

/** Leaflet touches `window` on import, so the map only renders in the browser. */
export const FarmMap = dynamic(() => import("./farm-map"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

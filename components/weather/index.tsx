"use client";

import dynamic from "next/dynamic";
import { MapSkeleton } from "@/components/dashboard/map";

export type { WeatherMapFarm } from "./weather-map";

/** Leaflet touches `window` on import, so the weather map only renders in the browser. */
export const WeatherMap = dynamic(() => import("./weather-map"), {
  ssr: false,
  loading: () => <MapSkeleton label="Loading forecast map…" />,
});

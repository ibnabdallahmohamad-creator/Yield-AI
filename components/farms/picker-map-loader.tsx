"use client";

import dynamic from "next/dynamic";
import { MapSkeleton } from "@/components/dashboard/map";

export type { PickerBasemap, PickerMapProps, PickerSensor } from "./picker-map";

/** Leaflet touches `window` on import, so the picker only renders in the browser. */
export const PickerMap = dynamic(() => import("./picker-map"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

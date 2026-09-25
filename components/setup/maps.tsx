"use client";

import dynamic from "next/dynamic";
import { MapSkeleton } from "@/components/dashboard/map";

/** Leaflet touches `window` on import, so the setup maps only render in the browser. */
export const BoundaryMap = dynamic(() => import("./setup-maps").then((m) => m.BoundaryMap), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

export const ProbeMap = dynamic(() => import("./setup-maps").then((m) => m.ProbeMap), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { LandCell } from "@/lib/land/profile";
import { LandProfileCard } from "./land-profile-card";

const cache = new Map<string, LandCell | null>();

/** Loads the land-atlas cell under a point (GET /api/land) and shows its profile. */
export function LandProfileLoader({ lat, lng, compact, className }: { lat: number; lng: number; compact?: boolean; className?: string }) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const [state, setState] = useState<{ key: string; cell: LandCell | null; failed: boolean } | null>(() =>
    cache.has(key) ? { key, cell: cache.get(key)!, failed: false } : null,
  );

  useEffect(() => {
    if (cache.has(key)) return;
    const controller = new AbortController();
    fetch(`/api/land?lat=${lat}&lng=${lng}`, { signal: controller.signal })
      .then((res) => res.json() as Promise<{ cell?: LandCell }>)
      .then((body) => {
        cache.set(key, body.cell ?? null);
        setState({ key, cell: body.cell ?? null, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, cell: null, failed: true });
      });
    return () => controller.abort();
  }, [key, lat, lng]);

  const current = state?.key === key ? state : cache.has(key) ? { key, cell: cache.get(key)!, failed: false } : null;
  if (!current) return <Skeleton className={className ?? "h-64 w-full rounded-2xl"} />;
  if (!current.cell) {
    return (
      <p className="rounded-2xl border border-dashed p-4 text-[13px] text-muted-foreground">
        {current.failed ? "The land profile could not be loaded." : "This location is outside the Qatar land atlas."}
      </p>
    );
  }
  return <LandProfileCard cell={current.cell} compact={compact} className={className} />;
}

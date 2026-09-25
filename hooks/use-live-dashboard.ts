"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { useShell } from "@/components/shell/shell-context";
import type { DashboardData, FarmDay, LiveUpdate } from "@/lib/types";

type LiveDays = Record<string, { index: number; day: FarmDay }>;

function mergeLive(data: DashboardData, liveDays: LiveDays): DashboardData {
  const ids = Object.keys(liveDays);
  if (ids.length === 0) return data;
  return {
    ...data,
    farms: data.farms.map((b) => {
      const live = liveDays[b.farm.id];
      if (!live) return b;
      const days = b.days.slice();
      days[live.index] = live.day;
      return { ...b, days };
    }),
  };
}

/**
 * The dashboard data with live readings merged in. Live updates re-derive today's values per farm;
 * `flashes` says when each farm last reported (to flash its row) and `pulse` which farm to pulse on
 * the map. A new server payload (a refresh or navigation) starts clean.
 */
export function useLiveDashboard(serverData: DashboardData) {
  const router = useRouter();
  const { subscribeLive } = useShell();
  const [liveDays, setLiveDays] = useState<LiveDays>({});
  const [prevServerData, setPrevServerData] = useState(serverData);
  if (prevServerData !== serverData) {
    setPrevServerData(serverData);
    setLiveDays({});
  }
  const data = useMemo(() => mergeLive(serverData, liveDays), [serverData, liveDays]);
  const [pulse, setPulse] = useState<{ farmId: string; at: number } | null>(null);
  const [flashes, setFlashes] = useState<Record<string, number>>({});

  const onLiveUpdate = useEffectEvent((update: LiveUpdate) => {
    const index = serverData.dates.indexOf(update.date);
    if (index < 0) {
      router.refresh(); // the day rolled over: fetch the new 60-day window
      return;
    }
    const entries = Object.entries(update.farms);
    if (entries.length === 0) return;
    setLiveDays((prev) => {
      const next = { ...prev };
      for (const [id, day] of entries) next[id] = { index, day };
      return next;
    });
    const at = Date.now();
    setFlashes((prev) => {
      const next = { ...prev };
      for (const [id] of entries) next[id] = at;
      return next;
    });
    setPulse({ farmId: entries[0][0], at });
  });
  useEffect(() => subscribeLive((update) => onLiveUpdate(update)), [subscribeLive]);

  return { data, pulse, flashes };
}

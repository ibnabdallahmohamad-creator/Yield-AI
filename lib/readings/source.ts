/**
 * Every reading of one farm, bucketed for the Readings chart. Real accounts read their own store
 * (files or Supabase); the demo account reads the demo dataset.
 */
import "server-only";
import { getAccountStore, isDemoUser } from "../account/store";
import { QATAR_ORIGIN_MS } from "../account/local-store";
import type { AppUser } from "../auth/session";
import { env } from "../env";
import { getMockState, mockReadings } from "../data/mock-store";
import { createSupabaseDataClient, withTimeout } from "../supabase/server";
import { toReading } from "../data/supabase-source";
import { getDashboardFor } from "../data/repository";
import { addReadings, buildSeries, chooseBucketSeconds, MAX_SERIES_RANGE_MS, type BucketMap, type ReadingSeries } from "./series";

export class SeriesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function demoBuckets(farmId: string, fromMs: number, toMs: number, bucketMs: number, source: string): Promise<BucketMap> {
  const map: BucketMap = new Map();
  if (source === "supabase" && !env.useMock) {
    const client = await createSupabaseDataClient();
    if (client) {
      const res = await withTimeout(
        client
          .from("sensor_readings")
          .select("*")
          .eq("farm_id", farmId)
          .gte("timestamp", new Date(fromMs).toISOString())
          .lt("timestamp", new Date(toMs).toISOString())
          .order("timestamp")
          .limit(20_000),
        10_000,
        "demo readings",
      );
      if (res.error) throw new Error(res.error.message);
      addReadings(map, (res.data ?? []).map((r) => toReading(r as Record<string, unknown>)), bucketMs, QATAR_ORIGIN_MS, fromMs, toMs);
      return map;
    }
  }
  const readings = mockReadings(getMockState()).filter((r) => r.farm_id === farmId);
  addReadings(map, readings, bucketMs, QATAR_ORIGIN_MS, fromMs, toMs);
  return map;
}

/**
 * `range`: milliseconds back from now, or "all" (from the farm's first reading). `from`/`to` pick an
 * exact window instead (zooming in). Buckets are chosen so the chart gets at most ~360 points and
 * never finer than the farm's fastest device interval.
 */
export async function getReadingSeries(
  user: AppUser,
  farmId: string,
  window: { rangeMs: number | "all" } | { fromMs: number; toMs: number },
): Promise<ReadingSeries> {
  const data = await getDashboardFor(user);
  const bundle = data.farms.find((b) => b.farm.id === farmId);
  if (!bundle) throw new SeriesError("That farm doesn't exist.", 404);

  const now = Date.now();
  const demo = isDemoUser(user);
  const store = demo ? null : getAccountStore(user);
  let fromMs: number;
  let toMs: number;
  if ("fromMs" in window) {
    fromMs = window.fromMs;
    toMs = Math.min(window.toMs, now + 60_000);
  } else if (window.rangeMs === "all") {
    const first = store ? await store.firstReadingAt(farmId) : Date.parse(`${data.dates[0]}T00:00:00+03:00`);
    toMs = now + 1000;
    fromMs = first ?? toMs - 3_600_000;
  } else {
    toMs = now + 1000;
    fromMs = toMs - window.rangeMs;
  }
  if (!(toMs > fromMs)) throw new SeriesError("`to` must be after `from`.", 400);
  if (toMs - fromMs > MAX_SERIES_RANGE_MS) fromMs = toMs - MAX_SERIES_RANGE_MS;

  const devices = data.account?.devices.filter((d) => d.farm_id === farmId) ?? [];
  const fastest = devices.length ? Math.min(...devices.map((d) => d.interval_s)) : 1;
  const bucketS = chooseBucketSeconds(toMs - fromMs, fastest);
  const bucketMs = bucketS * 1000;
  const map = store ? await store.bucketSeries(farmId, fromMs, toMs, bucketMs) : await demoBuckets(farmId, fromMs, toMs, bucketMs, data.source);
  return buildSeries(farmId, map, fromMs, toMs, bucketMs);
}

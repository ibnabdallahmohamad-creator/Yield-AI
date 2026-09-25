import { NextResponse, type NextRequest } from "next/server";
import { AccountStoreError } from "@/lib/account/store";
import { getCurrentUser } from "@/lib/auth/session";
import { SERIES_RANGES } from "@/lib/readings/series";
import { getReadingSeries, SeriesError } from "@/lib/readings/source";

/**
 * GET /api/readings/series?farm=<id>&range=1h|6h|24h|7d|30d|90d|all — or &from=<ISO>&to=<ISO> to zoom
 * in. Every reading of the farm in that window, bucketed (mean, min, max and count per metric, farm-wide
 * and per probe) so the chart stays fast however often the devices report. See lib/readings/series.ts.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const q = request.nextUrl.searchParams;
  const farm = q.get("farm");
  if (!farm) return NextResponse.json({ error: "Pass ?farm=<farm id>." }, { status: 400 });

  let window: Parameters<typeof getReadingSeries>[2];
  const from = q.get("from");
  const to = q.get("to");
  if (from || to) {
    const fromMs = Date.parse(from ?? "");
    const toMs = to ? Date.parse(to) : Date.now();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      return NextResponse.json({ error: "`from` and `to` must be ISO dates." }, { status: 400 });
    }
    window = { fromMs, toMs };
  } else {
    const key = q.get("range") ?? "24h";
    const range = SERIES_RANGES.find((r) => r.key === key);
    if (!range && key !== "all") {
      return NextResponse.json({ error: `range must be one of ${SERIES_RANGES.map((r) => r.key).join(", ")} or all.` }, { status: 400 });
    }
    window = { rangeMs: range ? range.ms : "all" };
  }

  try {
    const series = await getReadingSeries(user, farm, window);
    return NextResponse.json(series, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SeriesError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof AccountStoreError) return NextResponse.json({ error: `Readings are unavailable right now (${error.message}).` }, { status: 503 });
    console.error("[series] failed:", error);
    return NextResponse.json({ error: "Could not load the readings." }, { status: 500 });
  }
}

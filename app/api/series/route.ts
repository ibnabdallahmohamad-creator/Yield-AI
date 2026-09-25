import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getSeries } from "@/lib/data/repository";
import { isSeriesRange } from "@/lib/data/series";

/** GET /api/series?farm=…&range=1h|6h|24h|7d|30d|60d — every probe's readings over a range (raw or bucketed). */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const farmId = request.nextUrl.searchParams.get("farm") ?? "";
  const range = request.nextUrl.searchParams.get("range") ?? "24h";
  if (!isSeriesRange(range)) return NextResponse.json({ error: "Unknown range." }, { status: 400 });
  try {
    const series = await getSeries(user, farmId, range);
    if (!series) return NextResponse.json({ error: "That farm doesn't exist." }, { status: 404 });
    return NextResponse.json(series, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[series] failed:", error);
    return NextResponse.json({ error: "Readings are temporarily unavailable." }, { status: 503 });
  }
}

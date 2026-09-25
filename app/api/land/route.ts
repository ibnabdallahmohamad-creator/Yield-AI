import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { inQatarBbox } from "@/lib/land/grid";
import { landCellAt, landCellById } from "@/lib/land/profile";
import { getDerivedForecast } from "@/lib/weather/forecast";

/**
 * GET /api/land?lat=…&lng=… (or ?cell=QA-R30-C14) — the 10 km² land-atlas profile of a location:
 * soil and fertility, long-term climate, groundwater, crop suitability and its description.
 * Add `forecast=1` for the cell's derived 7-day weather, humidity and wind forecast.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const cellId = params.get("cell");
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  let cell = null;
  if (cellId) cell = landCellById(cellId.toUpperCase());
  else if (Number.isFinite(lat) && Number.isFinite(lng) && inQatarBbox(lat, lng)) cell = landCellAt(lat, lng);
  if (!cell) return NextResponse.json({ error: "No land-atlas cell here — pick a location on land in Qatar." }, { status: 404 });

  const forecast = params.get("forecast") === "1" ? await getDerivedForecast(cell.lat, cell.lng).catch(() => null) : undefined;
  return NextResponse.json({ cell, forecast }, { headers: { "Cache-Control": "private, max-age=600" } });
}

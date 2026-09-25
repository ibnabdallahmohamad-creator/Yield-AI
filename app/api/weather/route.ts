import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getFarmBundle } from "@/lib/data/repository";
import { scopeFor } from "@/lib/farms/scope";
import { inQatarBbox } from "@/lib/land/grid";
import { getLocationWeather } from "@/lib/weather/forecast";

/**
 * GET /api/weather?farm=<id> (or ?lat=…&lng=…) — real-time conditions from WeatherAPI.com and the
 * 7-day forecast (WeatherAPI.com days first, Open-Meteo for the rest of the week).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const params = request.nextUrl.searchParams;
  let lat = Number(params.get("lat"));
  let lng = Number(params.get("lng"));
  const farmId = params.get("farm");
  if (farmId) {
    const found = await getFarmBundle(scopeFor(user), farmId);
    if (!found) return NextResponse.json({ error: "That farm doesn't exist." }, { status: 404 });
    lat = found.bundle.farm.lat;
    lng = found.bundle.farm.lng;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inQatarBbox(lat, lng)) {
    return NextResponse.json({ error: "Pass ?farm=<id> or a location in Qatar (?lat=…&lng=…)." }, { status: 400 });
  }
  const weather = await getLocationWeather(lat, lng);
  return NextResponse.json(weather, { headers: { "Cache-Control": "private, max-age=300" } });
}

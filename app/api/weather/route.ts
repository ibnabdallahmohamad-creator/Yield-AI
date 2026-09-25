import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/data/repository";
import { getForecast } from "@/lib/weather/service";

/**
 * GET /api/weather — the hourly forecast (next 24 h, refreshed every 12 h) for the signed-in
 * account's farms and a grid around them, for the weather tabs.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const data = await getDashboardData(user);
  const farms = data.farms.map((b) => b.farm);
  const result = await getForecast(farms);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

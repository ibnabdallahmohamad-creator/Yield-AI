import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getWeatherGridJson } from "@/lib/weather/grid";

/**
 * GET /api/weather/grid — the weather maps' data: hourly temperature, humidity, rain, wind, gusts,
 * cloud and pressure for the next ~72 hours on a 0.1° grid over Qatar and a 0.5° grid over the Gulf
 * (see lib/weather/spec.ts for the format). Signed-in users only; the same for every account.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const json = await getWeatherGridJson();
  if (!json) {
    return NextResponse.json(
      { error: "The weather map can't be loaded right now (Open-Meteo unreachable). It's retried every 10 minutes." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return new NextResponse(json, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=300" },
  });
}

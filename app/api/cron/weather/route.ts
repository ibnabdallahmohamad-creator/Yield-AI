import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { refreshTrackedForecasts } from "@/lib/data/forecast";

/**
 * GET /api/cron/weather — re-download the 12-hour forecast for every farm location in use. For hosts
 * that run scheduled jobs (e.g. a cron at 00:00 and 12:00 Asia/Qatar, `0 9,21 * * *` UTC); long-running
 * servers already do this on their own (instrumentation.ts). Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Set CRON_SECRET on the server to enable this endpoint." }, { status: 503 });
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { locations, ok } = await refreshTrackedForecasts();
  return NextResponse.json({ ok: true, locations, updated: ok, at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}

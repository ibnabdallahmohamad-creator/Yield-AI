import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { refreshAllForecasts } from "@/lib/weather/service";

/**
 * GET /api/cron/weather — the 12-hourly forecast refresh for every account's farms, for an
 * external scheduler (Vercel Cron, GitHub Actions, cron + curl). Long-running servers also do
 * this on their own (instrumentation.ts), and any forecast older than 12 hours is refreshed the
 * next time someone opens it.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` (what Vercel Cron sends when CRON_SECRET is set).
 */
export async function GET(request: Request) {
  if (!env.cronSecret) return NextResponse.json({ error: "Set CRON_SECRET to enable this endpoint." }, { status: 503 });
  const token = (request.headers.get("authorization") ?? "").replace(/^bearer\s+/i, "");
  const a = Buffer.from(token);
  const b = Buffer.from(env.cronSecret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const result = await refreshAllForecasts();
  return NextResponse.json({ success: result.failed === 0, current: result.ok, failed: result.failed, total: result.total, at: new Date().toISOString() });
}

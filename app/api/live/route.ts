import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getLiveUpdateFor } from "@/lib/data/repository";

/**
 * GET /api/live?cursor=… — new readings since the last poll. Real accounts get only what their ESP32s
 * sent (and every device's status); the demo account gets the demo feed. The reply's `interval_s`
 * says when to poll next (10 s by default, or whatever the account chose).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    const update = await getLiveUpdateFor(user, request.nextUrl.searchParams.get("cursor"));
    return NextResponse.json(update, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[live] update failed:", error);
    return NextResponse.json({ error: "Live data is temporarily unavailable." }, { status: 503 });
  }
}

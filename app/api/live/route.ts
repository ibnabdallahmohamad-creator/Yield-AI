import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getLiveUpdate } from "@/lib/data/repository";

/**
 * GET /api/live?cursor=… — readings that arrived since the last poll, today re-derived for the
 * farms that received them, and the account's device status. Polled at the reading interval.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    const update = await getLiveUpdate(user, request.nextUrl.searchParams.get("cursor"));
    return NextResponse.json(update, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[live] update failed:", error);
    return NextResponse.json({ error: "Live data is temporarily unavailable." }, { status: 503 });
  }
}

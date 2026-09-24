import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getLiveUpdate } from "@/lib/data/repository";

/** GET /api/live?cursor=… — new probe readings since the last poll (live mode polls every 5 s). */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    const update = await getLiveUpdate(request.nextUrl.searchParams.get("cursor"));
    return NextResponse.json(update, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[live] update failed:", error);
    return NextResponse.json({ error: "Live data is temporarily unavailable." }, { status: 503 });
  }
}

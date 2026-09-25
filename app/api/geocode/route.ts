import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { searchPlaces } from "@/lib/geocode";

/** GET /api/geocode?q=… — places in Qatar (names, "lat, lng" or a land-atlas cell id). */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const body = await searchPlaces(q);
  return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
}

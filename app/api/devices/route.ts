import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getViewerSettings } from "@/lib/data/repository";
import { storeFor } from "@/lib/store";

/** GET /api/devices — the account's ESP32s with their last contact (the setup page polls it). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (user.demo) return NextResponse.json({ devices: [], interval_s: 10 });
  try {
    const [devices, settings] = await Promise.all([storeFor(user).listDevices(user.id), getViewerSettings(user)]);
    return NextResponse.json(
      { devices, interval_s: settings.reading_interval_s, server_time: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[devices] list failed:", error);
    return NextResponse.json({ error: "Devices are temporarily unavailable." }, { status: 503 });
  }
}

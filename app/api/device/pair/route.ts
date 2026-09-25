import { NextResponse } from "next/server";
import { pairDevice, rateLimited } from "@/lib/account/ingest";
import { PairRequestSchema } from "@/lib/account/types";

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/**
 * POST /api/device/pair — an ESP32 claims the pairing code its owner got from the dashboard.
 * Body: { code: "ABCD-EFGH", firmware?, mac?, ip?, rssi? }. No session: the code is the secret
 * (8 characters, single use, valid for 30 minutes). Returns the device's token, which it keeps and
 * sends as `Authorization: Bearer <token>` with every reading to `ingest_url`.
 */
export async function POST(request: Request) {
  const retryAfter = rateLimited(`pair:${clientIp(request)}`, 10);
  if (retryAfter !== null) {
    return NextResponse.json({ error: "Too many pairing attempts. Wait a minute and try again." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = PairRequestSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Send the pairing code." }, { status: 400 });

  const raw = json as { ip?: unknown; rssi?: unknown };
  const result = await pairDevice(parsed.data.code, {
    firmware: parsed.data.firmware ?? null,
    local_ip: typeof raw.ip === "string" ? raw.ip.slice(0, 45) : null,
    rssi: typeof raw.rssi === "number" ? raw.rssi : null,
  });
  if (!result) {
    return NextResponse.json(
      { error: "That pairing code isn't valid or has expired. Make a new one in the dashboard: Devices → the device → New pairing code." },
      { status: 404 },
    );
  }
  const { device, token } = result;
  const origin = new URL(request.url).origin;
  return NextResponse.json(
    {
      ok: true,
      device_id: device.id,
      name: device.name,
      farm_id: device.farm_id,
      sensor_id: device.sensor_id,
      token,
      interval_s: device.interval_s,
      ingest_url: `${origin}/api/readings`,
      server_time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

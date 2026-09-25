import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { looksLikeDeviceKey } from "@/lib/device-keys";
import { env } from "@/lib/env";
import { DevicePayloadSchema, IngestPayloadSchema, normalizeIngestPayload } from "@/lib/data/ingest";
import { IngestError, ingestBulk, ingestFromDevice } from "@/lib/data/repository";

function credential(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (/^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, "").trim();
  return (request.headers.get("x-device-key") ?? request.headers.get("x-api-key") ?? "").trim();
}

function isBulkKey(token: string): boolean {
  if (!env.ingestApiKey) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(env.ingestApiKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || null;
}

function issues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string[] {
  return error.issues.slice(0, 20).map((i) => `${i.path.map(String).join(".") || "body"}: ${i.message}`);
}

function ingestErrorResponse(error: IngestError) {
  const headers: Record<string, string> = {};
  if (error.retryAfterS) headers["Retry-After"] = String(error.retryAfterS);
  return NextResponse.json(
    { ok: false, error: error.message, details: error.details, ...(error.retryAfterS ? { interval_s: error.retryAfterS } : {}) },
    { status: error.status, headers },
  );
}

/**
 * POST /api/readings — probe readings over Wi-Fi.
 *
 *  - ESP32 devices: `Authorization: Bearer <device key>` (or `x-device-key`). Body: one
 *    measurement, `{ readings: [...] }` for buffered ones, or just `{ rssi, fw }` as a heartbeat.
 *    The reply carries `interval_s`, the account's reading interval, so devices follow it.
 *  - Bulk import: `Authorization: Bearer $INGEST_API_KEY` with farm_id and sensor_id per reading.
 *
 * See README → "Connect an ESP32" and "Probe ingest".
 */
export async function POST(request: Request) {
  const token = credential(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: "Send the device key as `Authorization: Bearer <key>`." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Send a JSON body." }, { status: 400 });
  }

  if (looksLikeDeviceKey(token)) {
    const parsed = DevicePayloadSchema.safeParse(json ?? {});
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid reading.", details: issues(parsed.error) }, { status: 422 });
    }
    try {
      const result = await ingestFromDevice(token, parsed.data, clientIp(request));
      return NextResponse.json(
        { ok: true, ...result, server_time: new Date().toISOString() },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof IngestError) return ingestErrorResponse(error);
      console.error("[ingest] device ingest failed:", error);
      return NextResponse.json({ ok: false, error: "Could not store the readings." }, { status: 500 });
    }
  }

  if (!isBulkKey(token)) {
    return NextResponse.json({ ok: false, error: "Invalid or missing key." }, { status: 401 });
  }
  const parsed = IngestPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid reading(s).", details: issues(parsed.error) }, { status: 422 });
  }
  try {
    const result = await ingestBulk(normalizeIngestPayload(parsed.data));
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof IngestError) return ingestErrorResponse(error);
    console.error("[ingest] bulk ingest failed:", error);
    return NextResponse.json({ ok: false, error: "Could not store the readings." }, { status: 500 });
  }
}

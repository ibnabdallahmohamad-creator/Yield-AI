import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  authenticateDevice,
  deviceFarm,
  looksLikeDeviceToken,
  parseDevicePayload,
  rateLimited,
  toDeviceReadings,
} from "@/lib/account/ingest";
import { AccountStoreError } from "@/lib/account/store";
import { env } from "@/lib/env";
import { IngestPayloadSchema, normalizeIngestPayload } from "@/lib/data/ingest";
import { IngestError, ingestReadings } from "@/lib/data/repository";

/** Requests per minute a single ESP32 may make (the shortest interval is 5 s, so 12 is normal). */
const DEVICE_REQUESTS_PER_MIN = 30;

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return (header.startsWith("Bearer ") ? header.slice(7) : (request.headers.get("x-api-key") ?? "")).trim();
}

function sharedKeyMatches(token: string): boolean {
  if (!env.ingestApiKey) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(env.ingestApiKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(request: Request): Promise<{ json: unknown } | { response: NextResponse }> {
  try {
    return { json: await request.json() };
  } catch {
    return { response: NextResponse.json({ error: "Send a JSON body." }, { status: 400 }) };
  }
}

/**
 * POST /api/readings — probe ingest.
 *
 * ESP32 devices: `Authorization: Bearer <device token>` (from pairing). Body: one reading, an array,
 * or { readings: [...], rssi?, firmware?, ip? }. No farm or probe ids needed. The reply includes
 * `interval_s`, how many seconds to wait before the next reading.
 *
 * Shared key (demo farms): `Authorization: Bearer $INGEST_API_KEY` (or `x-api-key`) with
 * `farm_id` + `sensor_id` per reading — see README → "Probe ingest".
 */
export async function POST(request: Request) {
  const token = bearer(request);
  if (!token) return NextResponse.json({ error: "Missing API key: send `Authorization: Bearer <device token>`." }, { status: 401 });

  if (looksLikeDeviceToken(token)) return deviceIngest(request, token);

  if (!env.ingestApiKey) {
    return NextResponse.json({ error: "Unknown device token. Pair the device again from the dashboard (Devices)." }, { status: 401 });
  }
  if (!sharedKeyMatches(token)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  const body = await readJson(request);
  if ("response" in body) return body.response;
  const parsed = IngestPayloadSchema.safeParse(body.json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid reading(s).",
        details: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
      },
      { status: 422 },
    );
  }
  try {
    const result = await ingestReadings(normalizeIngestPayload(parsed.data));
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof IngestError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    }
    console.error("[ingest] failed:", error);
    return NextResponse.json({ error: "Could not store the readings." }, { status: 500 });
  }
}

async function deviceIngest(request: Request, token: string) {
  const found = await authenticateDevice(token);
  if (!found) {
    return NextResponse.json({ error: "Unknown device token. Pair the device again from the dashboard (Devices)." }, { status: 401 });
  }
  const { device, registry } = found;
  const retryAfter = rateLimited(`device:${device.id}`, DEVICE_REQUESTS_PER_MIN);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: "Too many requests from this device.", interval_s: device.interval_s, retry_after_s: retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const body = await readJson(request);
  if ("response" in body) return body.response;
  const payload = parseDevicePayload(body.json);
  if (payload.readings.length === 0) {
    return NextResponse.json({ error: "Invalid reading(s).", details: payload.errors, interval_s: device.interval_s }, { status: 422 });
  }
  const farm = await deviceFarm(device, registry);
  const { readings, warnings, errors } = toDeviceReadings(payload.readings, device, farm);
  const rejected = [...payload.errors, ...errors];
  if (readings.length === 0) {
    return NextResponse.json({ error: "Invalid reading(s).", details: rejected, interval_s: device.interval_s }, { status: 422 });
  }
  try {
    const stored = await registry.recordReadings(device, readings, payload.meta, token);
    return NextResponse.json(
      {
        ok: true,
        stored,
        rejected: rejected.length ? rejected : undefined,
        warnings: warnings.length ? warnings : undefined,
        device_id: device.id,
        farm_id: device.farm_id,
        sensor_id: device.sensor_id,
        interval_s: device.interval_s,
        server_time: new Date().toISOString(),
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof AccountStoreError ? error.message : "unexpected error";
    console.error("[device] Could not store readings:", error);
    return NextResponse.json({ error: `Could not store the readings (${message}).`, interval_s: device.interval_s }, { status: 503 });
  }
}

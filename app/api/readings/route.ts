import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { IngestPayloadSchema, normalizeIngestPayload } from "@/lib/data/ingest";
import { IngestError, ingestReadings } from "@/lib/data/repository";

function authorized(request: Request): boolean {
  if (!env.ingestApiKey) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (request.headers.get("x-api-key") ?? "");
  const a = Buffer.from(token);
  const b = Buffer.from(env.ingestApiKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/readings — probe ingest for the hardware team.
 * Auth: `Authorization: Bearer $INGEST_API_KEY` (or `x-api-key`). Body: one reading, an array,
 * or { readings: [...] } — see README → "Probe ingest".
 */
export async function POST(request: Request) {
  if (!env.ingestApiKey) {
    return NextResponse.json({ error: "Ingest is disabled: set INGEST_API_KEY on the server." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = IngestPayloadSchema.safeParse(json);
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

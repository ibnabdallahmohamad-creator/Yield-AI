import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { accountFailure, jsonError, NO_STORE, readBody, requireApiUser } from "@/lib/account/api";
import { deleteDevice, listDevices, renewPairingCode, rotateToken, updateDevice } from "@/lib/account/manage";
import { DevicePatchSchema } from "@/lib/account/types";

/** GET /api/devices/[id] → { device, server_time } (the connect wizard polls it until the first reading). */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/devices/[id]">) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  try {
    const device = (await listDevices(auth.user)).find((d) => d.id === id);
    if (!device) return jsonError("That device doesn't exist.", 404);
    return NextResponse.json({ device, server_time: new Date().toISOString() }, { headers: NO_STORE });
  } catch (error) {
    return accountFailure(error, "Reading a device");
  }
}

/** PATCH /api/devices/[id] — { name?, farm_id?, interval_s?, lat?, lng? } → { device }. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/devices/[id]">) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, DevicePatchSchema);
  if ("response" in body) return body.response;
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ device: await updateDevice(auth.user, id, body.data) });
  } catch (error) {
    return accountFailure(error, "Updating a device");
  }
}

const ActionSchema = z.object({
  action: z.enum(["pairing-code", "token"], { error: 'Send { "action": "pairing-code" } or { "action": "token" }.' }),
});

/**
 * POST /api/devices/[id] — { action: "pairing-code" } → { device } with a fresh 30-minute code;
 * { action: "token" } → { device, token }: a new token (shown once), the old one stops working.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/devices/[id]">) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, ActionSchema);
  if ("response" in body) return body.response;
  const { id } = await ctx.params;
  try {
    if (body.data.action === "token") return NextResponse.json(await rotateToken(auth.user, id), { headers: NO_STORE });
    return NextResponse.json({ device: await renewPairingCode(auth.user, id) }, { headers: NO_STORE });
  } catch (error) {
    return accountFailure(error, "Renewing a device's credentials");
  }
}

/** DELETE /api/devices/[id] → { ok: true }. Its readings stay on the farm. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/devices/[id]">) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  try {
    await deleteDevice(auth.user, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return accountFailure(error, "Deleting a device");
  }
}

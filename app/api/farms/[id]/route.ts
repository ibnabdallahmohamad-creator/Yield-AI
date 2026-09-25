import { NextResponse, type NextRequest } from "next/server";
import { accountFailure, readBody, requireApiUser } from "@/lib/account/api";
import { deleteFarm, updateFarm } from "@/lib/account/manage";
import { FarmPatchSchema } from "@/lib/account/types";

/** PATCH /api/farms/[id] — change any farm field → { farm }. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/farms/[id]">) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, FarmPatchSchema);
  if ("response" in body) return body.response;
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ farm: await updateFarm(auth.user, id, body.data) });
  } catch (error) {
    return accountFailure(error, "Updating a farm");
  }
}

/** DELETE /api/farms/[id] — remove the farm with its devices and readings → { ok: true }. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/farms/[id]">) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  try {
    await deleteFarm(auth.user, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return accountFailure(error, "Deleting a farm");
  }
}

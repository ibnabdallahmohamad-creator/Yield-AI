import { NextResponse } from "next/server";
import { accountFailure, NO_STORE, readBody, requireApiUser } from "@/lib/account/api";
import { createFarm, listFarms } from "@/lib/account/manage";
import { FarmCreateSchema } from "@/lib/account/types";

/** GET /api/farms → { farms }: your account's farms (none for the demo account, whose farms are samples). */
export async function GET() {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ farms: await listFarms(auth.user) }, { headers: NO_STORE });
  } catch (error) {
    return accountFailure(error, "Listing farms");
  }
}

/**
 * POST /api/farms — add a farm to your account: { name, lat, lng, area_ha, main_crop, planting_date,
 * soil_type?, irrigation_water_ec?, region? } → 201 { farm }. The demo account can't add farms (403).
 */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, FarmCreateSchema);
  if ("response" in body) return body.response;
  try {
    return NextResponse.json({ farm: await createFarm(auth.user, body.data) }, { status: 201 });
  } catch (error) {
    return accountFailure(error, "Adding a farm");
  }
}

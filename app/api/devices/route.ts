import { networkInterfaces } from "node:os";
import { NextResponse } from "next/server";
import { accountFailure, NO_STORE, readBody, requireApiUser } from "@/lib/account/api";
import { createDevice, listDevices, setAllIntervals } from "@/lib/account/manage";
import { DeviceCreateSchema, DevicesBulkPatchSchema } from "@/lib/account/types";

/**
 * Addresses an ESP32 on the same Wi-Fi can use to reach this server when the browser is on
 * `localhost` (which means nothing to the device). Only offered in development.
 */
function lanUrls(request: Request): string[] {
  if (process.env.NODE_ENV === "production") return [];
  const url = new URL(request.url);
  const port = url.port ? `:${url.port}` : "";
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(net.address)) {
        out.push(`${url.protocol}//${net.address}${port}`);
      }
    }
  }
  return out.slice(0, 4);
}

/** GET /api/devices → { devices, server_time, lan_urls }. */
export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  try {
    const devices = await listDevices(auth.user);
    return NextResponse.json({ devices, server_time: new Date().toISOString(), lan_urls: lanUrls(request) }, { headers: NO_STORE });
  } catch (error) {
    return accountFailure(error, "Listing devices");
  }
}

/**
 * POST /api/devices — { farm_id, name?, interval_s? (default 10), lat?, lng? } → 201 { device, token }.
 * The device has a pairing code (valid 30 minutes) to type into the ESP32's setup page; `token` is
 * shown once, for flashing it into the firmware directly instead.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, DeviceCreateSchema);
  if ("response" in body) return body.response;
  try {
    return NextResponse.json(await createDevice(auth.user, body.data), { status: 201, headers: NO_STORE });
  } catch (error) {
    return accountFailure(error, "Adding a device");
  }
}

/** PATCH /api/devices — { interval_s } for every device at once → { updated, devices }. */
export async function PATCH(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const body = await readBody(request, DevicesBulkPatchSchema);
  if ("response" in body) return body.response;
  try {
    const updated = await setAllIntervals(auth.user, body.data.interval_s);
    return NextResponse.json({ updated, devices: await listDevices(auth.user) }, { headers: NO_STORE });
  } catch (error) {
    return accountFailure(error, "Changing the interval");
  }
}

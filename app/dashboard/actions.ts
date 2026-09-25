"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, type AppUser } from "@/lib/auth/session";
import { generateDeviceKey, newId } from "@/lib/device-keys";
import { nextSensorId } from "@/lib/devices";
import { DeviceInputSchema, farmIdFor, probeInsideFarm, validateFarmInput, type FarmFieldErrors } from "@/lib/farm-input";
import { forgetViewer, invalidateViewer } from "@/lib/data/repository";
import { READING_INTERVALS_S, storeFor } from "@/lib/store";
import type { Device, Farm, UserSettings } from "@/lib/types";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; fieldErrors?: FarmFieldErrors };

const DEMO_READ_ONLY =
  "The demo account is shared and shows built-in demo farms. Create your own free account to add farms and connect an ESP32.";

async function owner(): Promise<{ ok: true; user: AppUser } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session has ended. Sign in again." };
  if (user.demo) return { ok: false, error: DEMO_READ_ONLY };
  return { ok: true, user };
}

function failure(error: unknown, what: string): { ok: false; error: string } {
  console.error(`[actions] ${what} failed:`, error);
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: `Could not ${what}: ${message.length > 160 ? `${message.slice(0, 157)}…` : message}` };
}

function changed(user: AppUser) {
  forgetViewer(user.id);
  revalidatePath("/dashboard", "layout");
}

// ---------------------------------------------------------------------------
// Farms
// ---------------------------------------------------------------------------

export async function createFarmAction(input: unknown): Promise<ActionResult<{ farmId: string }>> {
  const who = await owner();
  if (!who.ok) return who;
  const checked = validateFarmInput(input);
  if (!checked.ok) return { ok: false, error: "Check the highlighted fields.", fieldErrors: checked.fieldErrors };
  const { value, geometry } = checked;
  const farm: Farm & { owner_id: string } = {
    id: farmIdFor(value.name, randomBytes(2).toString("hex")),
    owner_id: who.user.id,
    name: value.name,
    owner: who.user.name,
    lat: geometry.lat,
    lng: geometry.lng,
    area_ha: geometry.area_ha,
    main_crop: value.main_crop,
    polygon: geometry.polygon,
    region: value.region,
    planting_date: value.planting_date,
    soil_type: value.soil_type,
    theta_fc: null,
    theta_wp: null,
    elevation_m: value.elevation_m,
    ec_calibration_factor: value.ec_calibration_factor,
    irrigation_water_ec: value.irrigation_water_ec,
  };
  try {
    await storeFor(who.user).insertFarm(farm);
  } catch (error) {
    return failure(error, "save the farm");
  }
  changed(who.user);
  return { ok: true, farmId: farm.id };
}

export async function updateFarmAction(farmId: string, input: unknown): Promise<ActionResult<{ farmId: string }>> {
  const who = await owner();
  if (!who.ok) return who;
  const checked = validateFarmInput(input);
  if (!checked.ok) return { ok: false, error: "Check the highlighted fields.", fieldErrors: checked.fieldErrors };
  const { value, geometry } = checked;
  try {
    const updated = await storeFor(who.user).updateFarm(who.user.id, String(farmId), {
      name: value.name,
      main_crop: value.main_crop,
      planting_date: value.planting_date,
      soil_type: value.soil_type,
      region: value.region,
      irrigation_water_ec: value.irrigation_water_ec,
      ec_calibration_factor: value.ec_calibration_factor,
      elevation_m: value.elevation_m,
      polygon: geometry.polygon,
      area_ha: geometry.area_ha,
      lat: geometry.lat,
      lng: geometry.lng,
    });
    if (!updated) return { ok: false, error: "That farm no longer exists." };
  } catch (error) {
    return failure(error, "update the farm");
  }
  changed(who.user);
  return { ok: true, farmId };
}

export async function deleteFarmAction(farmId: string): Promise<ActionResult> {
  const who = await owner();
  if (!who.ok) return who;
  try {
    const deleted = await storeFor(who.user).deleteFarm(who.user.id, String(farmId));
    if (!deleted) return { ok: false, error: "That farm no longer exists." };
  } catch (error) {
    return failure(error, "delete the farm");
  }
  changed(who.user);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/** Register an ESP32 on a farm. The key is returned once — only its hash is stored. */
export async function createDeviceAction(input: unknown): Promise<ActionResult<{ device: Device; key: string }>> {
  const who = await owner();
  if (!who.ok) return who;
  const parsed = DeviceInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the device details." };
  const store = storeFor(who.user);
  try {
    const [farms, devices] = await Promise.all([store.listFarms(who.user.id), store.listDevices(who.user.id)]);
    const farm = farms.find((f) => f.id === parsed.data.farm_id);
    if (!farm) return { ok: false, error: "Pick one of your farms." };
    if (!probeInsideFarm(farm, parsed.data.lat, parsed.data.lng)) {
      return { ok: false, error: "Place the probe inside the field outline." };
    }
    const { key, hash, hint } = generateDeviceKey();
    const device: Device = {
      id: newId("dev"),
      owner_id: who.user.id,
      farm_id: farm.id,
      name: parsed.data.name,
      sensor_id: nextSensorId(
        farm,
        devices.filter((d) => d.farm_id === farm.id).map((d) => d.sensor_id),
      ),
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      token_hint: hint,
      created_at: new Date().toISOString(),
      last_seen_at: null,
      last_reading_at: null,
      last_ip: null,
      rssi: null,
      firmware: null,
      last_error: null,
      last_reading: null,
    };
    await store.insertDevice(device, hash);
    changed(who.user);
    return { ok: true, device, key };
  } catch (error) {
    return failure(error, "register the device");
  }
}

const DeviceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export async function updateDeviceAction(deviceId: string, input: unknown): Promise<ActionResult<{ device: Device }>> {
  const who = await owner();
  if (!who.ok) return who;
  const parsed = DeviceUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the device details." };
  const store = storeFor(who.user);
  try {
    const [farms, devices] = await Promise.all([store.listFarms(who.user.id), store.listDevices(who.user.id)]);
    const current = devices.find((d) => d.id === deviceId);
    const farm = current && farms.find((f) => f.id === current.farm_id);
    if (!current || !farm) return { ok: false, error: "That device no longer exists." };
    if (!probeInsideFarm(farm, parsed.data.lat, parsed.data.lng)) {
      return { ok: false, error: "Place the probe inside the field outline." };
    }
    const device = await store.updateDevice(who.user.id, deviceId, parsed.data);
    if (!device) return { ok: false, error: "That device no longer exists." };
    changed(who.user);
    return { ok: true, device };
  } catch (error) {
    return failure(error, "update the device");
  }
}

/** Issue a new key (e.g. the old one was lost); the old key stops working immediately. */
export async function rotateDeviceKeyAction(deviceId: string): Promise<ActionResult<{ device: Device; key: string }>> {
  const who = await owner();
  if (!who.ok) return who;
  try {
    const { key, hash, hint } = generateDeviceKey();
    const device = await storeFor(who.user).setDeviceToken(who.user.id, String(deviceId), hash, hint);
    if (!device) return { ok: false, error: "That device no longer exists." };
    changed(who.user);
    return { ok: true, device, key };
  } catch (error) {
    return failure(error, "issue a new key");
  }
}

export async function deleteDeviceAction(deviceId: string): Promise<ActionResult> {
  const who = await owner();
  if (!who.ok) return who;
  try {
    const deleted = await storeFor(who.user).deleteDevice(who.user.id, String(deviceId));
    if (!deleted) return { ok: false, error: "That device no longer exists." };
  } catch (error) {
    return failure(error, "remove the device");
  }
  changed(who.user);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const SettingsSchema = z.object({
  reading_interval_s: z
    .number()
    .int()
    .refine((v) => (READING_INTERVALS_S as readonly number[]).includes(v), { error: "Pick one of the listed intervals." }),
});

/** Reading interval: how often the ESP32s report and the dashboard refreshes. */
export async function updateSettingsAction(input: unknown): Promise<ActionResult<{ settings: UserSettings }>> {
  const who = await owner();
  if (!who.ok) return who;
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  try {
    await storeFor(who.user).saveSettings(who.user.id, parsed.data);
  } catch (error) {
    return failure(error, "save the setting");
  }
  invalidateViewer(who.user.id);
  return { ok: true, settings: parsed.data };
}

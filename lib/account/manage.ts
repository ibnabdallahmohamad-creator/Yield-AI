/**
 * Adding, changing and removing a real account's farms and ESP32 devices (the /api/farms and
 * /api/devices route handlers). Ownership is enforced by the store: every call is scoped to the
 * signed-in account.
 */
import "server-only";
import type { AppUser } from "../auth/session";
import { describeLocation, isInQatar } from "../qatar/location";
import type { Farm } from "../types";
import { invalidateAccountDashboard } from "./dashboard";
import { newDeviceId, newDeviceToken, newPairingCode, randomSuffix } from "./secrets";
import { getAccountStore, isDemoUser, NotFoundError } from "./store";
import {
  farmSlug,
  nextSensorId,
  publicDevice,
  squareFieldPolygon,
  type Device,
  type DeviceCreate,
  type DevicePatch,
  type FarmCreate,
  type FarmPatch,
} from "./types";

export const MAX_FARMS = 50;
export const MAX_DEVICES = 100;

export class AccountInputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function assertRealAccount(user: AppUser): void {
  if (isDemoUser(user)) {
    throw new AccountInputError("The demo account shows sample farms only. Create your own account to add farms and connect an ESP32.", 403);
  }
}

function regionFor(lat: number, lng: number, given?: string): string {
  if (given?.trim()) return given.trim();
  return isInQatar(lat, lng) ? describeLocation([lng, lat]).municipality : "";
}

function done(user: AppUser): void {
  invalidateAccountDashboard(user);
}

// ---------------------------------------------------------------------------
// Farms
// ---------------------------------------------------------------------------

export async function listFarms(user: AppUser): Promise<Farm[]> {
  if (isDemoUser(user)) return [];
  return getAccountStore(user).listFarms();
}

export async function createFarm(user: AppUser, input: FarmCreate): Promise<Farm> {
  assertRealAccount(user);
  const store = getAccountStore(user);
  const farms = await store.listFarms();
  if (farms.length >= MAX_FARMS) throw new AccountInputError(`An account can have up to ${MAX_FARMS} farms.`);
  const farm: Farm = {
    id: farmSlug(input.name, randomSuffix(4)),
    name: input.name,
    owner: user.name,
    lat: input.lat,
    lng: input.lng,
    area_ha: input.area_ha,
    main_crop: input.main_crop,
    polygon: squareFieldPolygon(input.lat, input.lng, input.area_ha),
    region: regionFor(input.lat, input.lng, input.region),
    planting_date: input.planting_date,
    soil_type: input.soil_type,
    theta_fc: null,
    theta_wp: null,
    elevation_m: 10,
    ec_calibration_factor: 3,
    irrigation_water_ec: input.irrigation_water_ec,
  };
  const saved = await store.insertFarm(farm);
  done(user);
  return saved;
}

export async function updateFarm(user: AppUser, id: string, patch: FarmPatch): Promise<Farm> {
  assertRealAccount(user);
  const store = getAccountStore(user);
  const current = (await store.listFarms()).find((f) => f.id === id);
  if (!current) throw new NotFoundError("That farm doesn't exist.");
  const next: Partial<Farm> = { ...patch };
  const lat = patch.lat ?? current.lat;
  const lng = patch.lng ?? current.lng;
  const area = patch.area_ha ?? current.area_ha;
  if (patch.lat !== undefined || patch.lng !== undefined || patch.area_ha !== undefined) {
    next.polygon = squareFieldPolygon(lat, lng, area);
    if (patch.region === undefined) next.region = regionFor(lat, lng);
  }
  const saved = await store.updateFarm(id, next);
  if (!saved) throw new NotFoundError("That farm doesn't exist.");
  done(user);
  return saved;
}

export async function deleteFarm(user: AppUser, id: string): Promise<void> {
  assertRealAccount(user);
  if (!(await getAccountStore(user).deleteFarm(id))) throw new NotFoundError("That farm doesn't exist.");
  done(user);
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export interface CreatedDevice {
  device: Device;
  /** Show once: the device can also be flashed with this token instead of pairing. */
  token: string;
}

export async function listDevices(user: AppUser): Promise<Device[]> {
  if (isDemoUser(user)) return [];
  return (await getAccountStore(user).listDevices()).map(publicDevice);
}

export async function createDevice(user: AppUser, input: DeviceCreate): Promise<CreatedDevice> {
  assertRealAccount(user);
  const store = getAccountStore(user);
  const [farms, devices] = await Promise.all([store.listFarms(), store.listDevices()]);
  if (!farms.some((f) => f.id === input.farm_id)) throw new AccountInputError("Choose one of your farms first.");
  if (devices.length >= MAX_DEVICES) throw new AccountInputError(`An account can have up to ${MAX_DEVICES} devices.`);
  const token = newDeviceToken();
  const pairing = newPairingCode();
  const saved = await store.insertDevice({
    id: newDeviceId(),
    farm_id: input.farm_id,
    name: input.name,
    sensor_id: nextSensorId(devices.filter((d) => d.farm_id === input.farm_id).map((d) => d.sensor_id)),
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    interval_s: input.interval_s,
    token_hash: token.hash,
    token_hint: token.hint,
    pairing_code: pairing.code,
    pairing_expires_at: pairing.expiresAt,
  });
  done(user);
  return { device: publicDevice(saved), token: token.token };
}

export async function updateDevice(user: AppUser, id: string, patch: DevicePatch): Promise<Device> {
  assertRealAccount(user);
  const store = getAccountStore(user);
  const devices = await store.listDevices();
  const current = devices.find((d) => d.id === id);
  if (!current) throw new NotFoundError("That device doesn't exist.");
  const update: Parameters<typeof store.updateDevice>[1] = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.interval_s !== undefined) update.interval_s = patch.interval_s;
  if (patch.lat !== undefined) update.lat = patch.lat;
  if (patch.lng !== undefined) update.lng = patch.lng;
  if (patch.farm_id !== undefined && patch.farm_id !== current.farm_id) {
    const farms = await store.listFarms();
    if (!farms.some((f) => f.id === patch.farm_id)) throw new AccountInputError("Choose one of your farms.");
    update.farm_id = patch.farm_id;
    update.sensor_id = nextSensorId(devices.filter((d) => d.farm_id === patch.farm_id).map((d) => d.sensor_id));
    // A new field: the old position no longer applies.
    if (patch.lat === undefined) update.lat = null;
    if (patch.lng === undefined) update.lng = null;
  }
  const saved = await store.updateDevice(id, update);
  if (!saved) throw new NotFoundError("That device doesn't exist.");
  done(user);
  return publicDevice(saved);
}

/** One interval for every device (the status menu's "Update every" picker). */
export async function setAllIntervals(user: AppUser, interval_s: number): Promise<number> {
  assertRealAccount(user);
  const count = await getAccountStore(user).updateAllDevices({ interval_s });
  done(user);
  return count;
}

/** A fresh pairing code (e.g. the old one expired, or the device was reset). The current token keeps working until the code is claimed. */
export async function renewPairingCode(user: AppUser, id: string): Promise<Device> {
  assertRealAccount(user);
  const pairing = newPairingCode();
  const saved = await getAccountStore(user).updateDevice(id, { pairing_code: pairing.code, pairing_expires_at: pairing.expiresAt });
  if (!saved) throw new NotFoundError("That device doesn't exist.");
  done(user);
  return publicDevice(saved);
}

/** A new token (for flashing it into the firmware directly). The previous token stops working. */
export async function rotateToken(user: AppUser, id: string): Promise<CreatedDevice> {
  assertRealAccount(user);
  const token = newDeviceToken();
  const saved = await getAccountStore(user).updateDevice(id, { token_hash: token.hash, token_hint: token.hint });
  if (!saved) throw new NotFoundError("That device doesn't exist.");
  done(user);
  return { device: publicDevice(saved), token: token.token };
}

export async function deleteDevice(user: AppUser, id: string): Promise<void> {
  assertRealAccount(user);
  if (!(await getAccountStore(user).deleteDevice(id))) throw new NotFoundError("That device doesn't exist.");
  done(user);
}

/**
 * What an ESP32 sends: POST /api/readings with `Authorization: Bearer <device token>` and one reading,
 * an array of readings, or { readings: [...], rssi?, firmware?, ip? }. The token says which farm and
 * probe the readings belong to, so the device never sends ids. The reply tells the device how often
 * to send (`interval_s`), which the owner can change from the dashboard at any time.
 */
import "server-only";
import { z } from "zod";
import { normalizeDeviceUnits } from "../ai/esp32-units";
import type { AppUser } from "../auth/session";
import type { Farm, SensorReading } from "../types";
import { localDeviceRegistry } from "./local-store";
import { hashDeviceToken, newDeviceToken } from "./secrets";
import { deviceRegistries, getAccountStore, type DeviceMeta, type DeviceRegistry } from "./store";
import { DEVICE_TOKEN_PREFIX, normalizePairingCode, type StoredDevice } from "./types";

const num = z.coerce.number().refine(Number.isFinite, "must be a number");
/** Readings older than this are refused (a device replaying a very old buffer). */
const MAX_AGE_MS = 30 * 86_400_000;
/** Before this the device's clock was clearly never set (e.g. 1970 after a reboot without NTP). */
const CLOCK_FLOOR_MS = Date.parse("2024-01-01T00:00:00Z");
const MAX_READINGS = 500;

/** Common names in ESP32 sketches → our field names (units noted where they differ). */
const ALIASES: Record<string, string> = {
  soil_moisture: "moisture",
  soil_temp: "temperature",
  soil_temperature: "temperature",
  ec_ms_cm: "ec",
  nitrogen: "n",
  phosphorus: "p",
  potassium: "k",
  air_temperature: "air_temp",
  humidity: "air_humidity",
};

function withAliases(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const [alias, field] of Object.entries(ALIASES)) {
    if (out[field] === undefined && out[alias] !== undefined) out[field] = out[alias];
  }
  return out;
}

export const DeviceReadingSchema = z.preprocess(
  (value) => withAliases(normalizeDeviceUnits(value)),
  z
    .object({
      /** ISO 8601 with offset, or Unix time in seconds (or ms). Defaults to when the server receives it. */
      timestamp: z.union([z.iso.datetime({ offset: true }), num]).optional(),
      /** Seconds since the reading was taken, for buffered readings from a device without a clock. */
      age_s: num.min(0).max(MAX_AGE_MS / 1000).optional(),
      moisture: num.min(0).max(100).nullish(),
      temperature: num.min(-20).max(80).nullish(),
      ec: num.min(0).max(100).nullish(),
      ec_us_cm: num.min(0).max(100000).nullish(),
      ph: num.min(0).max(14).nullish(),
      n: num.min(0).max(5000).nullish(),
      p: num.min(0).max(5000).nullish(),
      k: num.min(0).max(10000).nullish(),
      air_temp: num.min(-20).max(70).nullish(),
      air_humidity: num.min(0).max(100).nullish(),
    })
    .refine((r) => [r.moisture, r.temperature, r.ec, r.ec_us_cm, r.ph, r.n, r.p, r.k, r.air_temp, r.air_humidity].some((v) => v != null), {
      message: "Send at least one measurement (moisture, temperature, ec or ec_us_cm, ph, n, p, k, air_temp or air_humidity).",
    }),
);
export type DeviceReading = z.infer<typeof DeviceReadingSchema>;

const MetaSchema = z.object({
  rssi: num.min(-127).max(0).optional().catch(undefined),
  firmware: z.string().max(40).optional().catch(undefined),
  ip: z.string().max(45).optional().catch(undefined),
});

/** Split any accepted body shape into readings and device metadata, with per-reading errors. */
export function parseDevicePayload(json: unknown): { readings: DeviceReading[]; meta: DeviceMeta; errors: string[] } {
  let items: unknown[];
  let metaSource: unknown = {};
  if (Array.isArray(json)) items = json;
  else if (json && typeof json === "object" && Array.isArray((json as { readings?: unknown }).readings)) {
    items = (json as { readings: unknown[] }).readings;
    metaSource = json;
  } else if (json && typeof json === "object") {
    items = [json];
    metaSource = json;
  } else return { readings: [], meta: {}, errors: ["Send a JSON object with at least one measurement."] };

  if (items.length === 0) return { readings: [], meta: {}, errors: ["`readings` is empty."] };
  if (items.length > MAX_READINGS) return { readings: [], meta: {}, errors: [`Send at most ${MAX_READINGS} readings per request.`] };

  const readings: DeviceReading[] = [];
  const errors: string[] = [];
  items.forEach((item, i) => {
    const parsed = DeviceReadingSchema.safeParse(item);
    if (parsed.success) readings.push(parsed.data);
    else for (const issue of parsed.error.issues.slice(0, 5)) errors.push(`${items.length > 1 ? `readings[${i}]` : "reading"}${issue.path.length ? `.${issue.path.join(".")}` : ""}: ${issue.message}`);
  });
  const meta = MetaSchema.safeParse(metaSource);
  const m = meta.success ? meta.data : {};
  return { readings, meta: { rssi: m.rssi ?? null, firmware: m.firmware ?? null, local_ip: m.ip ?? null }, errors };
}

/** Readings with the device's farm, probe id and position, and a sane timestamp. */
export function toDeviceReadings(
  items: DeviceReading[],
  device: Pick<StoredDevice, "farm_id" | "sensor_id" | "lat" | "lng">,
  farm: Pick<Farm, "lat" | "lng"> | null,
  now = Date.now(),
): { readings: SensorReading[]; warnings: string[]; errors: string[] } {
  const readings: SensorReading[] = [];
  const warnings = new Set<string>();
  const errors: string[] = [];
  items.forEach((item, i) => {
    const fallback = now - (item.age_s ?? 0) * 1000;
    let t = fallback;
    if (item.timestamp !== undefined) {
      const parsed = typeof item.timestamp === "number" ? (item.timestamp > 1e11 ? item.timestamp : item.timestamp * 1000) : Date.parse(item.timestamp);
      if (!Number.isFinite(parsed) || parsed < CLOCK_FLOOR_MS) warnings.add("The device clock isn't set (no NTP?), so the server's time was used.");
      else if (parsed > now + 5 * 60_000) warnings.add("The device clock is ahead of the server's, so the server's time was used.");
      else t = parsed;
    }
    if (now - t > MAX_AGE_MS) {
      errors.push(`${items.length > 1 ? `readings[${i}]` : "reading"}: older than 30 days`);
      return;
    }
    readings.push({
      farm_id: device.farm_id,
      sensor_id: device.sensor_id,
      lat: device.lat ?? farm?.lat ?? 0,
      lng: device.lng ?? farm?.lng ?? 0,
      timestamp: new Date(Math.round(t)).toISOString(),
      moisture: item.moisture ?? null,
      temperature: item.temperature ?? null,
      ec: item.ec ?? (item.ec_us_cm != null ? item.ec_us_cm / 1000 : null),
      ph: item.ph ?? null,
      n: item.n ?? null,
      p: item.p ?? null,
      k: item.k ?? null,
      air_temp: item.air_temp ?? null,
      air_humidity: item.air_humidity ?? null,
    });
  });
  return { readings, warnings: [...warnings], errors };
}

export function looksLikeDeviceToken(token: string): boolean {
  return token.startsWith(DEVICE_TOKEN_PREFIX) && token.length >= 20 && token.length <= 100;
}

/** The provider an account store is looked up with, from the registry that knows the device. */
function ownerOf(device: StoredDevice, registry: DeviceRegistry): Pick<AppUser, "id" | "provider"> {
  return { id: device.owner_id, provider: registry === localDeviceRegistry ? "local" : "supabase" };
}

export async function authenticateDevice(token: string): Promise<{ device: StoredDevice; registry: DeviceRegistry } | null> {
  const hash = hashDeviceToken(token);
  for (const registry of deviceRegistries()) {
    try {
      const device = await registry.findByToken(hash, token);
      if (device) return { device, registry };
    } catch (error) {
      console.warn("[device] Token lookup failed:", error instanceof Error ? error.message : error);
    }
  }
  return null;
}

/** The device's farm (for its default position). Null if the farm is gone. */
export async function deviceFarm(device: StoredDevice, registry: DeviceRegistry): Promise<Farm | null> {
  try {
    const farms = await getAccountStore(ownerOf(device, registry)).listFarms();
    return farms.find((f) => f.id === device.farm_id) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rate limits (per process): a device may send at most 30 requests a minute; pairing 10 tries a minute per IP
// ---------------------------------------------------------------------------

const windows = new Map<string, { start: number; count: number }>();

export function rateLimited(key: string, limit: number, windowMs = 60_000, now = Date.now()): number | null {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    return null;
  }
  w.count++;
  return w.count > limit ? Math.ceil((w.start + windowMs - now) / 1000) : null;
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

export interface PairResult {
  device: StoredDevice;
  token: string;
}

/** Claim a pairing code for a device: returns its new token (shown to the device once). */
export async function pairDevice(rawCode: string, meta: DeviceMeta): Promise<PairResult | null> {
  const code = normalizePairingCode(rawCode);
  if (code.length !== 8) return null;
  const token = newDeviceToken();
  for (const registry of deviceRegistries()) {
    try {
      const device = await registry.claimPairingCode(code, { hash: token.hash, hint: token.hint, token: token.token }, meta);
      if (device) return { device, token: token.token };
    } catch (error) {
      console.warn("[device] Pairing lookup failed:", error instanceof Error ? error.message : error);
    }
  }
  return null;
}

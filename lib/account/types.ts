/**
 * A real account's own farms and ESP32 devices (client-safe: shapes, schemas and pure helpers).
 * The shared demo account keeps the built-in demo dataset; every other account starts empty and
 * only ever sees what it adds and what its devices send. See README → "Your farms and ESP32 devices".
 */
import { z } from "zod";
import { CROP_IDS, type CropId } from "../agronomy-tables";
import { METERS_PER_DEG_LAT, METERS_PER_DEG_LNG_EQUATOR, type GeoPolygon } from "../geo";

/** How often an ESP32 may send readings (and the dashboard refreshes), seconds. */
export const INTERVAL_OPTIONS_S = [5, 10, 30, 60, 300, 900] as const;
export const DEFAULT_INTERVAL_S = 10;
export const MIN_INTERVAL_S = 5;
export const MAX_INTERVAL_S = 3600;

export function intervalLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

/** Device tokens start with this prefix, so the ingest endpoint can tell them from INGEST_API_KEY. */
export const DEVICE_TOKEN_PREFIX = "yd_";
/** Pairing codes: 8 characters without look-alikes (0/O, 1/I/L), shown as XXXX-XXXX. */
export const PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const PAIRING_TTL_MS = 30 * 60_000;

/** Normalise what a person typed ("abcd efgh", "ABCD-EFGH") to the stored form "ABCDEFGH". */
export function normalizePairingCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function formatPairingCode(code: string): string {
  const c = normalizePairingCode(code);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export type DeviceStatus = "waiting" | "paired" | "online" | "offline";

/** An ESP32 as the browser sees it (never the token or its hash). */
export interface Device {
  id: string;
  farm_id: string;
  name: string;
  /** The probe id its readings are stored under (unique per farm), e.g. "ESP32-1". */
  sensor_id: string;
  /** Position in the field; null = the farm centre. */
  lat: number | null;
  lng: number | null;
  /** How often the device sends a reading, seconds. The device learns it from every ingest reply. */
  interval_s: number;
  /** Last 4 characters of the token, to tell tokens apart. */
  token_hint: string;
  /** Present until the device pairs (or the code expires). */
  pairing_code: string | null;
  pairing_expires_at: string | null;
  created_at: string;
  paired_at: string | null;
  last_seen_at: string | null;
  firmware: string | null;
  /** Wi-Fi signal strength the device reported, dBm. */
  rssi: number | null;
  /** Local IP the device reported on its Wi-Fi, e.g. "192.168.1.42". */
  local_ip: string | null;
  readings_count: number;
}

/** A device row as stored (adds the owner and the token hash). */
export interface StoredDevice extends Device {
  owner_id: string;
  token_hash: string;
}

export function publicDevice(d: StoredDevice): Device {
  const { owner_id: _owner, token_hash: _hash, ...rest } = d;
  return rest;
}

/**
 * online: a reading within three intervals (at least 45 s); offline: seen before but quiet since;
 * paired: the device has claimed its code but not sent a reading yet; waiting: not paired yet.
 */
export function deviceStatus(d: Pick<Device, "last_seen_at" | "paired_at" | "interval_s">, now = Date.now()): DeviceStatus {
  if (d.last_seen_at) {
    const quietFor = now - Date.parse(d.last_seen_at);
    return quietFor <= Math.max(45_000, d.interval_s * 3000) ? "online" : "offline";
  }
  return d.paired_at ? "paired" : "waiting";
}

export const DEVICE_STATUS_LABEL: Record<DeviceStatus, string> = {
  waiting: "Waiting to pair",
  paired: "Paired · waiting for the first reading",
  online: "Online",
  offline: "Offline",
};

// ---------------------------------------------------------------------------
// Request schemas (browser → /api/farms, /api/devices; ESP32 → /api/device/pair)
// ---------------------------------------------------------------------------

const lat = z.number({ error: "Latitude must be a number." }).min(-90, "Latitude must be between -90 and 90.").max(90, "Latitude must be between -90 and 90.");
const lng = z.number({ error: "Longitude must be a number." }).min(-180, "Longitude must be between -180 and 180.").max(180, "Longitude must be between -180 and 180.");
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-01.");

const soilType = z.enum(["sand", "loamy_sand"], { error: "Choose a soil type." });
const waterEc = z.number({ error: "Water EC must be a number." }).min(0).max(60, "Water EC must be 60 dS/m or less.");

const FarmFields = z.object({
  name: z.string().trim().min(2, "Give the farm a name (at least 2 characters).").max(80, "Keep the name under 80 characters."),
  lat,
  lng,
  area_ha: z.number({ error: "Area must be a number." }).positive("Area must be more than 0 ha.").max(5000, "Area must be 5,000 ha or less."),
  main_crop: z.enum(CROP_IDS as [CropId, ...CropId[]], { error: "Choose a crop." }),
  planting_date: isoDay,
  soil_type: soilType,
  irrigation_water_ec: waterEc,
  region: z.string().trim().max(80).optional(),
});

export const FarmCreateSchema = FarmFields.extend({ soil_type: soilType.default("sand"), irrigation_water_ec: waterEc.default(1.5) });
export type FarmCreate = z.infer<typeof FarmCreateSchema>;

// No defaults here: a partial update must not reset fields it doesn't mention.
export const FarmPatchSchema = FarmFields.partial().refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });
export type FarmPatch = z.infer<typeof FarmPatchSchema>;

const interval = z
  .number({ error: "The interval must be a number of seconds." })
  .int("Use whole seconds.")
  .min(MIN_INTERVAL_S, `Readings can come at most every ${MIN_INTERVAL_S} s.`)
  .max(MAX_INTERVAL_S, "Readings must come at least once an hour.");

export const DeviceCreateSchema = z.object({
  farm_id: z.string({ error: "Choose a farm." }).min(1, "Choose a farm.").max(64),
  name: z.string().trim().min(1, "Give the device a name.").max(60, "Keep the name under 60 characters.").default("ESP32 probe"),
  interval_s: interval.default(DEFAULT_INTERVAL_S),
  lat: lat.nullable().optional(),
  lng: lng.nullable().optional(),
});
export type DeviceCreate = z.infer<typeof DeviceCreateSchema>;

export const DevicePatchSchema = z
  .object({
    name: z.string().trim().min(1, "Give the device a name.").max(60).optional(),
    farm_id: z.string().min(1).max(64).optional(),
    interval_s: interval.optional(),
    lat: lat.nullable().optional(),
    lng: lng.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });
export type DevicePatch = z.infer<typeof DevicePatchSchema>;

/** PATCH /api/devices — change every device's interval at once (the status menu's picker). */
export const DevicesBulkPatchSchema = z.object({ interval_s: interval });

export const PairRequestSchema = z.object({
  code: z.string({ error: "Send the pairing code." }).min(4).max(20),
  firmware: z.string().max(40).optional(),
  mac: z.string().max(40).optional(),
});

// ---------------------------------------------------------------------------
// Farm helpers
// ---------------------------------------------------------------------------

/** A square field of `area_ha` centred on the point — the map's outline until a real one is drawn. */
export function squareFieldPolygon(latC: number, lngC: number, area_ha: number): GeoPolygon {
  const half = Math.sqrt(Math.max(area_ha, 0.01) * 10_000) / 2;
  const dLat = half / METERS_PER_DEG_LAT;
  const dLng = half / (METERS_PER_DEG_LNG_EQUATOR * Math.cos((latC * Math.PI) / 180));
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    type: "Polygon",
    coordinates: [
      [
        [r(lngC - dLng), r(latC - dLat)],
        [r(lngC + dLng), r(latC - dLat)],
        [r(lngC + dLng), r(latC + dLat)],
        [r(lngC - dLng), r(latC + dLat)],
        [r(lngC - dLng), r(latC - dLat)],
      ],
    ],
  };
}

/** Farm ids are short slugs of the name plus a random suffix, e.g. "al-khor-greenhouse-7kq2". */
export function farmSlug(name: string, suffix: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "farm"}-${suffix}`;
}

/** The next free "ESP32-n" probe id on a farm. */
export function nextSensorId(taken: string[]): string {
  const used = new Set(taken.map((s) => s.toUpperCase()));
  for (let i = 1; ; i++) if (!used.has(`ESP32-${i}`)) return `ESP32-${i}`;
}

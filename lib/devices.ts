/**
 * Client-safe device helpers: connection status and probe naming. Keys live in device-keys.ts.
 */
import type { Device, Farm } from "./types";

export type DeviceState = "online" | "probe-error" | "offline" | "never";

/** A device counts as online if it reported within three intervals (and at least 45 s). */
export function onlineWindowMs(intervalS: number): number {
  return Math.max(45_000, (3 * intervalS + 15) * 1000);
}

export function deviceState(device: Pick<Device, "last_seen_at" | "last_error">, intervalS: number, now: number): DeviceState {
  if (!device.last_seen_at) return "never";
  if (now - Date.parse(device.last_seen_at) > onlineWindowMs(intervalS)) return "offline";
  return device.last_error ? "probe-error" : "online";
}

export const DEVICE_STATE_LABEL: Record<DeviceState, string> = {
  online: "Online",
  "probe-error": "Online · probe problem",
  offline: "Offline",
  never: "Not connected yet",
};

/** Wi-Fi signal quality from RSSI (dBm): 0–4 bars. */
export function signalBars(rssi: number | null): number {
  if (rssi == null) return 0;
  if (rssi >= -55) return 4;
  if (rssi >= -67) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -85) return 1;
  return 0;
}

const GENERIC_WORDS = new Set(["farm", "farms", "the", "field", "fields", "and", "of"]);

/** Probe id prefix from the farm name: "Al Khor North Farm" → "AKN". */
export function probePrefix(farmName: string): string {
  const words = farmName
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w && !GENERIC_WORDS.has(w.toLowerCase()));
  const prefix = words
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return prefix || "P";
}

/** The next free probe id on a farm: AKN-01, AKN-02, … */
export function nextSensorId(farm: Pick<Farm, "name">, existing: string[]): string {
  const prefix = probePrefix(farm.name);
  const taken = new Set(existing.map((s) => s.toUpperCase()));
  for (let i = 1; i < 1000; i++) {
    const id = `${prefix}-${String(i).padStart(2, "0")}`;
    if (!taken.has(id)) return id;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

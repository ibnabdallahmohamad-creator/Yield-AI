/**
 * Device keys: each ESP32 authenticates with its own random key ("yai_…"). Only the SHA-256 of
 * the key is stored, so a leaked database cannot be used to post readings.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";

export const DEVICE_KEY_PREFIX = "yai_";

export function generateDeviceKey(): { key: string; hash: string; hint: string } {
  const key = `${DEVICE_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { key, hash: hashDeviceKey(key), hint: key.slice(-4) };
}

export function hashDeviceKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

export function looksLikeDeviceKey(value: string): boolean {
  return value.startsWith(DEVICE_KEY_PREFIX) && value.length >= 20 && value.length <= 100;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

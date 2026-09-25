/** Device tokens, pairing codes and ids. Only token hashes are stored. */
import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { DEVICE_TOKEN_PREFIX, PAIRING_ALPHABET, PAIRING_TTL_MS } from "./types";

export function newDeviceToken(): { token: string; hash: string; hint: string } {
  const token = `${DEVICE_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { token, hash: hashDeviceToken(token), hint: token.slice(-4) };
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

export function newPairingCode(now = Date.now()): { code: string; expiresAt: string } {
  let code = "";
  for (let i = 0; i < 8; i++) code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  return { code, expiresAt: new Date(now + PAIRING_TTL_MS).toISOString() };
}

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function randomSuffix(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return out;
}

export const newDeviceId = () => `dev_${randomSuffix(12)}`;

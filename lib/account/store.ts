/**
 * Which data an account sees, and where a real account's farms, devices and readings are stored.
 *
 * The shared demo account ("Try the demo account") keeps the built-in demo dataset (or the seeded
 * Supabase demo farms). Every other account is a real one: it starts with no farms at all, never
 * sees demo farms or simulated readings, and only shows what it adds and what its ESP32s send.
 */
import "server-only";
import type { AppUser } from "../auth/session";
import { DEMO_ACCOUNT, env } from "../env";
import type { AccountStore, DeviceRegistry } from "./core";
import { LocalAccountStore, localDeviceRegistry } from "./local-store";
import { SupabaseAccountStore, supabaseDeviceRegistry } from "./supabase-store";

export * from "./core";

/** The local demo account's id (lib/auth/local-users.ts). */
export const LOCAL_DEMO_USER_ID = "local-demo";

export function isDemoUser(user: Pick<AppUser, "id" | "email">): boolean {
  return user.id === LOCAL_DEMO_USER_ID || user.email.trim().toLowerCase() === DEMO_ACCOUNT.email.trim().toLowerCase();
}

/** Supabase users keep their farms in Supabase; local accounts in `.data/`. */
export function getAccountStore(user: Pick<AppUser, "id" | "provider">): AccountStore {
  if (user.provider === "supabase" && env.supabaseConfigured) return new SupabaseAccountStore(user.id);
  return new LocalAccountStore(user.id);
}

/**
 * Device tokens are looked up in both places: a local account's ESP32 and a Supabase account's
 * ESP32 may talk to the same server.
 */
export function deviceRegistries(): DeviceRegistry[] {
  const out: DeviceRegistry[] = [localDeviceRegistry];
  if (env.supabaseConfigured && env.supabaseServiceRoleKey) out.unshift(supabaseDeviceRegistry);
  return out;
}

/**
 * Which store holds an account's data. Supabase accounts keep their farms in Supabase; local
 * accounts (no Supabase, USE_MOCK=true, or Supabase unreachable at sign-up) in `.data/`.
 */
import "server-only";
import { env } from "../env";
import { getLocalStore } from "./local";
import { SupabaseStore } from "./supabase";
import type { DataStore } from "./types";

let supabaseStore: SupabaseStore | null = null;

function supabase(): SupabaseStore {
  supabaseStore ??= new SupabaseStore();
  return supabaseStore;
}

export function localStore(): DataStore {
  return getLocalStore(env.localDataDir);
}

export function storeFor(user: { provider: "supabase" | "local" }): DataStore {
  return user.provider === "supabase" && !env.localData ? supabase() : localStore();
}

/** Stores a device key may belong to, most likely first. */
export function deviceStores(): DataStore[] {
  return env.localData ? [localStore()] : [supabase(), localStore()];
}

/** Where shared server data (the weather forecast) is cached across instances. */
export function sharedStore(): DataStore {
  return env.localData || !env.supabaseServiceRoleKey ? localStore() : supabase();
}

/** Device ingest into Supabase needs the service role key. */
export function deviceIngestAvailable(store: DataStore): boolean {
  return store.kind === "local" || Boolean(env.supabaseServiceRoleKey);
}

export type { DataStore } from "./types";
export { DEFAULT_SETTINGS, READING_INTERVALS_S, StoreError } from "./types";

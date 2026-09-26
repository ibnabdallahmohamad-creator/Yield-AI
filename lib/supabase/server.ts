/**
 * Supabase clients for server code. The browser never talks to Supabase directly: pages,
 * route handlers and server actions do, so keys stay on the server.
 */
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "../env";

/** Client bound to the signed-in user's session cookies (RLS applies). */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only; proxy.ts refreshes sessions.
        }
      },
    },
  });
}

/** Service-role client for trusted server work (data reads after our own auth check, ingest, admin). */
export function createSupabaseAdminClient(): SupabaseClient | null {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client with only the publishable (anon) key and no session: for the ESP32 database functions. */
export function createSupabaseAnonClient(): SupabaseClient | null {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client for data reads: service role when available, otherwise the user's session. */
export async function createSupabaseDataClient(): Promise<SupabaseClient | null> {
  return createSupabaseAdminClient() ?? (await createSupabaseServerClient());
}

/** Resolve a promise or give up after `ms` — Supabase calls must never hang a page. */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

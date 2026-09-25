/**
 * Who is signed in. Supabase Auth when configured; local accounts (signed cookie) otherwise,
 * or when Supabase cannot be reached — sign-in must never block the demo.
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isDemoEmail } from "../env";
import { createSupabaseServerClient, withTimeout } from "../supabase/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, hasSupabaseAuthCookie, signSessionToken, verifySessionToken } from "./token";

export interface AppUser {
  id: string;
  email: string;
  name: string;
  provider: "supabase" | "local";
  /** The shared demo account: sees the built-in demo farms and cannot add its own. */
  demo: boolean;
}

/** Supabase verification budget; past it we treat the Supabase session as absent. */
const SUPABASE_AUTH_TIMEOUT_MS = 3500;

export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const cookieStore = await cookies();
  const local = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (local) {
    return { id: local.sub, email: local.email, name: local.name || local.email, provider: "local", demo: isDemoEmail(local.email) };
  }

  if (!hasSupabaseAuthCookie(cookieStore.getAll().map((c) => c.name))) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  try {
    const { data } = await withTimeout(supabase.auth.getClaims(), SUPABASE_AUTH_TIMEOUT_MS, "Supabase getClaims");
    const claims = data?.claims;
    if (!claims?.sub) return null;
    const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
    const email = typeof claims.email === "string" ? claims.email : "";
    return {
      id: claims.sub,
      email,
      name: typeof meta.name === "string" && meta.name ? meta.name : email,
      provider: "supabase",
      demo: isDemoEmail(email),
    };
  } catch (error) {
    console.warn("[auth] Supabase session check failed:", error instanceof Error ? error.message : error);
    return null;
  }
});

/** For pages: the signed-in user, or a redirect to /login that comes back here afterwards. */
export async function requireUser(nextPath = "/dashboard"): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

/** Whether the current request came over HTTPS (so the cookie can be marked Secure). */
async function isSecureRequest(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  const origin = h.get("origin") ?? h.get("referer") ?? "";
  return origin.startsWith("https://");
}

export async function startLocalSession(user: { id: string; email: string; name: string }): Promise<void> {
  const token = await signSessionToken({ sub: user.id, email: user.email, name: user.name });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: await isSecureRequest(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
}

export async function endSessions(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  if (!hasSupabaseAuthCookie(cookieStore.getAll().map((c) => c.name))) return;
  const supabase = await createSupabaseServerClient();
  try {
    if (supabase) await withTimeout(supabase.auth.signOut(), SUPABASE_AUTH_TIMEOUT_MS, "Supabase signOut");
  } catch {
    // Supabase unreachable: clear its cookies ourselves.
  }
  for (const c of cookieStore.getAll()) {
    if (c.name.startsWith("sb-") && c.name.includes("-auth-token")) cookieStore.delete(c.name);
  }
}

/** Only allow same-site relative paths as post-login destinations. */
export function safeNextPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}

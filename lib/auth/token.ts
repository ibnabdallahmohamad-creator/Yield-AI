/**
 * Signed session token for local accounts (used when Supabase Auth is not configured or not
 * reachable). HS256 JWT in an HttpOnly cookie. Kept free of `server-only` so proxy.ts can use it.
 */
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "yai_session";
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

/**
 * Development fallback — public in the repository. Set AUTH_SECRET in production
 * (`openssl rand -base64 32`). Without it, a deployment that has SUPABASE_SERVICE_ROLE_KEY signs
 * with a key derived from that secret instead, so cookies can't be forged where real data is readable.
 */
export const DEV_AUTH_SECRET = "yield-ai-dev-secret-change-me-in-production-0123456789";

export interface SessionPayload {
  sub: string;
  email: string;
  name: string;
}

const encoder = new TextEncoder();

async function secretKey(): Promise<Uint8Array> {
  const explicit = process.env.AUTH_SECRET?.trim();
  if (explicit) return encoder.encode(explicit);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceKey) {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`yield-ai-session:${serviceKey}`)));
  }
  return encoder.encode(DEV_AUTH_SECRET);
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, name: payload.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(await secretKey());
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return { sub: payload.sub, email: payload.email, name: typeof payload.name === "string" ? payload.name : "" };
  } catch {
    return null;
  }
}

/** Supabase auth cookies are named `sb-<project-ref>-auth-token` (optionally chunked `.0`, `.1`). */
export function hasSupabaseAuthCookie(names: string[]): boolean {
  return names.some((name) => name.startsWith("sb-") && name.includes("-auth-token"));
}

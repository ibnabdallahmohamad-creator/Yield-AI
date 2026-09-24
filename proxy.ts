/**
 * Optimistic auth gate (Next.js 16 Proxy): keeps signed-out visitors out of /dashboard and
 * refreshes Supabase session cookies. Pages, route handlers and server actions still verify
 * the session themselves (lib/auth/session.ts).
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, hasSupabaseAuthCookie, verifySessionToken } from "@/lib/auth/token";

const SUPABASE_TIMEOUT_MS = 3000;

async function hasSupabaseSession(request: NextRequest, response: { current: NextResponse }): Promise<boolean> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !hasSupabaseAuthCookie(request.cookies.getAll().map((c) => c.name))) return false;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response.current = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.current.cookies.set(name, value, options);
      },
    },
  });
  try {
    const result = await Promise.race([
      supabase.auth.getClaims(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SUPABASE_TIMEOUT_MS)),
    ]);
    return Boolean(result?.data?.claims?.sub);
  } catch {
    return false;
  }
}

function redirectTo(request: NextRequest, pathname: string, from: NextResponse, search?: Record<string, string>) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  for (const [k, v] of Object.entries(search ?? {})) url.searchParams.set(k, v);
  const redirect = NextResponse.redirect(url);
  // Keep any refreshed Supabase cookies.
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export async function proxy(request: NextRequest) {
  const response = { current: NextResponse.next({ request }) };
  const local = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  const signedIn = Boolean(local) || (await hasSupabaseSession(request, response));
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/dashboard") && !signedIn) {
    return redirectTo(request, "/login", response.current, { next: `${pathname}${search}` });
  }
  if ((pathname === "/login" || pathname === "/signup") && signedIn) {
    const next = request.nextUrl.searchParams.get("next");
    const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    const url = new URL(target, request.url);
    return redirectTo(request, url.pathname, response.current, Object.fromEntries(url.searchParams));
  }
  return response.current;
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};

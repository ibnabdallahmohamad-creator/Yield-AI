import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/session";
import { createSupabaseServerClient, withTimeout } from "@/lib/supabase/server";

const SUPABASE_TIMEOUT_MS = 6000;

function loginWith(notice: "confirmed" | "link-expired", next: string): string {
  const params = new URLSearchParams({ notice });
  if (next !== "/dashboard") params.set("next", next);
  return `/login?${params}`;
}

/**
 * GET /auth/confirm — where Supabase confirmation emails land. Signs the person in when this browser
 * started the sign-up (PKCE `code`) or the email template sends a `token_hash`; otherwise the email
 * is already confirmed by the time Supabase redirects here, so they are sent to sign in.
 * Errors Supabase puts in the URL fragment (a reused link) survive the redirect for the login form.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"));
  if (params.get("error") || params.get("error_code")) redirect(loginWith("link-expired", next));

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const supabase = await createSupabaseServerClient();
  if (!supabase || (!code && !(tokenHash && type))) redirect(loginWith("confirmed", next));

  let target = loginWith("confirmed", next);
  try {
    if (tokenHash && type) {
      const { error } = await withTimeout(supabase.auth.verifyOtp({ type, token_hash: tokenHash }), SUPABASE_TIMEOUT_MS, "Supabase verifyOtp");
      target = error ? loginWith("link-expired", next) : next;
    } else if (code) {
      // Fails when the link is opened in another browser than the sign-up; the email is confirmed anyway.
      const { error } = await withTimeout(supabase.auth.exchangeCodeForSession(code), SUPABASE_TIMEOUT_MS, "Supabase code exchange");
      if (!error) target = next;
    }
  } catch (error) {
    console.warn("[auth] Email confirmation failed:", error instanceof Error ? error.message : error);
  }
  redirect(target);
}

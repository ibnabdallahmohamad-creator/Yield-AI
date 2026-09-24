"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { createLocalUser, LocalUserExistsError, verifyLocalCredentials } from "@/lib/auth/local-users";
import { endSessions, safeNextPath, startLocalSession } from "@/lib/auth/session";
import { DEMO_ACCOUNT, env } from "@/lib/env";
import { createSupabaseAdminClient, createSupabaseServerClient, withTimeout } from "@/lib/supabase/server";

export interface AuthFormState {
  error?: string;
  notice?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "password", string>>;
  values?: { name?: string; email?: string };
}

const SUPABASE_TIMEOUT_MS = 6000;

const SignInSchema = z.object({
  email: z.email({ error: "Enter a valid email address." }).trim().toLowerCase(),
  password: z.string().min(1, { error: "Enter your password." }).max(72),
});

const SignUpSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter your name (at least 2 characters)." }).max(80),
  email: z.email({ error: "Enter a valid email address." }).trim().toLowerCase(),
  password: z
    .string()
    .min(8, { error: "Use at least 8 characters." })
    .max(72, { error: "Use at most 72 characters." }),
});

function fieldErrors(error: z.ZodError): AuthFormState["fieldErrors"] {
  const out: AuthFormState["fieldErrors"] = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if ((key === "name" || key === "email" || key === "password") && !out[key]) out[key] = issue.message;
  }
  return out;
}

type SupabaseAttempt = { ok: true } | { ok: false; reason: "invalid" | "unconfirmed" | "unavailable"; message?: string };

async function supabaseSignIn(email: string, password: string): Promise<SupabaseAttempt> {
  if (!env.supabaseConfigured) return { ok: false, reason: "unavailable" };
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return { ok: false, reason: "unavailable" };
    const { data, error } = await withTimeout(
      supabase.auth.signInWithPassword({ email, password }),
      SUPABASE_TIMEOUT_MS,
      "Supabase sign-in",
    );
    if (!error && data.session) return { ok: true };
    if (error?.code === "email_not_confirmed") return { ok: false, reason: "unconfirmed" };
    if (error && (error.status === 400 || error.code === "invalid_credentials")) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "unavailable", message: error?.message };
  } catch (error) {
    console.warn("[auth] Supabase sign-in unavailable:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "unavailable" };
  }
}

export async function signInAction(_prev: AuthFormState | undefined, formData: FormData): Promise<AuthFormState> {
  const next = safeNextPath(formData.get("next"));
  const parsed = SignInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const values = { email: String(formData.get("email") ?? "") };
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const { email, password } = parsed.data;

  const remote = await supabaseSignIn(email, password);
  if (remote.ok) redirect(next);

  // Local accounts (and the built-in demo account) keep working without Supabase.
  const local = await verifyLocalCredentials(email, password);
  if (local) {
    await startLocalSession(local);
    redirect(next);
  }

  if (!remote.ok && remote.reason === "unconfirmed") {
    return { error: "Please confirm your email first — check your inbox for the link.", values };
  }
  if (!remote.ok && remote.reason === "unavailable" && env.supabaseConfigured) {
    return { error: "We couldn't reach the sign-in service. Try again, or use the demo account.", values };
  }
  return { error: "That email and password don't match an account.", values };
}

export async function signUpAction(_prev: AuthFormState | undefined, formData: FormData): Promise<AuthFormState> {
  const next = safeNextPath(formData.get("next"));
  const values = { name: String(formData.get("name") ?? ""), email: String(formData.get("email") ?? "") };
  const parsed = SignUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const { name, email, password } = parsed.data;

  if (email === DEMO_ACCOUNT.email.toLowerCase()) {
    return { fieldErrors: { email: "This is the shared demo account — use “Try the demo account” instead." }, values };
  }

  if (env.supabaseConfigured) {
    try {
      const admin = createSupabaseAdminClient();
      if (admin) {
        // With the service role we can create a confirmed account and sign in straight away.
        const { error } = await withTimeout(
          admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } }),
          SUPABASE_TIMEOUT_MS,
          "Supabase createUser",
        );
        if (error) {
          if (error.code === "email_exists" || error.status === 422) {
            return { fieldErrors: { email: "An account with this email already exists — sign in instead." }, values };
          }
          throw error;
        }
        const signedIn = await supabaseSignIn(email, password);
        if (signedIn.ok) redirect(next);
        throw new Error("Sign-in after sign-up failed");
      }
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const { data, error } = await withTimeout(
          supabase.auth.signUp({ email, password, options: { data: { name } } }),
          SUPABASE_TIMEOUT_MS,
          "Supabase sign-up",
        );
        if (error) {
          if (error.code === "user_already_exists" || error.code === "email_exists") {
            return { fieldErrors: { email: "An account with this email already exists — sign in instead." }, values };
          }
          if (error.code === "weak_password") return { fieldErrors: { password: error.message }, values };
          throw error;
        }
        if (data.session) redirect(next);
        return { notice: "Account created. Check your inbox to confirm your email, then sign in.", values };
      }
    } catch (error) {
      unstable_rethrow(error); // let redirect() propagate
      console.warn("[auth] Supabase sign-up unavailable, using a local account:", error instanceof Error ? error.message : error);
    }
  }

  try {
    const user = await createLocalUser({ email, name, password });
    await startLocalSession(user);
  } catch (error) {
    if (error instanceof LocalUserExistsError) {
      return { fieldErrors: { email: "An account with this email already exists — sign in instead." }, values };
    }
    console.error("[auth] Local sign-up failed:", error);
    return { error: "We couldn't create your account. Please try again.", values };
  }
  redirect(next);
}

export async function demoSignInAction(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next"));
  const remote = await supabaseSignIn(DEMO_ACCOUNT.email, DEMO_ACCOUNT.password);
  if (!remote.ok) {
    const local = await verifyLocalCredentials(DEMO_ACCOUNT.email, DEMO_ACCOUNT.password);
    if (local) await startLocalSession(local);
  }
  redirect(next);
}

export async function signOutAction(): Promise<void> {
  await endSessions();
  redirect("/");
}

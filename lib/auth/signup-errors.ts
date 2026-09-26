/**
 * What to tell someone whose Supabase sign-up failed. Only an unreachable Supabase (network error,
 * timeout, 5xx) should fall back to a local account: on serverless hosts local accounts live in
 * memory and vanish, so a definite answer from Supabase must reach the person instead.
 */
export interface SignUpProblem {
  field?: "email" | "password";
  message: string;
}

export const ACCOUNT_EXISTS_MESSAGE = "An account with this email already exists — sign in instead.";

interface AuthErrorLike {
  code?: string;
  status?: number;
  message?: string;
}

/** A message for the form, or null when Supabase could not be reached (use a local account). */
export function signUpProblem(error: unknown): SignUpProblem | null {
  const { code, status, message } = (error ?? {}) as AuthErrorLike;
  switch (code) {
    case "user_already_exists":
    case "email_exists":
      return { field: "email", message: ACCOUNT_EXISTS_MESSAGE };
    case "weak_password":
      return { field: "password", message: message || "Choose a stronger password." };
    case "email_address_invalid":
      return { field: "email", message: "Use an email address that can receive mail." };
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return { message: "Too many sign-ups in the last few minutes. Please try again shortly, or use the demo account." };
    case "signup_disabled":
      return { message: "New sign-ups are turned off right now." };
  }
  if (status === 422) return { field: "email", message: ACCOUNT_EXISTS_MESSAGE };
  if (typeof status === "number" && status >= 400 && status < 500) {
    return { message: message ? `We couldn't create your account: ${message}` : "We couldn't create your account." };
  }
  return null;
}

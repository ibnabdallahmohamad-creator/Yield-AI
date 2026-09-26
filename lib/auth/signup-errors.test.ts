import { describe, expect, it } from "vitest";
import { ACCOUNT_EXISTS_MESSAGE, signUpProblem } from "./signup-errors";

describe("signUpProblem", () => {
  it("tells people their email already has an account", () => {
    expect(signUpProblem({ code: "user_already_exists", status: 422 })).toEqual({ field: "email", message: ACCOUNT_EXISTS_MESSAGE });
    expect(signUpProblem({ code: "email_exists", status: 422 })).toEqual({ field: "email", message: ACCOUNT_EXISTS_MESSAGE });
  });

  it("reports Supabase's email rate limit instead of creating a throwaway local account", () => {
    expect(signUpProblem({ code: "over_email_send_rate_limit", status: 429 })?.message).toMatch(/try again/i);
  });

  it("points invalid emails at the email field", () => {
    expect(signUpProblem({ code: "email_address_invalid", status: 400 })?.field).toBe("email");
  });

  it("passes weak-password advice through", () => {
    expect(signUpProblem({ code: "weak_password", status: 422, message: "Too short" })).toEqual({ field: "password", message: "Too short" });
  });

  it("surfaces any other definite rejection", () => {
    expect(signUpProblem({ code: "something_new", status: 400, message: "Nope" })?.message).toContain("Nope");
  });

  it("falls back to a local account only when Supabase is unreachable", () => {
    expect(signUpProblem(new Error("Supabase sign-up timed out after 6000 ms"))).toBeNull();
    expect(signUpProblem({ status: 503, message: "Service Unavailable" })).toBeNull();
    expect(signUpProblem({ status: 0, message: "fetch failed" })).toBeNull();
    expect(signUpProblem(undefined)).toBeNull();
  });
});

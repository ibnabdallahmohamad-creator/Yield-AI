import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_AUTH_SECRET, signSessionToken, verifySessionToken } from "./token";

const user = { sub: "user-1", email: "demo@yield-ai.app", name: "Demo Agronomist" };

/** A token anyone could make: signed with the dev secret that is public in the repository. */
const forged = () =>
  new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("intruder")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(DEV_AUTH_SECRET));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session tokens", () => {
  it("round-trips a session and rejects a tampered token", async () => {
    vi.stubEnv("AUTH_SECRET", "a-test-secret-that-is-long-enough-0123456789");
    const token = await signSessionToken(user);
    await expect(verifySessionToken(token)).resolves.toEqual(user);
    await expect(verifySessionToken(`${token}x`)).resolves.toBeNull();
    await expect(verifySessionToken(await forged())).resolves.toBeNull();
  });

  it("derives the key from the service-role key when AUTH_SECRET is missing", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-for-tests");
    await expect(verifySessionToken(await forged())).resolves.toBeNull();
    await expect(verifySessionToken(await signSessionToken(user))).resolves.toEqual(user);
  });

  it("falls back to the dev secret only when no secret is configured (local demo)", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(verifySessionToken(await forged())).resolves.toMatchObject({ sub: "intruder" });
  });
});

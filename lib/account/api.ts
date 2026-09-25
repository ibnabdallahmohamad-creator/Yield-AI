/** Shared plumbing for the /api/farms and /api/devices route handlers. */
import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser, type AppUser } from "../auth/session";
import { jsonError } from "../chat/api";
import { AccountInputError } from "./manage";
import { AccountStoreError, NotFoundError } from "./store";

export { jsonError, NO_STORE, readBody } from "../chat/api";

export async function requireApiUser(): Promise<{ user: AppUser } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: jsonError("Please sign in.", 401) };
  return { user };
}

/** Friendly errors: bad input 400/403, not yours 404, storage down 503, anything else 500. */
export function accountFailure(error: unknown, action: string): NextResponse {
  if (error instanceof AccountInputError) return jsonError(error.message, error.status);
  if (error instanceof NotFoundError) return jsonError(error.message, 404);
  if (error instanceof AccountStoreError) {
    console.warn(`[account] ${action} failed:`, error.message);
    return jsonError(`Your farms are unavailable right now (${error.message}).`, 503);
  }
  console.error(`[account] ${action} failed:`, error);
  return jsonError("Something went wrong. Please try again.", 500);
}

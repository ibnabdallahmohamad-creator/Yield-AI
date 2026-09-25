/**
 * Whose farms a request may see. The demo account sees the built-in demo farms; every other
 * account sees only the farms it created (and starts with none).
 */
import "server-only";
import type { AppUser } from "../auth/session";
import { DEMO_ACCOUNT } from "../env";

export type DataScope = { kind: "demo" } | { kind: "owner"; ownerId: string };

export const DEMO_SCOPE: DataScope = { kind: "demo" };

export function isDemoUser(user: Pick<AppUser, "id" | "email">): boolean {
  return user.id === "local-demo" || user.email.trim().toLowerCase() === DEMO_ACCOUNT.email.trim().toLowerCase();
}

export function scopeFor(user: Pick<AppUser, "id" | "email">): DataScope {
  return isDemoUser(user) ? DEMO_SCOPE : { kind: "owner", ownerId: user.id };
}

export const scopeKey = (scope: DataScope) => (scope.kind === "demo" ? "demo" : `owner:${scope.ownerId}`);

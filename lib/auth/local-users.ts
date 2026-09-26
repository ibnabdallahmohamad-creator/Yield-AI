/**
 * Local accounts: used when Supabase Auth is not configured or unreachable, so sign-in never
 * blocks the demo. Stored in `$HARVESTAR_DATA_DIR/users.json` (default `.data/`, git-ignored) with scrypt password hashes;
 * falls back to memory on read-only file systems. The demo and Tester accounts always exist.
 */
import "server-only";
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DEMO_ACCOUNT, TESTER_ACCOUNT } from "../env";
import { dataRoot } from "../storage/files";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;
const storeFile = () => path.join(dataRoot(), "users.json");

export interface LocalUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

let users: LocalUser[] | null = null;
let builtIn: LocalUser[] | null = null;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Accounts that exist without Supabase: the shared demo account and the Tester account. */
async function getBuiltInUsers(): Promise<LocalUser[]> {
  if (!builtIn) {
    const make = async (id: string, account: { email: string; name: string; password: string }): Promise<LocalUser> => ({
      id,
      email: normalizeEmail(account.email),
      name: account.name,
      passwordHash: await hashPassword(account.password),
      createdAt: new Date(0).toISOString(),
    });
    builtIn = [await make("local-demo", DEMO_ACCOUNT), await make("local-tester", TESTER_ACCOUNT)];
  }
  return builtIn;
}

async function load(): Promise<LocalUser[]> {
  if (users) return users;
  try {
    const parsed = JSON.parse(await readFile(storeFile(), "utf8")) as unknown;
    users = Array.isArray(parsed) ? (parsed as LocalUser[]) : [];
  } catch {
    users = [];
  }
  return users;
}

async function persist(list: LocalUser[]): Promise<void> {
  try {
    await mkdir(path.dirname(storeFile()), { recursive: true });
    await writeFile(storeFile(), JSON.stringify(list, null, 2), "utf8");
  } catch (error) {
    console.warn("[auth] Could not persist local users (memory only):", error instanceof Error ? error.message : error);
  }
}

export async function findLocalUser(email: string): Promise<LocalUser | null> {
  const target = normalizeEmail(email);
  const known = (await getBuiltInUsers()).find((u) => u.email === target);
  if (known) return known;
  return (await load()).find((u) => u.email === target) ?? null;
}

export async function verifyLocalCredentials(email: string, password: string): Promise<LocalUser | null> {
  const user = await findLocalUser(email);
  if (!user) {
    // Spend comparable time so response timing does not reveal which emails exist.
    await hashPassword(password);
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}

export class LocalUserExistsError extends Error {}

export async function createLocalUser(input: { email: string; name: string; password: string }): Promise<LocalUser> {
  if (await findLocalUser(input.email)) throw new LocalUserExistsError("An account with this email already exists.");
  const list = await load();
  const user: LocalUser = {
    id: `local-${randomUUID()}`,
    email: normalizeEmail(input.email),
    name: input.name.trim(),
    passwordHash: await hashPassword(input.password),
    createdAt: new Date().toISOString(),
  };
  list.push(user);
  await persist(list);
  return user;
}

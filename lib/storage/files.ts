/**
 * Small file helpers for the local (no Supabase) stores in `.data/`: the data root, atomic writes
 * that survive Windows file locks, and file-safe keys.
 */
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** `$YIELD_DATA_DIR`, or `.data` in the project. */
export function dataRoot(): string {
  return process.env.YIELD_DATA_DIR?.trim() || path.join(process.cwd(), ".data");
}

export const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;
export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Make any id safe as a file or folder name; a short hash keeps altered ids from colliding. */
export function fileKey(raw: string): string {
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
  if (safe === raw && safe) return safe;
  return `${safe}_${createHash("sha256").update(raw).digest("hex").slice(0, 10)}`;
}

/** Windows may briefly lock a file (indexer, antivirus); retry a rename a few times. */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      const code = errorCode(error);
      if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

/** Write through a temp file and rename, so readers never see half a file. */
export async function writeAtomic(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, contents, "utf8");
  try {
    await renameWithRetry(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** True for errors that mean "this file system is read-only" (serverless hosts). */
export function isReadOnlyError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EROFS" || code === "EACCES" || code === "EPERM";
}

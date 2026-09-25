/**
 * Saved chats for local accounts (no Supabase): one JSON file per owner in `.data/conversations/`
 * (git-ignored). Writes are atomic (temp file + rename) and serialised per owner; data is cached in
 * memory and falls back to memory only on read-only file systems. The shared demo account is
 * scoped per sign-in session, and those files are pruned after a week.
 */
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Conversation, ConversationMessage, MessageFeedback } from "../ai/contract";
import type { AppUser } from "../auth/session";
import {
  CHAT_LIMITS,
  DEFAULT_CONVERSATION_TITLE,
  compareConversations,
  laterIso,
  nowIso,
  previewOf,
  stampMessages,
  type ChatStore,
  type ConversationFilter,
  type ConversationUpdate,
  type ConversationWithMessages,
  type NewConversation,
  type NewMessage,
} from "./core";

const DEMO_USER_ID = "local-demo";
const DEMO_FILE = /^local-demo(-[A-Za-z0-9_-]+)?\.json$/;
/** Matches the session cookie lifetime: an older demo file belongs to an expired session. */
const DEMO_FILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TEMP_FILE_TTL_MS = 60 * 60 * 1000;
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;

interface OwnerData {
  conversations: Conversation[];
  messages: Record<string, ConversationMessage[]>;
}

interface OwnerState {
  data: OwnerData;
  loaded: boolean;
  /** mtime + size of the file as we last saw it; a change means another process wrote it. */
  signature: string | null;
  /** Serialises every operation on this owner. */
  queue: Promise<unknown>;
  lastUsed: number;
}

/** Shared through globalThis so every route bundle (and dev reloads) see the same cache. */
const shared = globalThis as typeof globalThis & {
  __yieldChatStore?: { states: Map<string, OwnerState>; pruned: Map<string, number>; warned: boolean };
};
const cache = (shared.__yieldChatStore ??= { states: new Map(), pruned: new Map(), warned: false });

/** `$YIELD_DATA_DIR/conversations`, or `.data/conversations` in the project. */
export function defaultChatDir(): string {
  const root = process.env.YIELD_DATA_DIR?.trim() || path.join(process.cwd(), ".data");
  return path.join(root, "conversations");
}

/** Make any id safe as a file name; a short hash keeps altered ids from colliding. */
function fileKey(raw: string): string {
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
  if (safe === raw && safe) return safe;
  return `${safe}_${createHash("sha256").update(raw).digest("hex").slice(0, 10)}`;
}

/** Owner key for a local user. The demo account is shared by every visitor, so it is per session. */
export function chatOwnerKey(user: Pick<AppUser, "id" | "sessionId">): string {
  return fileKey(user.id === DEMO_USER_ID && user.sessionId ? `${DEMO_USER_ID}-${user.sessionId}` : user.id);
}

/** Forget cached data (tests use it to simulate a fresh process). */
export function resetLocalChatCache(): void {
  cache.states.clear();
  cache.pruned.clear();
  cache.warned = false;
}

const emptyData = (): OwnerData => ({ conversations: [], messages: {} });
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function fileSignature(file: string): Promise<string | null> {
  const info = await stat(file);
  return `${info.mtimeMs}:${info.size}`;
}

async function readOwnerFile(file: string): Promise<OwnerData> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") console.warn("[chat] Could not read saved chats:", messageOf(error));
    return emptyData();
  }
  try {
    const parsed = JSON.parse(text) as Partial<OwnerData> | null;
    const messages = parsed?.messages && typeof parsed.messages === "object" ? parsed.messages : {};
    const conversations = Array.isArray(parsed?.conversations) ? parsed.conversations : [];
    return { conversations, messages };
  } catch (error) {
    // Keep the broken file for inspection rather than overwriting it on the next save.
    console.warn("[chat] Saved chats file is corrupt; starting fresh:", messageOf(error));
    await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined);
    return emptyData();
  }
}

/** Windows may briefly lock a file (indexer, antivirus); retry a rename a few times. */
async function renameWithRetry(from: string, to: string): Promise<void> {
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

async function writeAtomic(file: string, contents: string): Promise<void> {
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

/** Delete demo-session files (and stray temp files) nobody has written to for a week. */
async function pruneDemoFiles(dir: string, keep: string): Promise<void> {
  const now = Date.now();
  if (now - (cache.pruned.get(dir) ?? 0) < PRUNE_EVERY_MS) return;
  cache.pruned.set(dir, now);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    // Directory not created yet (or unreadable): nothing to prune on disk.
  }
  await Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name);
      const demo = DEMO_FILE.test(name);
      if (file === keep || (!demo && !name.endsWith(".tmp"))) return;
      try {
        const { mtimeMs } = await stat(file);
        if (now - mtimeMs < (demo ? DEMO_FILE_TTL_MS : TEMP_FILE_TTL_MS)) return;
        await unlink(file);
        cache.states.delete(file);
      } catch {
        // Already gone or locked: try again next time.
      }
    }),
  );
  // Memory-only demo sessions (read-only file systems) expire the same way.
  for (const [file, state] of cache.states) {
    if (file !== keep && path.dirname(file) === dir && DEMO_FILE.test(path.basename(file)) && now - state.lastUsed > DEMO_FILE_TTL_MS) {
      cache.states.delete(file);
    }
  }
}

const copyConversation = (c: Conversation): Conversation => ({ ...c });
const copyMessage = (m: ConversationMessage): ConversationMessage => ({ ...m });

/** Recompute the list fields after messages changed. */
function summarise(conversation: Conversation, messages: ConversationMessage[]): void {
  const last = messages.at(-1);
  conversation.preview = last ? previewOf(last.content) : "";
  conversation.message_count = messages.length;
}

/** Drop the oldest unpinned conversations (oldest overall if all are pinned) beyond the cap. */
function enforceConversationCap(data: OwnerData, keepId: string): void {
  while (data.conversations.length > CHAT_LIMITS.conversations) {
    const candidates = data.conversations.filter((c) => c.id !== keepId);
    const pool = candidates.some((c) => !c.pinned) ? candidates.filter((c) => !c.pinned) : candidates;
    const oldest = pool.reduce((a, b) => (compareConversations(a, b) > 0 ? a : b));
    data.conversations = data.conversations.filter((c) => c.id !== oldest.id);
    delete data.messages[oldest.id];
  }
}

export interface LocalChatStoreOptions {
  /** Directory with one `<owner>.json` per owner. Defaults to `defaultChatDir()`. */
  dir?: string;
}

export class LocalChatStore implements ChatStore {
  private readonly dir: string;
  private readonly file: string;
  private readonly demo: boolean;

  constructor(ownerKey: string, options: LocalChatStoreOptions = {}) {
    const key = fileKey(ownerKey);
    this.dir = path.resolve(options.dir ?? defaultChatDir());
    this.file = path.join(this.dir, `${key}.json`);
    this.demo = DEMO_FILE.test(`${key}.json`);
  }

  private state(): OwnerState {
    let state = cache.states.get(this.file);
    if (!state) {
      state = { data: emptyData(), loaded: false, signature: null, queue: Promise.resolve(), lastUsed: Date.now() };
      cache.states.set(this.file, state);
    }
    state.lastUsed = Date.now();
    return state;
  }

  /** Load on first use, and reload when another process changed the file. */
  private async refresh(state: OwnerState): Promise<void> {
    let signature: string | null;
    try {
      signature = await fileSignature(this.file);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        state.loaded = true;
        return; // Unreadable: keep what we have in memory.
      }
      signature = null;
    }
    if (state.loaded && signature === state.signature) return;
    if (!state.loaded && this.demo) await pruneDemoFiles(this.dir, this.file);
    state.data = signature === null ? emptyData() : await readOwnerFile(this.file);
    state.signature = signature;
    state.loaded = true;
  }

  private async persist(state: OwnerState): Promise<void> {
    try {
      await writeAtomic(this.file, JSON.stringify({ version: 1, ...state.data }));
      state.signature = await fileSignature(this.file);
    } catch (error) {
      if (!cache.warned) {
        cache.warned = true;
        console.warn("[chat] Could not save chats to disk (memory only):", messageOf(error));
      }
    }
  }

  /** Run one operation at a time per owner; `op` reports whether it changed anything. */
  private exclusive<T>(op: (data: OwnerData) => { result: T; changed?: boolean }): Promise<T> {
    const state = this.state();
    const task = state.queue.then(async () => {
      await this.refresh(state);
      const { result, changed } = op(state.data);
      if (changed) await this.persist(state);
      return result;
    });
    state.queue = task.catch(() => undefined);
    return task;
  }

  list(filter: ConversationFilter = {}): Promise<Conversation[]> {
    const q = filter.q?.trim().toLowerCase();
    return this.exclusive((data) => {
      const matches = data.conversations.filter(
        (c) =>
          (!filter.farm || c.farm_id === filter.farm) &&
          (!q ||
            c.title.toLowerCase().includes(q) ||
            (data.messages[c.id] ?? []).some((m) => m.content.toLowerCase().includes(q))),
      );
      return { result: matches.sort(compareConversations).slice(0, CHAT_LIMITS.conversations).map(copyConversation) };
    });
  }

  create(input: NewConversation): Promise<Conversation> {
    return this.exclusive((data) => {
      const now = nowIso();
      const conversation: Conversation = {
        id: randomUUID(),
        farm_id: input.farm_id,
        title: input.title?.trim() || DEFAULT_CONVERSATION_TITLE,
        pinned: false,
        created_at: now,
        updated_at: now,
        preview: "",
        message_count: 0,
      };
      data.conversations.push(conversation);
      data.messages[conversation.id] = [];
      enforceConversationCap(data, conversation.id);
      return { result: copyConversation(conversation), changed: true };
    });
  }

  get(id: string): Promise<ConversationWithMessages | null> {
    return this.exclusive((data) => {
      const conversation = data.conversations.find((c) => c.id === id);
      if (!conversation) return { result: null };
      const messages = (data.messages[id] ?? []).map(copyMessage);
      return { result: { conversation: copyConversation(conversation), messages } };
    });
  }

  update(id: string, patch: ConversationUpdate): Promise<Conversation | null> {
    return this.exclusive((data) => {
      const conversation = data.conversations.find((c) => c.id === id);
      if (!conversation) return { result: null };
      if (patch.title !== undefined) conversation.title = patch.title.trim() || DEFAULT_CONVERSATION_TITLE;
      if (patch.pinned !== undefined) conversation.pinned = patch.pinned;
      if (patch.farm_id !== undefined) conversation.farm_id = patch.farm_id;
      conversation.updated_at = nowIso();
      return { result: copyConversation(conversation), changed: true };
    });
  }

  remove(id: string): Promise<boolean> {
    return this.exclusive((data) => {
      const before = data.conversations.length;
      data.conversations = data.conversations.filter((c) => c.id !== id);
      delete data.messages[id];
      const removed = data.conversations.length < before;
      return { result: removed, changed: removed };
    });
  }

  append(id: string, messages: NewMessage[]): Promise<ConversationWithMessages | null> {
    return this.exclusive((data) => {
      const conversation = data.conversations.find((c) => c.id === id);
      if (!conversation) return { result: null };
      const list = (data.messages[id] ??= []);
      const stamps = stampMessages(messages, list.at(-1)?.created_at);
      const stored = messages.map(
        (m, i): ConversationMessage => ({
          id: randomUUID(),
          conversation_id: id,
          role: m.role,
          content: m.content,
          source: m.source,
          model: m.model,
          as_of: m.as_of,
          insight_id: m.insight_id,
          feedback: null,
          created_at: stamps[i],
        }),
      );
      list.push(...stored);
      if (list.length > CHAT_LIMITS.messagesPerConversation) list.splice(0, list.length - CHAT_LIMITS.messagesPerConversation);
      summarise(conversation, list);
      const now = nowIso();
      conversation.updated_at = stamps.length ? laterIso(now, stamps[stamps.length - 1]) : now;
      return { result: { conversation: copyConversation(conversation), messages: stored.map(copyMessage) }, changed: true };
    });
  }

  truncateAfterLastUser(id: string): Promise<ConversationMessage | null> {
    return this.exclusive((data) => {
      const conversation = data.conversations.find((c) => c.id === id);
      const list = data.messages[id];
      if (!conversation || !list) return { result: null };
      const index = list.findLastIndex((m) => m.role === "user");
      if (index < 0) return { result: null };
      const changed = index < list.length - 1;
      if (changed) {
        list.splice(index + 1);
        summarise(conversation, list);
      }
      return { result: copyMessage(list[index]), changed };
    });
  }

  setFeedback(id: string, messageId: string, feedback: MessageFeedback | null): Promise<ConversationMessage | null> {
    return this.exclusive((data) => {
      const message = data.messages[id]?.find((m) => m.id === messageId && m.role === "assistant");
      if (!message || !data.conversations.some((c) => c.id === id)) return { result: null };
      const changed = message.feedback !== feedback;
      message.feedback = feedback;
      return { result: copyMessage(message), changed };
    });
  }
}

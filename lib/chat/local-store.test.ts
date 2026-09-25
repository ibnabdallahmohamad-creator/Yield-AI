import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_LIMITS, previewOf, titleFromQuestion, type NewMessage } from "./core";
import { LocalChatStore, chatOwnerKey, resetLocalChatCache } from "./local-store";

vi.mock("server-only", () => ({}));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "yai-chat-"));
  resetLocalChatCache();
});

afterEach(async () => {
  resetLocalChatCache();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const storeFor = (owner = "local-user-1") => new LocalChatStore(owner, { dir });
const ask = (content: string, insight_id: string | null = null): NewMessage => ({
  role: "user",
  content,
  source: null,
  model: null,
  as_of: "2026-09-24",
  insight_id,
});
const reply = (content: string): NewMessage => ({
  role: "assistant",
  content,
  source: "offline",
  model: "agronomy-rules",
  as_of: "2026-09-24",
  insight_id: null,
});

describe("LocalChatStore", () => {
  it("creates, lists, renames, pins and deletes conversations", async () => {
    const store = storeFor();
    const first = await store.create({ farm_id: "shamal-east" });
    const second = await store.create({ farm_id: "al-khor-north", title: "  Salinity plan  " });
    expect(first).toMatchObject({ title: "New chat", pinned: false, preview: "", message_count: 0, farm_id: "shamal-east" });
    expect(second.title).toBe("Salinity plan");
    expect((await store.list()).map((c) => c.id)).toEqual([second.id, first.id]);

    const renamed = await store.update(first.id, { title: "Irrigation" });
    expect(renamed?.title).toBe("Irrigation");
    expect(renamed!.updated_at > first.updated_at).toBe(true);
    const pinned = await store.update(second.id, { pinned: true, farm_id: "shamal-east" });
    expect(pinned).toMatchObject({ pinned: true, farm_id: "shamal-east" });
    expect((await store.list()).map((c) => c.id)).toEqual([second.id, first.id]);

    expect(await store.update("missing", { title: "x" })).toBeNull();
    expect(await store.remove(first.id)).toBe(true);
    expect(await store.remove(first.id)).toBe(false);
    expect(await store.get(first.id)).toBeNull();
    expect((await store.list()).map((c) => c.id)).toEqual([second.id]);
  });

  it("appends messages and keeps preview, count and updated_at current", async () => {
    const store = storeFor();
    const conv = await store.create({ farm_id: "shamal-east" });
    const res = await store.append(conv.id, [ask("How much should I irrigate?", "insight-1"), reply("**Irrigate 11 mm** tonight.")]);
    if (!res) throw new Error("append returned null");
    const [question, answer] = res.messages;
    expect(res.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(question).toMatchObject({ insight_id: "insight-1", feedback: null, conversation_id: conv.id });
    expect(question.created_at < answer.created_at).toBe(true);
    expect(res.conversation).toMatchObject({ preview: "Irrigate 11 mm tonight.", message_count: 2 });
    expect(res.conversation.updated_at > conv.updated_at).toBe(true);

    const thread = await store.get(conv.id);
    expect(thread?.messages.map((m) => m.content)).toEqual(["How much should I irrigate?", "**Irrigate 11 mm** tonight."]);
    expect(await store.append("missing", [ask("hi")])).toBeNull();
  });

  it("serialises concurrent writes", async () => {
    const store = storeFor();
    const conv = await store.create({ farm_id: null });
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.append(conv.id, [ask(`question ${i}`)])));
    const thread = await store.get(conv.id);
    expect(thread?.conversation.message_count).toBe(20);
    resetLocalChatCache();
    expect((await storeFor().get(conv.id))?.messages).toHaveLength(20);
  });

  it("searches titles and message text case-insensitively and filters by farm", async () => {
    const store = storeFor();
    const salinity = await store.create({ farm_id: "al-khor-north", title: "Salinity plan" });
    const water = await store.create({ farm_id: "shamal-east" });
    await store.append(water.id, [ask("When should I IRRIGATE the tomatoes?"), reply("Tomorrow at dawn.")]);
    expect((await store.list({ q: "salinity" })).map((c) => c.id)).toEqual([salinity.id]);
    expect((await store.list({ q: "irrigate" })).map((c) => c.id)).toEqual([water.id]);
    expect((await store.list({ q: "DAWN" })).map((c) => c.id)).toEqual([water.id]);
    expect(await store.list({ q: "nothing like this" })).toEqual([]);
    expect((await store.list({ farm: "al-khor-north" })).map((c) => c.id)).toEqual([salinity.id]);
    expect(await store.list({ farm: "al-khor-north", q: "dawn" })).toEqual([]);
  });

  it("drops the replies after the last question for a regenerate", async () => {
    const store = storeFor();
    const conv = await store.create({ farm_id: "shamal-east" });
    await store.append(conv.id, [ask("First?"), reply("One."), ask("Second?"), reply("Two."), reply("Two, again.")]);
    const last = await store.truncateAfterLastUser(conv.id);
    expect(last?.content).toBe("Second?");
    const thread = await store.get(conv.id);
    expect(thread?.messages.map((m) => m.content)).toEqual(["First?", "One.", "Second?"]);
    expect(thread?.conversation).toMatchObject({ message_count: 3, preview: "Second?" });

    const empty = await store.create({ farm_id: null });
    expect(await store.truncateAfterLastUser(empty.id)).toBeNull();
    expect(await store.truncateAfterLastUser("missing")).toBeNull();
  });

  it("stores feedback on assistant messages only", async () => {
    const store = storeFor();
    const conv = await store.create({ farm_id: null });
    const res = await store.append(conv.id, [ask("Q"), reply("A")]);
    const [question, answer] = res!.messages;
    expect(await store.setFeedback(conv.id, answer.id, "up")).toMatchObject({ id: answer.id, feedback: "up" });
    expect(await store.setFeedback(conv.id, answer.id, null)).toMatchObject({ feedback: null });
    expect(await store.setFeedback(conv.id, question.id, "down")).toBeNull();
    expect(await store.setFeedback("missing", answer.id, "down")).toBeNull();
  });

  it("caps conversations per owner, dropping the oldest unpinned first", async () => {
    const store = storeFor();
    const oldestPinned = await store.create({ farm_id: null, title: "keep me" });
    await store.update(oldestPinned.id, { pinned: true });
    const oldestUnpinned = await store.create({ farm_id: null, title: "drop me" });
    for (let i = 2; i < CHAT_LIMITS.conversations; i++) await store.create({ farm_id: null, title: `chat ${i}` });
    expect(await store.list()).toHaveLength(CHAT_LIMITS.conversations);

    const newest = await store.create({ farm_id: null });
    const ids = (await store.list()).map((c) => c.id);
    expect(ids).toHaveLength(CHAT_LIMITS.conversations);
    expect(ids).toContain(newest.id);
    expect(ids).toContain(oldestPinned.id);
    expect(ids).not.toContain(oldestUnpinned.id);
  }, 60_000);

  it("caps messages per conversation, dropping the oldest", async () => {
    const store = storeFor();
    const conv = await store.create({ farm_id: null });
    const batch = Array.from({ length: CHAT_LIMITS.messagesPerConversation + 5 }, (_, i) => ask(`message ${i}`));
    await store.append(conv.id, batch);
    const thread = await store.get(conv.id);
    expect(thread?.messages).toHaveLength(CHAT_LIMITS.messagesPerConversation);
    expect(thread?.messages[0].content).toBe("message 5");
    expect(thread?.conversation.message_count).toBe(CHAT_LIMITS.messagesPerConversation);
  });

  it("keeps owners apart", async () => {
    const alice = storeFor("local-alice");
    const bob = storeFor("local-bob");
    const conv = await alice.create({ farm_id: null });
    expect(await bob.list()).toEqual([]);
    expect(await bob.get(conv.id)).toBeNull();
    expect(await bob.remove(conv.id)).toBe(false);
    expect(await bob.update(conv.id, { title: "mine now" })).toBeNull();
    expect(await bob.append(conv.id, [ask("hi")])).toBeNull();
    expect(await alice.get(conv.id)).not.toBeNull();
  });

  it("persists to disk atomically and reloads in a fresh process", async () => {
    const conv = await storeFor().create({ farm_id: "shamal-east", title: "Saved" });
    await storeFor().append(conv.id, [ask("Q"), reply("A")]);
    expect((await readdir(dir)).sort()).toEqual(["local-user-1.json"]);
    const onDisk = JSON.parse(await readFile(path.join(dir, "local-user-1.json"), "utf8"));
    expect(onDisk.conversations[0]).toMatchObject({ id: conv.id, title: "Saved", message_count: 2 });

    resetLocalChatCache();
    const thread = await storeFor().get(conv.id);
    expect(thread?.conversation.title).toBe("Saved");
    expect(thread?.messages.map((m) => m.content)).toEqual(["Q", "A"]);
  });

  it("picks up changes another process wrote", async () => {
    const store = storeFor();
    await store.create({ farm_id: null, title: "Mine" });
    const file = path.join(dir, "local-user-1.json");
    const data = JSON.parse(await readFile(file, "utf8"));
    data.conversations[0].title = "Edited elsewhere";
    await writeFile(file, JSON.stringify(data, null, 1));
    expect((await store.list())[0].title).toBe("Edited elsewhere");
  });

  it("falls back to memory when the directory can't be written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const blocker = path.join(dir, "not-a-directory");
    await writeFile(blocker, "x");
    const store = new LocalChatStore("local-user-1", { dir: path.join(blocker, "conversations") });
    const conv = await store.create({ farm_id: null });
    await store.append(conv.id, [ask("Still works?"), reply("Yes, in memory.")]);
    expect((await store.get(conv.id))?.messages).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("scopes the shared demo account per session and prunes week-old demo files", async () => {
    expect(chatOwnerKey({ id: "local-demo", sessionId: "abc-123" })).toBe("local-demo-abc-123");
    expect(chatOwnerKey({ id: "local-demo" })).toBe("local-demo");
    expect(chatOwnerKey({ id: "local-7f1c" })).toBe("local-7f1c");
    const unsafe = chatOwnerKey({ id: "local-demo", sessionId: "../../etc/passwd" });
    expect(unsafe).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(unsafe).not.toBe(chatOwnerKey({ id: "local-demo", sessionId: "______etc_passwd" }));

    const weekAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    for (const name of ["local-demo-old.json", "local-demo-fresh.json", "local-someone.json"]) {
      await writeFile(path.join(dir, name), JSON.stringify({ conversations: [], messages: {} }));
    }
    await utimes(path.join(dir, "local-demo-old.json"), weekAgo, weekAgo);
    await utimes(path.join(dir, "local-someone.json"), weekAgo, weekAgo);

    const demo = new LocalChatStore(chatOwnerKey({ id: "local-demo", sessionId: "new" }), { dir });
    const conv = await demo.create({ farm_id: null });
    expect((await readdir(dir)).sort()).toEqual(["local-demo-fresh.json", "local-demo-new.json", "local-someone.json"]);
    expect(await new LocalChatStore(chatOwnerKey({ id: "local-demo", sessionId: "other" }), { dir }).get(conv.id)).toBeNull();
  });
});

describe("chat text helpers", () => {
  it("titles a conversation after the question, cut on a word boundary", () => {
    expect(titleFromQuestion("How much should I irrigate?")).toBe("How much should I irrigate?");
    const long = titleFromQuestion("Why is the salinity rising so fast in the north-east corner of the farm this month?");
    expect(long.length).toBeLessThanOrEqual(CHAT_LIMITS.titleChars);
    expect(long).toBe("Why is the salinity rising so fast in the…");
    expect(titleFromQuestion("   ")).toBe("New chat");
  });

  it("previews the last message as one plain line", () => {
    expect(previewOf("**ECe is 5.9 dS/m**\n\n1. Leach\n2. Check KN-02")).toBe("ECe is 5.9 dS/m Leach Check KN-02");
    const preview = previewOf("word ".repeat(100));
    expect(preview.length).toBeLessThanOrEqual(CHAT_LIMITS.previewChars);
    expect(preview.endsWith("…")).toBe(true);
  });
});

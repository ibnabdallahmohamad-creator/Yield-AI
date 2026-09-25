"use client";

/**
 * The full-screen assistant (ui_improvement §5): chat history on the left (a sheet on phones), the
 * farm and "as of" day on top, a centred thread and a composer pinned to the bottom. One component
 * serves /dashboard/assistant and /dashboard/assistant/[id]; switching chats only rewrites the URL
 * (history.replaceState), so nothing remounts and Back always leaves the assistant.
 */
import { ArrowLeft, Ellipsis, Menu, PanelLeftClose, PanelLeftOpen, SquarePen, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useShellFarm } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChatRequest, Conversation, ConversationMessage, ConversationPatch, MessageFeedback } from "@/lib/ai/contract";
import { asOfLabel, followUps } from "@/lib/assistant";
import {
  ChatClientError,
  deleteConversation,
  getConversation,
  isAbortError,
  listConversations,
  sendChat,
  setMessageFeedback,
  updateConversation,
} from "@/lib/chat/client";
import { CHAT_LIMITS, titleFromQuestion, truncateText } from "@/lib/chat/core";
import { replaceUrl } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import { AsOfSelect, FarmSelect } from "./context-bar";
import { ConversationMenuItems, HistoryPanel, type ConversationActions } from "./history";
import { Snackbar, type Snack } from "./snackbar";
import { EmptyState, MissingChat, Thread, ThreadSkeleton } from "./thread";
import type { AssistantBoot, ThreadMessage } from "./types";

/** How long "Chat deleted · Undo" stays before the delete is sent. */
const UNDO_MS = 5000;
const SNACK_MS = 4000;
/** After Stop the server still finishes (and saves) the answer; refresh the list once it likely has. */
const RESYNC_AFTER_STOP_MS = 4000;
/** The shell remembers the last farm under this key (components/shell/shell-context.tsx). */
const SAVED_FARM_KEY = "yai:farm";
const SIDEBAR_KEY = "yai:assistant-sidebar";

const chatUrl = (id: string) => `/dashboard/assistant/${encodeURIComponent(id)}`;
const newChatUrl = (farmId: string | null) => `/dashboard/assistant${farmId ? `?farm=${encodeURIComponent(farmId)}` : ""}`;
const messageOf = (error: unknown, fallback: string) => (error instanceof ChatClientError ? error.message : fallback);

let keySeq = 0;
const nextKey = (prefix: string) => `${prefix}-${(keySeq += 1)}`;

const fromStored = (m: ConversationMessage): ThreadMessage => ({
  key: m.id,
  id: m.id,
  role: m.role,
  content: m.content,
  source: m.source,
  model: m.model,
  asOf: m.as_of,
  feedback: m.feedback,
});

// --- Small browser stores (read after hydration so the server render stays stable) -------------

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function readSavedFarm(): string | null {
  try {
    return window.localStorage.getItem(SAVED_FARM_KEY);
  } catch {
    return null;
  }
}

const sidebarListeners = new Set<() => void>();
let sidebarCollapsedInMemory: boolean | null = null;
function subscribeSidebar(onChange: () => void) {
  sidebarListeners.add(onChange);
  return () => {
    sidebarListeners.delete(onChange);
  };
}
function readSidebarCollapsed(): boolean {
  if (sidebarCollapsedInMemory !== null) return sidebarCollapsedInMemory;
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
}
function setSidebarCollapsed(collapsed: boolean) {
  sidebarCollapsedInMemory = collapsed;
  try {
    if (collapsed) window.localStorage.setItem(SIDEBAR_KEY, "collapsed");
    else window.localStorage.removeItem(SIDEBAR_KEY);
  } catch {
    // storage blocked: the in-memory value still works for this visit
  }
  sidebarListeners.forEach((l) => l());
}

function IconButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:size-9",
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function RenameDialog({
  conversation,
  open,
  onOpenChange,
  onRename,
}: {
  conversation: Conversation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (title: string) => void;
}) {
  return (
    <Dialog open={open && Boolean(conversation)} onOpenChange={onOpenChange}>
      <DialogContent className="p-5">
        <DialogTitle>Rename chat</DialogTitle>
        <DialogDescription className="mt-1">Give this chat a name you&apos;ll recognise in the list.</DialogDescription>
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            const title = String(new FormData(e.currentTarget).get("title") ?? "").trim();
            if (title && title !== conversation?.title) onRename(title);
            onOpenChange(false);
          }}
        >
          <label htmlFor="rename-dialog-title" className="sr-only">
            Chat title
          </label>
          <input
            id="rename-dialog-title"
            name="title"
            defaultValue={conversation?.title}
            maxLength={120}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            className="h-11 w-full rounded-xl border bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          />
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" className="h-11 rounded-xl px-4 sm:h-9">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" className="h-11 rounded-xl px-4 sm:h-9">
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface InFlight {
  controller: AbortController;
  question: string;
  conversationId: string | null;
  farmId: string;
  startedAt: string;
}

export function AssistantApp({ boot }: { boot: AssistantBoot }) {
  const router = useRouter();
  const { farms, dates, today, user } = boot;
  const latest = dates[dates.length - 1] ?? today;

  // --- Farm and day the answers are about ---------------------------------------------------------
  const [chosenFarm, setChosenFarm] = useState<string | null>(boot.initialFarmId);
  // undefined while rendering on the server / hydrating: the saved farm isn't known yet.
  const savedFarm = useSyncExternalStore(subscribeStorage, readSavedFarm, () => undefined);
  const farmResolved = chosenFarm !== null || savedFarm !== undefined;
  const farmId =
    chosenFarm ?? (savedFarm && farms.some((f) => f.id === savedFarm) ? savedFarm : null) ?? farms[0]?.id ?? null;
  const farm = farms.find((f) => f.id === farmId) ?? null;
  const [asOf, setAsOf] = useState(latest);

  // --- The open chat ----------------------------------------------------------------------------
  const [conversation, setConversation] = useState<Conversation | null>(boot.conversation?.conversation ?? null);
  const activeId = conversation?.id ?? null;
  const [messages, setMessages] = useState<ThreadMessage[]>(() => boot.conversation?.messages.map(fromStored) ?? []);
  const [missing, setMissing] = useState(boot.conversationError);
  const [requestedId, setRequestedId] = useState(boot.conversationId);
  const [loadingThread, setLoadingThread] = useState(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");
  /** Saving failed: keep answering, sending the history from the page instead. */
  const [unsaved, setUnsaved] = useState(false);

  // --- History list -----------------------------------------------------------------------------
  const [list, setList] = useState<Conversation[] | null>(boot.list);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{ q: string; items: Conversation[]; error: string | null } | null>(null);
  const [filterFarm, setFilterFarm] = useState("all");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  // --- Chrome -----------------------------------------------------------------------------------
  const [sheetOpen, setSheetOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [snack, setSnack] = useState<Snack | null>(null);
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebarCollapsed, () => false);

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const inFlight = useRef<InFlight | null>(null);
  /** Set by Stop: the server may still save that exchange, so catch up before the next question. */
  const stopped = useRef<Omit<InFlight, "controller"> | null>(null);
  /** Bumped whenever another chat opens, so late responses for the old one are dropped. */
  const threadGen = useRef(0);
  const insightId = useRef(boot.insightId);
  const pendingDelete = useRef<{ id: string; timer: number; restore: (() => void) | null } | null>(null);
  const snackTimer = useRef<number | undefined>(undefined);
  const resyncTimer = useRef<number | undefined>(undefined);
  const follow = useRef(true);
  const smoothNext = useRef(false);
  const headerMenuRename = useRef(false);

  // --- Helpers ----------------------------------------------------------------------------------
  const showSnack = useCallback((text: string, action?: Snack["action"], ms = SNACK_MS) => {
    window.clearTimeout(snackTimer.current);
    setSnack({ id: Date.now(), text, action });
    snackTimer.current = window.setTimeout(() => setSnack(null), ms);
  }, []);

  /** Put a changed conversation into the list, the search results and the header. */
  const applyConversation = useCallback((c: Conversation) => {
    setList((l) => (l ? (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [c, ...l]) : l));
    setSearch((s) => (s && s.items.some((x) => x.id === c.id) ? { ...s, items: s.items.map((x) => (x.id === c.id ? c : x)) } : s));
    setConversation((cur) => (cur?.id === c.id ? c : cur));
  }, []);

  const dropConversation = useCallback((id: string) => {
    setList((l) => l?.filter((x) => x.id !== id) ?? l);
    setSearch((s) => (s ? { ...s, items: s.items.filter((x) => x.id !== id) } : s));
  }, []);

  const loadList = useCallback((signal?: AbortSignal) => {
    return listConversations({}, signal).then(
      (items) => {
        setList(items);
        setListError(null);
        return items;
      },
      (error: unknown) => {
        if (!isAbortError(error)) setListError(messageOf(error, "Chat history is unavailable right now."));
        return null;
      },
    );
  }, []);

  const scheduleResync = useCallback(() => {
    window.clearTimeout(resyncTimer.current);
    resyncTimer.current = window.setTimeout(() => void loadList(), RESYNC_AFTER_STOP_MS);
  }, [loadList]);

  /** Abandon the answer on its way (another chat opened): the server still saves it. */
  const cancelInFlight = () => {
    const current = inFlight.current;
    if (!current) return;
    current.controller.abort();
    inFlight.current = null;
    setPending(false);
    scheduleResync();
  };

  const focusComposer = () => requestAnimationFrame(() => composerRef.current?.focus({ preventScroll: true }));

  // --- Farm -------------------------------------------------------------------------------------
  const moveConversation = (c: Conversation, id: string) => {
    if (c.farm_id === id) return;
    if (c.id === activeId) setChosenFarm(id);
    void patchConversation(c, { farm_id: id });
  };

  const changeFarm = (id: string) => {
    if (id === farmId || !farms.some((f) => f.id === id)) return;
    setChosenFarm(id);
    if (conversation) {
      void patchConversation(conversation, { farm_id: id });
      showSnack(`This chat now asks about ${farms.find((f) => f.id === id)?.name ?? "that farm"}.`);
    } else if (!missing) {
      replaceUrl(newChatUrl(id));
    }
  };

  // Tell the shell which farm this is (not before the saved farm is known, or it would overwrite it);
  // ⌘K farm switches land here instead of navigating away.
  useShellFarm(farmResolved ? farmId : null, changeFarm);

  // --- Opening chats ----------------------------------------------------------------------------
  const newChat = () => {
    setSheetOpen(false);
    cancelInFlight();
    stopped.current = null;
    threadGen.current += 1;
    insightId.current = null;
    setConversation(null);
    setMessages([]);
    setMissing(null);
    setRequestedId(null);
    setLoadingThread(false);
    setUnsaved(false);
    setDraft("");
    setAsOf(latest);
    replaceUrl(newChatUrl(farmId));
    focusComposer();
  };

  const openConversation = async (target: Conversation | string) => {
    const id = typeof target === "string" ? target : target.id;
    setSheetOpen(false);
    if (id === activeId && !missing) return;
    cancelInFlight();
    stopped.current = null;
    const gen = (threadGen.current += 1);
    insightId.current = null;
    const known = typeof target === "string" ? null : target;
    setConversation(known);
    if (known?.farm_id && farms.some((f) => f.id === known.farm_id)) setChosenFarm(known.farm_id);
    setMessages([]);
    setMissing(null);
    setRequestedId(id);
    setUnsaved(false);
    setDraft("");
    setAsOf(latest);
    setLoadingThread(true);
    replaceUrl(chatUrl(id));
    try {
      const thread = await getConversation(id);
      if (gen !== threadGen.current) return;
      const c = thread.conversation;
      setConversation(c);
      applyConversation(c);
      if (c.farm_id && farms.some((f) => f.id === c.farm_id)) setChosenFarm(c.farm_id);
      follow.current = true;
      setMessages(thread.messages.map(fromStored));
    } catch (error) {
      if (gen !== threadGen.current) return;
      setConversation(null);
      if (error instanceof ChatClientError && error.status === 404) {
        setMissing("not-found");
        dropConversation(id);
      } else {
        setMissing("unavailable");
      }
    } finally {
      if (gen === threadGen.current) setLoadingThread(false);
    }
  };

  // --- Asking -----------------------------------------------------------------------------------
  /**
   * After Stop the server may have finished and saved that exchange. Before asking again, adopt the
   * saved chat (a stopped first question still creates one) and show what is really stored.
   */
  const catchUpAfterStop = async (signal: AbortSignal): Promise<{ conversationId: string | null; lastQuestion: string | null } | null> => {
    const s = stopped.current;
    stopped.current = null;
    if (!s) return null;
    let id = s.conversationId;
    if (!id) {
      const items = await loadList(signal);
      const title = titleFromQuestion(s.question);
      id =
        items
          ?.filter((c) => c.title === title && c.farm_id === s.farmId && c.created_at >= s.startedAt)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.id ?? null;
      if (!id) return { conversationId: null, lastQuestion: null };
    }
    const thread = await getConversation(id, signal).catch((error: unknown) => {
      if (isAbortError(error)) throw error;
      return null;
    });
    if (!thread) return { conversationId: s.conversationId, lastQuestion: null };
    setConversation(thread.conversation);
    applyConversation(thread.conversation);
    if (!s.conversationId) replaceUrl(chatUrl(id));
    setMessages(thread.messages.map(fromStored));
    return { conversationId: id, lastQuestion: thread.messages.findLast((m) => m.role === "user")?.content ?? null };
  };

  /**
   * Ask `raw`. `reuseKey` re-asks an existing question bubble (Try again / Ask again) instead of adding
   * one; `regenerate` answers the last saved question again, replacing its answer.
   */
  const ask = async (raw: string, opts: { reuseKey?: string; regenerate?: boolean } = {}) => {
    const question = raw.trim().slice(0, 1000);
    if (!question || inFlight.current || !farmId) return;
    const gen = threadGen.current;
    const controller = new AbortController();
    const startedAt = new Date(Date.now() - 120_000).toISOString(); // generous: server and browser clocks differ
    let conversationId = activeId;
    let regenerate = Boolean(opts.regenerate);
    const userKey = opts.reuseKey ?? nextKey("q");
    const asked: ThreadMessage = {
      key: userKey,
      id: null,
      role: "user",
      content: question,
      source: null,
      model: null,
      asOf: asOf,
      feedback: null,
    };
    // History for an unsaved chat, taken before this question is added.
    const history = messages
      .filter((m) => !m.error && !m.stopped)
      .slice(-CHAT_LIMITS.historyTurns)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    const prepare = (list: ThreadMessage[]): ThreadMessage[] => {
      if (regenerate) {
        const last = list.findLastIndex((m) => m.role === "user");
        return last < 0 ? list : [...list.slice(0, last), { ...list[last], stopped: false }];
      }
      const reuse = opts.reuseKey ? list.findIndex((m) => m.key === opts.reuseKey) : -1;
      if (reuse >= 0) return [...list.slice(0, reuse), { ...list[reuse], stopped: false }];
      return [...list, asked];
    };

    inFlight.current = { controller, question, conversationId, farmId, startedAt };
    setPending(true);
    setMissing(null);
    setDraft((d) => (opts.reuseKey || regenerate ? d : ""));
    follow.current = true;
    smoothNext.current = true;
    setMessages(prepare);

    try {
      if (stopped.current) {
        const caughtUp = await catchUpAfterStop(controller.signal);
        if (gen !== threadGen.current || controller.signal.aborted) return;
        if (caughtUp) {
          conversationId = caughtUp.conversationId;
          // The stopped question is already saved: answer it again rather than storing it twice.
          if (conversationId && caughtUp.lastQuestion === question && (opts.reuseKey || regenerate)) regenerate = true;
          else if (!conversationId) regenerate = false;
          setMessages((m) => prepare(regenerate ? m : m.filter((x) => x.key !== userKey)));
          inFlight.current = { controller, question, conversationId, farmId, startedAt };
        }
      }

      const body: ChatRequest = { farm_id: farmId, question };
      if (asOf !== latest) body.date = asOf;
      if (conversationId) {
        body.conversation_id = conversationId;
        if (regenerate) body.regenerate = true;
      } else if (unsaved) {
        body.history = history;
      } else {
        body.new_conversation = true;
      }
      if (insightId.current && !conversationId) body.insight_id = insightId.current;

      const res = await sendChat(body, controller.signal);
      if (gen !== threadGen.current) return;
      insightId.current = null;
      if (res.conversation) {
        applyConversation(res.conversation);
        setConversation(res.conversation);
        if (!conversationId) replaceUrl(chatUrl(res.conversation.id));
        setRequestedId(res.conversation.id);
      } else if (!unsaved && (conversationId || body.new_conversation)) {
        if (!conversationId) setUnsaved(true);
        showSnack("Couldn't save this chat right now. You can keep asking.");
      }
      const userMessage = res.user_message;
      const answer = res.message;
      setMessages((m) => [
        ...m.map((x) => (x.key === userKey && userMessage ? { ...x, id: userMessage.id, asOf: userMessage.as_of } : x)),
        {
          key: answer?.id ?? nextKey("a"),
          id: answer?.id ?? null,
          role: "assistant",
          content: res.answer,
          source: res.source,
          model: res.model,
          asOf: answer?.as_of ?? asOf,
          feedback: null,
          animate: true,
        },
      ]);
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted || gen !== threadGen.current) return;
      const gone = error instanceof ChatClientError && error.status === 404 && conversationId;
      setMessages((m) => [
        ...m,
        {
          key: nextKey("e"),
          id: null,
          role: "assistant",
          content: gone
            ? "This chat was deleted, so I couldn't add to it. Start a new chat to keep asking."
            : messageOf(error, "Something went wrong. Please try again."),
          source: null,
          model: null,
          asOf: null,
          feedback: null,
          error: { retry: regenerate ? "regenerate" : "send" },
        },
      ]);
    } finally {
      if (inFlight.current?.controller === controller) {
        inFlight.current = null;
        setPending(false);
      }
    }
  };

  const stop = () => {
    const current = inFlight.current;
    if (!current) return;
    current.controller.abort();
    inFlight.current = null;
    setPending(false);
    stopped.current = { question: current.question, conversationId: current.conversationId, farmId: current.farmId, startedAt: current.startedAt };
    setMessages((m) => {
      const last = m.findLastIndex((x) => x.role === "user");
      return last < 0 ? m : m.map((x, i) => (i === last ? { ...x, stopped: true } : x));
    });
    scheduleResync();
    focusComposer();
  };

  const regenerateLast = () => {
    const lastQuestion = messages.findLast((m) => m.role === "user");
    if (!lastQuestion || !activeId) return;
    void ask(lastQuestion.content, { regenerate: true });
  };

  const retry = (m: ThreadMessage) => {
    if (m.role === "user") {
      void ask(m.content, { reuseKey: m.key });
      return;
    }
    const at = messages.findIndex((x) => x.key === m.key);
    setMessages((list) => list.filter((x) => x.key !== m.key));
    if (m.error?.retry === "regenerate") {
      const lastQuestion = messages.findLast((x) => x.role === "user");
      if (lastQuestion) void ask(lastQuestion.content, { regenerate: true });
      return;
    }
    const question = messages.slice(0, at).findLast((x) => x.role === "user");
    if (question) void ask(question.content, { reuseKey: question.key });
  };

  const rate = async (m: ThreadMessage, value: MessageFeedback | null) => {
    if (!activeId || !m.id) return;
    const previous = m.feedback;
    const set = (feedback: MessageFeedback | null) => setMessages((list) => list.map((x) => (x.key === m.key ? { ...x, feedback } : x)));
    set(value);
    try {
      await setMessageFeedback(activeId, m.id, value);
    } catch (error) {
      set(previous);
      showSnack(messageOf(error, "Couldn't save your feedback. Please try again."));
    }
  };

  // --- Rename / pin / move / delete ---------------------------------------------------------------
  async function patchConversation(c: Conversation, patch: ConversationPatch) {
    applyConversation({ ...c, ...patch });
    try {
      applyConversation(await updateConversation(c.id, patch));
    } catch (error) {
      if (error instanceof ChatClientError && error.status === 404) {
        dropConversation(c.id);
        showSnack("That chat was already deleted.");
        return;
      }
      applyConversation(c);
      showSnack(messageOf(error, "Couldn't save the change. Please try again."));
    }
  }

  const commitDelete = async (id: string) => {
    if (pendingDelete.current?.id === id) {
      window.clearTimeout(pendingDelete.current.timer);
      pendingDelete.current = null;
    }
    try {
      await deleteConversation(id);
      dropConversation(id);
    } catch (error) {
      if (error instanceof ChatClientError && error.status === 404) dropConversation(id);
      else showSnack(messageOf(error, "Couldn't delete the chat. It's back in the list."));
    } finally {
      setHidden((h) => {
        const next = new Set(h);
        next.delete(id);
        return next;
      });
    }
  };

  const flushDelete = () => {
    const p = pendingDelete.current;
    if (p) void commitDelete(p.id);
  };

  const undoDelete = () => {
    const p = pendingDelete.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    pendingDelete.current = null;
    setHidden((h) => {
      const next = new Set(h);
      next.delete(p.id);
      return next;
    });
    p.restore?.();
    window.clearTimeout(snackTimer.current);
    setSnack(null);
  };

  const deleteChat = (c: Conversation) => {
    flushDelete();
    const wasOpen = c.id === activeId;
    let restore: (() => void) | null = null;
    if (wasOpen) {
      const snapshot = { conversation, messages: messages.map((m) => ({ ...m, animate: false })), asOf, unsaved };
      restore = () => {
        cancelInFlight();
        threadGen.current += 1;
        setConversation(snapshot.conversation);
        setMessages(snapshot.messages);
        setAsOf(snapshot.asOf);
        setUnsaved(snapshot.unsaved);
        setMissing(null);
        setRequestedId(c.id);
        replaceUrl(chatUrl(c.id));
      };
      newChat();
    }
    setHidden((h) => new Set(h).add(c.id));
    const timer = window.setTimeout(() => void commitDelete(c.id), UNDO_MS);
    pendingDelete.current = { id: c.id, timer, restore };
    showSnack(`Deleted “${truncateText(c.title, 32)}”`, { label: "Undo", onClick: undoDelete }, UNDO_MS);
  };

  const actions: ConversationActions = {
    onRename: (c, title) => void patchConversation(c, { title }),
    onPin: (c, pinned) => void patchConversation(c, { pinned }),
    onMove: moveConversation,
    onDelete: deleteChat,
  };

  // --- Effects ----------------------------------------------------------------------------------

  // Search runs on the server (titles and message text), 250 ms after typing stops.
  const q = query.trim();
  useEffect(() => {
    if (!q) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      listConversations({ q }, controller.signal).then(
        (items) => setSearch({ q, items, error: null }),
        (error: unknown) => {
          if (!isAbortError(error)) setSearch({ q, items: [], error: messageOf(error, "Search is unavailable right now.") });
        },
      );
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  // The history couldn't be read on the server: try once more from the browser.
  useEffect(() => {
    if (boot.list) return;
    const controller = new AbortController();
    void loadList(controller.signal);
    return () => controller.abort();
  }, [boot.list, loadList]);

  // ?q= (e.g. "Ask AI about this"): ask once, then drop it from the URL so a reload doesn't ask again.
  const autoAsked = useRef(false);
  const autoAsk = useEffectEvent((question: string) => {
    replaceUrl(newChatUrl(farmId));
    void ask(question);
  });
  useEffect(() => {
    if (!boot.question || autoAsked.current || !farmResolved) return;
    autoAsked.current = true;
    autoAsk(boot.question);
  }, [boot.question, farmResolved]);

  // Desktop: start with the cursor in the composer (not on phones, where it would pop the keyboard).
  useEffect(() => {
    if (!boot.question && window.matchMedia("(pointer: fine)").matches) composerRef.current?.focus({ preventScroll: true });
  }, [boot.question]);

  // Leaving: send a pending delete now; really unmounting only (StrictMode re-mounts straight away).
  const mounted = useRef(false);
  const onLeave = useEffectEvent(() => {
    inFlight.current?.controller.abort();
    flushDelete();
    window.clearTimeout(snackTimer.current);
    window.clearTimeout(resyncTimer.current);
  });
  useEffect(() => {
    mounted.current = true;
    const onPageHide = () => {
      const p = pendingDelete.current;
      if (!p) return;
      pendingDelete.current = null;
      void fetch(`/api/conversations/${encodeURIComponent(p.id)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", onPageHide);
      window.setTimeout(() => {
        if (!mounted.current) onLeave();
      }, 0);
    };
  }, []);

  // Esc goes back to where you came from (unless you're typing or a menu is open).
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(`/dashboard${farmId ? `?farm=${encodeURIComponent(farmId)}` : ""}`);
  };
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || sheetOpen || renameOpen) return;
    const target = e.target as HTMLElement | null;
    if (target && target !== composerRef.current && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (draft.trim()) return;
    e.preventDefault();
    goBack();
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Follow the conversation while you're at the bottom; scrolling up stops following.
  useEffect(() => {
    let lastY = window.scrollY;
    const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 96;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < lastY - 4) follow.current = nearBottom();
      else if (nearBottom()) follow.current = true;
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const scrollToEnd = useCallback((smooth: boolean) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth && !reduce ? "smooth" : "auto" });
  }, []);
  useLayoutEffect(() => {
    // Nothing to follow in the empty state: keep its heading in view (phones would scroll past it).
    if (!follow.current || (messages.length === 0 && !pending)) return;
    scrollToEnd(smoothNext.current);
    smoothNext.current = false;
  }, [messages, pending, scrollToEnd]);
  const onTypingProgress = useCallback(() => {
    if (follow.current) scrollToEnd(false);
  }, [scrollToEnd]);

  // The tab shows the chat's title.
  const title = conversation?.title ?? (missing === "not-found" ? "Chat not found" : "New chat");
  useEffect(() => {
    document.title = `${title} · Yield AI`;
  }, [title]);

  // --- Derived ------------------------------------------------------------------------------------
  const suggestions = useMemo(() => {
    const asked = messages.filter((m) => m.role === "user").map((m) => m.content);
    return followUps(asked[asked.length - 1] ?? "", asked);
  }, [messages]);
  const baseItems = q ? (search?.q === q ? search.items : null) : list;
  const items = baseItems ? baseItems.filter((c) => !hidden.has(c.id)) : null;
  const itemsError = q ? (search?.q === q ? search.error : null) : list ? null : listError;
  const saved = Boolean(activeId) && !unsaved;
  const showMissing = missing !== null && messages.length === 0 && !pending;

  const note = farm ? (
    <>
      {unsaved ? "Not saved right now · " : ""}
      Answers use <span className="font-medium text-foreground/80">{farm.name}</span>&apos;s probe readings
      {asOf !== latest ? ` as of ${asOfLabel(asOf, latest)}` : ""}.
    </>
  ) : (
    "Add a farm to start asking."
  );

  const historyProps = {
    items,
    error: itemsError,
    onRetry: () => {
      if (q) setSearch(null);
      setListError(null);
      void loadList();
    },
    query,
    onQueryChange: setQuery,
    filterFarm,
    onFilterFarm: setFilterFarm,
    farms,
    today,
    activeId,
    onNew: newChat,
    onOpen: (c: Conversation) => void openConversation(c),
    actions,
    user,
  };

  const backButton = (
    <Button variant="ghost" className="h-11 gap-1.5 rounded-xl px-2.5 text-muted-foreground hover:text-foreground sm:h-9" onClick={goBack}>
      <ArrowLeft aria-hidden="true" /> Back
    </Button>
  );

  return (
    <div className="min-h-dvh bg-background" style={{ "--assistant-sidebar": collapsed ? "0px" : "272px" } as React.CSSProperties}>
      {/* Desktop: the history sidebar */}
      {!collapsed ? (
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] flex-col border-r bg-sidebar lg:flex" aria-label="Chats">
          <HistoryPanel
            {...historyProps}
            top={
              <div className="flex items-center justify-between">
                {backButton}
                <IconButton label="Hide chats" onClick={() => setSidebarCollapsed(true)}>
                  <PanelLeftClose className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
            }
          />
        </aside>
      ) : null}

      {/* Phones and tablets: the history in a left sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-[88vw] max-w-sm gap-0 bg-sidebar p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Chats</SheetTitle>
            <SheetDescription>Your saved chats with the assistant.</SheetDescription>
          </SheetHeader>
          <HistoryPanel
            {...historyProps}
            top={
              <div className="flex items-center justify-between pt-[env(safe-area-inset-top)]">
                {backButton}
                <SheetClose asChild>
                  <button
                    type="button"
                    aria-label="Close chats"
                    className="flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:size-9"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </SheetClose>
              </div>
            }
          />
        </SheetContent>
      </Sheet>

      <div className={cn("flex min-h-dvh flex-col", !collapsed && "lg:pl-[272px]")}>
        <header className="sticky top-0 z-20 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="flex h-14 items-center gap-0.5 px-2 sm:gap-1 sm:px-3">
            <IconButton label="Back" onClick={goBack} className={cn(!collapsed && "lg:hidden")}>
              <ArrowLeft className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton label="Chats" onClick={() => setSheetOpen(true)} className="lg:hidden">
              <Menu className="size-4" aria-hidden="true" />
            </IconButton>
            {collapsed ? (
              <IconButton label="Show chats" onClick={() => setSidebarCollapsed(false)} className="hidden lg:flex">
                <PanelLeftOpen className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
            <FarmSelect farms={farms} value={farmId} onChange={changeFarm} className="max-w-[44vw] sm:max-w-72" />
            <AsOfSelect dates={dates} value={asOf} onChange={setAsOf} />
            {/* An empty chat's "New chat" title would read as a second New chat button: screen readers only. */}
            <h1 className={cn("ml-auto min-w-0 truncate px-2 text-sm text-muted-foreground max-xl:sr-only xl:max-w-80", !conversation && "sr-only")}>{title}</h1>
            <IconButton label="New chat" onClick={newChat} className={cn(conversation ? "max-xl:ml-auto" : "ml-auto", !collapsed && "lg:hidden")}>
              <SquarePen className="size-4" aria-hidden="true" />
            </IconButton>
            {conversation ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Chat options"
                    className="hidden size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none data-[state=open]:bg-muted sm:flex"
                  >
                    <Ellipsis className="size-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-48"
                  onCloseAutoFocus={(e) => {
                    if (headerMenuRename.current) {
                      e.preventDefault();
                      headerMenuRename.current = false;
                    }
                  }}
                >
                  <ConversationMenuItems
                    conversation={conversation}
                    farms={farms}
                    actions={actions}
                    onStartRename={() => {
                      headerMenuRename.current = true;
                      setRenameOpen(true);
                    }}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </header>

        <main className="flex flex-1 flex-col px-4">
          <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col pt-6">
            {showMissing ? (
              <MissingChat kind={missing} onNew={newChat} onRetry={() => requestedId && void openConversation(requestedId)} />
            ) : loadingThread ? (
              <ThreadSkeleton />
            ) : messages.length === 0 && !pending ? (
              <EmptyState farm={farm} onAsk={(p) => void ask(p)} disabled={!farm} />
            ) : (
              <Thread
                messages={messages}
                pending={pending}
                farm={farm}
                latest={latest}
                saved={saved}
                followUps={suggestions}
                onAsk={(p) => void ask(p)}
                onRetry={retry}
                onRegenerate={regenerateLast}
                onFeedback={(m, value) => void rate(m, value)}
                onTyped={(m) => setMessages((list) => list.map((x) => (x.key === m.key ? { ...x, animate: false } : x)))}
                onProgress={onTypingProgress}
              />
            )}
          </div>
        </main>

        <div className="sticky bottom-0 z-10 bg-linear-to-t from-background from-75% to-transparent px-3 pt-5 pb-[max(env(safe-area-inset-bottom),12px)] sm:px-4">
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => void ask(draft)}
            onStop={stop}
            pending={pending}
            disabled={!farm || loadingThread}
            placeholder={farm ? `Ask about ${farm.name}…` : "No farms yet"}
            note={note}
            textareaRef={composerRef}
          />
        </div>
      </div>

      <Snackbar
        snack={snack}
        onDismiss={() => {
          window.clearTimeout(snackTimer.current);
          setSnack(null);
        }}
      />
      <RenameDialog
        key={`${conversation?.id}-${renameOpen}`}
        conversation={conversation}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        onRename={(t) => conversation && void patchConversation(conversation, { title: t })}
      />
    </div>
  );
}

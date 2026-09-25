"use client";

import { Check, Ellipsis, MapPin, Pencil, Pin, PinOff, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { UserMenu } from "@/components/shell/user-menu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Conversation } from "@/lib/ai/contract";
import { groupConversations } from "@/lib/assistant";
import { cn } from "@/lib/utils";
import type { AssistantFarm } from "./types";

export interface ConversationActions {
  onRename: (conversation: Conversation, title: string) => void;
  onPin: (conversation: Conversation, pinned: boolean) => void;
  onMove: (conversation: Conversation, farmId: string) => void;
  onDelete: (conversation: Conversation) => void;
}

/** Rename, Pin, Change farm and Delete: the row's ⋯ menu and the header's ⋯ menu share these. */
export function ConversationMenuItems({
  conversation,
  farms,
  onStartRename,
  actions,
}: {
  conversation: Conversation;
  farms: AssistantFarm[];
  onStartRename: () => void;
  actions: ConversationActions;
}) {
  return (
    <>
      <DropdownMenuItem onSelect={onStartRename}>
        <Pencil aria-hidden="true" /> Rename
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => actions.onPin(conversation, !conversation.pinned)}>
        {conversation.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
        {conversation.pinned ? "Unpin" : "Pin"}
      </DropdownMenuItem>
      {farms.length > 1 ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <MapPin aria-hidden="true" /> Change farm
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
            <DropdownMenuRadioGroup value={conversation.farm_id ?? ""} onValueChange={(id) => actions.onMove(conversation, id)}>
              {farms.map((f) => (
                <DropdownMenuRadioItem key={f.id} value={f.id}>
                  <span className="truncate">{f.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={() => actions.onDelete(conversation)}>
        <Trash2 aria-hidden="true" /> Delete
      </DropdownMenuItem>
    </>
  );
}

/** Inline title editor: Enter or leaving the field saves, Esc cancels. */
function RenameField({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    const next = value?.trim() ?? "";
    onDone(next && next !== title ? next : null);
  };
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1 p-1"
      onSubmit={(e) => {
        e.preventDefault();
        finish(new FormData(e.currentTarget).get("title") as string);
      }}
    >
      <label className="sr-only" htmlFor="rename-chat">
        Chat title
      </label>
      <input
        id="rename-chat"
        name="title"
        defaultValue={title}
        maxLength={120}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => finish(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(null);
          }
        }}
        className="h-11 min-w-0 flex-1 rounded-lg border border-ring bg-card px-2.5 text-base outline-none ring-3 ring-ring/30 sm:h-9 sm:text-sm"
      />
      <button
        type="submit"
        aria-label="Save title"
        onMouseDown={(e) => e.preventDefault()}
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground sm:size-8"
      >
        <Check className="size-4" aria-hidden="true" />
      </button>
    </form>
  );
}

function ConversationRow({
  conversation,
  farm,
  farms,
  active,
  onOpen,
  actions,
}: {
  conversation: Conversation;
  farm: AssistantFarm | undefined;
  farms: AssistantFarm[];
  active: boolean;
  onOpen: (conversation: Conversation) => void;
  actions: ConversationActions;
}) {
  const [renaming, setRenaming] = useState(false);
  const keepFocus = useRef(false);
  return (
    <li
      className={cn(
        "group/row relative flex items-center rounded-xl transition-colors duration-150",
        active ? "bg-card shadow-xs ring-1 ring-border" : "hover:bg-foreground/5",
      )}
    >
      {renaming ? (
        <RenameField
          title={conversation.title}
          onDone={(title) => {
            setRenaming(false);
            if (title) actions.onRename(conversation, title);
          }}
        />
      ) : (
        <>
          <a
            href={`/dashboard/assistant/${encodeURIComponent(conversation.id)}`}
            aria-current={active ? "page" : undefined}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              onOpen(conversation);
            }}
            className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-xl py-2 pr-11 pl-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:pr-10"
          >
            <span className={cn("truncate text-sm", active ? "font-medium text-foreground" : "text-foreground/90")}>{conversation.title}</span>
            {farm ? (
              <span className="flex min-w-0 items-center gap-1.5">
                {conversation.pinned ? <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" /> : null}
                <span className="truncate rounded-md bg-foreground/5 px-1.5 text-xs leading-5 text-muted-foreground">{farm.name}</span>
              </span>
            ) : null}
          </a>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More for “${conversation.title}”`}
                className={cn(
                  "absolute right-0.5 flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-opacity duration-150 hover:bg-foreground/5 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none data-[state=open]:opacity-100 sm:right-1 sm:size-8",
                  !active && "sm:opacity-0 sm:group-hover/row:opacity-100",
                )}
              >
                <Ellipsis className="size-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="right"
              className="w-48"
              onCloseAutoFocus={(e) => {
                // Renaming: leave the focus in the title field.
                if (keepFocus.current) {
                  e.preventDefault();
                  keepFocus.current = false;
                }
              }}
            >
              <ConversationMenuItems
                conversation={conversation}
                farms={farms}
                actions={actions}
                onStartRename={() => {
                  keepFocus.current = true;
                  setRenaming(true);
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </li>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="pt-4 first:pt-1">
      <h3 className="px-3 pb-1 text-xs font-medium text-muted-foreground">{label}</h3>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

/**
 * The chat history: New chat, search, Pinned and date groups, a farm filter and the account.
 * Rendered as the desktop sidebar and inside the phone's left sheet.
 */
export function HistoryPanel({
  top,
  items,
  error,
  onRetry,
  query,
  onQueryChange,
  filterFarm,
  onFilterFarm,
  farms,
  today,
  activeId,
  onNew,
  onOpen,
  actions,
  user,
}: {
  /** Back / collapse controls above New chat. */
  top?: React.ReactNode;
  /** Null while loading. */
  items: Conversation[] | null;
  error: string | null;
  onRetry: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  filterFarm: string;
  onFilterFarm: (farmId: string) => void;
  farms: AssistantFarm[];
  today: string;
  activeId: string | null;
  onNew: () => void;
  onOpen: (conversation: Conversation) => void;
  actions: ConversationActions;
  user: { name: string; email: string };
}) {
  const farmById = new Map(farms.map((f) => [f.id, f]));
  const shown = items?.filter((c) => filterFarm === "all" || c.farm_id === filterFarm) ?? null;
  const { pinned, groups } = groupConversations(shown ?? [], today);
  const row = (c: Conversation) => (
    <ConversationRow
      key={c.id}
      conversation={c}
      farm={c.farm_id ? farmById.get(c.farm_id) : undefined}
      farms={farms}
      active={c.id === activeId}
      onOpen={onOpen}
      actions={actions}
    />
  );
  const filterName = filterFarm === "all" ? null : (farmById.get(filterFarm)?.name ?? null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 px-3 pt-3 pb-2">
        {top}
        <Button variant="outline" className="h-11 w-full justify-start gap-2 rounded-xl bg-card px-3 sm:h-9" onClick={onNew}>
          <Plus aria-hidden="true" /> New chat
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="chat-search" className="sr-only">
            Search chats
          </label>
          <input
            id="chat-search"
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                onQueryChange("");
              }
            }}
            placeholder="Search chats"
            autoComplete="off"
            className="h-11 w-full rounded-xl border border-transparent bg-foreground/5 pr-10 pl-9 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-card focus-visible:ring-3 focus-visible:ring-ring/30 sm:h-9 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQueryChange("")}
              className="absolute top-0 right-0 flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground sm:size-9"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <Select value={filterFarm} onValueChange={onFilterFarm}>
          <SelectTrigger aria-label="Show chats about" className="h-11 w-full rounded-xl bg-card sm:h-9">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="text-muted-foreground">Show</span>
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent position="popper" align="start" className="max-h-80">
            <SelectItem value="all">All farms</SelectItem>
            {farms.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <nav aria-label="Chat history" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {error ? (
          <div className="px-3 py-6 text-sm text-muted-foreground">
            <p>{error}</p>
            <Button variant="outline" className="mt-3 h-11 rounded-xl sm:h-9" onClick={onRetry}>
              <RefreshCw aria-hidden="true" /> Try again
            </Button>
          </div>
        ) : shown === null ? (
          <div className="space-y-2 px-1 pt-2" aria-busy="true" aria-label="Loading chats">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-xl" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="px-3 py-6 text-sm text-muted-foreground">
            {query.trim()
              ? `No chats match “${query.trim()}”${filterName ? ` for ${filterName}` : ""}.`
              : filterName
                ? `No chats about ${filterName} yet.`
                : "No chats yet. Your questions and answers are saved here."}
          </p>
        ) : (
          <>
            {pinned.length > 0 ? <Group label="Pinned">{pinned.map(row)}</Group> : null}
            {groups.map((g) => (
              <Group key={g.label} label={g.label}>
                {g.items.map(row)}
              </Group>
            ))}
          </>
        )}
      </nav>

      <div className="border-t px-3 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">
        <div className="flex items-center gap-1">
          <UserMenu user={user} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

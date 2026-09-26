"use client";

/** The ticked-off actions (lib/done-actions), kept in localStorage and shared by every list on the page. */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { activeTicks, localDay, tickHolds, type DoneMap } from "@/lib/done-actions";

const STORE = "yai:done-actions:v1";
const CHANGED = "yai:done-actions";

function parse(raw: string): DoneMap {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as DoneMap) : {};
  } catch {
    return {};
  }
}

// Where storage is blocked (some private windows) ticks live in memory until the page reloads.
let memory = "";

function readRaw(): string {
  try {
    return window.localStorage.getItem(STORE) ?? "";
  } catch {
    return memory;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORE) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** Tick or untick an action. Expired ticks are dropped on every write. */
export function setActionDone(key: string, done: boolean): void {
  const today = localDay();
  const map = parse(readRaw());
  const next: DoneMap = {};
  for (const [k, day] of Object.entries(map)) if (k !== key && tickHolds(k, day, today)) next[k] = day;
  if (done) next[key] = today;
  memory = JSON.stringify(next);
  try {
    window.localStorage.setItem(STORE, memory);
  } catch {
    // Blocked or full: readRaw falls back to memory.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** The ticked actions (empty on the server and before hydration). */
export function useDoneActions(): { done: Set<string>; setDone: (key: string, done: boolean) => void } {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "");
  const done = useMemo(() => activeTicks(parse(raw)), [raw]);
  const setDone = useCallback((key: string, value: boolean) => setActionDone(key, value), []);
  return { done, setDone };
}

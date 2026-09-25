"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Snack {
  /** Changes for every new message, so repeated messages still re-announce. */
  id: number;
  text: string;
  action?: { label: string; onClick: () => void };
}

/** A small message at the bottom of the screen ("Chat deleted · Undo"), above the composer. */
export function Snackbar({ snack, onDismiss }: { snack: Snack | null; onDismiss: () => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+7.5rem)] z-50 flex justify-center px-4 lg:left-[var(--assistant-sidebar,0px)]"
      role="status"
      aria-live="polite"
    >
      {snack ? (
        <div
          key={snack.id}
          className={cn(
            "pointer-events-auto flex min-h-11 max-w-md items-center gap-1 rounded-2xl bg-forest-900 py-1 pr-1 pl-4 text-sm text-white shadow-lg",
            "duration-200 animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none",
          )}
        >
          <span className="min-w-0 flex-1 py-2">{snack.text}</span>
          {snack.action ? (
            <button
              type="button"
              onClick={snack.action.onClick}
              className="h-11 rounded-xl px-3 font-semibold text-white underline-offset-4 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none sm:h-9"
            >
              {snack.action.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex size-11 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none sm:size-9"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

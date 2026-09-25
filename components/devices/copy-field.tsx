"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** A value to copy: shown in monospace with a copy button. */
export function CopyField({ value, label, className, multiline }: { value: string; label: string; className?: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className={cn("flex items-start gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3", className)}>
      <code className={cn("min-w-0 flex-1 py-1 font-mono text-sm break-all", multiline ? "whitespace-pre-wrap" : "truncate")} aria-label={label}>
        {value}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => setCopied(true),
            () => undefined,
          );
        }}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
      >
        {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

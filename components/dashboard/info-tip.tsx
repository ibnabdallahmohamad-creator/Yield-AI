"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Small (i) button that explains how a value is computed. */
export function InfoTip({
  children,
  label = "How is this calculated?",
  className,
  side = "top",
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "relative inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/80 transition-colors after:absolute after:-inset-1.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
            className,
          )}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-76 text-[12px] leading-snug text-pretty">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

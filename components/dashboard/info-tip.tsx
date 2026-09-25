"use client";

import { Info } from "lucide-react";
import { useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Small (i) toggletip that explains how a value is computed. A mouse opens it on hover; a tap, click
 * or Enter pins it open (tooltips never open on touch, so a plain tooltip would hide this on phones).
 * On phones the button is a 44 px target; negative margins keep it 16 px in the layout.
 */
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
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const hover = (next: boolean) => (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || pinned.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), next ? 120 : 150);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) pinned.current = false;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault(); // we decide: pin it open, or close a pinned one
            window.clearTimeout(timer.current);
            const close = open && pinned.current;
            pinned.current = !close;
            setOpen(!close);
          }}
          onPointerEnter={hover(true)}
          onPointerLeave={hover(false)}
          className={cn(
            "relative inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/80 transition-colors after:absolute after:-inset-1.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none data-[state=open]:text-foreground max-sm:-m-3.5 max-sm:size-11 max-sm:after:hidden",
            className,
          )}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        className="w-auto max-w-76 rounded-lg px-3 py-2 text-xs leading-snug text-pretty shadow-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

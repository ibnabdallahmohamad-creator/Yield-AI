"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** A scroll container that fades its bottom edge while more content sits below the fold. */
export function ScrollFade({
  children,
  className,
  viewportClassName,
  fadeClassName = "from-sidebar",
}: {
  children: React.ReactNode;
  className?: string;
  viewportClassName?: string;
  fadeClassName?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const update = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 6);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (content.current) observer.observe(content.current);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <div className={cn("relative flex min-h-0 flex-col", className)}>
      <div ref={viewport} className={cn("scrollbar-thin min-h-0 overflow-y-auto", viewportClassName)}>
        <div ref={content}>{children}</div>
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t to-transparent transition-opacity duration-200",
          fadeClassName,
          more ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

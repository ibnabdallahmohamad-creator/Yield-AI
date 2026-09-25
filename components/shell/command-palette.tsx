"use client";

import { ChartLine, CornerDownLeft, Cpu, House, LandPlot, ListChecks, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { HealthDot, RISK_TONE } from "@/components/dashboard/risk-badge";
import { sectionHref, useShell } from "@/components/shell/shell-context";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  group: "Farms" | "Go to" | "Ask AI";
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

const match = (query: string, ...fields: string[]) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return q.split(/\s+/).every((word) => fields.some((f) => f.toLowerCase().includes(word)));
};

/** ⌘K / Ctrl K: jump to a farm or a page, or type a question and ask the AI. */
export function CommandPalette() {
  const router = useRouter();
  const { farms, farmId, switchFarm, paletteOpen, setPaletteOpen } = useShell();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = farms.find((f) => f.id === farmId) ?? farms[0];

  const close = () => setPaletteOpen(false);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const f of farms) {
      if (!match(query, f.name, f.crop, f.region, f.reason)) continue;
      out.push({
        id: `farm-${f.id}`,
        group: "Farms",
        label: f.name,
        hint: `${f.crop} · ${f.reason}`,
        icon: <HealthDot tone={f.riskLevel ? RISK_TONE[f.riskLevel] : "none"} />,
        run: () => switchFarm(f.id),
      });
    }
    const pages: Item[] = [
      { id: "go-home", group: "Go to", label: "Home", hint: "Every farm at a glance, ranked by risk", icon: <House />, run: () => router.push(sectionHref("home", farmId)) },
      { id: "go-insights", group: "Go to", label: "Plan", hint: "What to do this week, across your farms", icon: <ListChecks />, run: () => router.push("/dashboard/insights") },
      ...(current
        ? [{ id: "go-farm", group: "Go to" as const, label: `Trends · ${current.name}`, hint: "Soil and weather charts", icon: <ChartLine />, run: () => router.push(`${sectionHref("farm", current.id)}?tab=trends`) }]
        : []),
      { id: "go-land", group: "Go to", label: "Land use", hint: "What to use the land for in Qatar", icon: <LandPlot />, run: () => router.push(sectionHref("land", farmId)) },
      { id: "go-devices", group: "Go to", label: "Farms & devices", hint: "Add a farm, connect an ESP32", icon: <Cpu />, run: () => router.push("/dashboard/devices") },
      { id: "go-assistant", group: "Go to", label: "Assistant", hint: "Chat history", icon: <Sparkles />, run: () => router.push(sectionHref("assistant", farmId)) },
    ];
    out.push(...pages.filter((p) => match(query, p.label, p.hint ?? "")));
    const question = query.trim();
    if (current && question.length > 2) {
      out.push({
        id: "ask",
        group: "Ask AI",
        label: `Ask AI: “${question}”`,
        hint: `About ${current.name}`,
        icon: <Sparkles />,
        run: () => router.push(`/dashboard/assistant?farm=${encodeURIComponent(current.id)}&q=${encodeURIComponent(question)}`),
      });
    }
    return out;
  }, [farms, query, current, farmId, switchFarm, router]);

  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setActive(0);
  }
  const activeIndex = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  let lastGroup: string | null = null;

  return (
    <Dialog
      open={paletteOpen}
      onOpenChange={(open) => {
        setPaletteOpen(open);
        if (!open) setQuery("");
      }}
    >
      <DialogContent className="max-w-xl overflow-hidden p-0" aria-describedby={`${listId}-desc`}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription id={`${listId}-desc`} className="sr-only">
          Search farms and pages, or type a question for the AI. Use the arrow keys and Enter.
        </DialogDescription>
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(items[activeIndex]);
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[activeIndex] ? `${listId}-${items[activeIndex].id}` : undefined}
            aria-label="Search farms and pages, or ask a question"
            placeholder="Search farms and pages, or ask a question…"
            className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded-md border bg-muted px-1.5 py-0.5 font-sans text-xs text-muted-foreground sm:inline">Esc</kbd>
        </div>
        <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="scrollbar-thin max-h-[min(60vh,420px)] overflow-y-auto p-2">
          {items.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</p> : null}
          {items.map((item, i) => {
            const heading = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {heading ? <p className="px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground first:pt-1">{heading}</p> : null}
                <div
                  id={`${listId}-${item.id}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(item)}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
                    i === activeIndex && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="flex w-4 justify-center">{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.label}</span>
                    {item.hint ? <span className="block truncate text-xs text-muted-foreground">{item.hint}</span> : null}
                  </span>
                  {i === activeIndex ? <CornerDownLeft aria-hidden="true" /> : null}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

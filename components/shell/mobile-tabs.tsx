"use client";

/**
 * Phone navigation: five tabs — Home · Farm · Ask AI · Plan · More. "Farm" opens the farm you last
 * looked at; "More" holds Land use, devices and search.
 */
import { ChevronRight, Cpu, House, LandPlot, ListChecks, MessagesSquare, MoreHorizontal, Search, Sparkles, Sprout } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { sectionHref, useShell, type Section } from "@/components/shell/shell-context";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const TAB =
  "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-inset [&_svg]:size-[22px]";

function MoreLink({ href, icon, label, hint, onClick }: { href?: string; icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  const body = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-primary [&_svg]:size-5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold">{label}</span>
        <span className="block truncate text-sm text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
    </>
  );
  const cls = "flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none";
  return href ? (
    <Link href={href} onClick={onClick} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

export function MobileTabs() {
  const { section, farmId, farms, setPaletteOpen } = useShell();
  const [more, setMore] = useState(false);
  const doFirst = farms.reduce((n, f) => n + f.doFirst, 0);
  const inMore = section === "land" || section === "devices";

  const tab = (s: Exclude<Section, "other">, label: string, icon: React.ReactNode, badge?: number) => (
    <Link href={sectionHref(s, farmId)} aria-current={section === s ? "page" : undefined} className={cn(TAB, section === s ? "text-primary" : "text-muted-foreground")}>
      <span className="relative">
        {icon}
        {badge ? (
          <span aria-hidden="true" className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-risk-high px-1 text-xs leading-none font-semibold text-white ring-2 ring-background">
            {badge}
          </span>
        ) : null}
      </span>
      {label}
      {badge ? <span className="sr-only">, {badge} to do first</span> : null}
    </Link>
  );

  return (
    <>
      <nav aria-label="Main" data-chrome className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        {tab("home", "Home", <House />)}
        {tab("farm", "Farm", <Sprout />)}
        <Link href={sectionHref("assistant", farmId)} className={cn(TAB, "text-primary")} aria-current={section === "assistant" ? "page" : undefined}>
          <span className="-mt-5 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-forest-900/25 ring-4 ring-background">
            <Sparkles />
          </span>
          Ask AI
        </Link>
        {tab("insights", "Plan", <ListChecks />, doFirst)}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" className={cn(TAB, inMore ? "text-primary" : "text-muted-foreground")}>
          <MoreHorizontal />
          More
        </button>
      </nav>

      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="gap-0 rounded-t-3xl px-3 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto mt-1 mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/25" aria-hidden="true" />
          <SheetHeader className="px-2 pt-1 pb-2">
            <SheetTitle>More</SheetTitle>
            <SheetDescription className="sr-only">Other sections and search</SheetDescription>
          </SheetHeader>
          <div className="space-y-1">
            <MoreLink href={sectionHref("land", farmId)} icon={<LandPlot />} label="Land use" hint="What to use a piece of land for" onClick={() => setMore(false)} />
            <MoreLink href="/dashboard/devices" icon={<Cpu />} label="Farms & devices" hint="Add a farm, connect an ESP32 probe" onClick={() => setMore(false)} />
            <MoreLink href={sectionHref("assistant", farmId)} icon={<MessagesSquare />} label="Chats" hint="Your saved conversations with the AI" onClick={() => setMore(false)} />
            <MoreLink
              icon={<Search />}
              label="Search"
              hint="Jump to a farm or a page"
              onClick={() => {
                setMore(false);
                setPaletteOpen(true);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

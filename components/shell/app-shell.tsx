"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";
import { AppHeader } from "@/components/shell/app-header";
import { CommandPalette } from "@/components/shell/command-palette";
import { FarmPicker } from "@/components/shell/farm-picker";
import { MobileTabs } from "@/components/shell/mobile-tabs";
import { sectionHref, ShellProvider, useShell, type ShellFarm, type ShellStatus } from "@/components/shell/shell-context";
import { Sidebar } from "@/components/shell/sidebar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** Phones and tablets: every farm in a sheet (opened from the farm name in the header). */
function FarmsSheet() {
  const { farms, farmId, switchFarm, farmsSheetOpen, setFarmsSheetOpen } = useShell();
  return (
    <Sheet open={farmsSheetOpen} onOpenChange={setFarmsSheetOpen}>
      <SheetContent
        side="left"
        className="w-[88vw] max-w-sm gap-0 bg-sidebar p-0"
        onOpenAutoFocus={(e) => {
          // Focus the selected farm rather than the close button.
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[aria-current=true]")?.focus();
        }}
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>Farms</SheetTitle>
          <SheetDescription>Ranked by risk. Pick one to switch.</SheetDescription>
        </SheetHeader>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
          <FarmPicker
            farms={farms}
            selectedId={farmId}
            onSelect={(id) => {
              setFarmsSheetOpen(false);
              switchFarm(id);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Shortcuts() {
  const router = useRouter();
  const { setPaletteOpen, farmId, section, sidebarCollapsed, setSidebarCollapsed } = useShell();
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(input|textarea|select)$/i.test(e.target.tagName));
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setPaletteOpen(true);
    } else if (mod && e.key.toLowerCase() === "j" && section !== "assistant") {
      e.preventDefault();
      router.push(sectionHref("assistant", farmId));
    } else if (!mod && !e.altKey && e.key === "[" && !typing && section !== "assistant") {
      setSidebarCollapsed(!sidebarCollapsed);
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return null;
}

function Frame({ user, children }: { user: { name: string; email: string }; children: React.ReactNode }) {
  const { section, sidebarCollapsed } = useShell();
  // The assistant is a full-screen, ChatGPT-style page with its own navigation.
  if (section === "assistant") return <>{children}</>;
  return (
    <div className="group/shell" data-collapsed={sidebarCollapsed ? "true" : "false"}>
      <Sidebar user={user} />
      <div className="min-h-dvh pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-[4.25rem] xl:pl-64 xl:group-data-[collapsed=true]/shell:pl-[4.25rem]">
        <AppHeader user={user} />
        {children}
      </div>
      <MobileTabs />
    </div>
  );
}

/** The signed-in app frame: sidebar (desktop) or bottom tabs (phone), header, search and shortcuts. */
export function AppShell({
  user,
  farms,
  status,
  children,
}: {
  user: { name: string; email: string };
  farms: ShellFarm[];
  status: ShellStatus;
  children: React.ReactNode;
}) {
  return (
    <ShellProvider farms={farms} status={status}>
      <Frame user={user}>{children}</Frame>
      <FarmsSheet />
      <CommandPalette />
      <Shortcuts />
    </ShellProvider>
  );
}

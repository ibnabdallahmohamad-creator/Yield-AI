"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useDoneActions } from "@/hooks/use-done-actions";
import { useLiveUpdates, type LiveStatus } from "@/hooks/use-live-updates";
import { DEFAULT_INTERVAL_S, INTERVAL_OPTIONS_S, type Device } from "@/lib/account/types";
import type { RiskLevel } from "@/lib/ai/contract";
import type { HealthTone } from "@/lib/dashboard";
import type { DataSource, LiveUpdate } from "@/lib/types";

/** What the shell knows about each farm (the rail, the ⌘K palette and the farm switcher). */
export interface ShellFarm {
  id: string;
  name: string;
  crop: string;
  region: string;
  riskLevel: RiskLevel | null;
  riskScore: number | null;
  reason: string;
  reasonTone: HealthTone;
  /** Keys (lib/done-actions) of the "Do first" actions in the farm's latest assessment. */
  doFirst: string[];
}

export interface ShellStatus {
  source: DataSource;
  /** Set when the app fell back to demo data (e.g. Supabase unreachable). */
  sourceNote: string | null;
  weatherOffline: boolean;
  weatherNote: string | null;
  /** A real account: how many ESP32 devices it has and how often they report (null for the demo account). */
  account: { devices: number; interval_s: number; error: string | null } | null;
}

export interface LiveEvent {
  farmName: string;
  probes: number;
  at: string;
  simulated: boolean;
}

export type Section = "home" | "insights" | "farm" | "weather" | "land" | "devices" | "assistant" | "other";

export function sectionOf(pathname: string): Section {
  if (pathname === "/dashboard") return "home";
  if (pathname.startsWith("/dashboard/insights")) return "insights";
  if (pathname.startsWith("/dashboard/farm/")) return "farm";
  if (pathname.startsWith("/dashboard/weather")) return "weather";
  if (pathname.startsWith("/dashboard/land")) return "land";
  if (pathname.startsWith("/dashboard/devices")) return "devices";
  if (pathname.startsWith("/dashboard/assistant")) return "assistant";
  return "other";
}

/** A farm's workspace, optionally on one of its tabs. */
export function farmHref(farmId: string, tab?: string | null): string {
  const base = `/dashboard/farm/${encodeURIComponent(farmId)}`;
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base;
}

/** Where each section lives for a given farm. */
export function sectionHref(section: Exclude<Section, "other">, farmId: string | null): string {
  const q = farmId ? `?farm=${encodeURIComponent(farmId)}` : "";
  switch (section) {
    case "home":
      return "/dashboard";
    case "insights":
      return "/dashboard/insights";
    case "farm":
      return farmId ? farmHref(farmId) : "/dashboard";
    case "weather":
      return `/dashboard/weather${q}`;
    case "land":
      return `/dashboard/land${q}`;
    case "devices":
      return "/dashboard/devices";
    case "assistant":
      return `/dashboard/assistant${q}`;
  }
}

interface ShellContextValue {
  farms: ShellFarm[];
  status: ShellStatus;
  section: Section;
  /** The farm the user is looking at (or last looked at). */
  farmId: string | null;
  /** Pages report the farm they show, so the rail and the assistant follow it. */
  reportFarm: (id: string | null) => void;
  /** Switch farm and stay in the same kind of view (overview → overview, details → details…). */
  switchFarm: (id: string) => void;
  /** A page can take over switching (e.g. the overview selects on the map instead of navigating). */
  setSwitchHandler: (handler: ((id: string) => void) | null) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** Wide screens: the sidebar shows labels and the farm list, unless the user collapsed it. */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  farmsSheetOpen: boolean;
  setFarmsSheetOpen: (open: boolean) => void;
  live: boolean;
  setLive: (on: boolean) => void;
  /** How often live readings are shown, in seconds (default 10). */
  intervalS: number;
  /** Change it: saved to every device of the account (they pick it up on their next report), or in this browser for the demo. Resolves to an error message or null. */
  setIntervalS: (seconds: number) => Promise<string | null>;
  /** The account's devices as of the latest live update (null until one arrives, and for the demo). */
  liveDevices: Device[] | null;
  liveStatus: LiveStatus;
  lastEvent: LiveEvent | null;
  /** Receive live updates (returns an unsubscribe function). */
  subscribeLive: (listener: (update: LiveUpdate) => void) => () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

const FARM_KEY = "yai:farm";
const SIDEBAR_KEY = "yai:sidebar";
const SIDEBAR_EVENT = "yai:sidebar";

// The sidebar's collapsed state, remembered in this browser.
function subscribeSidebar(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SIDEBAR_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SIDEBAR_EVENT, onChange);
  };
}
function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
}
const INTERVAL_KEY = "yai:interval";
const INTERVAL_EVENT = "yai:interval";

// The last farm the user looked at, remembered across visits (read after hydration to keep SSR stable).
function subscribeSavedFarm(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function readSavedFarm(): string | null {
  try {
    return window.localStorage.getItem(FARM_KEY);
  } catch {
    return null; // storage blocked: fall back to the top-ranked farm
  }
}

// The demo account's live interval lives in this browser.
function subscribeSavedInterval(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(INTERVAL_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(INTERVAL_EVENT, onChange);
  };
}
function readSavedInterval(): number | null {
  try {
    const v = Number(window.localStorage.getItem(INTERVAL_KEY));
    return (INTERVAL_OPTIONS_S as readonly number[]).includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function ShellProvider({ farms, status, children }: { farms: ShellFarm[]; status: ShellStatus; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // An unknown farm id (the farm not-found page) is no farm the header or sidebar can point at.
  const pathSection = sectionOf(pathname);
  const pathFarm = pathSection === "farm" ? decodeURIComponent(pathname.split("/")[3] ?? "") : null;
  const section: Section = pathSection === "farm" && !farms.some((f) => f.id === pathFarm) ? "other" : pathSection;
  const [reportedFarmId, setFarmId] = useState<string | null>(null);
  const savedFarmId = useSyncExternalStore(subscribeSavedFarm, readSavedFarm, () => null);
  const farmId = reportedFarmId ?? (farms.some((f) => f.id === savedFarmId) ? savedFarmId : null) ?? farms[0]?.id ?? null;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const sidebarCollapsed = useSyncExternalStore(subscribeSidebar, readSidebarCollapsed, () => false);
  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded");
      window.dispatchEvent(new Event(SIDEBAR_EVENT));
    } catch {
      // storage blocked: the toggle just doesn't stick
    }
  }, []);
  const [farmsSheetOpen, setFarmsSheetOpen] = useState(false);
  // Accounts with devices watch their readings live from the start; the demo waits for the switch.
  const deviceCount = status.account?.devices ?? 0;
  const [live, setLive] = useState(deviceCount > 0);
  const [prevDeviceCount, setPrevDeviceCount] = useState(deviceCount);
  if (deviceCount !== prevDeviceCount) {
    setPrevDeviceCount(deviceCount);
    if (prevDeviceCount === 0 && deviceCount > 0) setLive(true);
  }
  const savedInterval = useSyncExternalStore(subscribeSavedInterval, readSavedInterval, () => null);
  const [accountInterval, setAccountInterval] = useState<number | null>(null);
  const [prevServerInterval, setPrevServerInterval] = useState(status.account?.interval_s ?? null);
  if ((status.account?.interval_s ?? null) !== prevServerInterval) {
    setPrevServerInterval(status.account?.interval_s ?? null);
    setAccountInterval(null);
  }
  // With devices, the interval is theirs (saved on the server); otherwise it's a preference in this browser.
  const hasDevices = deviceCount > 0;
  const intervalS = hasDevices && status.account ? (accountInterval ?? status.account.interval_s) : (savedInterval ?? DEFAULT_INTERVAL_S);
  const [liveDevices, setLiveDevices] = useState<Device[] | null>(null);
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null);
  const switchHandler = useRef<((id: string) => void) | null>(null);
  const listeners = useRef(new Set<(update: LiveUpdate) => void>());

  const reportFarm = useCallback(
    (id: string | null) => {
      if (!id || !farms.some((f) => f.id === id)) return;
      setFarmId(id);
      try {
        window.localStorage.setItem(FARM_KEY, id);
      } catch {
        // ignore
      }
    },
    [farms],
  );

  const switchFarm = useCallback(
    (id: string) => {
      reportFarm(id);
      if (switchHandler.current) {
        switchHandler.current(id);
        return;
      }
      // Stay in the same kind of view: a farm tab stays on that tab, the plan and land filter by farm;
      // from anywhere else, open the farm's workspace.
      if (section === "farm") {
        const tab = new URLSearchParams(window.location.search).get("tab");
        router.push(farmHref(id, tab));
      } else if (section === "insights") router.push(`/dashboard/insights?farm=${encodeURIComponent(id)}`);
      else if (section === "land") router.push(sectionHref("land", id));
      else router.push(farmHref(id));
    },
    [reportFarm, router, section],
  );

  const setSwitchHandler = useCallback((handler: ((id: string) => void) | null) => {
    switchHandler.current = handler;
  }, []);

  // useLiveUpdates keeps the latest callback itself, so this can be a plain function.
  const onLive = (update: LiveUpdate) => {
    if (update.devices) setLiveDevices(update.devices);
    if (hasDevices && update.interval_s && update.interval_s !== intervalS) setAccountInterval(update.interval_s);
    const [first] = Object.keys(update.farms);
    if (first) {
      const readings = update.readings.filter((r) => r.farm_id === first);
      setLastEvent({
        farmName: farms.find((f) => f.id === first)?.name ?? first,
        probes: new Set(readings.map((r) => r.sensor_id)).size,
        at: update.serverTime,
        simulated: readings.some((r) => r.simulated),
      });
    }
    listeners.current.forEach((l) => l(update));
  };
  const liveStatus = useLiveUpdates(live, onLive, intervalS * 1000);

  const setIntervalS = useCallback(
    async (seconds: number): Promise<string | null> => {
      if (!hasDevices) {
        try {
          window.localStorage.setItem(INTERVAL_KEY, String(seconds));
          window.dispatchEvent(new Event(INTERVAL_EVENT));
          return null;
        } catch {
          return "Your browser blocked saving this setting.";
        }
      }
      setAccountInterval(seconds);
      try {
        const res = await fetch("/api/devices", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interval_s: seconds }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; devices?: Device[] };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (body.devices) setLiveDevices(body.devices);
        router.refresh();
        return null;
      } catch (error) {
        setAccountInterval(null);
        return error instanceof Error ? error.message : "Could not save the interval.";
      }
    },
    [hasDevices, router],
  );

  const subscribeLive = useCallback((listener: (update: LiveUpdate) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo<ShellContextValue>(
    () => ({
      farms,
      status,
      section,
      farmId,
      reportFarm,
      switchFarm,
      setSwitchHandler,
      paletteOpen,
      setPaletteOpen,
      sidebarCollapsed,
      setSidebarCollapsed,
      farmsSheetOpen,
      setFarmsSheetOpen,
      live,
      setLive,
      intervalS,
      setIntervalS,
      liveDevices,
      liveStatus,
      lastEvent,
      subscribeLive,
    }),
    [
      farms,
      status,
      section,
      farmId,
      reportFarm,
      switchFarm,
      setSwitchHandler,
      paletteOpen,
      sidebarCollapsed,
      setSidebarCollapsed,
      farmsSheetOpen,
      live,
      intervalS,
      setIntervalS,
      liveDevices,
      liveStatus,
      lastEvent,
      subscribeLive,
    ],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}

/** "Do first" actions across the farms that are not ticked off yet: the Plan badge. */
export function useDoFirstLeft(): number {
  const { farms } = useShell();
  const { done } = useDoneActions();
  return farms.reduce((n, f) => n + f.doFirst.filter((k) => !done.has(k)).length, 0);
}

/** Optional variant for components that also render outside the dashboard (e.g. the landing page). */
export function useOptionalShell(): ShellContextValue | null {
  return useContext(ShellContext);
}

/** Tell the shell which farm this page shows, and optionally handle farm switches in place. */
export function useShellFarm(farmId: string | null, onSwitch?: (id: string) => void) {
  const { reportFarm, setSwitchHandler } = useShell();
  useEffect(() => {
    reportFarm(farmId);
  }, [farmId, reportFarm]);
  const handle = useEffectEvent((id: string) => onSwitch?.(id));
  const hasHandler = Boolean(onSwitch);
  useEffect(() => {
    if (!hasHandler) return;
    setSwitchHandler((id) => handle(id));
    return () => setSwitchHandler(null);
  }, [hasHandler, setSwitchHandler]);
}

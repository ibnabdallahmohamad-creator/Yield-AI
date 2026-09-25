"use client";

import { useEffect, useState } from "react";
import { useMap } from "react-leaflet";

/**
 * On a page that scrolls, the wheel scrolls the page and Ctrl/⌘ + wheel (or a trackpad pinch,
 * which browsers report as Ctrl + wheel) zooms the map. A plain wheel shows a short hint.
 */
export function GestureZoom() {
  const map = useMap();
  const [hint, setHint] = useState(false);
  useEffect(() => {
    const el = map.getContainer();
    let timer: number | undefined;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        acc += -e.deltaY * (e.deltaMode === 1 ? 33 : 1);
        if (Math.abs(acc) < 40) return;
        const step = acc > 0 ? 0.5 : -0.5;
        acc = 0;
        map.setZoomAround(map.mouseEventToContainerPoint(e), map.getZoom() + step);
        setHint(false);
        return;
      }
      setHint(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHint(false), 1500);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(timer);
    };
  }, [map]);
  if (!hint) return null;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 z-[1000] flex -translate-y-1/2 justify-center" aria-hidden="true">
      <span className="rounded-full bg-forest-900/85 px-4 py-2 text-sm font-medium text-primary-foreground shadow-md">
        Hold {mac ? "⌘" : "Ctrl"} and scroll to zoom the map
      </span>
    </div>
  );
}

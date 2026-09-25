"use client";

/** The weather map's options (inside the map's ⧉ popover): base map, wind animation, isolines, colour strength. */
import { Map as MapIcon, Moon, SatelliteIcon } from "lucide-react";
import { useId } from "react";
import { Segmented } from "@/components/dashboard/segmented";
import { Switch } from "@/components/ui/switch";
import type { WeatherBasemap } from "./weather-map";
import type { StreakMode } from "./particles";

export interface WeatherOptionsState {
  basemap: WeatherBasemap;
  streaks: StreakMode;
  isolines: boolean;
  opacity: number;
}

export const DEFAULT_WEATHER_OPTIONS: WeatherOptionsState = { basemap: "dark", streaks: "streaks", isolines: true, opacity: 0.82 };

export function WeatherOptions({ value, onChange, hasIsolines }: { value: WeatherOptionsState; onChange: (next: WeatherOptionsState) => void; hasIsolines: boolean }) {
  const isoId = useId();
  const opacityId = useId();
  const set = <K extends keyof WeatherOptionsState>(k: K, v: WeatherOptionsState[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-semibold">Base map</p>
        <Segmented
          ariaLabel="Base map"
          value={value.basemap}
          onChange={(v) => set("basemap", v)}
          options={[
            { value: "dark", label: "Dark", icon: <Moon /> },
            { value: "light", label: "Light", icon: <MapIcon /> },
            { value: "satellite", label: "Satellite", icon: <SatelliteIcon /> },
          ]}
        />
      </div>
      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-semibold">Wind on the map</p>
        <Segmented
          ariaLabel="Wind on the map"
          value={value.streaks}
          onChange={(v) => set("streaks", v)}
          options={[
            { value: "streaks", label: "Moving" },
            { value: "arrows", label: "Arrows" },
            { value: "off", label: "Off" },
          ]}
        />
      </div>
      <div className="flex items-start justify-between gap-3 border-t pt-4">
        <label htmlFor={isoId} className="cursor-pointer">
          <span className="block text-sm font-semibold">Isolines</span>
          <span className="block text-xs text-muted-foreground">{hasIsolines ? "Lines of equal value, labelled" : "Not drawn for this layer"}</span>
        </label>
        <Switch id={isoId} checked={value.isolines} onCheckedChange={(on) => set("isolines", on)} disabled={!hasIsolines} />
      </div>
      <div className="space-y-2 border-t pt-4">
        <label htmlFor={opacityId} className="flex items-baseline justify-between text-sm font-semibold">
          Colour strength <span className="text-xs font-normal text-muted-foreground tabular">{Math.round(value.opacity * 100)}%</span>
        </label>
        <input
          id={opacityId}
          type="range"
          min={0.3}
          max={1}
          step={0.05}
          value={value.opacity}
          onChange={(e) => set("opacity", Number(e.target.value))}
          className="w-full accent-[var(--primary)]"
        />
      </div>
    </div>
  );
}

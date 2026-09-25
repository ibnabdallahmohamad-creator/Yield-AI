"use client";

import dynamic from "next/dynamic";
import { CloudSun, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { MapSkeleton } from "@/components/dashboard/map";
import { PlaceSearch } from "@/components/farms/place-search";
import { LandProfileCard } from "@/components/land/land-profile-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConditionIcon } from "@/components/weather/weather-card";
import { ATLAS_LAYERS, LANDFORM_COLORS, scaleColor, formatLayerValue, type AtlasCell, type AtlasLayer } from "@/lib/land/layers";
import type { LandCell } from "@/lib/land/profile";
import type { ForecastDay } from "@/lib/weather/types";

const AtlasMap = dynamic(() => import("./atlas-map"), { ssr: false, loading: () => <MapSkeleton label="Loading the land atlas…" /> });

interface CellDetail {
  cell: LandCell;
  forecast?: { days: ForecastDay[]; sources: string[]; anchors: string[] } | null;
}

const n0 = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toString());
const n1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));

function Legend({ layer }: { layer: AtlasLayer }) {
  const def = ATLAS_LAYERS[layer];
  if (def.kind === "category") {
    return (
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
        {Object.values(LANDFORM_COLORS).map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm ring-1 ring-black/10" style={{ background: l.color }} aria-hidden="true" />
            {l.label}
          </li>
        ))}
      </ul>
    );
  }
  const [lo, hi] = def.domain;
  const steps = Array.from({ length: 24 }, (_, i) => scaleColor(def, lo + ((hi - lo) * i) / 23));
  return (
    <div className="text-[12px]">
      <div className="h-2.5 w-full max-w-72 rounded-full ring-1 ring-black/10" style={{ background: `linear-gradient(90deg, ${steps.join(",")})` }} aria-hidden="true" />
      <div className="flex max-w-72 justify-between text-muted-foreground tabular">
        <span>
          {lo.toLocaleString("en-US")} {def.unit}
        </span>
        <span>
          {hi.toLocaleString("en-US")} {def.unit}
        </span>
      </div>
    </div>
  );
}

function DerivedForecast({ forecast }: { forecast: NonNullable<CellDetail["forecast"]> }) {
  if (!forecast.days.length) return <p className="text-[13px] text-muted-foreground">The forecast is unavailable right now.</p>;
  return (
    <section aria-labelledby="cell-forecast" className="rounded-2xl border bg-card p-3 shadow-xs sm:p-4">
      <h2 id="cell-forecast" className="flex items-center gap-1.5 text-[16px] font-semibold">
        <CloudSun className="size-4 text-primary" aria-hidden="true" /> Next 7 days
      </h2>
      <p className="text-[12px] text-muted-foreground">
        Derived for this cell from nearby forecast points ({forecast.anchors.join(", ")}) · {forecast.sources.join(" + ")}
      </p>
      <div className="scrollbar-thin mt-2 overflow-x-auto">
        <table className="w-full min-w-[420px] text-[12.5px]">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 font-medium">High / low</th>
              <th className="py-1 font-medium">Humidity</th>
              <th className="py-1 font-medium">Wind (km/h)</th>
              <th className="py-1 font-medium">Rain</th>
              <th className="py-1 font-medium">ET₀</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {forecast.days.map((d) => (
              <tr key={d.date} className="border-t">
                <td className="py-1.5">
                  <span className="flex items-center gap-1.5">
                    <ConditionIcon condition={d.condition} className="size-4 text-primary" />
                    {new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" })}
                  </span>
                </td>
                <td className="py-1.5">
                  {n0(d.tmaxC)}° / {n0(d.tminC)}°
                </td>
                <td className="py-1.5">
                  {n0(d.rhMin)}–{n0(d.rhMax)}%
                </td>
                <td className="py-1.5">
                  {d.windDir ?? ""} {n0(d.windMeanKph)} <span className="text-muted-foreground">({n0(d.windMaxKph)})</span>
                </td>
                <td className="py-1.5">{n1(d.precipMm)} mm</td>
                <td className="py-1.5">{n1(d.et0Mm)} mm</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The land atlas: every 10 km² cell of Qatar with its profile and derived 7-day forecast. */
export function LandAtlas({
  cells,
  farms,
  initialCellId,
}: {
  cells: AtlasCell[];
  farms: Array<{ id: string; name: string; lat: number; lng: number }>;
  initialCellId?: string;
}) {
  const [layer, setLayer] = useState<AtlasLayer>("fertility");
  const [selectedId, setSelectedId] = useState<string | null>(initialCellId ?? null);
  const [detail, setDetail] = useState<{ id: string; data: CellDetail | null; error: string | null } | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom: number; key: number } | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    fetch(`/api/land?cell=${encodeURIComponent(selectedId)}&forecast=1`, { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as CellDetail & { error?: string };
        setDetail({ id: selectedId, data: res.ok ? body : null, error: res.ok ? null : (body.error ?? "Could not load this cell.") });
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetail({ id: selectedId, data: null, error: "Could not load this cell." });
      });
    return () => controller.abort();
  }, [selectedId]);

  const selected = cells.find((c) => c.id === selectedId) ?? null;
  const current = detail?.id === selectedId ? detail : null;
  const def = ATLAS_LAYERS[layer];
  const arable = cells.filter((c) => c.arable);

  return (
    <div className="mx-auto grid max-w-[1720px] gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_460px]">
      <section aria-label="Land atlas map" className="flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <PlaceSearch
            className="min-w-[220px] flex-1"
            placeholder="Find a place, coordinates or a cell id (QA-R45-C21)"
            onSelect={(p) => {
              const hit = cells.find((c) => p.lat >= c.b[0] && p.lat < c.b[2] && p.lng >= c.b[1] && p.lng < c.b[3]);
              if (hit) setSelectedId(hit.id);
              setFlyTo({ lat: p.lat, lng: p.lng, zoom: 12, key: Date.now() });
            }}
          />
          <Select value={layer} onValueChange={(v) => setLayer(v as AtlasLayer)}>
            <SelectTrigger className="w-48 bg-card" aria-label="Map layer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ATLAS_LAYERS) as AtlasLayer[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {ATLAS_LAYERS[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative isolate h-[clamp(420px,calc(100dvh_-_200px),860px)]">
          <AtlasMap cells={cells} layer={layer} selectedId={selectedId} onSelect={setSelectedId} farms={farms} flyTo={flyTo} />
        </div>
        <div className="space-y-1 border-t px-3 py-2">
          <p className="text-[12.5px] text-muted-foreground">
            <span className="font-semibold text-foreground">{def.label}.</span> {def.describe}
          </p>
          <Legend layer={layer} />
        </div>
      </section>

      <aside className="flex min-w-0 flex-col gap-4">
        {selected ? (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="font-display text-[22px] font-semibold">{selected.id}</h2>
              <span className="text-[13px] text-muted-foreground">
                {selected.m} · {def.label}: {formatLayerValue(layer, selected)}
              </span>
            </div>
            {current?.data ? (
              <>
                <LandProfileCard cell={current.data.cell} />
                {current.data.forecast ? <DerivedForecast forecast={current.data.forecast} /> : null}
              </>
            ) : current?.error ? (
              <p className="text-[13px] text-muted-foreground">{current.error}</p>
            ) : (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading the cell profile and forecast…
              </p>
            )}
          </>
        ) : (
          <section className="rounded-2xl border bg-card p-4 shadow-xs">
            <h2 className="text-[16px] font-semibold">Qatar land atlas</h2>
            <p className="mt-1 text-[13.5px] text-muted-foreground">
              Qatar is divided into {cells.length.toLocaleString("en-US")} cells of 10 km². Each cell has a description of its soil and fertility, rainfall,
              temperatures, humidity, groundwater and the crops it can grow, plus a derived 7-day weather, humidity and wind forecast. The AI
              assistant reads the cell under each farm when it answers.
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
              <div className="rounded-xl bg-sand-100 p-2.5">
                <dt className="text-muted-foreground">Potentially arable cells</dt>
                <dd className="text-[18px] font-semibold tabular">{arable.length.toLocaleString("en-US")}</dd>
              </div>
              <div className="rounded-xl bg-sand-100 p-2.5">
                <dt className="text-muted-foreground">Good fertility or better</dt>
                <dd className="text-[18px] font-semibold tabular">{cells.filter((c) => c.fertility >= 50).length.toLocaleString("en-US")}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[13px] text-muted-foreground">Click a cell on the map, or search for a place, to see its profile.</p>
          </section>
        )}
      </aside>
    </div>
  );
}

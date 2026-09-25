"use client";

import { Loader2, MapPin, Search } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface PlaceResult {
  label: string;
  detail: string;
  lat: number;
  lng: number;
  source: string;
}

/** Search box for places in Qatar: names (OpenStreetMap), "lat, lng" or a land-atlas cell id. */
export function PlaceSearch({
  onSelect,
  placeholder = "Search a farm, village or area — or type 25.75, 51.37",
  className,
}: {
  onSelect: (place: PlaceResult) => void;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  const run = async (q: string) => {
    const n = ++request.current;
    if (q.trim().length < 2) {
      setResults([]);
      setNote(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q.trim())}`);
      const body = (await res.json()) as { results?: PlaceResult[]; note?: string | null; error?: string };
      if (n !== request.current) return;
      setResults(body.results ?? []);
      setNote(body.error ?? body.note ?? ((body.results ?? []).length === 0 ? "No places found in Qatar — try another spelling, or drop the pin on the map." : null));
      setOpen(true);
    } catch {
      if (n === request.current) setNote("Search is unavailable — drop the pin on the map instead.");
    } finally {
      if (n === request.current) setLoading(false);
    }
  };

  // Debounced search while typing (Nominatim allows one request per second).
  const searchLater = useEffectEvent((q: string) => void run(q));
  useEffect(() => {
    if (query.trim().length < 3) return;
    const t = window.setTimeout(() => searchLater(query), 650);
    return () => window.clearTimeout(t);
  }, [query]);

  const choose = (place: PlaceResult) => {
    onSelect(place);
    setOpen(false);
    setQuery(place.label);
  };

  return (
    <div className={cn("relative", className)}>
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
      >
        <label htmlFor={`${id}-q`} className="sr-only">
          Search for your farm
        </label>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={`${id}-q`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder={placeholder}
            className="h-9 bg-card pl-8"
            autoComplete="off"
            aria-controls={`${id}-results`}
            aria-expanded={open}
          />
        </div>
        <Button type="submit" size="sm" className="h-9" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <Search />}
          <span className="hidden sm:inline">Search</span>
        </Button>
      </form>
      {open && (results.length > 0 || note) ? (
        <div
          id={`${id}-results`}
          className="absolute top-full right-0 left-0 z-[1100] mt-1 overflow-hidden rounded-xl border bg-popover shadow-lg"
        >
          {results.length > 0 ? (
            <ul role="listbox" aria-label="Places found">
              {results.map((r) => (
                <li key={`${r.lat},${r.lng},${r.label}`} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => choose(r)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-[13.5px] hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.label}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {r.detail} · {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {note ? <p className="border-t px-3 py-2 text-[12.5px] text-muted-foreground first:border-t-0">{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSun, Droplets, RefreshCw, Sun, Wind } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ForecastDay, LocationWeather } from "@/lib/weather/types";

const n0 = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toString());
const n1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));

export function ConditionIcon({ condition, className }: { condition: string; className?: string }) {
  const c = condition.toLowerCase();
  const Icon = /thunder|storm/.test(c)
    ? CloudLightning
    : /drizzle/.test(c)
      ? CloudDrizzle
      : /rain|shower/.test(c)
        ? CloudRain
        : /fog|mist|haze|dust|sand/.test(c)
          ? CloudFog
          : /partly|mainly clear/.test(c)
            ? CloudSun
            : /cloud|overcast/.test(c)
              ? Cloud
              : /wind/.test(c)
                ? Wind
                : Sun;
  return <Icon className={className} aria-hidden="true" />;
}

const dayLabel = (date: string, i: number) =>
  i === 0
    ? "Today"
    : new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });

function DayColumn({ day, index }: { day: ForecastDay; index: number }) {
  return (
    <li className="flex min-w-[88px] flex-1 flex-col items-center gap-0.5 rounded-xl border bg-card px-2 py-2 text-center">
      <span className="text-[12px] font-semibold">{dayLabel(day.date, index)}</span>
      <ConditionIcon condition={day.condition} className="my-0.5 size-5 text-primary" />
      <span className="text-[13px] font-semibold tabular">
        {n0(day.tmaxC)}° <span className="font-normal text-muted-foreground">{n0(day.tminC)}°</span>
      </span>
      <span className="text-[11.5px] text-muted-foreground tabular" title="Relative humidity, min–max">
        <Droplets className="mr-0.5 inline size-3" aria-hidden="true" />
        {n0(day.rhMin)}–{n0(day.rhMax)}%
      </span>
      <span className="text-[11.5px] text-muted-foreground tabular" title="Mean wind (max) and direction">
        <Wind className="mr-0.5 inline size-3" aria-hidden="true" />
        {day.windDir ?? ""} {n0(day.windMeanKph)}
        <span className="opacity-70">/{n0(day.windMaxKph)}</span> km/h
      </span>
      <span className="text-[11.5px] text-muted-foreground tabular" title="Rain and reference evapotranspiration">
        {n1(day.precipMm)} mm · ET₀ {n1(day.et0Mm)}
      </span>
    </li>
  );
}

/** Real-time conditions and the 7-day forecast for a farm (WeatherAPI.com; Open-Meteo fills the week). */
export function WeatherCard({ farmId, lat, lng, className }: { farmId?: string; lat?: number; lng?: number; className?: string }) {
  const [weather, setWeather] = useState<LocationWeather | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const query = farmId ? `farm=${encodeURIComponent(farmId)}` : `lat=${lat}&lng=${lng}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/weather?${query}`, { cache: "no-store" });
      const body = (await res.json()) as LocationWeather & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setWeather(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Weather is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const c = weather?.current;
  return (
    <section aria-labelledby="weather-heading" className={cn("rounded-2xl border bg-card p-3 shadow-xs sm:p-4", className)}>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 id="weather-heading" className="text-[16px] font-semibold">
          Weather
        </h2>
        <span className="text-[12.5px] text-muted-foreground">
          {weather ? `Live + 7-day forecast · ${weather.sources.join(" + ") || "no provider"}` : "Live + 7-day forecast"}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => void load()} disabled={loading} aria-label="Refresh weather">
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !weather ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : error && !weather ? (
        <p className="text-[13px] text-muted-foreground">Weather is unavailable right now ({error}).</p>
      ) : weather ? (
        <>
          {c ? (
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-forest-50 px-3 py-2">
              <ConditionIcon condition={c.condition} className="size-8 text-primary" />
              <div>
                <p className="text-[24px] leading-none font-semibold tabular">{n0(c.tempC)}°C</p>
                <p className="text-[12.5px] text-muted-foreground">
                  {c.condition}
                  {c.feelsLikeC != null ? ` · feels ${n0(c.feelsLikeC)}°` : ""}
                </p>
              </div>
              <dl className="grid grid-cols-3 gap-x-4 text-[12.5px]">
                <div>
                  <dt className="text-muted-foreground">Humidity</dt>
                  <dd className="font-semibold tabular">{n0(c.humidity)}%</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Wind</dt>
                  <dd className="font-semibold tabular">
                    {c.windDir ?? ""} {n0(c.windKph)} km/h
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Gusts</dt>
                  <dd className="font-semibold tabular">{c.gustKph != null ? `${n0(c.gustKph)} km/h` : "—"}</dd>
                </div>
              </dl>
              <p className="ml-auto text-[11.5px] text-muted-foreground">
                Updated {new Date(c.observedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qatar" })}
              </p>
            </div>
          ) : null}
          {weather.days.length ? (
            <ol className="scrollbar-thin flex gap-2 overflow-x-auto pb-1" aria-label="7-day forecast">
              {weather.days.map((d, i) => (
                <DayColumn key={d.date} day={d} index={i} />
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-muted-foreground">No forecast available.</p>
          )}
          {weather.alerts.length ? (
            <p className="mt-2 rounded-lg bg-risk-medium-soft px-2.5 py-1.5 text-[12.5px] text-risk-medium-ink">Alerts: {weather.alerts.join("; ")}</p>
          ) : null}
          {weather.note ? <p className="mt-2 text-[12px] text-muted-foreground">{weather.note}</p> : null}
        </>
      ) : null}
    </section>
  );
}

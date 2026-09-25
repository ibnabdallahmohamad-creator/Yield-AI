"use client";

/**
 * Everything the forecast says about one spot at the timeline's hour: temperature and feels-like,
 * humidity and dew point, wind with direction and gusts, rain, cloud and pressure, plus whether it is
 * a good hour to spray (wind and the Delta-T evaporation index).
 */
import { ArrowUp, X } from "lucide-react";
import { compassPoint, fmtNum } from "@/lib/format";
import { FieldSampler, wetBulb, windFromDeg, type WeatherField } from "@/lib/weather/field";
import { beaufort, kmh } from "@/lib/weather/layers";
import { sprayRating, SPRAY_TONE_CLASS } from "@/lib/weather/work-windows";
import { cn } from "@/lib/utils";
import { hourLabel } from "./weather-timeline";

export function readPoint(field: WeatherField, t: number, lat: number, lng: number) {
  const s = new FieldSampler(field, t);
  const u = s.value("u", lat, lng);
  const v = s.value("v", lat, lng);
  const temp = s.value("temp", lat, lng);
  const rh = s.value("rh", lat, lng);
  const wind = Math.hypot(u, v);
  return {
    temp,
    feels: s.value("feels", lat, lng),
    rh,
    dew: s.value("dew", lat, lng),
    wind,
    windDir: windFromDeg(u, v),
    gust: s.value("gust", lat, lng),
    precip: s.value("precip", lat, lng),
    precipProb: s.value("precipProb", lat, lng),
    cloud: s.value("cloud", lat, lng),
    pressure: s.value("pressure", lat, lng),
    deltaT: temp - wetBulb(temp, rh),
  };
}

function Row({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-semibold tabular">
        {value}
        {sub ? <span className="ml-1 text-xs font-normal text-muted-foreground">{sub}</span> : null}
      </dd>
    </div>
  );
}

export function PointReadout({
  field,
  t,
  lat,
  lng,
  title,
  onClose,
  action,
  className,
}: {
  field: WeatherField;
  t: number;
  lat: number;
  lng: number;
  title: string;
  onClose?: () => void;
  action?: React.ReactNode;
  className?: string;
}) {
  const p = readPoint(field, t, lat, lng);
  if (!Number.isFinite(p.temp)) return null;
  const bf = beaufort(p.wind);
  const spray = sprayRating({ wind: p.wind, gust: p.gust, precip: p.precip, precipProb: p.precipProb, temp: p.temp, deltaT: p.deltaT });
  const time = field.times[Math.min(field.nt - 1, Math.max(0, Math.round(t)))];
  return (
    <section aria-label={`Forecast at ${title}`} className={cn("rounded-xl border bg-card/97 p-3 shadow-lg backdrop-blur-sm", className)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="truncate text-xs text-muted-foreground tabular">
            {hourLabel(time)} · {lat.toFixed(2)}° N, {lng.toFixed(2)}° E
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none pointer-coarse:size-11"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
        <Row label="Temperature" value={`${fmtNum(p.temp, 1)} °C`} sub={`feels ${fmtNum(p.feels, 0)}°`} />
        <Row label="Humidity" value={`${fmtNum(p.rh, 0)}%`} sub={`dew ${fmtNum(p.dew, 0)}°`} />
        <Row
          label="Wind"
          value={
            <span className="inline-flex items-center gap-1">
              <ArrowUp className="size-3.5 text-muted-foreground" style={{ transform: `rotate(${p.windDir + 180}deg)` }} aria-hidden="true" />
              {fmtNum(p.wind, 1)} m/s
            </span>
          }
          sub={`${compassPoint(p.windDir)} · ${fmtNum(kmh(p.wind), 0)} km/h`}
        />
        <Row label="Gusts" value={`${fmtNum(p.gust, 1)} m/s`} sub={bf.label.toLowerCase()} />
        <Row label="Rain" value={p.precip >= 0.05 ? `${fmtNum(p.precip, 1)} mm` : "None"} sub={Number.isFinite(p.precipProb) ? `${fmtNum(p.precipProb, 0)}% chance` : undefined} />
        <Row label="Clouds" value={`${fmtNum(p.cloud, 0)}%`} sub={`${fmtNum(p.pressure, 0)} hPa`} />
      </dl>
      <p className="mt-2 flex items-center gap-2 border-t pt-2 text-xs">
        <span className={cn("inline-flex h-5 items-center rounded-full px-2 font-semibold", SPRAY_TONE_CLASS[spray.tone])}>Spraying: {spray.label}</span>
        <span className="truncate text-muted-foreground">{spray.reason}</span>
      </p>
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}

/**
 * Farms & devices on the demo account: the sample farms and the probes behind their readings,
 * read-only, with the way to connect real ESP32 probes (a new account).
 */
import { ArrowRight, Cpu, Wifi } from "lucide-react";
import Link from "next/link";
import { HealthDot, RISK_TONE } from "@/components/dashboard/risk-badge";
import { Button } from "@/components/ui/button";
import { CROPS } from "@/lib/agronomy-tables";
import { probeLocation } from "@/lib/ai/analysis";
import { rankFarms } from "@/lib/dashboard";
import { formatShortDay } from "@/lib/format";
import { farmTabHref } from "@/lib/routes";
import type { FarmBundle } from "@/lib/types";

const CARD = "rounded-2xl border bg-card shadow-xs";

function lastReading(bundle: FarmBundle, today: string): string {
  const day = bundle.days.findLast((d) => d !== null)?.date;
  if (!day) return "No readings yet";
  return day === today ? "Reporting today" : `Last reading ${formatShortDay(day)}`;
}

export function DemoDevices({ farms, today }: { farms: FarmBundle[]; today: string }) {
  const ranked = rankFarms(farms);
  const probes = ranked.reduce((n, b) => n + b.sensors.length, 0);

  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">Farms &amp; devices</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {ranked.length} sample farms · {probes} probes · read-only on the demo account
      </p>

      <section aria-labelledby="connect-heading" className={`${CARD} mt-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6`}>
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-primary" aria-hidden="true">
          <Wifi className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="connect-heading" className="text-base font-semibold">
            Connect your own ESP32 probes
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground">
            Create an account to add your farms, pair ESP32 devices over Wi-Fi and see their readings live. A new account starts empty, with no sample data.
          </p>
        </div>
        <Button asChild className="h-11 shrink-0 sm:h-9 sm:pointer-coarse:h-11">
          <Link href="/signup">
            Create an account <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </section>

      <section aria-labelledby="sample-heading" className={`${CARD} mt-4 overflow-hidden lg:mt-6`}>
        <h2 id="sample-heading" className="px-5 pt-5 pb-3 text-base font-semibold sm:px-6">
          Sample probes
        </h2>
        <ul className="divide-y border-t">
          {ranked.map((b) => (
            <li key={b.farm.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:gap-6 sm:px-6">
              <div className="min-w-0 sm:w-64 sm:shrink-0">
                <p className="flex items-center gap-2">
                  <HealthDot tone={b.insight ? RISK_TONE[b.insight.risk_level] : "none"} className="ring-0" />
                  <Link href={farmTabHref(b.farm.id, "probes")} className="truncate font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
                    {b.farm.name}
                  </Link>
                </p>
                <p className="mt-0.5 pl-4.5 text-sm text-muted-foreground">
                  {CROPS[b.farm.main_crop].name} · {lastReading(b, today)}
                </p>
              </div>
              <ul className="flex flex-wrap gap-2" aria-label={`Probes at ${b.farm.name}`}>
                {b.sensors.map((s) => (
                  <li key={s.id} className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background/60 px-2.5 text-sm">
                    <Cpu className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="font-medium tabular">{s.id}</span>
                    <span className="text-muted-foreground">{probeLocation(b, s.id)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

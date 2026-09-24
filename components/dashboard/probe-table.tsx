import { probeLocation } from "@/lib/ai/analysis";
import { formatShortDay } from "@/lib/format";
import { colorFor, formatValue, METRICS, type MetricKey } from "@/lib/metrics";
import type { FarmBundle, SensorDay } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLUMNS: { key: MetricKey; label: string; pick: (s: SensorDay) => number | null }[] = [
  { key: "ece", label: "ECe", pick: (s) => s.ece },
  { key: "moisture", label: "Moisture", pick: (s) => s.moisture },
  { key: "ph", label: "pH", pick: (s) => s.ph },
  { key: "temperature", label: "Temp.", pick: (s) => s.temperature },
  { key: "n", label: "N", pick: (s) => s.n },
  { key: "p", label: "P", pick: (s) => s.p },
  { key: "k", label: "K", pick: (s) => s.k },
  { key: "deficit", label: "Deficit", pick: (s) => s.deficitPct },
  { key: "yieldLoss", label: "Yield loss", pick: (s) => s.yieldLoss },
];

/** Daily means per probe for one day, each cell marked with its class colour. The saltiest probe is flagged. */
export function ProbeTable({ bundle, index, className }: { bundle: FarmBundle; index: number; className?: string }) {
  const day = bundle.days[index];
  if (!day || day.sensors.length === 0) {
    return (
      <p className={cn("rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground", className)}>
        No probe readings on this day.
      </p>
    );
  }
  const sensors = [...day.sensors].sort((a, b) => a.id.localeCompare(b.id));
  const saltiest = sensors.reduce<SensorDay | null>((top, s) => (s.ece != null && (top?.ece == null || s.ece > top.ece) ? s : top), null);

  return (
    <div className={cn("scrollbar-thin overflow-x-auto", className)}>
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[13px] tabular">
        <caption className="sr-only">
          Probe readings (daily means) on {formatShortDay(day.date)}
        </caption>
        <thead>
          <tr className="text-left text-[11.5px] text-muted-foreground">
            <th scope="col" className="border-b px-3 py-2 font-semibold">
              Probe
            </th>
            {COLUMNS.map((c) => (
              <th key={c.key} scope="col" className="border-b px-3 py-2 text-right font-semibold whitespace-nowrap">
                {c.label}
                <span className="block text-[10.5px] font-normal">{METRICS[c.key].unit === "pH" ? " " : METRICS[c.key].unit}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sensors.map((s) => {
            const worst = s === saltiest;
            return (
              <tr key={s.id} className={cn(worst && "bg-risk-high-soft/50")}>
                <th scope="row" className="border-b px-3 py-2 text-left font-semibold whitespace-nowrap">
                  {s.id}
                  <span className="ml-1.5 font-normal text-muted-foreground">{probeLocation(bundle, s.id)}</span>
                  {worst ? (
                    <span className="ml-2 rounded-full bg-risk-high-soft px-1.5 py-px text-[10.5px] font-bold text-risk-high-ink">
                      Saltiest
                    </span>
                  ) : null}
                </th>
                {COLUMNS.map((c) => {
                  const metric = METRICS[c.key];
                  const value = c.pick(s);
                  return (
                    <td key={c.key} className="border-b px-3 py-2 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-2 rounded-full ring-1 ring-black/15"
                          style={{ background: colorFor(metric, value) }}
                          aria-hidden="true"
                        />
                        {formatValue(metric, value, false)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

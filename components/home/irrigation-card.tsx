/**
 * "Irrigation this week": when each farm next needs water and how much, grouped by day. One card
 * for Home and the Plan, so the schedule reads the same wherever it appears.
 */
import Link from "next/link";
import { irrigationSchedule, type FarmRow } from "@/lib/portfolio";
import { farmTabHref } from "@/lib/routes";
import { cn } from "@/lib/utils";

export function IrrigationCard({ rows, className }: { rows: FarmRow[]; className?: string }) {
  const schedule = irrigationSchedule(rows);
  return (
    <section aria-labelledby="water-heading" className={cn("rounded-2xl border bg-card p-4 shadow-xs sm:p-5", className)}>
      <h2 id="water-heading" className="text-base font-semibold">
        Irrigation this week
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Amounts include water to flush salt.</p>
      {schedule.length > 0 ? (
        <ol className="mt-2 divide-y">
          {schedule.map((g) => (
            <li key={g.when} className="flex gap-4 py-3">
              <span
                className={cn(
                  "w-20 shrink-0 text-sm font-semibold max-sm:leading-11",
                  g.status === "now" ? "text-risk-high-ink" : g.status === "soon" ? "text-risk-medium-ink" : "text-foreground",
                )}
              >
                {g.when}
              </span>
              {/* Phones: each row is a 44px tap target (the link stretches over it). */}
              <ul className="min-w-0 flex-1 sm:space-y-1.5">
                {g.rows.map((r) => (
                  <li key={r.id} className="relative flex items-center justify-between gap-3 text-sm max-sm:min-h-11">
                    <Link
                      href={farmTabHref(r.id)}
                      className="truncate rounded-sm after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-ring/60"
                    >
                      {r.name}
                    </Link>
                    <span className="shrink-0 tabular text-muted-foreground">{r.irrigation.grossMm} mm</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No readings to plan irrigation yet.</p>
      )}
    </section>
  );
}

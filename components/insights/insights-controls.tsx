"use client";

/** The Plan page's few client pieces: the farm filter, the "How it works" drawer and farm reporting. */
import { BookOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useShellFarm } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { insightsHref, type PlanView } from "@/lib/routes";

const ALL = "all";

export function FarmFilter({ farms, value, view }: { farms: Array<{ id: string; name: string }>; value: string | null; view?: PlanView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Select value={value ?? ALL} onValueChange={(v) => startTransition(() => router.push(insightsHref(v === ALL ? null : v, view)))}>
      <SelectTrigger aria-label="Show advice for" aria-busy={pending} className="h-11 min-w-44 flex-1 bg-card font-medium sm:h-9 sm:flex-none sm:pointer-coarse:h-11">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        <SelectItem value={ALL} className="min-h-9">
          All farms
        </SelectItem>
        <SelectSeparator />
        {farms.map((f) => (
          <SelectItem key={f.id} value={f.id} className="min-h-9">
            {f.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Reports the farm on screen so the rail, ⌘K and the assistant follow it. */
export function ReportFarm({ farmId }: { farmId: string }) {
  useShellFarm(farmId);
  return null;
}

const SECTION = "space-y-2 text-sm leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground";

/** Method on demand: what the risk score is, and where the advice comes from. */
export function HowItWorks() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" className="h-11 text-muted-foreground sm:h-9 sm:pointer-coarse:h-11">
          <BookOpen /> How it works
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[92vw] gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>How the advice works</SheetTitle>
          <SheetDescription>What the risk score means and where each number comes from.</SheetDescription>
        </SheetHeader>
        <div className="scrollbar-thin min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className={SECTION}>
            <h3 className="text-base font-semibold text-foreground">The risk score</h3>
            <p>
              A score from 0 to 100 for how much of this season&apos;s yield is at risk. It blends two parts and takes the worse
              one first:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Salt:</strong> the yield the crop loses at today&apos;s soil salinity (Maas–Hoffman, FAO-29), plus how fast
                salinity rose over the last 30 days.
              </li>
              <li>
                <strong>Water:</strong> how far the root zone has dried past the point where the crop starts to suffer (FAO-56
                soil-water balance).
              </li>
              <li>
                Small extras for alkaline soil (pH above 8) and falling potassium.
              </li>
            </ul>
            <div className="grid grid-cols-3 gap-2 pt-1 text-center text-xs font-semibold">
              <span className="rounded-lg bg-risk-low-soft px-2 py-2 text-risk-low-ink">Low · under 40</span>
              <span className="rounded-lg bg-risk-medium-soft px-2 py-2 text-risk-medium-ink">Medium · 40–69</span>
              <span className="rounded-lg bg-risk-high-soft px-2 py-2 text-risk-high-ink">High · 70+</span>
            </div>
            <p>It is a product heuristic to rank farms by urgency, not a published index.</p>
          </section>
          <section className={SECTION}>
            <h3 className="text-base font-semibold text-foreground">The actions</h3>
            <p>
              Each farm gets a written assessment from the latest probe readings and the weather. Every number in it comes
              from the FAO-56 water balance and FAO-29 salinity tables. Actions are sorted <strong>Do first</strong>,{" "}
              <strong>This week</strong>, then <strong>When you can</strong>, and riskier farms come first.
            </p>
            <p>
              Open <strong>Why</strong> on an action to see the reasoning and the chart behind it, or ask the assistant to walk
              you through it.
            </p>
          </section>
          <section className={SECTION}>
            <h3 className="text-base font-semibold text-foreground">Next season</h3>
            <p>
              Crop suggestions compare each crop&apos;s expected yield at the farm&apos;s current salinity with the local market. If
              the best crop&apos;s market is oversupplied, a better-selling alternative is shown.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

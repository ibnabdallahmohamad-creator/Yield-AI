import { ArrowDown, ArrowRight, Check, ChevronRight, Cpu, LineChart, ListChecks, MapIcon, MessagesSquare, Sparkles, Sprout } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { FieldPattern } from "@/components/brand/field-pattern";
import { Logo } from "@/components/brand/logo";
import { DemoChart } from "@/components/landing/demo-chart";
import { DemoChat } from "@/components/landing/demo-chat";
import { DemoMap } from "@/components/landing/demo-map";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/session";
import { getShowcase, type Showcase } from "@/lib/data/showcase";
import { cn } from "@/lib/utils";

const REPO_URL = "https://github.com/ibnabdallahmohamad-creator/Yield-AI";

const STEPS = [
  {
    icon: Cpu,
    title: "Probe",
    body: "In-field probes log soil salinity (EC), moisture, pH, temperature and NPK every three hours.",
  },
  {
    icon: MapIcon,
    title: "Map",
    body: "Readings are interpolated across each field (IDW on 5 m cells), so hotspots stand out at a glance.",
  },
  {
    icon: Sparkles,
    title: "AI insight",
    body: "FAO-56 water balance and FAO-29 salinity models score each farm’s risk and explain the cause.",
  },
  {
    icon: ListChecks,
    title: "Action",
    body: "Clear next steps: how much to irrigate, when to leach salts, and what to plant next season.",
  },
];

async function loadShowcase(): Promise<Showcase | null> {
  try {
    return await getShowcase();
  } catch (error) {
    console.warn("[landing] Demo data unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}

export default async function Home() {
  // Rendered per request: the demo data is dated to today (and the header knows who is signed in).
  await connection();
  const [showcase, user] = await Promise.all([loadShowcase(), getCurrentUser()]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6">
          <Link href="/" className="rounded-lg focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none">
            <Logo />
          </Link>
          <nav aria-label="Main" className="ml-auto flex items-center gap-1 sm:gap-2">
            <Button asChild variant="ghost" className="hidden h-9 px-3 text-[14px] sm:inline-flex">
              <a href="#how-it-works">How it works</a>
            </Button>
            <Button asChild variant="ghost" className="hidden h-9 px-3 text-[14px] md:inline-flex">
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </Button>
            {user ? null : (
              <Button asChild variant="ghost" className="h-9 px-3 text-[14px]">
                <Link href="/login">Sign in</Link>
              </Button>
            )}
            <Button asChild className="h-9 px-3.5 text-[14px]">
              <Link href="/dashboard">
                Open Dashboard <ArrowRight />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <FieldPattern color="#1f5a3d" className="opacity-[0.07]" />
          <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:gap-12 lg:py-14">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-card/80 px-3 py-1 text-[12.5px] font-semibold text-primary shadow-xs">
                <Sprout className="size-3.5" aria-hidden="true" />
                The AI-powered CRM for agribusinesses
              </p>
              <h1 className="mt-5 font-display text-[40px] leading-[1.06] font-semibold tracking-tight text-balance sm:text-5xl xl:text-[56px]">
                Every field, every probe, one clear next step.
              </h1>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
                Yield AI turns soil-probe readings from farms across northern Qatar into salinity and moisture maps, risk scores and
                plain-language actions — grounded in FAO-56 and FAO-29 science.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild className="h-11 px-5 text-[15px]">
                  <Link href="/dashboard">
                    Open Dashboard <ArrowRight />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11 bg-card/70 px-5 text-[15px]">
                  <a href="#demo">
                    Try the demo <ArrowDown />
                  </a>
                </Button>
              </div>
              <ul className="mt-8 grid gap-x-6 gap-y-2 text-[13.5px] text-muted-foreground sm:grid-cols-2">
                {[
                  showcase ? `${showcase.farms.length} demo farms, 60 days of readings` : "Demo farms with 60 days of readings",
                  "Salinity, moisture, pH, temperature, NPK",
                  "Works offline with a built-in agronomy engine",
                  "Open source and free, including the model",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <WidgetCard
              icon={<MapIcon />}
              title="Farm map"
              description="Pins are coloured by soil salinity (ECe). Click a farm for its risk and top insight."
              className="shadow-lg shadow-forest-900/10"
            >
              {showcase ? <DemoMap farms={showcase.farms} /> : <Unavailable />}
            </WidgetCard>
          </div>
        </section>

        {/* Demo widgets */}
        <section id="demo" aria-labelledby="demo-heading" className="mx-auto max-w-7xl scroll-mt-20 px-4 pb-12 sm:px-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
            <h2 id="demo-heading" className="font-display text-[28px] leading-tight font-semibold tracking-tight">
              Try it on demo data
            </h2>
            <p className="text-[14px] text-muted-foreground">
              The same map, charts and assistant as the dashboard{showcase ? ` — here for ${showcase.chat.farmName}` : ""}.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <WidgetCard
              icon={<LineChart />}
              title="Soil trends"
              description="30 days of probe readings, with the FAO class bands and crop threshold."
              bodyClassName="p-4"
            >
              {showcase ? <DemoChart bundle={showcase.chart.bundle} dates={showcase.chart.dates} /> : <Unavailable />}
            </WidgetCard>
            <WidgetCard
              icon={<MessagesSquare />}
              title="Ask the agronomist"
              description="Pick a question — the answer quotes this farm’s own readings."
              className="h-[460px]"
              bodyClassName="flex min-h-0 flex-1 flex-col p-4"
            >
              {showcase && showcase.chat.answers.length > 0 ? (
                <DemoChat farmName={showcase.chat.farmName} answers={showcase.chat.answers} />
              ) : (
                <Unavailable />
              )}
            </WidgetCard>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-16 border-t bg-sidebar/60">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
            <h2 id="how-heading" className="font-display text-[28px] leading-tight font-semibold tracking-tight">
              How it works
            </h2>
            <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
              {STEPS.map((step, i) => (
                <li key={step.title} className="relative flex gap-3.5 rounded-2xl border bg-card p-4 shadow-xs">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <step.icon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Step {i + 1}</p>
                    <h3 className="text-[16px] font-semibold">{step.title}</h3>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{step.body}</p>
                  </div>
                  {i < STEPS.length - 1 ? (
                    <ChevronRight
                      className="absolute top-1/2 -right-[19px] z-10 hidden size-5 -translate-y-1/2 rounded-full bg-sidebar text-primary lg:block"
                      aria-hidden="true"
                    />
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-6 text-[13px] text-muted-foreground sm:px-6">
          <Logo markClassName="size-6" className="text-foreground" />
          <p>Open source (MIT) and free. Farms and readings on this page are simulated demo data.</p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-md font-medium text-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:ml-auto"
          >
            Source on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

function WidgetCard({
  icon,
  title,
  description,
  children,
  className,
  bodyClassName,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm", className)} aria-label={title}>
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary [&_svg]:size-4">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-[15px] leading-tight font-semibold">{title}</h3>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

function Unavailable() {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-1 p-6 text-center">
      <p className="text-[14px] font-semibold">The demo data is warming up</p>
      <p className="max-w-xs text-[13px] text-muted-foreground">Refresh in a moment, or open the dashboard to explore the farms.</p>
    </div>
  );
}

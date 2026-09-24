import Link from "next/link";
import { FieldPattern } from "@/components/brand/field-pattern";
import { Logo } from "@/components/brand/logo";

const POINTS = [
  { title: "Probe → map", body: "Salinity, moisture and nutrients interpolated across every field." },
  { title: "FAO-grade numbers", body: "ET₀, crop water use and yield loss computed with FAO-56 and FAO-29." },
  { title: "An agronomist on call", body: "Ask about any farm and get answers grounded in its readings." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-forest-900 text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <FieldPattern className="opacity-[0.16]" />
        <Link href="/" className="relative z-10 w-fit rounded-lg focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none">
          <Logo className="text-primary-foreground [&_.text-primary]:text-[#b9dca8]" />
        </Link>
        <div className="relative z-10 max-w-md">
          <p className="font-display text-4xl leading-tight font-medium text-balance">
            Every field, every probe, one clear next step.
          </p>
          <ul className="mt-8 space-y-5">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#b9dca8]" />
                <span>
                  <span className="block font-semibold">{p.title}</span>
                  <span className="text-sm text-primary-foreground/75">{p.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-xs text-primary-foreground/60">
          Open-source and free — including our fine-tuned model. Built for farms in Qatar.
        </p>
      </aside>
      <main className="flex flex-col items-center justify-center px-5 py-10 sm:px-8">
        <Link href="/" className="mb-8 rounded-lg focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none lg:hidden">
          <Logo />
        </Link>
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}

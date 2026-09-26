import { ArrowLeft, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <Link href="/" className="rounded-lg focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none">
        <Logo />
      </Link>
      <div className="max-w-md">
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">Page not found</p>
        <h1 className="mt-2 font-display text-[1.75rem] leading-tight font-semibold tracking-tight sm:text-[2.25rem]">This field is not on our map</h1>
        <p className="mt-3 text-base text-muted-foreground">
          The page you are looking for does not exist or has moved. The farms are all on the dashboard.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild className="h-11 px-4">
          <Link href="/dashboard">
            <LayoutDashboard /> Open Dashboard
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-11 px-4">
          <Link href="/">
            <ArrowLeft /> Home page
          </Link>
        </Button>
      </div>
    </main>
  );
}

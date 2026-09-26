"use client";

import "./globals.css";

/** Last-resort boundary (errors in the root layout). Renders its own document; never shows raw errors. */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">
        <title>Something went wrong · Harvestar AI</title>
        <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 py-16 text-center">
          <div className="max-w-md">
            <p className="text-[13px] font-semibold tracking-wide text-primary uppercase">Harvestar AI</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Something went wrong</h1>
            <p className="mt-3 text-[15px] text-muted-foreground">
              The page could not load. Your data is safe — try again, or go back to the home page.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => retry()}
              className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Try again
            </button>
            {/* A full page load: the root layout itself failed, so client navigation may not work. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex h-10 items-center rounded-lg border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Home page
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}

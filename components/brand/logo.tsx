import { cn } from "@/lib/utils";

/** Harvestar AI mark: a sprout reaching for a star (harvest + star). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path d="M15 25.5V15.6" stroke="#fdfbf6" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M15 17C15 12.1 12 9 6.8 9c0 4.9 3 8 8.2 8Z" fill="#fdfbf6" />
      <path d="M15 16.2c0-3.2 2-5.3 5.3-5.3 0 3.2-2 5.3-5.3 5.3Z" fill="#b9dca8" />
      <path d="M24.2 4.3l.95 2.6 2.6.95-2.6.95-.95 2.6-.95-2.6-2.6-.95 2.6-.95Z" fill="#f3c969" />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={markClassName} />
      <span className="text-base font-semibold tracking-tight">
        Harvestar <span className="text-primary">AI</span>
      </span>
    </span>
  );
}

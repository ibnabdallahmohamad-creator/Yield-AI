import { cn } from "@/lib/utils";

/** Yield AI mark: a sprout forming the "Y" of Yield. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path d="M16 25.5V15.2" stroke="#fdfbf6" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 16.6C16 11.6 12.9 8.4 7.6 8.4c0 5 3.1 8.2 8.4 8.2Z" fill="#fdfbf6" />
      <path d="M16 14.6c0-4.5 2.8-7.4 7.5-7.4 0 4.5-2.8 7.4-7.5 7.4Z" fill="#b9dca8" />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={markClassName} />
      <span className="text-base font-semibold tracking-tight">
        Yield <span className="text-primary">AI</span>
      </span>
    </span>
  );
}

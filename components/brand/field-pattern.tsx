import { cn } from "@/lib/utils";

/** Contour-style field lines used behind brand panels. */
export function FieldPattern({ color = "#e8f3df", className }: { color?: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 size-full", className)}
      viewBox="0 0 600 800"
      preserveAspectRatio="xMidYMid slice"
    >
      {Array.from({ length: 14 }, (_, i) => (
        <ellipse
          key={i}
          cx={460}
          cy={220}
          rx={40 + i * 34}
          ry={26 + i * 24}
          fill="none"
          stroke={color}
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
          transform={`rotate(${-18 + i * 1.5} 460 220)`}
        />
      ))}
      {Array.from({ length: 9 }, (_, i) => (
        <line
          key={`r${i}`}
          x1={0}
          y1={520 + i * 30}
          x2={600}
          y2={470 + i * 30}
          stroke={color}
          strokeWidth={0.8}
          strokeDasharray="2 7"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

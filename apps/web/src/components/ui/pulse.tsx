import { cn } from "@/lib/utils";

/// The mark's heartbeat as a small glyph. `live` animates a slow sweep.
export function PulseGlyph({ live = false, className }: { live?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 22 12" className={cn("h-3 w-[22px] shrink-0", className)} aria-hidden>
      <path
        d="M0 7 H6 L8 3 L10.5 11 L13 1 L15 7 H22"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={live ? "pulse-sweep" : undefined}
      />
    </svg>
  );
}

/// A flat line with one small blip: "all quiet". Used in empty states.
export function FlatPulse({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 34" className={cn("h-[34px] w-[200px] text-t4", className)} aria-hidden>
      <path
        d="M0 22 H80 L85 17 L90 26 L95 22 H200"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

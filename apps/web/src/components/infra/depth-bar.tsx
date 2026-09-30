import { cn } from "@/lib/utils";

const FILL = {
  neutral: "bg-bar-hi",
  warn: "bg-warn",
  fail: "bg-fail",
} as const;

export type DepthTone = keyof typeof FILL;

/// Thin horizontal meter for a queue's depth relative to the deepest queue.
/// Any non-empty queue gets a sliver so it never reads as empty.
export function DepthBar({
  value,
  max,
  tone = "neutral",
  className,
}: {
  value: number;
  max: number;
  tone?: DepthTone;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max((value / max) * 100, value > 0 ? 1.5 : 0)) : 0;
  return (
    <span className={cn("block h-1 overflow-hidden rounded-full bg-raised", className)} aria-hidden>
      <span className={cn("block h-full rounded-full", FILL[tone])} style={{ width: `${pct}%` }} />
    </span>
  );
}

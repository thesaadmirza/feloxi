"use client";

import { cn } from "@/lib/utils";
import { PulseGlyph } from "./pulse";

/// Auto-refresh switch for lists. Amber while refreshing, muted when paused.
export function LiveToggle({
  on,
  onChange,
  every = "5s",
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  every?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      title={on ? `Refreshing every ${every}. Click to pause.` : `Refresh every ${every}`}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border pr-3 pl-2.5 text-[12.5px] font-semibold transition-colors",
        on
          ? "border-amber-line bg-amber-wash text-link"
          : "border-line-strong bg-card text-t3 hover:text-foreground",
      )}
    >
      <PulseGlyph live={on} className={on ? "text-mark" : undefined} />
      {on ? "Live" : "Paused"}
    </button>
  );
}

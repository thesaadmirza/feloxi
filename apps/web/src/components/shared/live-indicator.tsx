"use client";

import { useWsStore } from "@/stores/ws-store";
import { PulseGlyph } from "@/components/ui/pulse";
import { cn } from "@/lib/utils";

type LiveIndicatorProps = {
  compact?: boolean;
};

/// Streaming status for the WebSocket. Amber means events are flowing, not
/// that the system is healthy; health lives in the sidebar footer.
export function LiveIndicator({ compact = false }: LiveIndicatorProps) {
  const state = useWsStore((s) => s.connectionState);
  const live = state === "connected";
  const label = live ? "Live" : state === "connecting" ? "Connecting" : "Offline";

  if (compact) {
    return (
      <span
        className={cn("inline-flex", live ? "text-mark" : "text-t4")}
        aria-label={label}
        title={label}
      >
        <PulseGlyph live={live} />
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-label={`Event stream: ${label}`}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border pr-3 pl-2.5 text-[12.5px] font-semibold",
        live ? "border-amber-line bg-amber-wash text-link" : "border-line-strong bg-card text-t3",
      )}
    >
      <PulseGlyph live={live} className={live ? "text-mark" : undefined} />
      {label}
    </span>
  );
}

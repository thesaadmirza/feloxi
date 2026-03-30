"use client";

import { useWsStore } from "@/stores/ws-store";

type LiveIndicatorProps = {
  compact?: boolean;
};

export function LiveIndicator({ compact = false }: LiveIndicatorProps) {
  const connected = useWsStore((s) => s.connectionState === "connected");

  const dotColor = connected ? "bg-emerald-400" : "bg-zinc-500";
  const label = connected ? "Live" : "Offline";

  if (compact) {
    return (
      <span className="relative flex h-1.5 w-1.5" aria-label={label}>
        {connected && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${dotColor} opacity-75`} />
        )}
        <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${dotColor}`} />
      </span>
    );
  }

  const borderColor = connected
    ? "bg-emerald-500/10 border-emerald-500/20"
    : "bg-zinc-500/10 border-zinc-500/20";
  const textColor = connected ? "text-emerald-400" : "text-zinc-500";

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${borderColor}`}
      aria-label={label}
    >
      <span className="relative flex h-1.5 w-1.5">
        {connected && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${dotColor} opacity-75`} />
        )}
        <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${dotColor}`} />
      </span>
      <span className={`text-xs font-semibold ${textColor} tracking-wider uppercase leading-none`}>
        {label}
      </span>
    </div>
  );
}

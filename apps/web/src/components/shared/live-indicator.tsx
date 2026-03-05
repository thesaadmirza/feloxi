"use client";

type LiveIndicatorProps = {
  compact?: boolean;
};

export function LiveIndicator({ compact = false }: LiveIndicatorProps) {
  if (compact) {
    return (
      <span className="relative flex h-1.5 w-1.5" aria-label="Live">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
      </span>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20"
      aria-label="Live data"
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
      </span>
      <span className="text-xs font-semibold text-emerald-400 tracking-wider uppercase leading-none">
        Live
      </span>
    </div>
  );
}

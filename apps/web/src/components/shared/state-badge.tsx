import { Ban, Check, CircleDashed, CircleDot, CircleSlash, RotateCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Size = "xs" | "sm" | "md";

type StateStyle = { label: string; className: string; chip: string; glyph: React.ReactNode };

const PLAY = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
  </svg>
);

/// Every state pairs its colour with a glyph and a word, so red and green
/// never carry meaning alone. The Celery state name stays in the tooltip.
const STATES: Record<string, StateStyle> = {
  SUCCESS: {
    label: "Succeeded",
    className: "text-ok",
    chip: "bg-ok-wash text-ok",
    glyph: <Check strokeWidth={2.6} aria-hidden />,
  },
  FAILURE: {
    label: "Failed",
    className: "text-fail",
    chip: "bg-fail-wash text-fail",
    glyph: <X strokeWidth={2.6} aria-hidden />,
  },
  RETRY: {
    label: "Retrying",
    className: "text-warn",
    chip: "bg-warn-wash text-warn",
    glyph: <RotateCw strokeWidth={2.2} aria-hidden />,
  },
  STARTED: { label: "Running", className: "text-run", chip: "bg-run-wash text-run", glyph: PLAY },
  RECEIVED: {
    label: "Received",
    className: "text-t3",
    chip: "bg-raised text-t2",
    glyph: <CircleDot strokeWidth={2} aria-hidden />,
  },
  PENDING: {
    label: "Queued",
    className: "text-t3",
    chip: "bg-raised text-t2",
    glyph: <CircleDashed strokeWidth={2} aria-hidden />,
  },
  REVOKED: {
    label: "Revoked",
    className: "text-t3",
    chip: "bg-raised text-t2",
    glyph: <Ban strokeWidth={2} aria-hidden />,
  },
  REJECTED: {
    label: "Rejected",
    className: "text-fail",
    chip: "bg-fail-wash text-fail",
    glyph: <CircleSlash strokeWidth={2} aria-hidden />,
  },
};

export function stateLabel(state: string): string {
  return STATES[state.toUpperCase()]?.label ?? state;
}

const SIZE: Record<Size, string> = {
  xs: "gap-1 text-[11px] [&_svg]:size-3",
  sm: "gap-1.5 text-[12.5px] [&_svg]:size-[13px]",
  md: "h-6 gap-1.5 rounded-md px-2 text-[12.5px] [&_svg]:size-[13px]",
};

export function StateBadge({
  state,
  size = "sm",
  className,
}: {
  state: string;
  size?: Size;
  className?: string;
}) {
  const key = state.toUpperCase();
  const s = STATES[key] ?? {
    label: state,
    className: "text-t3",
    chip: "bg-raised text-t2",
    glyph: null,
  };
  return (
    <span
      title={`Celery state: ${key}`}
      className={cn(
        "inline-flex shrink-0 items-center font-[550] whitespace-nowrap [&_svg]:shrink-0",
        SIZE[size],
        size === "md" ? s.chip : s.className,
        className,
      )}
    >
      {s.glyph}
      {s.label}
    </span>
  );
}

/// Just the coloured glyph, for dense lists; the label stays for screen readers.
export function StateGlyph({ state, className }: { state: string; className?: string }) {
  const key = state.toUpperCase();
  const s = STATES[key];
  return (
    <span
      title={s?.label ?? state}
      className={cn(
        "inline-flex shrink-0 items-center [&_svg]:size-[13px]",
        s?.className ?? "text-t3",
        className,
      )}
    >
      {s?.glyph ?? <span className="size-1.5 rounded-full bg-current" />}
      <span className="sr-only">{s?.label ?? state}</span>
    </span>
  );
}

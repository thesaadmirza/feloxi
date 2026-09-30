import { cn } from "@/lib/utils";

export type Tone = "neutral" | "ok" | "fail" | "warn" | "run" | "amber";

const TONES: Record<Tone, string> = {
  neutral: "bg-raised text-t2",
  ok: "bg-ok-wash text-ok",
  fail: "bg-fail-wash text-fail",
  warn: "bg-warn-wash text-warn",
  run: "bg-run-wash text-run",
  amber: "bg-amber-wash text-link",
};

/// Small filled label for status and severity. Pair colour with an icon or
/// words so meaning never rests on colour alone.
export function Chip({
  tone = "neutral",
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11.5px] font-semibold [&_svg]:size-3 [&_svg]:shrink-0",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/// Outlined mono tag for machine names: queues, hosts, channels.
export function Tag({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 max-w-full items-center truncate whitespace-nowrap rounded-md border border-border px-1.5 font-mono text-[11px] text-t2",
        className,
      )}
    >
      {children}
    </span>
  );
}

/// Tiny uppercase mono marker: Preview, Beta, Planned.
export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "amber";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 font-mono text-[9.5px] font-medium uppercase leading-[15px] tracking-[0.08em]",
        tone === "amber"
          ? "border-amber-line bg-amber-wash text-link"
          : "border-line-strong text-t3",
        className,
      )}
    >
      {children}
    </span>
  );
}

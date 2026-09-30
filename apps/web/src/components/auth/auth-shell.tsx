import { Loader2 } from "lucide-react";
import { FeloxiLogo } from "@/components/icons/feloxi-logo";
import { cn } from "@/lib/utils";

/// Split screen for sign-in, sign-up and first-run setup. A quiet brand panel
/// on the left (desktop only) and the form column on the right.
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-card lg:grid lg:grid-cols-[minmax(0,1fr)_520px] lg:bg-background">
      <BrandPanel />
      <main className="flex min-h-dvh flex-col bg-card px-5 py-10 sm:px-8 lg:border-l lg:border-border">
        <div className="m-auto w-full max-w-[380px]">
          <Wordmark className="mb-10 lg:hidden" />
          {title && (
            <header className="mb-7">
              <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-foreground">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-t2">{subtitle}</p>
              )}
            </header>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}

function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <FeloxiLogo variant="brand" size={22} />
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">Feloxi</span>
    </div>
  );
}

function BrandPanel() {
  return (
    <div className="hidden overflow-hidden bg-background px-12 py-10 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
      <Wordmark />
      <div className="-mx-12 flex min-h-[220px] flex-1 items-center">
        <Heartbeat />
      </div>
      <div className="flex flex-col gap-2.5">
        <p className="max-w-[460px] text-[30px] leading-tight font-semibold tracking-[-0.02em] text-balance text-foreground font-stretch-semi-expanded">
          Every task on your queues, in one place.
        </p>
        <p className="font-mono text-[11.5px] text-t3">self-hosted Celery monitoring</p>
      </div>
    </div>
  );
}

// The mark's heartbeat, drawn long: large beats with small ones between.
const EKG_WIDTH = 920;
const EKG_HEIGHT = 220;
const EKG_BASE = 130;
const EKG_AMP = 110;
const BEATS: [x: number, kind: "large" | "small"][] = [
  [100, "large"],
  [310, "small"],
  [500, "large"],
  [680, "small"],
  [840, "large"],
];
// [x offset, y offset as a share of the amplitude; negative is up]
const LARGE: [number, number][] = [
  [-14, 0],
  [-9, -0.18],
  [-5, 0],
  [-2, 0.22],
  [2, -0.95],
  [6, 0.42],
  [10, 0],
  [22, -0.14],
  [30, 0],
];
const SMALL: [number, number][] = [
  [-6, 0],
  [-2, -0.3],
  [2, 0.18],
  [6, 0],
];

const EKG_PATH = [
  `M0 ${EKG_BASE}`,
  ...BEATS.flatMap(([x, kind]) =>
    (kind === "large" ? LARGE : SMALL).map(
      ([dx, dy]) => `L${x + dx} ${+(EKG_BASE + dy * EKG_AMP).toFixed(1)}`,
    ),
  ),
  `L${EKG_WIDTH} ${EKG_BASE}`,
].join(" ");

function Heartbeat() {
  return (
    <svg
      viewBox={`0 0 ${EKG_WIDTH} ${EKG_HEIGHT}`}
      preserveAspectRatio="none"
      className="block h-[220px] w-full"
      aria-hidden
    >
      <path
        d={EKG_PATH}
        fill="none"
        stroke="var(--mark-pulse)"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/// Hairlines either side of a short label, e.g. "or with email".
export function AuthDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-t3">
      <span className="h-px flex-1 bg-border" aria-hidden />
      {children}
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

/// Spinner for a page that is still checking something. `quiet` hides the
/// label and fades the spinner in late, so a fast check shows nothing.
export function AuthSpinner({ label, quiet = false }: { label: string; quiet?: boolean }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2.5 text-[13px] text-t3",
        quiet &&
          "justify-center py-6 transition-opacity delay-300 duration-300 starting:opacity-0 motion-reduce:transition-none",
      )}
    >
      <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
      <span className={quiet ? "sr-only" : undefined}>{label}</span>
    </div>
  );
}

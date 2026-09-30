import Link from "next/link";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

/// A row of instrument readouts separated by hairlines. Uses a 1px grid gap
/// over the line colour so the rules stay correct at every breakpoint.
export function Readouts({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label="Key readouts"
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Readout({
  label,
  value,
  unit,
  delta,
  spark,
  sparkColor = "var(--t2)",
  loading,
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: React.ReactNode;
  delta?: React.ReactNode;
  spark?: number[];
  sparkColor?: string;
  loading?: boolean;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <span className="label flex-1 truncate">{label}</span>
        {delta && !loading && (
          <span className="flex shrink-0 items-center gap-1 text-[11.5px] tabular-nums text-t3 [&_svg]:size-3">
            {delta}
          </span>
        )}
      </div>
      {loading ? (
        <div className="h-7 w-24 animate-pulse rounded bg-raised" />
      ) : (
        <div className="text-[27px] font-semibold leading-[1.05] tracking-[-0.025em] tabular-nums text-foreground">
          {value}
          {unit && (
            <span className="ml-1 text-[13px] font-medium tracking-normal text-t3">{unit}</span>
          )}
        </div>
      )}
      {spark && !loading ? (
        <Sparkline values={spark} color={sparkColor} />
      ) : (
        <div className="h-6" aria-hidden />
      )}
    </>
  );
  const cls = cn("flex min-w-0 flex-col gap-2 bg-card px-4 pt-3.5 pb-3", className);
  if (href && !loading) {
    return (
      <Link href={href} className={cn(cls, "transition-colors hover:bg-hover")}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

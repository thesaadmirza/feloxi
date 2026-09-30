import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/// Warning banner, the sibling of ErrorAlert for states that need attention
/// but aren't failures: a consumer reconnecting, a degraded system.
export function WarnAlert({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-warn/35 bg-warn-wash px-4 py-3 text-[13px] leading-relaxed text-warn",
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

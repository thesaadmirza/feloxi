import { Check, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ErrorAlertProps = {
  children: React.ReactNode;
  className?: string;
  onDismiss?: () => void;
};

function Dismiss({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Dismiss"
      className="-my-1 -mr-1.5 ml-auto grid size-6 shrink-0 place-items-center rounded-md opacity-80 transition hover:bg-current/10 hover:opacity-100"
    >
      <X className="size-3.5" aria-hidden />
    </button>
  );
}

export function ErrorAlert({ children, className, onDismiss }: ErrorAlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-3 rounded-xl border border-fail/35 bg-fail-wash px-4 py-3 text-[13px] text-fail",
        className,
      )}
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && <Dismiss onClick={onDismiss} />}
    </div>
  );
}

/// Quiet confirmation after an action, e.g. "Retried 4 tasks".
export function Notice({ children, className, onDismiss }: ErrorAlertProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-3 rounded-xl border border-ok/30 bg-ok-wash px-4 py-3 text-[13px] text-ok",
        className,
      )}
    >
      <Check className="size-4 shrink-0" strokeWidth={2.4} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && <Dismiss onClick={onDismiss} />}
    </div>
  );
}

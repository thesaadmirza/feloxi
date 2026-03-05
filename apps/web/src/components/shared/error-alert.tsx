import { AlertTriangle } from "lucide-react";

type ErrorAlertProps = {
  children: React.ReactNode;
  className?: string;
};

export function ErrorAlert({ children, className }: ErrorAlertProps) {
  return (
    <div
      className={`flex items-center gap-3 p-4 rounded-xl border border-destructive/40 bg-destructive/5 text-destructive text-sm ${className ?? ""}`}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {children}
    </div>
  );
}

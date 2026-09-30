import { type ReactNode } from "react";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={["flex flex-col items-center justify-center text-center py-12 px-6", className]
        .filter(Boolean)
        .join(" ")}
    >
      {icon && <div className="mb-4 text-t4 [&>svg]:w-10 [&>svg]:h-10">{icon}</div>}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-t3">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

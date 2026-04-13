"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/shared/skeleton";
import { EmptyState } from "@/components/shared/empty-state";

type Props = {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actionHref?: string;
  actionLabel?: string;
  children: React.ReactNode;
  className?: string;
};

export function DashboardCard({
  title,
  subtitle,
  icon,
  actionHref,
  actionLabel,
  children,
  className = "",
}: Props) {
  return (
    <div
      className={`flex flex-col bg-card border border-border rounded-xl p-5 ${className}`}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {actionHref && (
          <Link
            href={actionHref}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition shrink-0"
          >
            {actionLabel ?? "View all"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

export function DashboardCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function DashboardCardEmpty({
  icon,
  message,
}: {
  icon?: React.ReactNode;
  message: string;
}) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <EmptyState icon={icon} title={message} className="py-6" />
    </div>
  );
}

"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

type Props = {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actionHref?: string;
  actionLabel?: string;
  children: React.ReactNode;
  className?: string;
};

/// Common shell for every dashboard widget: card chrome, title row with an
/// optional icon + subtitle, and an optional "see all" link in the header.
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
      className={`flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl p-5 ${className}`}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-zinc-400 shrink-0">{icon}</span>}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {actionHref && (
          <Link
            href={actionHref}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 transition shrink-0"
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
        <div key={i} className="h-9 bg-zinc-800/60 rounded animate-pulse" />
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
    <div className="flex-1 flex flex-col items-center justify-center py-10 gap-2 text-zinc-600">
      {icon}
      <p className="text-xs">{message}</p>
    </div>
  );
}

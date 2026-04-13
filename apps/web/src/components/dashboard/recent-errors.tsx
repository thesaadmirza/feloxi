"use client";

import Link from "next/link";
import { AlertOctagon, CheckCircle2 } from "lucide-react";
import { $api } from "@/lib/api";
import { formatNumber, timeAgo } from "@/lib/utils";
import {
  DashboardCard,
  DashboardCardEmpty,
  DashboardCardSkeleton,
} from "./dashboard-card";
import type { FailureGroupRow } from "@/types/api";

type Props = {
  fromMinutes: number;
  limit?: number;
};

function truncateException(raw: string, max = 80): string {
  const firstLine = raw.split("\n")[0]?.trim() ?? "";
  return firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine;
}

export function RecentErrors({ fromMinutes, limit = 5 }: Props) {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/metrics/failure-groups",
    { params: { query: { from_minutes: fromMinutes, limit } } },
    { refetchInterval: 30_000 }
  );

  const rows: FailureGroupRow[] = (data?.data ?? []) as FailureGroupRow[];

  return (
    <DashboardCard
      title="Recent Errors"
      subtitle="Grouped by exception — click through to the latest occurrence"
      icon={<AlertOctagon className="h-4 w-4" />}
      actionHref="/tasks?errors_only=true"
      actionLabel="All errors"
    >
      {isLoading ? (
        <DashboardCardSkeleton rows={limit} />
      ) : rows.length === 0 ? (
        <DashboardCardEmpty
          icon={<CheckCircle2 className="h-6 w-6 text-emerald-500/40" />}
          message="No errors in this window."
        />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li
              key={row.exception}
              className="rounded-lg border border-red-500/15 bg-red-500/[0.04] hover:bg-red-500/[0.07] transition"
            >
              <Link
                href={`/tasks/${row.latest_task_id}`}
                className="block px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <p
                    className="text-xs font-mono text-red-200 leading-snug"
                    title={row.exception}
                  >
                    {truncateException(row.exception)}
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold text-red-300 tabular-nums">
                      ×{formatNumber(row.count)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center flex-wrap gap-1.5">
                  {row.task_names.slice(0, 3).map((n) => (
                    <span
                      key={n}
                      className="inline-flex max-w-[180px] truncate px-1.5 py-0.5 rounded bg-zinc-800/80 text-[10px] text-zinc-400 font-mono"
                      title={n}
                    >
                      {n}
                    </span>
                  ))}
                  {row.task_names.length > 3 && (
                    <span className="text-[10px] text-zinc-600">
                      +{row.task_names.length - 3}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-zinc-600">
                    last {timeAgo(Number(row.last_seen))}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}

"use client";

import Link from "next/link";
import { TrendingDown, CheckCircle2 } from "lucide-react";
import { $api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import {
  DashboardCard,
  DashboardCardEmpty,
  DashboardCardSkeleton,
} from "./dashboard-card";
import type { TaskNameStatsRow } from "@/types/api";

type Props = {
  fromMinutes: number;
  limit?: number;
};

export function TopFailingTasks({ fromMinutes, limit = 6 }: Props) {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/metrics/task-name-stats",
    { params: { query: { from_minutes: fromMinutes } } },
    { refetchInterval: 30_000 }
  );

  const rows: TaskNameStatsRow[] = (data?.data ?? []) as TaskNameStatsRow[];
  const ranked = rows
    .filter((r) => r.failure > 0)
    .map((r) => ({
      ...r,
      failureRate: r.total > 0 ? r.failure / r.total : 0,
    }))
    .sort((a, b) => {
      if (b.failure !== a.failure) return b.failure - a.failure;
      return b.failureRate - a.failureRate;
    })
    .slice(0, limit);

  return (
    <DashboardCard
      title="Top Failing Tasks"
      subtitle={`Highest failure counts in the window`}
      icon={<TrendingDown className="h-4 w-4" />}
      actionHref="/tasks?errors_only=true"
      actionLabel="All failures"
    >
      {isLoading ? (
        <DashboardCardSkeleton rows={limit} />
      ) : ranked.length === 0 ? (
        <DashboardCardEmpty
          icon={<CheckCircle2 className="h-6 w-6 text-emerald-500/40" />}
          message="No failing tasks in this window — nice."
        />
      ) : (
        <ul className="divide-y divide-zinc-800/60">
          {ranked.map((row) => (
            <li key={row.task_name}>
              <Link
                href={`/tasks?task_name=${encodeURIComponent(row.task_name)}&errors_only=true`}
                className="flex items-center gap-3 py-2.5 hover:bg-zinc-800/40 rounded-md px-2 -mx-2 transition"
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="text-xs font-mono text-zinc-100 truncate"
                    title={row.task_name}
                  >
                    {row.task_name}
                  </p>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500 mt-0.5">
                    <span>{formatNumber(row.total)} total</span>
                    <span>·</span>
                    <span className="text-red-400">
                      {formatNumber(row.failure)} failed
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-red-400 tabular-nums">
                    {(row.failureRate * 100).toFixed(1)}%
                  </div>
                  <div className="text-[10px] text-zinc-600 uppercase tracking-wider">
                    fail
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}

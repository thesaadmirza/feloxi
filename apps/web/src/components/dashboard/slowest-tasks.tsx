"use client";

import Link from "next/link";
import { Clock, Zap } from "lucide-react";
import { $api } from "@/lib/api";
import { formatDuration, formatNumber } from "@/lib/utils";
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

export function SlowestTasks({ fromMinutes, limit = 6 }: Props) {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/metrics/task-name-stats",
    { params: { query: { from_minutes: fromMinutes } } },
    { refetchInterval: 30_000 }
  );

  const rows: TaskNameStatsRow[] = (data?.data ?? []) as TaskNameStatsRow[];
  const ranked = rows
    .filter((r) => r.p95_runtime > 0)
    .sort((a, b) => b.p95_runtime - a.p95_runtime)
    .slice(0, limit);

  // Compute a normalized width so the longest P95 fills the row.
  const maxP95 = ranked[0]?.p95_runtime ?? 1;

  return (
    <DashboardCard
      title="Slowest Tasks"
      subtitle="By P95 runtime — look here first for tail latency"
      icon={<Clock className="h-4 w-4" />}
      actionHref="/tasks"
    >
      {isLoading ? (
        <DashboardCardSkeleton rows={limit} />
      ) : ranked.length === 0 ? (
        <DashboardCardEmpty
          icon={<Zap className="h-6 w-6 text-zinc-700" />}
          message="No runtime data yet for this window."
        />
      ) : (
        <ul className="space-y-2.5">
          {ranked.map((row) => (
            <li key={row.task_name}>
              <Link
                href={`/tasks?task_name=${encodeURIComponent(row.task_name)}`}
                className="block group"
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span
                    className="text-xs font-mono text-zinc-200 truncate min-w-0 group-hover:text-white transition"
                    title={row.task_name}
                  >
                    {row.task_name}
                  </span>
                  <div className="flex items-center gap-2 text-[11px] shrink-0">
                    <span className="text-zinc-500">
                      avg {formatDuration(row.avg_runtime)}
                    </span>
                    <span className="text-amber-300 font-semibold tabular-nums">
                      p95 {formatDuration(row.p95_runtime)}
                    </span>
                  </div>
                </div>
                <div className="h-1.5 bg-zinc-800/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500/60 to-amber-400 rounded-full transition-all"
                    style={{ width: `${(row.p95_runtime / maxP95) * 100}%` }}
                  />
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-600">
                  <span>{formatNumber(row.total)} runs</span>
                  <span>·</span>
                  <span>p99 {formatDuration(row.p99_runtime)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}

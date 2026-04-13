"use client";

import Link from "next/link";
import { Users, ServerCrash } from "lucide-react";
import { $api } from "@/lib/api";
import { formatDuration, formatNumber, truncateId } from "@/lib/utils";
import {
  DashboardCard,
  DashboardCardEmpty,
  DashboardCardSkeleton,
} from "./dashboard-card";
import type { WorkerTaskStats } from "@/types/api";

type Props = {
  fromMinutes: number;
  limit?: number;
};

export function WorkerLeaderboard({ fromMinutes, limit = 6 }: Props) {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/workers/stats",
    { params: { query: { from_minutes: fromMinutes } } },
    { refetchInterval: 30_000 }
  );

  const rows: WorkerTaskStats[] = (data?.data ?? []) as WorkerTaskStats[];
  const ranked = rows.sort((a, b) => b.total - a.total).slice(0, limit);

  return (
    <DashboardCard
      title="Worker Leaderboard"
      subtitle="Most active workers in the window"
      icon={<Users className="h-4 w-4" />}
      actionHref="/workers"
    >
      {isLoading ? (
        <DashboardCardSkeleton rows={limit} />
      ) : ranked.length === 0 ? (
        <DashboardCardEmpty
          icon={<ServerCrash className="h-6 w-6 text-zinc-700" />}
          message="No worker activity recorded yet."
        />
      ) : (
        <ul className="space-y-2">
          {ranked.map((row) => {
            const failRate = row.total > 0 ? row.failed / row.total : 0;
            const hasErrors = row.failed > 0;
            return (
              <li key={row.worker_id}>
                <Link
                  href={`/workers/${encodeURIComponent(row.worker_id)}`}
                  className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-zinc-800/40 transition"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-xs font-mono text-zinc-200 truncate"
                      title={row.worker_id}
                    >
                      {truncateId(row.worker_id, 32)}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-500 mt-0.5">
                      <span className="text-emerald-400">
                        {formatNumber(row.succeeded)} ok
                      </span>
                      {hasErrors && (
                        <>
                          <span>·</span>
                          <span className="text-red-400">
                            {formatNumber(row.failed)} fail
                          </span>
                        </>
                      )}
                      {row.avg_runtime > 0 && (
                        <>
                          <span>·</span>
                          <span>avg {formatDuration(row.avg_runtime)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-zinc-100 tabular-nums">
                      {formatNumber(row.total)}
                    </div>
                    <div className="text-[10px] text-zinc-600 uppercase tracking-wider">
                      {hasErrors && failRate > 0.1
                        ? `${(failRate * 100).toFixed(0)}% fail`
                        : "tasks"}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}

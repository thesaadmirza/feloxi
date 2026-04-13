"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, ChevronRight } from "lucide-react";
import { $api } from "@/lib/api";
import { formatDuration, timeAgo, truncateId } from "@/lib/utils";
import { StateBadge } from "@/components/shared/state-badge";
import {
  DashboardCard,
  DashboardCardEmpty,
  DashboardCardSkeleton,
} from "./dashboard-card";
import type { TaskSummaryRow } from "@/types/api";

type Props = {
  limit?: number;
};

export function RecentTasksSummary({ limit = 15 }: Props) {
  const [failuresOnly, setFailuresOnly] = useState(false);

  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/tasks/summary",
    {
      params: {
        query: {
          limit,
          require_task_name: true,
          errors_only: failuresOnly || undefined,
        },
      },
    },
    { refetchInterval: 30_000 }
  );

  const rows: TaskSummaryRow[] = (data?.data ?? []) as TaskSummaryRow[];

  return (
    <DashboardCard
      title="Recent Tasks"
      subtitle="Latest state per task — click any row to inspect"
      icon={<Activity className="h-4 w-4" />}
      actionHref="/tasks"
    >
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => setFailuresOnly(false)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
            !failuresOnly
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setFailuresOnly(true)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
            failuresOnly
              ? "bg-red-500/15 text-red-300 border border-red-500/25"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Failures only
        </button>
      </div>

      {isLoading ? (
        <DashboardCardSkeleton rows={8} />
      ) : rows.length === 0 ? (
        <DashboardCardEmpty
          icon={<Activity className="h-6 w-6 text-muted-foreground" />}
          message={
            failuresOnly
              ? "No failing tasks right now."
              : "No task events yet — waiting on worker activity."
          }
        />
      ) : (
        <div className="divide-y divide-border -mx-2">
          {rows.map((row) => (
            <Link
              key={row.task_id}
              href={`/tasks/${row.task_id}`}
              className="flex items-center gap-3 px-2 py-2 hover:bg-secondary transition"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className="text-xs font-mono text-foreground truncate"
                    title={row.task_name}
                  >
                    {row.task_name}
                  </span>
                  <StateBadge state={row.state} size="xs" />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-mono" title={row.task_id}>
                    {truncateId(row.task_id, 12)}
                  </span>
                  {row.worker_id && (
                    <>
                      <span>·</span>
                      <span className="truncate max-w-[180px]" title={row.worker_id}>
                        {row.worker_id}
                      </span>
                    </>
                  )}
                  <span className="ml-auto">
                    {row.runtime > 0 ? formatDuration(row.runtime) : "—"} ·{" "}
                    {timeAgo(
                      typeof row.timestamp === "number"
                        ? row.timestamp
                        : String(row.timestamp)
                    )}
                  </span>
                </div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </DashboardCard>
  );
}

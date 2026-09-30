"use client";

import { useMemo } from "react";
import Link from "next/link";
import { $api } from "@/lib/api";
import { formatDuration } from "@/lib/utils";
import { shortTaskName } from "@/lib/names";
import { Panel, PanelHeader, PanelLink } from "@/components/ui/panel";
import { Skeleton } from "@/components/shared/skeleton";
import type { TaskNameStatsRow } from "@/types/api";

export function SlowestTasks({
  fromMinutes,
  limit = 5,
  className,
}: {
  fromMinutes: number;
  limit?: number;
  className?: string;
}) {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/metrics/task-name-stats",
    { params: { query: { from_minutes: fromMinutes } } },
    { refetchInterval: 30_000 },
  );
  const rows = useMemo(
    () =>
      [...((data?.data ?? []) as TaskNameStatsRow[])]
        .filter((r) => r.p95_runtime > 0)
        .sort((a, b) => b.p95_runtime - a.p95_runtime)
        .slice(0, limit),
    [data, limit],
  );

  return (
    <Panel className={className} aria-label="Slowest tasks">
      <PanelHeader
        title="Slowest tasks"
        subtitle="by p95 runtime"
        action={<PanelLink href="/tasks">All tasks</PanelLink>}
      />
      {isLoading ? (
        <div className="flex flex-col gap-2 px-4 pb-4">
          {Array.from({ length: limit }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 pt-4 pb-8 text-center text-[13px] text-t3">
          No finished tasks in this window.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-[13px]">
            <colgroup>
              <col />
              <col className="w-16" />
              <col className="hidden w-20 sm:table-column" />
              <col className="w-20" />
              <col className="hidden w-[88px] sm:table-column" />
            </colgroup>
            <thead>
              <tr className="border-y border-border">
                <th className="label px-4 py-2 text-left font-medium">Task</th>
                <th className="label px-3 py-2 text-right font-medium">Runs</th>
                <th className="label hidden px-3 py-2 text-right font-medium sm:table-cell">Avg</th>
                <th className="label px-3 py-2 text-right font-medium">p95</th>
                <th className="label hidden py-2 pr-4 pl-3 text-right font-medium sm:table-cell">
                  p99
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.task_name}
                  className="border-b border-line-soft last:border-b-0 hover:bg-hover"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/tasks?task_name=${encodeURIComponent(r.task_name)}`}
                      className="block truncate font-mono text-[12.5px] text-foreground hover:text-link"
                      title={r.task_name}
                    >
                      <span className="sm:hidden">{shortTaskName(r.task_name)}</span>
                      <span className="hidden sm:inline">{r.task_name}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-t2">
                    {r.total.toLocaleString()}
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums text-t2 sm:table-cell">
                    {formatDuration(r.avg_runtime)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">
                    {formatDuration(r.p95_runtime)}
                  </td>
                  <td className="hidden py-2.5 pr-4 pl-3 text-right tabular-nums text-t2 sm:table-cell">
                    {formatDuration(r.p99_runtime)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

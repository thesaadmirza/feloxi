"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Activity, Inbox, Users, ServerCrash } from "lucide-react";
import { $api } from "@/lib/api";
import { formatNumber, truncateId } from "@/lib/utils";
import {
  DashboardCard,
  DashboardCardEmpty,
  DashboardCardSkeleton,
} from "./dashboard-card";

const REFRESH_MS = 10_000;

function LiveKpi({
  title,
  value,
  sub,
  icon,
  loading,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1.5">
        {icon}
        <span>{title}</span>
      </div>
      <div className="text-2xl font-bold text-foreground tabular-nums">
        {loading ? <span className="text-muted-foreground">—</span> : value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export function LiveClusterStrip() {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/dashboard/live",
    {},
    { refetchInterval: REFRESH_MS },
  );

  const utilisationPct = useMemo(() => {
    if (!data || data.worker_capacity_total === 0) return null;
    return Math.min(
      100,
      Math.round((data.active_tasks_total / data.worker_capacity_total) * 100),
    );
  }, [data]);

  return (
    <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
      <LiveKpi
        title="Running now"
        value={data ? formatNumber(data.active_tasks_total) : "—"}
        sub={
          utilisationPct !== null && data
            ? `${utilisationPct}% of ${formatNumber(data.worker_capacity_total)} capacity`
            : undefined
        }
        icon={<Activity className="h-3.5 w-3.5" />}
        loading={isLoading}
      />
      <LiveKpi
        title="In queue"
        value={data ? formatNumber(data.queue_depth_total) : "—"}
        sub={
          data && data.queues.length > 0
            ? `${data.queues.length} queue${data.queues.length === 1 ? "" : "s"}`
            : undefined
        }
        icon={<Inbox className="h-3.5 w-3.5" />}
        loading={isLoading}
      />
      <LiveKpi
        title="Online workers"
        value={data ? formatNumber(data.online_workers_total) : "—"}
        icon={<Users className="h-3.5 w-3.5" />}
        loading={isLoading}
      />
    </div>
  );
}

export function LiveWorkerCapacity({ limit = 8 }: { limit?: number }) {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/dashboard/live",
    {},
    { refetchInterval: REFRESH_MS },
  );

  const workers = useMemo(() => (data?.workers ?? []).slice(0, limit), [data, limit]);

  return (
    <DashboardCard
      title="Worker Capacity"
      subtitle="Active tasks vs concurrency, right now"
      icon={<Activity className="h-4 w-4" />}
      actionHref="/workers"
    >
      {isLoading ? (
        <DashboardCardSkeleton rows={limit} />
      ) : workers.length === 0 ? (
        <DashboardCardEmpty
          icon={<ServerCrash className="h-6 w-6 text-muted-foreground" />}
          message="No workers online right now."
        />
      ) : (
        <ul className="space-y-2.5">
          {workers.map((w) => {
            const cap = w.pool_size === 0 ? null : w.pool_size;
            const pct =
              cap === null ? 0 : Math.min(100, Math.round((w.active_tasks / cap) * 100));
            const tone =
              pct >= 90
                ? "bg-red-400"
                : pct >= 60
                  ? "bg-yellow-400"
                  : "bg-emerald-400";
            return (
              <li key={w.worker_id}>
                <Link
                  href={`/workers/${encodeURIComponent(w.worker_id)}`}
                  className="block py-1.5 px-2 -mx-2 rounded-md hover:bg-secondary transition"
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <p
                      className="text-xs font-mono text-foreground truncate min-w-0"
                      title={w.worker_id}
                    >
                      {truncateId(w.worker_id, 32)}
                    </p>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                      {w.active_tasks}
                      {cap !== null && <> / {cap}</>}
                    </span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full ${tone} transition-[width]`}
                      style={{ width: `${pct}%` }}
                    />
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

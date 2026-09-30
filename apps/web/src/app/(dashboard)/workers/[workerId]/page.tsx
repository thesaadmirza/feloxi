"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { ArrowRight, Cpu, Hash, PowerOff, SearchX } from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { cn, displayTaskName, formatDuration, timeAgo } from "@/lib/utils";
import { useHasPermission } from "@/hooks/use-current-user";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Readout, Readouts } from "@/components/ui/readout";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert, Notice } from "@/components/shared/error-alert";
import { Skeleton } from "@/components/shared/skeleton";
import { StateBadge } from "@/components/shared/state-badge";
import type { TaskSummaryRow, WorkerEvent } from "@/types/api";

function RecentTasks({ workerId }: { workerId: string }) {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/tasks/summary",
    { params: { query: { worker_id: workerId, limit: 10 } } },
    { refetchInterval: 15_000 },
  );
  const rows = (data?.data ?? []) as TaskSummaryRow[];

  return (
    <Panel aria-label="Recent tasks">
      <PanelHeader
        title="Recent tasks"
        action={
          <Link
            href={`/tasks?worker_id=${encodeURIComponent(workerId)}`}
            className="inline-flex items-center gap-1 text-xs text-t3 transition-colors hover:text-foreground"
          >
            All tasks on this worker <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      />
      {isLoading ? (
        <div className="flex flex-col gap-2 px-4 pb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 pt-2 pb-6 text-[13px] text-t3">No tasks recorded for this worker yet.</p>
      ) : (
        <ul className="border-t border-line-soft">
          {rows.map((t) => (
            <li key={t.task_id} className="border-b border-line-soft last:border-b-0">
              <Link
                href={`/tasks/${t.task_id}`}
                className="grid grid-cols-[104px_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2 text-[13px] transition-colors hover:bg-hover"
              >
                <StateBadge state={t.state} />
                <span
                  className="truncate font-mono text-[12.5px] text-foreground"
                  title={t.task_name}
                >
                  {displayTaskName(t.task_name)}
                </span>
                <span className="hidden text-right text-t2 tabular-nums sm:block">
                  {t.runtime > 0 ? formatDuration(t.runtime) : ""}
                </span>
                <span className="w-16 text-right text-t3 tabular-nums">{timeAgo(t.timestamp)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function WorkerDetailPage() {
  const params = useParams();
  const workerId = decodeURIComponent(params.workerId as string);
  const canShutdown = useHasPermission("workers_shutdown");
  const [confirm, setConfirm] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = $api.useQuery(
    "get",
    "/api/v1/workers/{worker_id}",
    { params: { path: { worker_id: workerId } } },
    { enabled: !!workerId, refetchInterval: 10_000 },
  );
  const live = $api.useQuery("get", "/api/v1/dashboard/live", {}, { refetchInterval: 15_000 });
  const statsQuery = $api.useQuery("get", "/api/v1/workers/stats", {}, { refetchInterval: 30_000 });
  const stats = (statsQuery.data?.data ?? []).find((r) => r.worker_id === workerId);

  const state = data?.current_state ?? null;
  const events = useMemo(() => (data?.recent_events ?? []) as WorkerEvent[], [data]);
  const latest = events[0];
  const online =
    (live.data?.workers ?? []).some((w) => w.worker_id === workerId) || state?.status === "online";
  const trail = useMemo(() => [...events].reverse().map((e) => e.active_tasks), [events]);

  async function shutdown() {
    setShuttingDown(true);
    setActionError(null);
    try {
      await unwrap(
        fetchClient.POST("/api/v1/workers/{worker_id}/shutdown", {
          params: { path: { worker_id: workerId } },
        }),
      );
      setNotice("Shutdown sent. The worker exits after its running tasks finish.");
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't send the shutdown command.");
    } finally {
      setShuttingDown(false);
      setConfirm(false);
    }
  }

  const hostname = state?.hostname || latest?.hostname || workerId.replace(/^celery@/, "");
  const crumbs = [
    { label: "Workers", href: "/workers" },
    { label: <span className="font-mono">{hostname}</span> },
  ];

  if (isLoading) {
    return (
      <>
        <PageHeader crumbs={crumbs} />
        <PageBody>
          <Skeleton className="h-9 w-80 max-w-full" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </PageBody>
      </>
    );
  }

  if (isError) {
    return (
      <>
        <PageHeader crumbs={crumbs} />
        <PageBody>
          <Panel>
            <EmptyState
              icon={<SearchX />}
              title="Worker not found"
              description={(error as Error)?.message ?? "It may not have sent any events yet."}
              action={
                <Button asChild>
                  <Link href="/workers">Back to workers</Link>
                </Button>
              }
            />
          </Panel>
        </PageBody>
      </>
    );
  }

  const cpu = state?.cpu_percent ?? latest?.cpu_percent ?? 0;
  const mem = state?.memory_mb ?? latest?.memory_mb ?? 0;
  const load = state?.load_avg?.length ? state.load_avg : (latest?.load_avg ?? []);
  const poolType = state?.pool_type || latest?.pool_type;
  const poolSize = state?.pool_size || latest?.pool_size;
  const software = state?.sw_ident || latest?.sw_ident;
  const version = state?.sw_ver || latest?.sw_ver;

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        actions={
          <>
            <Button asChild>
              <Link href={`/tasks?worker_id=${encodeURIComponent(workerId)}`}>View tasks</Link>
            </Button>
            {canShutdown && (
              <Button variant="danger" onClick={() => setConfirm(true)} disabled={!online}>
                <PowerOff />
                Shut down
              </Button>
            )}
          </>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Chip tone={online ? "ok" : "fail"} className="h-6 px-2 text-[12.5px]">
              <span
                className={cn("size-[7px] rounded-full", online ? "bg-ok" : "bg-fail")}
                aria-hidden
              />
              {online ? "Online" : "Offline"}
            </Chip>
            <h1 className="min-w-0 truncate font-mono text-[19px] font-medium tracking-[-0.01em]">
              {hostname}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px] text-t2 [&_svg]:size-3.5 [&_svg]:text-t3">
            <span className="inline-flex min-w-0 items-center gap-1.5 font-mono">
              <Hash aria-hidden />
              <span className="truncate">{workerId}</span>
            </span>
            {poolType || (poolSize ?? 0) > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <Cpu aria-hidden />
                {[poolType, poolSize ? `${poolSize} slots` : null].filter(Boolean).join(" · ")}
              </span>
            ) : null}
            <span className="text-t3 tabular-nums">
              {(state?.processed ?? latest?.processed ?? 0).toLocaleString()} processed since start
            </span>
            {cpu > 0 && <span className="text-t3 tabular-nums">CPU {Math.round(cpu)}%</span>}
            {mem > 0 && (
              <span className="text-t3 tabular-nums">{Math.round(mem).toLocaleString()} MB</span>
            )}
            {software && (
              <span className="font-mono text-t3">
                {software} {version}
              </span>
            )}
            {latest && <span className="text-t3">last event {timeAgo(latest.timestamp)}</span>}
          </div>
        </div>

        {actionError && (
          <ErrorAlert onDismiss={() => setActionError(null)}>{actionError}</ErrorAlert>
        )}
        {notice && <Notice onDismiss={() => setNotice(null)}>{notice}</Notice>}

        <Readouts>
          <Readout
            label="Running now"
            value={online ? (state?.active_tasks ?? latest?.active_tasks ?? 0) : "—"}
            unit={poolSize ? `of ${poolSize}` : undefined}
            spark={trail}
          />
          <Readout
            label="Done 24h"
            value={stats ? stats.succeeded.toLocaleString() : "—"}
            href={`/tasks?worker_id=${encodeURIComponent(workerId)}&state=SUCCESS`}
          />
          <Readout
            label="Failed 24h"
            value={
              stats ? (
                <span className={stats.failed > 0 ? "text-fail" : undefined}>
                  {stats.failed.toLocaleString()}
                </span>
              ) : (
                "—"
              )
            }
            delta={
              stats && stats.succeeded + stats.failed > 0 ? (
                <span>{((stats.failed / (stats.succeeded + stats.failed)) * 100).toFixed(1)}%</span>
              ) : undefined
            }
            href={`/tasks?worker_id=${encodeURIComponent(workerId)}&state=FAILURE`}
          />
          <Readout
            label="Avg runtime"
            value={stats && stats.avg_runtime > 0 ? formatDuration(stats.avg_runtime) : "—"}
          />
          <Readout
            label="Load 1/5/15"
            value={load.length ? load[0].toFixed(2) : "—"}
            delta={
              load.length > 1 ? (
                <span className="font-mono">
                  {load
                    .slice(1, 3)
                    .map((n) => n.toFixed(2))
                    .join(" · ")}
                </span>
              ) : undefined
            }
            className="col-span-2 lg:col-span-1"
          />
        </Readouts>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <RecentTasks workerId={workerId} />

          <Panel aria-label="Recent events">
            <PanelHeader
              title="Recent events"
              subtitle={events.length ? `${events.length} latest` : undefined}
            />
            {events.length === 0 ? (
              <p className="px-4 pt-2 pb-6 text-[13px] text-t3">No events recorded yet.</p>
            ) : (
              <div className="max-h-[440px] overflow-y-auto border-t border-line-soft">
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {events.map((e, i) => (
                      <tr
                        key={e.event_id ?? i}
                        className="border-b border-line-soft last:border-b-0"
                      >
                        <td
                          className={cn(
                            "py-2 pl-4 font-mono whitespace-nowrap",
                            e.event_type === "worker-offline"
                              ? "text-fail"
                              : e.event_type === "worker-online"
                                ? "text-ok"
                                : "text-foreground",
                          )}
                        >
                          {e.event_type}
                        </td>
                        <td className="px-3 py-2 text-t2 tabular-nums">{e.active_tasks} running</td>
                        <td className="hidden px-3 py-2 font-mono text-t3 sm:table-cell">
                          {e.load_avg?.length ? e.load_avg.map((n) => n.toFixed(2)).join(" ") : ""}
                        </td>
                        <td
                          className="py-2 pr-4 pl-3 text-right font-mono whitespace-nowrap text-t3"
                          title={new Date(e.timestamp).toLocaleString()}
                        >
                          {format(e.timestamp, "HH:mm:ss")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </PageBody>

      <ConfirmDialog
        open={confirm}
        onOpenChange={(open) => !open && !shuttingDown && setConfirm(false)}
        title="Shut down this worker?"
        description="The worker finishes the tasks it is running, then exits. It won't come back unless your process manager restarts it."
        subject={workerId}
        confirmLabel="Shut down"
        tone="danger"
        busy={shuttingDown}
        onConfirm={shutdown}
      />
    </>
  );
}

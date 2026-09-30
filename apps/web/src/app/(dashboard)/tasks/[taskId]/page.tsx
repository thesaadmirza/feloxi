"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowRight,
  Ban,
  Braces,
  Check,
  Clock,
  Copy,
  Hash,
  Layers,
  RotateCw,
  SearchX,
  Server,
} from "lucide-react";
import { $api } from "@/lib/api";
import { fingerprint, mergeFailureGroups, splitException } from "@/lib/fingerprint";
import { bucketize } from "@/lib/series";
import { retryTask, revokeTask } from "@/lib/task-actions";
import { cn, displayTaskName, formatDuration, timeAgo } from "@/lib/utils";
import { useHasPermission } from "@/hooks/use-current-user";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Sparkline } from "@/components/ui/sparkline";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";
import { JsonViewer } from "@/components/shared/json-viewer";
import { Skeleton } from "@/components/shared/skeleton";
import { StateBadge } from "@/components/shared/state-badge";
import RetryChain from "@/components/shared/retry-chain";
import { searchPhrase } from "@/components/tasks/failure-groups";
import { LifecycleBar, lifecycleOf } from "@/components/tasks/lifecycle";
import { UNFINISHED } from "@/components/tasks/task-table";
import { Traceback } from "@/components/tasks/traceback";
import { WorkflowPanel } from "@/components/tasks/workflow-panel";
import type { FailureGroupRow, TaskEvent, TaskMetricsRow, TaskNameStatsRow } from "@/types/api";

const present = (v: string | null | undefined) => !!v && v !== "null" && v.trim() !== "";

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) =>
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        setTimeout(() => setCopied(null), 1500);
      },
      () => {},
    );
  return { copied, copy };
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] items-baseline gap-3 border-t border-line-soft px-4 py-2.5 text-[13px]">
      <dt className="text-t3">{label}</dt>
      <dd className="min-w-0 truncate text-foreground">{children}</dd>
    </div>
  );
}

function eventDetail(e: TaskEvent): string {
  switch (e.event_type) {
    case "task-sent":
      return e.queue ? `queue ${e.queue}` : "published";
    case "task-received":
      return "prefetched by the pool";
    case "task-succeeded":
      return e.runtime > 0 ? `runtime ${formatDuration(e.runtime)}` : "succeeded";
    case "task-failed":
    case "task-retried": {
      const { type, message } = splitException(e.exception);
      return type
        ? `${type}${message ? `: ${message}` : ""}`
        : e.exception.split("\n")[0] || e.event_type.slice(5);
    }
    case "task-revoked":
      return "revoked";
    case "task-rejected":
      return "rejected by the worker";
    default:
      return "";
  }
}

function TaskStats({ taskName }: { taskName: string }) {
  const stats = $api.useQuery(
    "get",
    "/api/v1/metrics/task-name-stats",
    { params: { query: { from_minutes: 1440 } } },
    { staleTime: 60_000 },
  );
  const throughput = $api.useQuery(
    "get",
    "/api/v1/metrics/throughput",
    { params: { query: { from_minutes: 1440 } } },
    { staleTime: 60_000 },
  );
  const row = ((stats.data?.data ?? []) as TaskNameStatsRow[]).find(
    (r) => r.task_name === taskName,
  );
  const series = useMemo(() => {
    const rows = ((throughput.data?.data ?? []) as TaskMetricsRow[]).filter(
      (r) => r.task_name === taskName,
    );
    return bucketize(rows, 1440, throughput.dataUpdatedAt || Date.now(), 48);
  }, [throughput.data, throughput.dataUpdatedAt, taskName]);

  if (stats.isLoading) return <Skeleton className="h-28 w-full rounded-xl" />;
  if (!row || row.total === 0) return null;
  const rate = row.failure / row.total;

  return (
    <Panel aria-label="This task over 24 hours" className="pb-3">
      <PanelHeader title="This task, 24h" />
      <div className="grid grid-cols-3 gap-3 px-4">
        <div>
          <div className="label">Runs</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">
            {row.total.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="label">Failed</div>
          <div
            className={cn("mt-1 text-lg font-semibold tabular-nums", rate > 0.05 && "text-fail")}
          >
            {(rate * 100).toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="label">p95</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">
            {row.p95_runtime > 0 ? formatDuration(row.p95_runtime) : "—"}
          </div>
        </div>
      </div>
      <Sparkline
        values={series.map((b) => (row.failure > 0 ? b.failed : b.total))}
        color={row.failure > 0 ? "var(--fail)" : "var(--t2)"}
        height={36}
        className="mt-3 px-4"
        label={row.failure > 0 ? "Failures per 30 minutes" : "Runs per 30 minutes"}
      />
    </Panel>
  );
}

function FingerprintStrip({ exception, taskId }: { exception: string; taskId: string }) {
  const { data } = $api.useQuery(
    "get",
    "/api/v1/metrics/failure-groups",
    { params: { query: { from_minutes: 1440, limit: 200 } } },
    { staleTime: 60_000 },
  );
  const group = useMemo(() => {
    const key = fingerprint(exception).key;
    return mergeFailureGroups((data?.data ?? []) as FailureGroupRow[]).find(
      (g) => g.fingerprint.key === key,
    );
  }, [data, exception]);
  if (!group) return null;
  const others = group.count - (group.latest_task_id === taskId ? 1 : 0);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3.5 py-2.5 text-[12.5px]">
      <span className="text-t2">
        <span className="font-semibold text-foreground tabular-nums">
          {group.count.toLocaleString()}
        </span>{" "}
        {group.count === 1 ? "failure has" : "failures share"} this fingerprint in 24h
        {others > 0 && <span className="text-t3"> · first seen {timeAgo(group.first_seen)}</span>}
      </span>
      <Link
        href={`/tasks?state=FAILURE&search=${encodeURIComponent(searchPhrase(group))}`}
        className="ml-auto inline-flex items-center gap-1 text-xs text-t3 transition-colors hover:text-foreground"
      >
        View group <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
}

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.taskId as string;

  const canRetry = useHasPermission("tasks_retry");
  const canRevoke = useHasPermission("tasks_revoke");
  const [confirm, setConfirm] = useState<"retry" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const { copied, copy } = useCopy();

  const {
    data: task,
    isLoading,
    isError,
    error,
    refetch,
  } = $api.useQuery(
    "get",
    "/api/v1/tasks/{task_id}",
    { params: { path: { task_id: taskId } } },
    { enabled: !!taskId },
  );
  const {
    data: timelineData,
    isLoading: timelineLoading,
    dataUpdatedAt,
  } = $api.useQuery(
    "get",
    "/api/v1/tasks/{task_id}/timeline",
    { params: { path: { task_id: taskId } } },
    { enabled: !!taskId },
  );
  const timeline = useMemo(
    () => [...(timelineData?.timeline ?? [])].sort((a, b) => a.timestamp - b.timestamp),
    [timelineData],
  );
  const life = useMemo(() => lifecycleOf(timeline, task?.runtime), [timeline, task?.runtime]);

  async function runAction() {
    if (!task || !confirm) return;
    setBusy(true);
    setActionError(null);
    try {
      if (confirm === "retry") {
        const result = await retryTask(task.task_id);
        setConfirm(null);
        if (result.task_id) router.push(`/tasks/${result.task_id}`);
        else refetch();
      } else {
        await revokeTask(task.task_id);
        setConfirm(null);
        refetch();
      }
    } catch (err) {
      setConfirm(null);
      setActionError(err instanceof Error ? err.message : `Couldn't ${confirm} the task.`);
    } finally {
      setBusy(false);
    }
  }

  const crumbs = [
    { label: "Tasks", href: "/tasks" },
    { label: <span className="font-mono">{taskId.slice(0, 8)}</span> },
  ];

  if (isLoading) {
    return (
      <>
        <PageHeader crumbs={crumbs} />
        <PageBody>
          <Skeleton className="h-9 w-96 max-w-full" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Skeleton className="h-72 w-full rounded-xl" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
        </PageBody>
      </>
    );
  }

  if (isError || !task) {
    return (
      <>
        <PageHeader crumbs={crumbs} />
        <PageBody>
          <Panel>
            <EmptyState
              icon={<SearchX />}
              title="Task not found"
              description={
                (error as unknown as Error)?.message ??
                "It may have aged out of retention, or the ID is from another organization."
              }
              action={
                <Button asChild>
                  <Link href="/tasks">Back to tasks</Link>
                </Button>
              }
            />
          </Panel>
        </PageBody>
      </>
    );
  }

  const hasException = present(task.exception);
  const hasTraceback = present(task.traceback);
  const hasResult = present(task.result);
  const state = task.state.toUpperCase();
  const unfinished = UNFINISHED.has(state);
  const inWorkflow =
    !!(task.root_id && task.root_id !== task.task_id) ||
    !!task.parent_id ||
    !!task.group_id ||
    !!task.chord_id;
  const { type: excType, message: excMessage } = splitException(task.exception);
  const total = life.wait != null && life.run != null ? life.wait + life.run : null;
  const lifeSubtitle =
    total != null && life.endState
      ? `${formatDuration(total)} from ${life.queuedBy === "sent" ? "publish" : "receipt"} to ${
          life.endState === "SUCCESS"
            ? "success"
            : life.endState === "FAILURE"
              ? "failure"
              : life.endState.toLowerCase()
        }`
      : life.startedAt != null
        ? "running now"
        : life.queuedAt != null
          ? "waiting for a worker"
          : undefined;

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        actions={
          <>
            <Button onClick={() => copy("id", task.task_id)}>
              {copied === "id" ? <Check className="text-ok" /> : <Copy />}
              {copied === "id" ? "Copied" : "Copy ID"}
            </Button>
            {canRevoke && unfinished && (
              <Button onClick={() => setConfirm("revoke")}>
                <Ban />
                Revoke
              </Button>
            )}
            {canRetry && (
              <Button variant="primary" onClick={() => setConfirm("retry")}>
                <RotateCw />
                Retry task
              </Button>
            )}
          </>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <StateBadge state={task.state} size="md" />
            <h1
              className="min-w-0 truncate font-mono text-[19px] font-medium tracking-[-0.01em] text-foreground"
              title={task.task_name}
            >
              {displayTaskName(task.task_name)}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px] text-t2 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-t3">
            <span className="inline-flex min-w-0 items-center gap-1.5 font-mono">
              <Hash aria-hidden />
              <span className="truncate">{task.task_id}</span>
            </span>
            {task.queue && (
              <Link
                href={`/tasks?queue=${encodeURIComponent(task.queue)}`}
                className="inline-flex items-center gap-1.5 font-mono hover:text-foreground"
              >
                <Layers aria-hidden />
                {task.queue}
              </Link>
            )}
            {task.worker_id && (
              <Link
                href={`/workers/${encodeURIComponent(task.worker_id)}`}
                className="inline-flex min-w-0 items-center gap-1.5 font-mono hover:text-foreground"
              >
                <Server aria-hidden />
                <span className="truncate">{task.worker_id}</span>
              </Link>
            )}
            <span
              className="inline-flex items-center gap-1.5"
              title={new Date(task.timestamp).toISOString()}
            >
              <Clock aria-hidden />
              {format(task.timestamp, "d MMM yyyy, HH:mm:ss")}
            </span>
          </div>
        </div>

        {actionError && (
          <ErrorAlert onDismiss={() => setActionError(null)}>{actionError}</ErrorAlert>
        )}

        {(life.queuedAt != null || life.startedAt != null) && (
          <Panel aria-label="Lifecycle" className="pb-4">
            <PanelHeader title="Lifecycle" subtitle={lifeSubtitle} />
            <div className="px-4">
              <LifecycleBar life={life} state={state} now={dataUpdatedAt || Date.now()} />
            </div>
          </Panel>
        )}

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-5">
            {(hasException || hasTraceback) && (
              <Panel aria-label="Exception">
                <PanelHeader
                  title="Exception"
                  action={
                    <button
                      type="button"
                      onClick={() =>
                        copy("tb", [task.exception, task.traceback].filter(present).join("\n\n"))
                      }
                      className="inline-flex items-center gap-1.5 text-xs text-t3 transition-colors hover:text-foreground"
                    >
                      {copied === "tb" ? (
                        <Check className="size-3.5 text-ok" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                      {copied === "tb" ? "Copied" : "Copy traceback"}
                    </button>
                  }
                />
                <div className="flex flex-col gap-3 px-4 pb-4">
                  {hasException && (
                    <div>
                      {excType && (
                        <div className="font-mono text-[14px] font-semibold text-fail">
                          {excType}
                        </div>
                      )}
                      <p className="mt-0.5 text-[14px] leading-relaxed break-words text-foreground">
                        {excMessage || task.exception}
                      </p>
                    </div>
                  )}
                  {hasException && state === "FAILURE" && (
                    <FingerprintStrip exception={task.exception} taskId={task.task_id} />
                  )}
                  {hasTraceback && (
                    <Traceback raw={task.traceback} className="max-h-[520px] overflow-y-auto" />
                  )}
                </div>
              </Panel>
            )}

            <Panel aria-label="Arguments">
              <PanelHeader title="Arguments" />
              <div className="grid grid-cols-1 gap-3 px-4 pb-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                {present(task.args) ? (
                  <JsonViewer value={task.args} label="Args" maxHeight={320} />
                ) : (
                  <EmptyBox label="Args" text="none" />
                )}
                {present(task.kwargs) ? (
                  <JsonViewer value={task.kwargs} label="Kwargs" maxHeight={320} />
                ) : (
                  <EmptyBox label="Kwargs" text="none" />
                )}
                {hasResult ? (
                  <JsonViewer value={task.result} label="Result" maxHeight={320} />
                ) : (
                  <EmptyBox
                    label="Result"
                    text={
                      state === "FAILURE"
                        ? "none, the task raised"
                        : unfinished
                          ? "not finished yet"
                          : "none"
                    }
                  />
                )}
              </div>
            </Panel>

            <Panel aria-label="Events">
              <PanelHeader
                title="Events"
                subtitle={
                  timeline.length
                    ? `${timeline.length} raw Celery event${timeline.length === 1 ? "" : "s"}`
                    : undefined
                }
                action={
                  timeline.length > 0 ? (
                    <button
                      type="button"
                      aria-pressed={showRaw}
                      onClick={() => setShowRaw((v) => !v)}
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs transition-colors hover:text-foreground",
                        showRaw ? "text-foreground" : "text-t3",
                      )}
                    >
                      <Braces className="size-3.5" aria-hidden />
                      JSON
                    </button>
                  ) : undefined
                }
              />
              {timelineLoading ? (
                <div className="flex flex-col gap-2 px-4 pb-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : timeline.length === 0 ? (
                <p className="px-4 pb-4 text-[13px] text-t3">No events recorded for this task.</p>
              ) : showRaw ? (
                <div className="px-4 pb-4">
                  <JsonViewer
                    value={timeline}
                    label="Events"
                    maxHeight={480}
                    defaultCollapsed={false}
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[12.5px]">
                    <tbody>
                      {timeline.map((e) => (
                        <tr key={e.event_id} className="border-t border-line-soft">
                          <td
                            className={cn(
                              "w-[150px] py-2 pl-4 font-mono whitespace-nowrap",
                              e.event_type === "task-failed" || e.event_type === "task-rejected"
                                ? "text-fail"
                                : e.event_type === "task-succeeded"
                                  ? "text-ok"
                                  : e.event_type === "task-retried"
                                    ? "text-warn"
                                    : "text-foreground",
                            )}
                          >
                            {e.event_type}
                          </td>
                          <td className="w-[110px] px-3 py-2 font-mono whitespace-nowrap text-t2">
                            {format(e.timestamp, "HH:mm:ss.SSS")}
                          </td>
                          <td
                            className="max-w-[260px] truncate px-3 py-2 font-mono text-t3"
                            title={e.worker_id}
                          >
                            {e.worker_id || "—"}
                          </td>
                          <td
                            className="max-w-[280px] truncate py-2 pr-4 pl-3 text-t2"
                            title={eventDetail(e)}
                          >
                            {eventDetail(e)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <Panel aria-label="Details">
              <PanelHeader title="Details" />
              <dl className="pb-1">
                <DetailRow label="Runtime">
                  {life.run != null ? formatDuration(life.run) : <span className="text-t3">—</span>}
                </DetailRow>
                <DetailRow label="Queue wait">
                  {life.wait != null ? (
                    formatDuration(life.wait)
                  ) : (
                    <span className="text-t3">—</span>
                  )}
                </DetailRow>
                <DetailRow label="Retries">{task.retries ?? 0}</DetailRow>
                <DetailRow label="Worker">
                  {task.worker_id ? (
                    <Link
                      href={`/workers/${encodeURIComponent(task.worker_id)}`}
                      className="font-mono text-[12.5px] hover:text-link"
                      title={task.worker_id}
                    >
                      {task.worker_id}
                    </Link>
                  ) : (
                    <span className="text-t3">—</span>
                  )}
                </DetailRow>
                <DetailRow label="Queue">
                  {task.queue ? (
                    <span className="font-mono text-[12.5px]">{task.queue}</span>
                  ) : (
                    <span className="text-t3">—</span>
                  )}
                </DetailRow>
                <DetailRow label="Broker">
                  {task.broker_type || <span className="text-t3">—</span>}
                </DetailRow>
                {task.root_id && task.root_id !== task.task_id && (
                  <DetailRow label="Root">
                    <Link
                      href={`/tasks/${task.root_id}`}
                      className="font-mono text-[12.5px] text-link hover:underline"
                    >
                      {task.root_id.slice(0, 8)}
                    </Link>
                  </DetailRow>
                )}
                {task.parent_id && (
                  <DetailRow label="Parent">
                    <Link
                      href={`/tasks/${task.parent_id}`}
                      className="font-mono text-[12.5px] text-link hover:underline"
                    >
                      {task.parent_id.slice(0, 8)}
                    </Link>
                  </DetailRow>
                )}
                {task.group_id && (
                  <DetailRow label="Group">
                    <span className="font-mono text-[12.5px]" title={task.group_id}>
                      {task.group_id.slice(0, 8)}
                    </span>
                  </DetailRow>
                )}
                {task.chord_id && (
                  <DetailRow label="Chord callback">
                    <Link
                      href={`/tasks/${task.chord_id}`}
                      className="font-mono text-[12.5px] text-link hover:underline"
                    >
                      {task.chord_id.slice(0, 8)}
                    </Link>
                  </DetailRow>
                )}
              </dl>
            </Panel>

            {inWorkflow && (
              <WorkflowPanel
                rootId={task.root_id ?? task.task_id}
                current={{ task_id: task.task_id, state: task.state, runtime: life.run }}
              />
            )}

            {(task.retries > 0 || task.parent_id) && <RetryChain taskId={task.task_id} />}

            <TaskStats taskName={task.task_name} />
          </div>
        </div>
      </PageBody>

      <ConfirmDialog
        open={confirm != null}
        onOpenChange={(open) => !open && !busy && setConfirm(null)}
        title={confirm === "retry" ? "Retry this task?" : "Revoke this task?"}
        description={
          confirm === "retry"
            ? `Publishes a new copy to the ${task.queue || "default"} queue with the same arguments, then opens it.`
            : "Workers skip a revoked task if it hasn't started. A task that's already running finishes."
        }
        subject={`${task.task_name} · ${task.task_id}`}
        confirmLabel={confirm === "retry" ? "Retry task" : "Revoke"}
        tone={confirm === "revoke" ? "danger" : "primary"}
        busy={busy}
        onConfirm={runAction}
      />
    </>
  );
}

function EmptyBox({ label, text }: { label: string; text: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-code">
      <div className="border-b border-border px-3 py-1.5">
        <span className="label">{label}</span>
      </div>
      <div className="px-3.5 py-2.5 font-mono text-[12px] text-t3">{text}</div>
    </div>
  );
}

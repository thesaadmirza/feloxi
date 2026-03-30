"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  RotateCcw,
  XCircle,
  Loader2,
  Clock,
  Layers,
  AlertTriangle,
  Copy,
  Check,
  GitBranch,
  ExternalLink,
  Server,
} from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { formatDuration, truncateId } from "@/lib/utils";
import { getStateColor } from "@/lib/constants";
import { JsonViewer } from "@/components/shared/json-viewer";
import { Skeleton } from "@/components/shared/skeleton";
import WorkflowDag from "@/components/shared/workflow-dag";

type TabId = "details" | "workflow";

function StateBadge({ state }: { state: string }) {
  return (
    <span
      className={`badge-${state.toLowerCase()} inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold`}
    >
      {state}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2.5 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground w-32 shrink-0">{label}</span>
      <span className="text-sm text-foreground font-mono break-all flex-1">{value}</span>
    </div>
  );
}

function TaskIdLink({ taskId, label }: { taskId: string; label?: string }) {
  return (
    <Link
      href={`/tasks/${taskId}`}
      className="inline-flex items-center gap-1 text-primary hover:text-primary/80 transition underline-offset-4 hover:underline"
    >
      <span>{label ?? truncateId(taskId, 16)}</span>
      <ExternalLink className="h-3 w-3" />
    </Link>
  );
}

function WorkflowLink({ rootId }: { rootId: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <TaskIdLink taskId={rootId} />
      <span className="text-xs text-muted-foreground">(workflow root)</span>
    </span>
  );
}

function TracebackSection({
  exception,
  traceback,
  hasException,
  hasTraceback,
}: {
  exception: string;
  traceback: string;
  hasException: boolean;
  hasTraceback: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const fullText = [
    hasException ? exception : "",
    hasTraceback ? traceback : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  function handleCopy() {
    navigator.clipboard.writeText(fullText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <h2 className="font-semibold text-destructive">Error Details</h2>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {hasException && (
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-1">Exception</p>
          <p className="text-sm font-mono text-destructive break-all">{exception}</p>
        </div>
      )}

      {hasTraceback && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Traceback</p>
          <pre className="text-xs font-mono text-foreground/80 bg-background/50 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-all max-h-[500px] overflow-y-auto">
            {traceback}
          </pre>
        </div>
      )}
    </div>
  );
}

function WorkflowSection({
  rootId,
  currentTaskId,
}: {
  rootId: string;
  currentTaskId: string;
}) {
  const { data, isLoading, isError } = $api.useQuery(
    "get",
    "/api/v1/workflows/{root_id}",
    { params: { path: { root_id: rootId } } },
    { enabled: !!rootId }
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Could not load workflow data
      </div>
    );
  }

  return (
    <WorkflowDag
      nodes={data.nodes}
      edges={data.edges}
      rootId={data.root_id}
      currentTaskId={currentTaskId}
    />
  );
}

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.taskId as string;

  const [retrying, setRetrying] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("details");

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
    { enabled: !!taskId }
  );

  const { data: timelineData, isLoading: timelineLoading } = $api.useQuery(
    "get",
    "/api/v1/tasks/{task_id}/timeline",
    { params: { path: { task_id: taskId } } },
    { enabled: !!taskId }
  );
  const timeline = timelineData?.timeline ?? [];

  async function handleRetry() {
    if (!task || retrying) return;
    setRetrying(true);
    try {
      let args: unknown = [];
      let kwargs: unknown = {};
      try {
        args = JSON.parse(task.args);
      } catch {
        args = [];
      }
      try {
        kwargs = JSON.parse(task.kwargs);
      } catch {
        kwargs = {};
      }
      const result = await unwrap(fetchClient.POST("/api/v1/tasks/{task_id}/retry", {
        params: { path: { task_id: task.task_id } },
        body: {
          task_name: task.task_name,
          args,
          kwargs,
          queue: task.queue,
        },
      }));
      if (result.task_id) {
        router.push(`/tasks/${result.task_id}`);
      } else {
        refetch();
      }
    } catch (err) {
      console.error("Retry failed:", err);
    } finally {
      setRetrying(false);
    }
  }

  async function handleRevoke() {
    if (!task || revoking) return;
    setRevoking(true);
    try {
      await unwrap(fetchClient.POST("/api/v1/tasks/{task_id}/revoke", {
        params: { path: { task_id: task.task_id } },
      }));
      refetch();
    } catch (err) {
      console.error("Revoke failed:", err);
    } finally {
      setRevoking(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-border bg-card p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
          <div className="rounded-xl border border-border bg-card p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive opacity-60" />
        <p className="text-lg font-medium text-foreground">Task not found</p>
        <p className="text-sm text-muted-foreground">
          {String((error as unknown as Error)?.message ?? "Could not load task details")}
        </p>
        <button
          onClick={() => router.back()}
          className="mt-2 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition"
        >
          Go back
        </button>
      </div>
    );
  }

  if (!task) return null;

  const hasException = !!(task.exception && task.exception !== "null" && task.exception !== "");
  const hasTraceback = !!(task.traceback && task.traceback !== "null" && task.traceback !== "");
  const hasResult = !!(task.result && task.result !== "null" && task.result !== "");
  const hasWorkflow = !!(task.root_id || task.parent_id || task.group_id);

  const tabs: { id: TabId; label: string; icon: typeof Layers; show: boolean }[] = [
    { id: "details", label: "Details", icon: Layers, show: true },
    { id: "workflow", label: "Workflow Chain", icon: GitBranch, show: hasWorkflow },
  ];
  const visibleTabs = tabs.filter((t) => t.show);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/tasks")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Tasks
          </button>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-mono text-muted-foreground">
            {truncateId(task.task_id)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <StateBadge state={task.state} />
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-sm text-foreground hover:bg-secondary/80 transition disabled:opacity-50"
          >
            {retrying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            Retry
          </button>
          <button
            onClick={handleRevoke}
            disabled={revoking}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-destructive/20 text-sm text-destructive hover:bg-destructive/30 transition disabled:opacity-50"
          >
            {revoking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            Revoke
          </button>
        </div>
      </div>

      {visibleTabs.length > 1 && (
        <div className="flex gap-1 bg-secondary/50 rounded-lg p-1 w-fit">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition ${
                  activeTab === tab.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {activeTab === "details" && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-xl border border-border bg-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Layers className="h-4 w-4 text-primary" />
                <h2 className="font-semibold text-foreground">{task.task_name}</h2>
              </div>
              <InfoRow label="Task ID" value={task.task_id} />
              <InfoRow label="Event ID" value={task.event_id} />
              <InfoRow label="Queue" value={task.queue || "—"} />
              <InfoRow label="Worker" value={task.worker_id || "—"} />
              <InfoRow
                label="Runtime"
                value={task.runtime != null ? formatDuration(task.runtime) : "—"}
              />
              <InfoRow label="Retries" value={String(task.retries ?? 0)} />
              {task.root_id && (
                <InfoRow
                  label="Root ID"
                  value={
                    task.root_id === task.task_id ? (
                      <span className="text-muted-foreground">{truncateId(task.root_id, 16)} (this task)</span>
                    ) : (
                      <WorkflowLink rootId={task.root_id} />
                    )
                  }
                />
              )}
              {task.parent_id && (
                <InfoRow
                  label="Parent Task"
                  value={<TaskIdLink taskId={task.parent_id} />}
                />
              )}
              {task.group_id && (
                <InfoRow label="Group ID" value={truncateId(task.group_id, 16)} />
              )}
              {task.chord_id && (
                <InfoRow
                  label="Chord Callback"
                  value={<TaskIdLink taskId={task.chord_id} />}
                />
              )}
              <InfoRow
                label="Timestamp"
                value={new Date(task.timestamp).toLocaleString()}
              />
              <InfoRow label="Broker" value={task.broker_type || "—"} />
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="h-4 w-4 text-primary" />
                <h2 className="font-semibold text-foreground">State Timeline</h2>
              </div>

              {timelineLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">No timeline available</p>
              ) : (
                <div className="relative">
                  <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
                  <div className="space-y-4">
                    {timeline.map((event, idx) => (
                      <div
                        key={event.event_id ?? idx}
                        className="flex items-start gap-3 pl-8 relative"
                      >
                        <div
                          className="absolute left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-background"
                          style={{ backgroundColor: getStateColor(event.state) }}
                        />
                        <div className="min-w-0">
                          <span
                            className={`badge-${event.state.toLowerCase()} inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium`}
                          >
                            {event.state}
                          </span>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {new Date(event.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {(task.args || task.kwargs) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {task.args && task.args !== "null" && task.args !== "[]" && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <JsonViewer value={task.args} label="Args" maxHeight={400} />
                </div>
              )}
              {task.kwargs && task.kwargs !== "null" && task.kwargs !== "{}" && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <JsonViewer value={task.kwargs} label="Kwargs" maxHeight={400} />
                </div>
              )}
            </div>
          )}

          {hasResult && (
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Server className="h-4 w-4 text-[#22c55e]" />
                <h2 className="font-semibold text-foreground">Result</h2>
              </div>
              <JsonViewer value={task.result} label="Return value" maxHeight={999999} defaultCollapsed={false} />
            </div>
          )}

          {(hasException || hasTraceback) && (
            <TracebackSection
              exception={task.exception}
              traceback={task.traceback}
              hasException={hasException}
              hasTraceback={hasTraceback}
            />
          )}
        </>
      )}

      {activeTab === "workflow" && hasWorkflow && (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <GitBranch className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-foreground">Workflow Chain</h2>
          </div>
          <WorkflowSection
            rootId={task.root_id ?? task.task_id}
            currentTaskId={task.task_id}
          />
        </div>
      )}
    </div>
  );
}

"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import {
  RotateCcw,
  XCircle,
  Search,
  ChevronRight,
  Loader2,
  ListTodo,
  Download,
  RefreshCw,
} from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { formatDuration, truncateId, timeAgo } from "@/lib/utils";
import { Pagination } from "@/components/shared/pagination";
import type { TaskState, TaskEvent } from "@/types/api";

const TASKS_LIMIT = 50;

function exportTasks(tasks: TaskEvent[], format: "csv" | "json") {
  if (tasks.length === 0) return;
  let content: string;
  let mime: string;
  let ext: string;

  if (format === "json") {
    content = JSON.stringify(tasks, null, 2);
    mime = "application/json";
    ext = "json";
  } else {
    const headers = ["task_id", "task_name", "state", "queue", "worker_id", "runtime", "timestamp"];
    const rows = tasks.map((t) =>
      [t.task_id, t.task_name, t.state, t.queue || "", t.worker_id || "", t.runtime?.toString() ?? "", t.timestamp].map(
        (v) => `"${String(v).replace(/"/g, '""')}"`
      ).join(",")
    );
    content = [headers.join(","), ...rows].join("\n");
    mime = "text/csv";
    ext = "csv";
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tasks-export.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

const TASK_STATES: TaskState[] = [
  "PENDING",
  "RECEIVED",
  "STARTED",
  "SUCCESS",
  "FAILURE",
  "RETRY",
  "REVOKED",
  "REJECTED",
];

function StateBadge({ state }: { state: string }) {
  return (
    <span
      className={`badge-${state.toLowerCase()} inline-flex items-center px-2 py-0.5 rounded text-xs font-medium`}
    >
      {state}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border animate-pulse">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-secondary rounded w-full" />
        </td>
      ))}
    </tr>
  );
}

export default function TasksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const stateFilter = (searchParams.get("state") as TaskState) || "";
  const nameFilter = searchParams.get("task_name") || "";
  const queueFilter = searchParams.get("queue") || "";

  const [nameInput, setNameInput] = useState(nameFilter);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      setCursor(undefined);
      setCursorStack([]);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  const { data, isLoading, isError, error, refetch } = $api.useQuery(
    "get",
    "/api/v1/tasks",
    {
      params: {
        query: {
          state: stateFilter || undefined,
          task_name: nameFilter || undefined,
          queue: queueFilter || undefined,
          limit: TASKS_LIMIT,
          cursor,
        },
      },
    },
    { refetchInterval: autoRefresh ? 5_000 : false }
  );

  const tasks = data?.data ?? [];

  const { data: queueNamesData } = $api.useQuery("get", "/api/v1/metrics/queue-names");
  const queueNames = queueNamesData?.data ?? [];

  const toggleAutoRefresh = useCallback(() => setAutoRefresh((v) => !v), []);
  const handleExportCsv = useCallback(() => exportTasks(tasks, "csv"), [tasks]);
  const handleExportJson = useCallback(() => exportTasks(tasks, "json"), [tasks]);
  const handleRefresh = useCallback(() => refetch(), [refetch]);
  const dismissActionError = useCallback(() => setActionError(null), []);
  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") updateParam("task_name", nameInput);
    },
    [nameInput, updateParam]
  );
  const handleNameBlur = useCallback(
    () => updateParam("task_name", nameInput),
    [nameInput, updateParam]
  );
  const handleTaskRowClick = useCallback(
    (taskId: string) => router.push(`/tasks/${taskId}`),
    [router]
  );

  const handleNextPage = useCallback(() => {
    if (!data?.next_cursor) return;
    setCursorStack((prev) => [...prev, cursor ?? ""]);
    setCursor(data.next_cursor ?? undefined);
  }, [data?.next_cursor, cursor]);

  const handlePrevPage = useCallback(() => {
    setCursorStack((prev) => {
      const next = [...prev];
      const prevCursor = next.pop();
      setCursor(prevCursor || undefined);
      return next;
    });
  }, []);

  async function handleRetry(e: React.MouseEvent, task: TaskEvent) {
    e.stopPropagation();
    if (retrying) return;
    setRetrying(task.task_id);
    setActionError(null);
    try {
      let args: unknown = [];
      let kwargs: unknown = {};
      try { args = JSON.parse(task.args); } catch { args = []; }
      try { kwargs = JSON.parse(task.kwargs); } catch { kwargs = {}; }
      await unwrap(fetchClient.POST("/api/v1/tasks/{task_id}/retry", {
        params: { path: { task_id: task.task_id } },
        body: {
          task_name: task.task_name,
          args,
          kwargs,
          queue: task.queue,
        },
      }));
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to retry task");
    } finally {
      setRetrying(null);
    }
  }

  async function handleRevoke(e: React.MouseEvent, task: TaskEvent) {
    e.stopPropagation();
    if (revoking) return;
    setRevoking(task.task_id);
    setActionError(null);
    try {
      await unwrap(fetchClient.POST("/api/v1/tasks/{task_id}/revoke", {
        params: { path: { task_id: task.task_id } },
      }));
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to revoke task");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tasks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor and manage your task queue events
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAutoRefresh}
            className={[
              "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition",
              autoRefresh
                ? "bg-primary/15 text-primary border border-primary/30"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            ].join(" ")}
            title={autoRefresh ? "Auto-refresh on (5s)" : "Enable auto-refresh"}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{autoRefresh ? "Live" : "Auto"}</span>
          </button>

          <button
            onClick={handleExportCsv}
            disabled={tasks.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition disabled:opacity-40"
            title="Export as CSV"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">CSV</span>
          </button>
          <button
            onClick={handleExportJson}
            disabled={tasks.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition disabled:opacity-40"
            title="Export as JSON"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">JSON</span>
          </button>

          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-destructive/40 bg-destructive/5 text-destructive text-sm">
          <span>{actionError}</span>
          <button onClick={dismissActionError} className="text-xs underline hover:no-underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">State</label>
          <select
            value={stateFilter}
            onChange={(e) => updateParam("state", e.target.value)}
            className="bg-secondary border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All states</option>
            {TASK_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Task</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={handleNameKeyDown}
              onBlur={handleNameBlur}
              placeholder="Search task name..."
              className="pl-8 pr-3 py-2 bg-secondary border border-border text-foreground text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-ring w-52"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Queue</label>
          <select
            value={queueFilter}
            onChange={(e) => updateParam("queue", e.target.value)}
            className="bg-secondary border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All queues</option>
            {queueNames.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Task ID
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Task Name
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  State
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Queue
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Worker
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Runtime
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Timestamp
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}

              {isError && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-destructive"
                  >
                    Failed to load tasks:{" "}
                    {(error as Error)?.message ?? "Unknown error"}
                  </td>
                </tr>
              )}

              {!isLoading && !isError && tasks.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <ListTodo className="h-10 w-10 opacity-40" />
                      <p className="font-medium">No tasks found</p>
                      <p className="text-sm">
                        Try adjusting your filters or check back later
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {!isLoading &&
                tasks.map((task) => (
                  <tr
                    key={task.event_id}
                    onClick={() => handleTaskRowClick(task.task_id)}
                    className="border-b border-border hover:bg-secondary/30 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {truncateId(task.task_id, 8)}
                    </td>
                    <td className="px-4 py-3 text-foreground max-w-[220px] truncate">
                      {task.task_name}
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge state={task.state} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {task.queue || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs truncate max-w-[140px]">
                      {task.worker_id ? truncateId(task.worker_id, 16) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {task.runtime != null && task.runtime > 0 ? formatDuration(task.runtime) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {timeAgo(task.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleRetry(e, task)}
                          disabled={retrying === task.task_id}
                          title="Retry task"
                          className="flex items-center gap-1 px-2 py-1 rounded bg-secondary hover:bg-secondary/70 text-xs text-foreground transition disabled:opacity-50"
                        >
                          {retrying === task.task_id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                          Retry
                        </button>
                        <button
                          onClick={(e) => handleRevoke(e, task)}
                          disabled={revoking === task.task_id}
                          title="Revoke task"
                          className="flex items-center gap-1 px-2 py-1 rounded bg-destructive/20 hover:bg-destructive/30 text-xs text-destructive transition disabled:opacity-50"
                        >
                          {revoking === task.task_id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          Revoke
                        </button>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {data && (
          <Pagination
            total={data.total ?? undefined}
            limit={TASKS_LIMIT}
            hasMore={data.has_more}
            currentCount={tasks.length}
            page={cursorStack.length + 1}
            onNext={handleNextPage}
            onPrev={handlePrevPage}
          />
        )}
      </div>
    </div>
  );
}

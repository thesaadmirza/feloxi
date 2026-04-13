"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RotateCcw,
  XCircle,
  Search,
  ChevronRight,
  Loader2,
  ListTodo,
  Download,
  RefreshCw,
  X,
  AlertTriangle,
} from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { formatDuration, truncateId, timeAgo } from "@/lib/utils";
import { Pagination } from "@/components/shared/pagination";
import { useHasPermission } from "@/hooks/use-current-user";
import type { TaskState, TaskEvent } from "@/types/api";

import { DEFAULT_TIME_RANGE, TIME_RANGE_PRESETS, type TimeRangeId } from "@/lib/constants";

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

type ViewMode = "summary" | "events";

function msToLocalInput(ms: number): string {
  // <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time.
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function CustomRangePanel({
  initialSince,
  initialUntil,
  onApply,
  onCancel,
}: {
  initialSince?: number;
  initialUntil?: number;
  onApply: (sinceMs: number, untilMs: number) => void;
  onCancel: () => void;
}) {
  const now = Date.now();
  const defaultSince = initialSince ?? now - 60 * 60 * 1000;
  const defaultUntil = initialUntil ?? now;

  const [fromValue, setFromValue] = useState(() => msToLocalInput(defaultSince));
  const [toValue, setToValue] = useState(() => msToLocalInput(defaultUntil));
  const [error, setError] = useState<string | null>(null);

  const handleApply = () => {
    const since = new Date(fromValue).getTime();
    const until = new Date(toValue).getTime();
    if (Number.isNaN(since) || Number.isNaN(until)) {
      setError("Please pick valid dates");
      return;
    }
    if (since >= until) {
      setError("Start must be before end");
      return;
    }
    onApply(since, until);
  };

  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wider">
            From
          </label>
          <input
            type="datetime-local"
            value={fromValue}
            onChange={(e) => {
              setFromValue(e.target.value);
              setError(null);
            }}
            className="px-3 py-2 bg-background border border-border text-foreground text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wider">
            To
          </label>
          <input
            type="datetime-local"
            value={toValue}
            onChange={(e) => {
              setToValue(e.target.value);
              setError(null);
            }}
            className="px-3 py-2 bg-background border border-border text-foreground text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition"
          >
            Apply range
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default function TasksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const stateFilter = (searchParams.get("state") as TaskState) || "";
  const nameFilter = searchParams.get("task_name") || "";
  const searchFilter = searchParams.get("search") || "";
  const errorsOnlyFilter = searchParams.get("errors_only") === "true";
  const sinceMsParam = searchParams.get("since_ms");
  const untilMsParam = searchParams.get("until_ms");
  const customRange = useMemo(
    () =>
      sinceMsParam !== null && untilMsParam !== null
        ? { since: Number(sinceMsParam), until: Number(untilMsParam) }
        : null,
    [sinceMsParam, untilMsParam]
  );
  const rangeFilter: TimeRangeId =
    (searchParams.get("range") as TimeRangeId) || DEFAULT_TIME_RANGE;

  const [nameInput, setNameInput] = useState(nameFilter);
  const [searchInput, setSearchInput] = useState(searchFilter);
  const [customOpen, setCustomOpen] = useState(false);
  const canRetry = useHasPermission("tasks_retry");
  const canRevoke = useHasPermission("tasks_revoke");
  const [retrying, setRetrying] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: "retry" | "revoke"; task: TaskEvent } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("summary");

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

  const rangeMinutes = useMemo(
    () =>
      (TIME_RANGE_PRESETS.find((p) => p.id === rangeFilter)
        ?? TIME_RANGE_PRESETS.find((p) => p.id === DEFAULT_TIME_RANGE)!).minutes,
    [rangeFilter]
  );

  // Bucket to the minute so React Query can still dedupe identical polls,
  // but the lower bound advances as the clock does instead of being frozen
  // at the moment the user picked the preset.
  const bucketMinute = Math.floor(Date.now() / 60_000);
  const effectiveSinceMs = customRange
    ? customRange.since
    : (bucketMinute - rangeMinutes) * 60_000;
  const effectiveUntilMs = customRange ? customRange.until : undefined;

  const queryParams = useMemo(() => ({
    params: {
      query: {
        state: stateFilter || undefined,
        task_name: nameFilter || undefined,
        search: searchFilter || undefined,
        errors_only: errorsOnlyFilter || undefined,
        since_ms: effectiveSinceMs,
        until_ms: effectiveUntilMs,
        limit: TASKS_LIMIT,
        cursor,
      },
    },
  }), [stateFilter, nameFilter, searchFilter, errorsOnlyFilter, effectiveSinceMs, effectiveUntilMs, cursor]);

  const summaryQuery = $api.useQuery(
    "get",
    "/api/v1/tasks/summary",
    queryParams,
    { enabled: viewMode === "summary", refetchInterval: autoRefresh ? 5_000 : false }
  );

  const eventsQuery = $api.useQuery(
    "get",
    "/api/v1/tasks",
    queryParams,
    { enabled: viewMode === "events", refetchInterval: autoRefresh ? 5_000 : false }
  );

  const activeQuery = viewMode === "summary" ? summaryQuery : eventsQuery;
  const tasks = activeQuery.data?.data ?? [];

  const toggleAutoRefresh = useCallback(() => setAutoRefresh((v) => !v), []);
  const handleExportCsv = useCallback(() => exportTasks(tasks as TaskEvent[], "csv"), [tasks]);
  const handleExportJson = useCallback(() => exportTasks(tasks as TaskEvent[], "json"), [tasks]);
  const handleRefresh = useCallback(() => activeQuery.refetch(), [activeQuery]);
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

  const commitSearch = useCallback(
    () => updateParam("search", searchInput.trim()),
    [searchInput, updateParam]
  );
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitSearch();
    },
    [commitSearch]
  );
  const clearFilters = useCallback(() => {
    setNameInput("");
    setSearchInput("");
    setCursor(undefined);
    setCursorStack([]);
    router.push(pathname);
  }, [pathname, router]);

  const applyCustomRange = useCallback(
    (sinceMs: number, untilMs: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("since_ms", String(sinceMs));
      params.set("until_ms", String(untilMs));
      params.delete("range");
      setCursor(undefined);
      setCursorStack([]);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  const clearCustomRange = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("since_ms");
    params.delete("until_ms");
    setCursor(undefined);
    setCursorStack([]);
    router.push(`${pathname}?${params.toString()}`);
  }, [pathname, router, searchParams]);

  useEffect(() => {
    setNameInput(nameFilter);
  }, [nameFilter]);
  useEffect(() => {
    setSearchInput(searchFilter);
  }, [searchFilter]);

  const activeChips = useMemo(() => {
    const chips: {
      key: string;
      label: string;
      onRemove: () => void;
    }[] = [];
    if (stateFilter)
      chips.push({
        key: "state",
        label: `state: ${stateFilter}`,
        onRemove: () => updateParam("state", ""),
      });
    if (nameFilter)
      chips.push({
        key: "task_name",
        label: `name: ${nameFilter}`,
        onRemove: () => {
          setNameInput("");
          updateParam("task_name", "");
        },
      });
    if (searchFilter)
      chips.push({
        key: "search",
        label: `search: ${searchFilter}`,
        onRemove: () => {
          setSearchInput("");
          updateParam("search", "");
        },
      });
    if (errorsOnlyFilter)
      chips.push({
        key: "errors_only",
        label: "errors only",
        onRemove: () => updateParam("errors_only", ""),
      });
    if (customRange) {
      const fmt = (ms: number) =>
        new Date(ms).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      chips.push({
        key: "custom_range",
        label: `${fmt(customRange.since)} → ${fmt(customRange.until)}`,
        onRemove: clearCustomRange,
      });
    } else if (rangeFilter !== DEFAULT_TIME_RANGE) {
      chips.push({
        key: "range",
        label: `range: ${rangeFilter}`,
        onRemove: () => updateParam("range", ""),
      });
    }
    return chips;
  }, [
    stateFilter,
    nameFilter,
    searchFilter,
    errorsOnlyFilter,
    rangeFilter,
    customRange,
    updateParam,
    clearCustomRange,
  ]);
  const handleTaskRowClick = useCallback(
    (taskId: string) => router.push(`/tasks/${taskId}`),
    [router]
  );

  const handleNextPage = useCallback(() => {
    if (!activeQuery.data?.next_cursor) return;
    setCursorStack((prev) => [...prev, cursor ?? ""]);
    setCursor(activeQuery.data.next_cursor ?? undefined);
  }, [activeQuery.data?.next_cursor, cursor]);

  const handlePrevPage = useCallback(() => {
    setCursorStack((prev) => {
      const next = [...prev];
      const prevCursor = next.pop();
      setCursor(prevCursor || undefined);
      return next;
    });
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setCursor(undefined);
    setCursorStack([]);
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
      activeQuery.refetch();
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
      activeQuery.refetch();
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
            {viewMode === "summary"
              ? "One row per task — latest state"
              : "All task events in chronological order"
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 p-1 bg-secondary rounded-lg">
            <button
              onClick={() => handleViewModeChange("summary")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                viewMode === "summary"
                  ? "bg-zinc-700 text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              Summary
            </button>
            <button
              onClick={() => handleViewModeChange("events")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                viewMode === "events"
                  ? "bg-zinc-700 text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              Events
            </button>
          </div>

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

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                updateParam("search", "");
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onBlur={commitSearch}
            placeholder="Search task ID, name, args, kwargs, result, error…  (press Enter)"
            className="w-full pl-10 pr-10 py-2.5 bg-secondary border border-border text-foreground text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-secondary rounded-lg">
            {TIME_RANGE_PRESETS.map((p) => {
              const isActive = !customRange && rangeFilter === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    clearCustomRange();
                    updateParam("range", p.id === DEFAULT_TIME_RANGE ? "" : p.id);
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    isActive
                      ? "bg-zinc-700 text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
            <div className="w-px h-4 bg-border mx-0.5" />
            <button
              type="button"
              onClick={() => setCustomOpen((v) => !v)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                customRange
                  ? "bg-zinc-700 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Custom…
            </button>
          </div>

          <select
            value={stateFilter}
            onChange={(e) => updateParam("state", e.target.value)}
            className="bg-secondary border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="State filter"
          >
            <option value="">All states</option>
            {TASK_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <div className="relative">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={handleNameKeyDown}
              onBlur={handleNameBlur}
              placeholder="Task name…"
              className="px-3 py-2 bg-secondary border border-border text-foreground text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-ring w-44"
              aria-label="Task name filter"
            />
          </div>

          <label className="flex items-center gap-2 px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={errorsOnlyFilter}
              onChange={(e) => updateParam("errors_only", e.target.checked ? "true" : "")}
              className="accent-primary"
            />
            <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
            Errors only
          </label>

          {activeChips.length > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition"
            >
              Clear all
            </button>
          )}
        </div>

        {customOpen && (
          <CustomRangePanel
            initialSince={customRange?.since}
            initialUntil={customRange?.until}
            onApply={(since, until) => {
              applyCustomRange(since, until);
              setCustomOpen(false);
            }}
            onCancel={() => setCustomOpen(false)}
          />
        )}

        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/60">
            <span className="text-xs text-muted-foreground mr-1">Active:</span>
            {activeChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.onRemove}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-xs text-primary hover:bg-primary/25 transition"
              >
                {chip.label}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Task ID</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Task Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">State</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Queue</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Worker</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Runtime</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  {viewMode === "summary" ? "Last Seen" : "Timestamp"}
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeQuery.isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}

              {activeQuery.isError && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-destructive">
                    Failed to load tasks: {(activeQuery.error as Error)?.message ?? "Unknown error"}
                  </td>
                </tr>
              )}

              {!activeQuery.isLoading && !activeQuery.isError && tasks.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <ListTodo className="h-10 w-10 opacity-40" />
                      <p className="font-medium">No tasks found</p>
                      <p className="text-sm">Try adjusting your filters or check back later</p>
                    </div>
                  </td>
                </tr>
              )}

              {!activeQuery.isLoading &&
                tasks.map((task) => (
                  <tr
                    key={`${task.task_id}-${task.timestamp}`}
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
                    <td className="px-4 py-3 text-muted-foreground">{task.queue || "—"}</td>
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
                        {canRetry && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: "retry", task: task as TaskEvent }); }}
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
                        )}
                        {canRevoke && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: "revoke", task: task as TaskEvent }); }}
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
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {activeQuery.data && (
          <Pagination
            limit={TASKS_LIMIT}
            hasMore={activeQuery.data.has_more}
            currentCount={tasks.length}
            page={cursorStack.length + 1}
            onNext={handleNextPage}
            onPrev={handlePrevPage}
          />
        )}
      </div>

      {confirmAction && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setConfirmAction(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full shadow-xl">
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {confirmAction.type === "retry" ? "Retry Task" : "Revoke Task"}
              </h3>
              <p className="text-sm text-muted-foreground mb-1">
                {confirmAction.type === "retry"
                  ? "This will publish a new copy of this task to the broker queue."
                  : "This will broadcast a revoke command to all workers. The task will be terminated if currently running."}
              </p>
              <p className="text-xs text-muted-foreground mb-4 font-mono truncate">
                {confirmAction.task.task_name} — {confirmAction.task.task_id}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmAction(null)}
                  className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const { type, task } = confirmAction;
                    setConfirmAction(null);
                    const fakeEvent = { stopPropagation: () => {} } as React.MouseEvent;
                    if (type === "retry") handleRetry(fakeEvent, task);
                    else handleRevoke(fakeEvent, task);
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                    confirmAction.type === "revoke"
                      ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  }`}
                >
                  {confirmAction.type === "retry" ? "Retry" : "Revoke"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

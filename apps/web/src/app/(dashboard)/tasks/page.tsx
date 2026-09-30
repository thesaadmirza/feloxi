"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarRange, Download, SlidersHorizontal } from "lucide-react";
import { $api } from "@/lib/api";
import { mergeFailureGroups } from "@/lib/fingerprint";
import { bucketizeRange } from "@/lib/series";
import { shortTaskName, workerLabeler } from "@/lib/names";
import { retryTask, revokeTask } from "@/lib/task-actions";
import { cn } from "@/lib/utils";
import {
  DEFAULT_TIME_RANGE,
  STATE_COLORS,
  TIME_RANGE_PHRASE,
  TIME_RANGE_PRESETS,
  type TimeRangeId,
} from "@/lib/constants";
import { useHasPermission } from "@/hooks/use-current-user";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { LiveToggle } from "@/components/ui/live-toggle";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/segmented";
import { Tab, Tabs } from "@/components/ui/tabs";
import { ErrorAlert, Notice } from "@/components/shared/error-alert";
import { Pagination } from "@/components/shared/pagination";
import { stateLabel } from "@/components/shared/state-badge";
import { BulkBar } from "@/components/tasks/bulk-bar";
import { CustomRangePanel } from "@/components/tasks/custom-range";
import { FacetGroup, type FacetOption } from "@/components/tasks/facets";
import { FailureGroups } from "@/components/tasks/failure-groups";
import { SEGMENTS, TaskHistogram, type Segment } from "@/components/tasks/histogram";
import { QueryBar, type QueryChip } from "@/components/tasks/query-bar";
import { TaskTable, UNFINISHED, type TaskRow } from "@/components/tasks/task-table";
import type { FailureGroupRow, TaskMetricsRow, TaskState, WorkerTaskStats } from "@/types/api";

const TASKS_LIMIT = 50;
const SUGGESTIONS_STALE_MS = 10 * 60 * 1000;
const RANGES = TIME_RANGE_PRESETS.map((r) => ({ value: r.id, label: r.label }));

/// Facet order: what people filter by most often first.
const TASK_STATES: TaskState[] = [
  "FAILURE",
  "SUCCESS",
  "RETRY",
  "STARTED",
  "RECEIVED",
  "PENDING",
  "REVOKED",
  "REJECTED",
];

/// States the per-minute metrics count, and the column that holds each.
const COUNTED: Partial<
  Record<TaskState, "success_count" | "failure_count" | "retry_count" | "revoked_count">
> = {
  SUCCESS: "success_count",
  FAILURE: "failure_count",
  RETRY: "retry_count",
  REVOKED: "revoked_count",
};
const SEGMENT_OF: Partial<Record<TaskState, Segment>> = {
  SUCCESS: SEGMENTS.succeeded,
  RETRY: SEGMENTS.retried,
  REVOKED: SEGMENTS.revoked,
  FAILURE: SEGMENTS.failed,
};
const WORKER_COLUMN: Partial<Record<TaskState, keyof WorkerTaskStats>> = {
  SUCCESS: "succeeded",
  FAILURE: "failed",
  RETRY: "retried",
  REVOKED: "revoked",
  STARTED: "started",
  PENDING: "pending",
};

type ViewMode = "summary" | "events" | "failures";
type Pending = { type: "retry" | "revoke"; rows: TaskRow[] };

function exportTasks(tasks: TaskRow[], kind: "csv" | "json") {
  if (tasks.length === 0) return;
  let content: string;
  if (kind === "json") {
    content = JSON.stringify(tasks, null, 2);
  } else {
    const headers = [
      "task_id",
      "task_name",
      "state",
      "queue",
      "worker_id",
      "runtime",
      "timestamp",
      "exception",
    ];
    const rows = tasks.map((t) =>
      [
        t.task_id,
        t.task_name,
        t.state,
        t.queue || "",
        t.worker_id || "",
        t.runtime?.toString() ?? "",
        t.timestamp,
        t.exception || "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    content = [headers.join(","), ...rows].join("\n");
  }
  const url = URL.createObjectURL(
    new Blob([content], { type: kind === "json" ? "application/json" : "text/csv" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `tasks-export.${kind}`;
  a.click();
  URL.revokeObjectURL(url);
}

function selectionSummary(rows: TaskRow[]): string {
  const states = new Set(rows.map((r) => stateLabel(r.state).toLowerCase()));
  if (states.size === 1) {
    const s = [...states][0];
    return rows.length === 1 ? s : rows.length === 2 ? `both ${s}` : `all ${s}`;
  }
  return `${states.size} different states`;
}

function stateBreakdown(rows: TaskRow[]): string {
  const counts = new Map<string, number>();
  for (const r of rows)
    counts.set(
      stateLabel(r.state).toLowerCase(),
      (counts.get(stateLabel(r.state).toLowerCase()) ?? 0) + 1,
    );
  return [...counts].map(([s, n]) => `${n} ${s}`).join(" · ");
}

function listPhrase(words: string[]): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export default function TasksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const stateFilters = useMemo<TaskState[]>(() => {
    const raw = searchParams.get("state");
    if (!raw) return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is TaskState => (TASK_STATES as readonly string[]).includes(s));
  }, [searchParams]);
  const stateFilterCsv = stateFilters.join(",");
  const nameFilter = searchParams.get("task_name") || "";
  const queueFilter = searchParams.get("queue") || "";
  const workerFilter = searchParams.get("worker_id") || "";
  const searchFilter = searchParams.get("search") || "";
  const errorsOnlyFilter = searchParams.get("errors_only") === "true";
  const sinceMsParam = searchParams.get("since_ms");
  const untilMsParam = searchParams.get("until_ms");
  const customRange = useMemo(
    () =>
      sinceMsParam !== null && untilMsParam !== null
        ? { since: Number(sinceMsParam), until: Number(untilMsParam) }
        : null,
    [sinceMsParam, untilMsParam],
  );
  const rawRange = searchParams.get("range") as TimeRangeId | null;
  const rangeFilter: TimeRangeId =
    rawRange && TIME_RANGE_PRESETS.some((p) => p.id === rawRange) ? rawRange : DEFAULT_TIME_RANGE;

  const canRetry = useHasPermission("tasks_retry");
  const canRevoke = useHasPermission("tasks_revoke");
  const canMetrics = useHasPermission("metrics_read");
  const canWorkers = useHasPermission("workers_read");

  const [searchInput, setSearchInput] = useState(searchFilter);
  const [customOpen, setCustomOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("summary");
  const [selected, setSelected] = useState<Map<string, TaskRow>>(new Map());
  const [pending, setPending] = useState<Pending | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<React.ReactNode>(null);

  useEffect(() => setSearchInput(searchFilter), [searchFilter]);

  // Selection belongs to one result set; any change of filters, page or view drops it.
  useEffect(() => {
    setSelected(new Map());
  }, [
    stateFilterCsv,
    nameFilter,
    queueFilter,
    workerFilter,
    searchFilter,
    errorsOnlyFilter,
    rangeFilter,
    sinceMsParam,
    untilMsParam,
    viewMode,
    cursor,
  ]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  /// Applies several URL changes in one navigation, so dependent params
  /// (a preset replacing a custom range) never race each other.
  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v) params.set(k, v);
        else params.delete(k);
      }
      setCursor(undefined);
      setCursorStack([]);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const toggleState = useCallback(
    (state: string) => {
      const next = new Set<string>(stateFilters);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      setParams({ state: TASK_STATES.filter((s) => next.has(s)).join(",") || null });
    },
    [stateFilters, setParams],
  );

  const commitSearch = useCallback(() => {
    const v = searchInput.trim();
    if (v !== searchFilter) setParams({ search: v || null });
  }, [searchInput, searchFilter, setParams]);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setCursor(undefined);
    setCursorStack([]);
    router.push(rawRange ? `${pathname}?range=${rawRange}` : pathname);
  }, [pathname, router, rawRange]);

  const rangeMinutes = TIME_RANGE_PRESETS.find((p) => p.id === rangeFilter)!.minutes;
  // Bucket to the minute so identical polls dedupe while the lower bound
  // still advances with the clock.
  const bucketMinute = Math.floor(Date.now() / 60_000);
  const effectiveSinceMs = customRange ? customRange.since : (bucketMinute - rangeMinutes) * 60_000;
  const effectiveUntilMs = customRange ? customRange.until : undefined;
  const metricsMinutes = customRange
    ? Math.max(1, Math.ceil((bucketMinute * 60_000 - customRange.since) / 60_000) + 1)
    : rangeMinutes;

  const queryParams = useMemo(
    () => ({
      params: {
        query: {
          state: stateFilterCsv || undefined,
          task_name: nameFilter || undefined,
          queue: queueFilter || undefined,
          worker_id: workerFilter || undefined,
          search: searchFilter || undefined,
          errors_only: errorsOnlyFilter || undefined,
          since_ms: effectiveSinceMs,
          until_ms: effectiveUntilMs,
          limit: TASKS_LIMIT,
          cursor,
          count: true,
        },
      },
    }),
    [
      stateFilterCsv,
      nameFilter,
      queueFilter,
      workerFilter,
      searchFilter,
      errorsOnlyFilter,
      effectiveSinceMs,
      effectiveUntilMs,
      cursor,
    ],
  );

  const summaryQuery = $api.useQuery("get", "/api/v1/tasks/summary", queryParams, {
    enabled: viewMode === "summary",
    refetchInterval: autoRefresh ? 5_000 : false,
  });
  const eventsQuery = $api.useQuery("get", "/api/v1/tasks", queryParams, {
    enabled: viewMode === "events",
    refetchInterval: autoRefresh ? 5_000 : false,
  });
  const failureGroupsQuery = $api.useQuery(
    "get",
    "/api/v1/metrics/failure-groups",
    { params: { query: { from_minutes: metricsMinutes, limit: 200 } } },
    {
      enabled: viewMode === "failures" && canMetrics,
      refetchInterval: autoRefresh ? 30_000 : false,
    },
  );
  const throughput = $api.useQuery(
    "get",
    "/api/v1/metrics/throughput",
    { params: { query: { from_minutes: metricsMinutes } } },
    { enabled: canMetrics, refetchInterval: autoRefresh ? 30_000 : false, staleTime: 30_000 },
  );
  const workerStats = $api.useQuery(
    "get",
    "/api/v1/workers/stats",
    { params: { query: { from_minutes: metricsMinutes } } },
    { enabled: canWorkers, staleTime: 60_000 },
  );
  const taskNamesQuery = $api.useQuery("get", "/api/v1/metrics/task-names", undefined, {
    enabled: canMetrics,
    staleTime: SUGGESTIONS_STALE_MS,
  });
  const queueNamesQuery = $api.useQuery("get", "/api/v1/metrics/queue-names", undefined, {
    enabled: canMetrics,
    staleTime: SUGGESTIONS_STALE_MS,
  });

  const activeQuery = viewMode === "events" ? eventsQuery : summaryQuery;
  const tasks = useMemo(() => (activeQuery.data?.data ?? []) as TaskRow[], [activeQuery.data]);
  const totalMatching = activeQuery.data?.total ?? null;

  // ── Facets and histogram, from per-minute metrics in the same window ──
  const windowRows = useMemo(() => {
    const rows = (throughput.data?.data ?? []) as TaskMetricsRow[];
    return customRange
      ? rows.filter((r) => r.minute >= customRange.since - 60_000 && r.minute < customRange.until)
      : rows;
  }, [throughput.data, customRange]);

  const nameNeedle = nameFilter.toLowerCase();
  const nameMatch = useCallback(
    (r: TaskMetricsRow) => !nameNeedle || r.task_name.toLowerCase().includes(nameNeedle),
    [nameNeedle],
  );
  const queueMatch = useCallback(
    (r: TaskMetricsRow) => !queueFilter || r.queue === queueFilter,
    [queueFilter],
  );
  const counted = useMemo(
    () => stateFilters.flatMap((s) => (COUNTED[s] ? [COUNTED[s]!] : [])),
    [stateFilters],
  );
  // Metrics only know finished outcomes, and nothing about search, worker or
  // exception filters; counts that can't honour the filters are hidden.
  const outsideMetrics = !!searchFilter || !!workerFilter || errorsOnlyFilter;
  const statesCountable = counted.length === stateFilters.length;
  const rowCount = useCallback(
    (r: TaskMetricsRow) =>
      counted.length === 0
        ? r.success_count + r.failure_count + r.retry_count + r.revoked_count
        : counted.reduce((n, c) => n + r[c], 0),
    [counted],
  );

  const stateOptions = useMemo<FacetOption[]>(() => {
    const sums = new Map<string, number>();
    for (const r of windowRows) {
      if (!nameMatch(r) || !queueMatch(r)) continue;
      for (const [s, col] of Object.entries(COUNTED)) sums.set(s, (sums.get(s) ?? 0) + r[col]);
    }
    const exact = canMetrics && !outsideMetrics && throughput.isSuccess;
    return TASK_STATES.map((s) => ({
      value: s,
      label: stateLabel(s),
      title: `Celery state: ${s}`,
      dot: STATE_COLORS[s],
      count: exact && COUNTED[s] ? (sums.get(s) ?? 0) : null,
    }));
  }, [windowRows, nameMatch, queueMatch, canMetrics, outsideMetrics, throughput.isSuccess]);

  const queueOptions = useMemo<FacetOption[]>(() => {
    const sums = new Map<string, number>();
    let all = 0;
    let attributed = 0;
    for (const r of windowRows) {
      if (!nameMatch(r)) continue;
      const n = rowCount(r);
      all += n;
      if (!r.queue) continue;
      attributed += n;
      sums.set(r.queue, (sums.get(r.queue) ?? 0) + n);
    }
    for (const q of queueNamesQuery.data?.data ?? []) if (q && !sums.has(q)) sums.set(q, 0);
    if (queueFilter && !sums.has(queueFilter)) sums.set(queueFilter, 0);
    // Finish events often carry no queue (it's only on sent events), so
    // counts are shown only when nearly all of them can be placed.
    const exact =
      statesCountable && !outsideMetrics && throughput.isSuccess && attributed >= all * 0.9;
    return [...sums]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([q, n]) => ({ value: q, label: q, mono: true, count: exact ? n : null }));
  }, [
    windowRows,
    nameMatch,
    rowCount,
    queueNamesQuery.data,
    queueFilter,
    statesCountable,
    outsideMetrics,
    throughput.isSuccess,
  ]);

  const taskOptions = useMemo<FacetOption[]>(() => {
    const sums = new Map<string, number>();
    for (const r of windowRows)
      if (r.task_name && queueMatch(r))
        sums.set(r.task_name, (sums.get(r.task_name) ?? 0) + rowCount(r));
    for (const n of taskNamesQuery.data?.data ?? []) if (n && !sums.has(n)) sums.set(n, 0);
    const exact = statesCountable && !outsideMetrics && throughput.isSuccess;
    return [...sums]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([n, c]) => ({
        value: n,
        label: shortTaskName(n),
        title: n,
        mono: true,
        count: exact ? c : null,
      }));
  }, [
    windowRows,
    queueMatch,
    rowCount,
    taskNamesQuery.data,
    statesCountable,
    outsideMetrics,
    throughput.isSuccess,
  ]);

  const workerRows = useMemo(
    () => (workerStats.data?.data ?? []) as WorkerTaskStats[],
    [workerStats.data],
  );
  const workerLabel = useMemo(
    () => workerLabeler(workerRows.map((w) => w.worker_id)),
    [workerRows],
  );
  const workerOptions = useMemo<FacetOption[]>(() => {
    const cols = stateFilters.map((s) => WORKER_COLUMN[s]);
    const exact =
      !customRange &&
      !nameFilter &&
      !queueFilter &&
      !searchFilter &&
      !errorsOnlyFilter &&
      cols.every(Boolean);
    const count = (w: WorkerTaskStats) =>
      cols.length === 0
        ? w.succeeded + w.failed + w.retried + w.revoked
        : cols.reduce((n, c) => n + Number(w[c!]), 0);
    const opts = workerRows
      .map((w) => ({
        value: w.worker_id,
        label: workerLabel(w.worker_id),
        title: w.worker_id,
        mono: true,
        count: exact ? count(w) : null,
        n: count(w),
      }))
      .sort((a, b) => b.n - a.n || a.value.localeCompare(b.value));
    if (workerFilter && !opts.some((o) => o.value === workerFilter)) {
      opts.unshift({
        value: workerFilter,
        label: workerFilter,
        title: workerFilter,
        mono: true,
        count: null,
        n: 0,
      });
    }
    return opts;
  }, [
    workerRows,
    workerLabel,
    stateFilters,
    customRange,
    nameFilter,
    queueFilter,
    searchFilter,
    errorsOnlyFilter,
    workerFilter,
  ]);

  const failuresView = viewMode === "failures";
  const histogram = useMemo(() => {
    const now = bucketMinute * 60_000 + 60_000;
    const start = customRange ? customRange.since : now - rangeMinutes * 60_000;
    const end = customRange ? Math.min(customRange.until, now) : now;
    const buckets = bucketizeRange(
      windowRows.filter((r) => nameMatch(r) && queueMatch(r)),
      start,
      end,
      60,
    );
    const chosen = failuresView
      ? [SEGMENTS.failed]
      : stateFilters.flatMap((s) => (SEGMENT_OF[s] ? [SEGMENT_OF[s]!] : []));
    const segments =
      chosen.length > 0
        ? chosen
        : [SEGMENTS.succeeded, SEGMENTS.retried, SEGMENTS.revoked, SEGMENTS.failed];
    return {
      buckets,
      segments,
      endsNow: !customRange || customRange.until >= now - 60_000,
      partialStates: !failuresView && chosen.length < stateFilters.length,
    };
  }, [
    windowRows,
    nameMatch,
    queueMatch,
    stateFilters,
    customRange,
    rangeMinutes,
    bucketMinute,
    failuresView,
  ]);

  const failureGroups = useMemo(() => {
    const merged = mergeFailureGroups((failureGroupsQuery.data?.data ?? []) as FailureGroupRow[]);
    const needle = searchFilter.toLowerCase();
    return merged.filter(
      (g) =>
        (!nameNeedle || g.task_names.some((n) => n.toLowerCase().includes(nameNeedle))) &&
        (!needle ||
          g.samples.some((s) => s.toLowerCase().includes(needle)) ||
          g.fingerprint.template.toLowerCase().includes(needle)),
    );
  }, [failureGroupsQuery.data, nameNeedle, searchFilter]);

  // ── Wording ──
  const fmtRangeEnd = (ms: number) => format(ms, "MMM d, HH:mm");
  const scope = customRange
    ? `${fmtRangeEnd(customRange.since)} → ${fmtRangeEnd(customRange.until)}`
    : TIME_RANGE_PHRASE[rangeFilter];
  const filtered =
    stateFilters.length > 0 ||
    !!nameFilter ||
    !!queueFilter ||
    !!workerFilter ||
    !!searchFilter ||
    errorsOnlyFilter;
  const meta =
    viewMode === "failures"
      ? failureGroupsQuery.data
        ? `${failureGroups.length} exception group${failureGroups.length === 1 ? "" : "s"} · ${scope}`
        : undefined
      : totalMatching != null
        ? `${totalMatching.toLocaleString()} ${filtered ? "matching " : ""}${viewMode === "events" ? "events" : "tasks"} · ${scope}`
        : undefined;

  const histogramTitle = (() => {
    const chosen = failuresView
      ? ["failed"]
      : stateFilters.filter((s) => SEGMENT_OF[s]).map((s) => stateLabel(s).toLowerCase());
    const what = chosen.length > 0 ? `${listPhrase(chosen)} tasks` : "tasks";
    return `${what[0].toUpperCase()}${what.slice(1)} · ${scope}`;
  })();
  const histogramNote = [
    histogram.partialStates && "finished states only",
    !failuresView &&
      (searchFilter || workerFilter || errorsOnlyFilter) &&
      "search, worker and exception filters not charted",
  ]
    .filter(Boolean)
    .join(" · ");

  const chips = useMemo<QueryChip[]>(() => {
    const out: QueryChip[] = [];
    if (stateFilters.length > 0) {
      const labels = stateFilters.map(stateLabel);
      out.push({
        key: "state",
        field: "state",
        op: stateFilters.length > 1 ? "in" : "is",
        text: labels.join(", "),
        value:
          stateFilters.length === 1 ? (
            <span style={{ color: STATE_COLORS[stateFilters[0]] }}>{labels[0]}</span>
          ) : (
            labels.join(", ")
          ),
        onRemove: () => setParams({ state: null }),
      });
    }
    if (nameFilter)
      out.push({
        key: "task",
        field: "task",
        op: "contains",
        text: nameFilter,
        value: <span className="font-mono">{nameFilter}</span>,
        onRemove: () => setParams({ task_name: null }),
      });
    if (queueFilter)
      out.push({
        key: "queue",
        field: "queue",
        op: "is",
        text: queueFilter,
        value: <span className="font-mono">{queueFilter}</span>,
        onRemove: () => setParams({ queue: null }),
      });
    if (workerFilter)
      out.push({
        key: "worker",
        field: "worker",
        op: "is",
        text: workerFilter,
        value: <span className="font-mono">{workerFilter}</span>,
        onRemove: () => setParams({ worker_id: null }),
      });
    if (errorsOnlyFilter)
      out.push({
        key: "errors",
        field: "has",
        op: "",
        text: "exception",
        value: "exception",
        onRemove: () => setParams({ errors_only: null }),
      });
    if (customRange)
      out.push({
        key: "range",
        field: "time",
        op: "",
        text: scope,
        value: scope,
        onRemove: () => setParams({ since_ms: null, until_ms: null }),
      });
    return out;
  }, [
    stateFilters,
    nameFilter,
    queueFilter,
    workerFilter,
    errorsOnlyFilter,
    customRange,
    scope,
    setParams,
  ]);

  // ── Paging ──
  const handleNextPage = useCallback(() => {
    if (!activeQuery.data?.next_cursor) return;
    setCursorStack((prev) => [...prev, cursor ?? ""]);
    setCursor(activeQuery.data.next_cursor ?? undefined);
  }, [activeQuery.data?.next_cursor, cursor]);

  const handlePrevPage = useCallback(() => {
    setCursorStack((prev) => {
      const next = [...prev];
      setCursor(next.pop() || undefined);
      return next;
    });
  }, []);

  const changeView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setCursor(undefined);
    setCursorStack([]);
  }, []);

  // ── Selection and actions ──
  const selectable = canRetry || canRevoke;
  const toggleRow = useCallback((row: TaskRow) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.task_id)) next.delete(row.task_id);
      else next.set(row.task_id, row);
      return next;
    });
  }, []);
  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const allOn = tasks.length > 0 && tasks.every((t) => prev.has(t.task_id));
      const next = new Map(prev);
      for (const t of tasks) {
        if (allOn) next.delete(t.task_id);
        else next.set(t.task_id, t);
      }
      return next;
    });
  }, [tasks]);

  const selectedRows = useMemo(() => [...selected.values()], [selected]);
  const revocableSelected = useMemo(
    () => selectedRows.filter((r) => UNFINISHED.has(r.state.toUpperCase())),
    [selectedRows],
  );

  async function runPending() {
    if (!pending) return;
    const { type, rows } = pending;
    const act = type === "retry" ? retryTask : revokeTask;
    const verb = type === "retry" ? "Retrying" : "Revoking";
    setActionError(null);
    const failures: string[] = [];
    let newTaskId: string | null = null;
    for (let i = 0; i < rows.length; i += 4) {
      const chunk = rows.slice(i, i + 4);
      setProgress(
        rows.length > 1
          ? `${verb} ${Math.min(i + chunk.length, rows.length)} of ${rows.length}…`
          : `${verb}…`,
      );
      const results = await Promise.allSettled(chunk.map((r) => act(r.task_id)));
      results.forEach((res, j) => {
        if (res.status === "rejected") {
          failures.push(
            `${chunk[j].task_id.slice(0, 8)}: ${res.reason instanceof Error ? res.reason.message : "request failed"}`,
          );
        } else if (rows.length === 1 && res.value && "task_id" in res.value && res.value.task_id) {
          newTaskId = res.value.task_id;
        }
      });
    }
    setProgress(null);
    setPending(null);
    setSelected(new Map());
    activeQuery.refetch();

    const ok = rows.length - failures.length;
    if (ok > 0) {
      const past = type === "retry" ? "Retried" : "Revoked";
      setNotice(
        newTaskId ? (
          <>
            {past} {rows[0].task_name}.{" "}
            <Link href={`/tasks/${newTaskId}`} className="font-[550] underline underline-offset-2">
              Open the new task
            </Link>
          </>
        ) : (
          `${past} ${ok} task${ok === 1 ? "" : "s"}.`
        ),
      );
    }
    if (failures.length > 0) {
      setActionError(
        `${failures.length} task${failures.length === 1 ? "" : "s"} couldn't be ${type === "retry" ? "retried" : "revoked"}. ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "…" : ""}`,
      );
    }
  }

  const facets = (
    <>
      <FacetGroup
        title="State"
        options={stateOptions}
        isSelected={(v) => stateFilters.includes(v as TaskState)}
        onToggle={toggleState}
        limit={8}
      />
      <FacetGroup
        title="Queue"
        options={queueOptions}
        isSelected={(v) => v === queueFilter}
        onToggle={(v) => setParams({ queue: v === queueFilter ? null : v })}
        empty="No queues seen yet"
      />
      <FacetGroup
        title="Task"
        options={taskOptions}
        isSelected={(v) => v === nameFilter}
        onToggle={(v) => setParams({ task_name: v === nameFilter ? null : v })}
        empty="No tasks seen yet"
      />
      {canWorkers && (
        <FacetGroup
          title="Worker"
          options={workerOptions}
          isSelected={(v) => v === workerFilter}
          onToggle={(v) => setParams({ worker_id: v === workerFilter ? null : v })}
          limit={5}
          empty="No workers in this window"
        />
      )}
      <FacetGroup
        title="Exception"
        options={[{ value: "errors_only", label: "Has an exception", count: null }]}
        isSelected={() => errorsOnlyFilter}
        onToggle={() => setParams({ errors_only: errorsOnlyFilter ? null : "true" })}
      />
    </>
  );

  const activeFilterCount =
    stateFilters.length +
    [nameFilter, queueFilter, workerFilter].filter(Boolean).length +
    (errorsOnlyFilter ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Tasks"
        meta={meta}
        actions={
          <>
            <Menu>
              <MenuTrigger asChild>
                <Button disabled={tasks.length === 0 || viewMode === "failures"}>
                  <Download />
                  Export
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>This page · {tasks.length} rows</MenuLabel>
                <MenuItem onSelect={() => exportTasks(tasks, "csv")}>CSV</MenuItem>
                <MenuItem onSelect={() => exportTasks(tasks, "json")}>JSON</MenuItem>
              </MenuContent>
            </Menu>
            <Segmented
              label="Time range"
              options={RANGES}
              value={customRange ? null : rangeFilter}
              onChange={(r) => {
                setCustomOpen(false);
                setParams({
                  range: r === DEFAULT_TIME_RANGE ? null : r,
                  since_ms: null,
                  until_ms: null,
                });
              }}
            />
            <Button
              size="icon"
              aria-label="Custom time range"
              aria-pressed={customOpen || !!customRange}
              title="Custom time range"
              onClick={() => setCustomOpen((v) => !v)}
              className={cn(
                customRange && "border-amber-line bg-amber-wash text-link hover:bg-amber-wash",
              )}
            >
              <CalendarRange />
            </Button>
            <LiveToggle on={autoRefresh} onChange={setAutoRefresh} />
          </>
        }
      />
      <PageBody className={cn("gap-4", selected.size > 0 && "pb-24")}>
        <QueryBar
          chips={chips}
          value={searchInput}
          onChange={setSearchInput}
          onCommit={commitSearch}
          onClearAll={clearFilters}
          placeholder="Search task ID, name, args, result or exception"
        />

        {customOpen && (
          <CustomRangePanel
            initialSince={customRange?.since}
            initialUntil={customRange?.until}
            onApply={(since, until) => {
              setCustomOpen(false);
              setParams({ since_ms: String(since), until_ms: String(until), range: null });
            }}
            onCancel={() => setCustomOpen(false)}
          />
        )}

        {actionError && (
          <ErrorAlert onDismiss={() => setActionError(null)}>{actionError}</ErrorAlert>
        )}
        {notice && <Notice onDismiss={() => setNotice(null)}>{notice}</Notice>}

        <div className="flex items-end gap-3 border-b border-border">
          <Tabs label="Task views" className="flex-1 border-b-0">
            <Tab active={viewMode === "summary"} onClick={() => changeView("summary")}>
              Tasks
            </Tab>
            <Tab active={viewMode === "events"} onClick={() => changeView("events")}>
              Events
            </Tab>
            <Tab active={viewMode === "failures"} onClick={() => changeView("failures")}>
              Failures
            </Tab>
          </Tabs>
          {viewMode !== "failures" && (
            <Button
              size="sm"
              variant="ghost"
              className="mb-1.5 lg:hidden"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <SlidersHorizontal />
              Filters
              {activeFilterCount > 0 && (
                <span className="tabular-nums text-link">{activeFilterCount}</span>
              )}
            </Button>
          )}
        </div>

        {canMetrics && (
          <TaskHistogram
            title={histogramTitle}
            buckets={histogram.buckets}
            segments={histogram.segments}
            loading={throughput.isLoading}
            endsNow={histogram.endsNow}
            note={histogramNote || undefined}
            onZoom={(from, to) =>
              setParams({ since_ms: String(from), until_ms: String(to), range: null })
            }
          />
        )}

        {viewMode === "failures" ? (
          <>
            {(queueFilter || workerFilter || stateFilters.length > 0 || errorsOnlyFilter) && (
              <p className="text-xs text-t3">
                Exception groups cover every queue and worker; state and exception filters
                don&apos;t apply here.
              </p>
            )}
            <FailureGroups
              groups={failureGroups}
              loading={failureGroupsQuery.isLoading}
              error={failureGroupsQuery.isError}
            />
          </>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[216px_minmax(0,1fr)]">
            <aside
              aria-label="Filters"
              className={cn(
                "flex-col gap-5 lg:flex",
                filtersOpen
                  ? "grid grid-cols-2 gap-x-6 rounded-xl border border-border bg-card p-4 max-sm:grid-cols-1 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0"
                  : "hidden",
              )}
            >
              {facets}
            </aside>
            <TaskTable
              rows={tasks}
              loading={activeQuery.isLoading}
              error={
                activeQuery.isError
                  ? ((activeQuery.error as Error)?.message ?? "Unknown error")
                  : null
              }
              timeLabel={viewMode === "events" ? "At" : "When"}
              selectable={selectable}
              selected={selected}
              onToggle={toggleRow}
              onToggleAll={toggleAll}
              canRetry={canRetry}
              canRevoke={canRevoke}
              onRetry={(row) => setPending({ type: "retry", rows: [row] })}
              onRevoke={(row) => setPending({ type: "revoke", rows: [row] })}
              onOpen={(id) => router.push(`/tasks/${id}`)}
              workerLabel={workerLabel}
              footer={
                activeQuery.data && (
                  <Pagination
                    total={totalMatching ?? undefined}
                    limit={TASKS_LIMIT}
                    hasMore={activeQuery.data.has_more}
                    currentCount={tasks.length}
                    page={cursorStack.length + 1}
                    onNext={handleNextPage}
                    onPrev={handlePrevPage}
                  />
                )
              }
            />
          </div>
        )}
      </PageBody>

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          summary={selectionSummary(selectedRows)}
          canRetry={canRetry}
          canRevoke={canRevoke && revocableSelected.length > 0}
          progress={progress}
          onRetry={() => setPending({ type: "retry", rows: selectedRows })}
          onRevoke={() => setPending({ type: "revoke", rows: revocableSelected })}
          onClear={() => setSelected(new Map())}
        />
      )}

      <ConfirmDialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open && !progress) setPending(null);
        }}
        tone={pending?.type === "revoke" ? "danger" : "primary"}
        busy={progress != null}
        onConfirm={runPending}
        confirmLabel={
          progress ??
          (pending
            ? `${pending.type === "retry" ? "Retry" : "Revoke"}${pending.rows.length > 1 ? ` ${pending.rows.length} tasks` : ""}`
            : "")
        }
        title={
          pending
            ? pending.rows.length === 1
              ? `${pending.type === "retry" ? "Retry" : "Revoke"} this task?`
              : `${pending.type === "retry" ? "Retry" : "Revoke"} ${pending.rows.length} tasks?`
            : ""
        }
        description={
          pending?.type === "retry"
            ? pending.rows.length === 1
              ? `Publishes a new copy to the ${pending.rows[0].queue || "default"} queue with the same arguments.`
              : "Each task is published again to its queue with its original arguments."
            : pending && pending.rows.length < selected.size
              ? `Only the ${pending.rows.length} still queued or running can be revoked. Workers skip them if they haven't started and stop them if they have.`
              : "Workers skip a revoked task if it hasn't started, and stop it if it's running."
        }
        subject={
          pending
            ? pending.rows.length === 1
              ? `${pending.rows[0].task_name} · ${pending.rows[0].task_id}`
              : stateBreakdown(pending.rows)
            : undefined
        }
      />
    </>
  );
}

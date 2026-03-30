"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Cpu,
  MemoryStick,
  Activity,
  Users,
  PowerOff,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  Play,
  Layers,
  HeartPulse,
} from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { timeAgo, truncateId } from "@/lib/utils";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Pagination } from "@/components/shared/pagination";
import type { WorkerEvent, WorkerTaskStats, WorkerHealthRow } from "@/types/api";

const WORKERS_PER_PAGE = 20;

type ParsedWorker = {
  worker_id: string;
  hostname: string;
  active_tasks: number;
  cpu_percent: number;
  memory_mb: number;
  pool_size: number;
  pool_type: string;
  status: string;
  health?: WorkerHealthRow;
  taskStats?: WorkerTaskStats;
};

type WorkerGroup = {
  name: string;
  workers: ParsedWorker[];
  online: number;
  offline: number;
  healthSummary: { healthy: number; degraded: number; offline: number };
  stats: {
    pending: number;
    started: number;
    succeeded: number;
    failed: number;
    retried: number;
    total: number;
    avg_runtime: number;
  };
};

function deriveGroupName(hostname: string): string {
  const clean = hostname.replace(/^celery@/, "");
  const match = clean.match(/^(.+?)(?:-[a-f0-9]{6,}.*|-\d+)$/i);
  if (match) return match[1];
  const parts = clean.split("-");
  if (parts.length > 2) return parts.slice(0, -1).join("-");
  return clean;
}

function StatusBadge({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
        online
          ? "bg-[#22c55e]/20 text-[#22c55e]"
          : "bg-secondary text-muted-foreground"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${online ? "bg-[#22c55e] live-dot" : "bg-muted-foreground"}`}
      />
      {online ? "Online" : "Offline"}
    </span>
  );
}

const HEALTH_STYLES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  healthy: { bg: "bg-[#22c55e]/20", text: "text-[#22c55e]", dot: "bg-[#22c55e]", label: "Healthy" },
  degraded: { bg: "bg-[#eab308]/20", text: "text-[#eab308]", dot: "bg-[#eab308]", label: "Degraded" },
  offline: { bg: "bg-secondary", text: "text-muted-foreground", dot: "bg-muted-foreground", label: "Offline" },
};

function HealthBadge({ status, maxGap }: { status: string; maxGap?: number }) {
  const style = HEALTH_STYLES[status] ?? HEALTH_STYLES.offline;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      <HeartPulse className="h-3 w-3" />
      {style.label}
      {status === "degraded" && maxGap != null && maxGap > 0 && (
        <span className="opacity-75">({Math.round(maxGap)}s gap)</span>
      )}
    </span>
  );
}

function StatPill({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary/50 text-xs">
      <Icon className={`h-3 w-3 ${color ?? "text-muted-foreground"}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value.toLocaleString()}</span>
    </div>
  );
}

function GroupCard({
  group,
  expanded,
  onToggle,
  onWorkerClick,
  shutdownConfirm,
  shuttingDown,
  onConfirmShutdown,
  onCancelShutdown,
  onShutdown,
}: {
  group: WorkerGroup;
  expanded: boolean;
  onToggle: () => void;
  onWorkerClick: (id: string) => void;
  shutdownConfirm: string | null;
  shuttingDown: string | null;
  onConfirmShutdown: (id: string) => void;
  onCancelShutdown: () => void;
  onShutdown: (id: string) => void;
}) {
  const [workerPage, setWorkerPage] = useState(1);
  const totalWorkers = group.workers.length;
  const totalPages = Math.ceil(totalWorkers / WORKERS_PER_PAGE);
  const paginatedWorkers = group.workers.slice(
    (workerPage - 1) * WORKERS_PER_PAGE,
    workerPage * WORKERS_PER_PAGE
  );

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-secondary/30 transition text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary shrink-0" />
              <h3 className="font-semibold text-foreground truncate">{group.name}</h3>
              <span className="text-xs text-muted-foreground shrink-0">
                {group.workers.length} worker{group.workers.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-xs text-[#22c55e]">{group.online} online</span>
              {group.offline > 0 && (
                <span className="text-xs text-muted-foreground">· {group.offline} offline</span>
              )}
              {group.healthSummary.degraded > 0 && (
                <span className="text-xs text-[#eab308]">
                  · {group.healthSummary.degraded} degraded
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <StatPill icon={Clock} label="Pending" value={group.stats.pending} color="text-[#eab308]" />
          <StatPill icon={Play} label="Running" value={group.stats.started} color="text-[#3b82f6]" />
          <StatPill icon={CheckCircle2} label="Done" value={group.stats.succeeded} color="text-[#22c55e]" />
          <StatPill icon={XCircle} label="Failed" value={group.stats.failed} color="text-destructive" />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left px-5 py-2.5 font-medium">Worker</th>
                  <th className="text-left px-3 py-2.5 font-medium">Status</th>
                  <th className="text-left px-3 py-2.5 font-medium">Health</th>
                  <th className="text-right px-3 py-2.5 font-medium">Last Seen</th>
                  <th className="text-right px-3 py-2.5 font-medium">Active</th>
                  <th className="text-right px-3 py-2.5 font-medium">Pool</th>
                  <th className="text-right px-3 py-2.5 font-medium">CPU</th>
                  <th className="text-right px-3 py-2.5 font-medium">Memory</th>
                  <th className="text-right px-3 py-2.5 font-medium">Pending</th>
                  <th className="text-right px-3 py-2.5 font-medium">Running</th>
                  <th className="text-right px-3 py-2.5 font-medium">Done</th>
                  <th className="text-right px-3 py-2.5 font-medium">Failed</th>
                  <th className="text-right px-5 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {paginatedWorkers.map((worker) => {
                  const isOnline = worker.status === "online";
                  const cpuPct = Math.round(worker.cpu_percent ?? 0);
                  const memMb = Math.round(worker.memory_mb ?? 0);
                  const ws = worker.taskStats;

                  return (
                    <tr
                      key={worker.worker_id}
                      onClick={() => onWorkerClick(worker.worker_id)}
                      className={`border-b border-border/50 cursor-pointer transition hover:bg-secondary/30 ${
                        !isOnline ? "opacity-60" : ""
                      }`}
                    >
                      <td className="px-5 py-3">
                        <p className="font-medium text-foreground truncate max-w-[200px]">
                          {worker.hostname}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate max-w-[200px]">
                          {truncateId(worker.worker_id, 30)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge online={isOnline} />
                      </td>
                      <td className="px-3 py-3">
                        {worker.health ? (
                          <HealthBadge status={worker.health.status} maxGap={worker.health.max_gap_secs} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-xs text-muted-foreground">
                        {worker.health?.last_heartbeat ? timeAgo(worker.health.last_heartbeat) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">
                        {worker.active_tasks ?? 0}
                      </td>
                      <td className="px-3 py-3 text-right text-muted-foreground">
                        {worker.pool_size ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span
                          className={
                            cpuPct > 80
                              ? "text-destructive font-semibold"
                              : cpuPct > 60
                                ? "text-[#eab308] font-semibold"
                                : "text-muted-foreground"
                          }
                        >
                          {cpuPct}%
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right text-muted-foreground">
                        {memMb > 0 ? `${memMb} MB` : "—"}
                      </td>
                      <td className="px-3 py-3 text-right text-[#eab308]">
                        {ws?.pending ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-right text-[#3b82f6]">
                        {ws?.started ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-right text-[#22c55e]">
                        {ws?.succeeded ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-right text-destructive">
                        {ws?.failed ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {shutdownConfirm === worker.worker_id ? (
                          <div className="flex items-center gap-1.5 justify-end">
                            <button
                              onClick={() => onShutdown(worker.worker_id)}
                              disabled={!!shuttingDown}
                              className="px-2 py-1 rounded bg-destructive text-white text-xs hover:bg-destructive/80 transition disabled:opacity-50"
                            >
                              {shuttingDown === worker.worker_id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Yes"
                              )}
                            </button>
                            <button
                              onClick={onCancelShutdown}
                              className="px-2 py-1 rounded bg-secondary text-foreground text-xs hover:bg-secondary/70 transition"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => onConfirmShutdown(worker.worker_id)}
                            disabled={!isOnline}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <PowerOff className="h-3 w-3" />
                            Stop
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <Pagination
              total={totalWorkers}
              limit={WORKERS_PER_PAGE}
              hasMore={workerPage < totalPages}
              currentCount={paginatedWorkers.length}
              page={workerPage}
              onNext={() => setWorkerPage((p) => Math.min(p + 1, totalPages))}
              onPrev={() => setWorkerPage((p) => Math.max(p - 1, 1))}
            />
          )}
        </div>
      )}
    </div>
  );
}

function GroupsSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-card p-5 animate-pulse"
        >
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-5 bg-secondary rounded w-48" />
              <div className="h-3 bg-secondary rounded w-24" />
            </div>
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="h-7 bg-secondary rounded w-24" />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function WorkersPage() {
  const router = useRouter();
  const [shutdownConfirm, setShutdownConfirm] = useState<string | null>(null);
  const [shuttingDown, setShuttingDown] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error, refetch } = $api.useQuery(
    "get",
    "/api/v1/workers",
    { params: { query: { limit: 500 } } },
    { refetchInterval: 15_000 }
  );

  const { data: statsData } = $api.useQuery(
    "get",
    "/api/v1/workers/stats",
    {},
    { refetchInterval: 15_000 }
  );

  const { data: healthData } = $api.useQuery(
    "get",
    "/api/v1/workers/health",
    { params: { query: { hours: 1 } } },
    { refetchInterval: 15_000 }
  );

  const statsMap = useMemo(() => {
    const map = new Map<string, WorkerTaskStats>();
    for (const row of statsData?.data ?? []) {
      map.set(row.worker_id, row);
    }
    return map;
  }, [statsData]);

  const healthMap = useMemo(() => {
    const map = new Map<string, WorkerHealthRow>();
    for (const row of healthData?.data ?? []) {
      map.set(row.worker_id, row);
    }
    return map;
  }, [healthData]);

  const onlineWorkerIds = useMemo(
    () => new Set<string>(data?.online_workers ?? []),
    [data?.online_workers],
  );

  const mergedWorkers = useMemo(() => {
    const apiWorkerMap = new Map<string, ParsedWorker>();
    const rawEvents = (data?.worker_events ?? []) as WorkerEvent[];
    for (const ev of rawEvents) {
      if (!apiWorkerMap.has(ev.worker_id)) {
        apiWorkerMap.set(ev.worker_id, {
          worker_id: ev.worker_id,
          hostname: ev.hostname,
          active_tasks: ev.active_tasks,
          cpu_percent: ev.cpu_percent,
          memory_mb: ev.memory_mb,
          pool_size: ev.pool_size,
          pool_type: ev.pool_type,
          status: onlineWorkerIds.has(ev.worker_id) ? "online" : "offline",
        });
      }
    }

    const workerStates = (data as Record<string, unknown>)?.worker_states ?? [];
    for (const ws of workerStates as Record<string, unknown>[]) {
      const wid = ws.worker_id as string;
      if (wid && !apiWorkerMap.has(wid)) {
        apiWorkerMap.set(wid, {
          worker_id: wid,
          hostname: (ws.hostname as string) ?? wid.replace("celery@", ""),
          active_tasks: (ws.active_tasks as number) ?? 0,
          cpu_percent: (ws.cpu_percent as number) ?? 0,
          memory_mb: (ws.memory_mb as number) ?? 0,
          pool_size: (ws.pool_size as number) ?? 0,
          pool_type: (ws.pool_type as string) ?? "",
          status: "online",
        });
      }
    }

    const result: ParsedWorker[] = Array.from(apiWorkerMap.values());
    const seen = new Set<string>(apiWorkerMap.keys());

    for (const wid of onlineWorkerIds) {
      if (!seen.has(wid)) {
        result.push({
          worker_id: wid,
          hostname: wid.replace("celery@", ""),
          active_tasks: 0,
          cpu_percent: 0,
          memory_mb: 0,
          pool_size: 0,
          pool_type: "",
          status: "online",
        });
      }
    }

    return result;
  }, [data, onlineWorkerIds]);

  const groups = useMemo(() => {
    const groupMap = new Map<string, ParsedWorker[]>();

    // Enrich workers with stats/health (new objects, no mutation of mergedWorkers)
    const enriched: ParsedWorker[] = mergedWorkers.map((w) => ({
      ...w,
      taskStats: statsMap.get(w.worker_id),
      health: healthMap.get(w.worker_id),
    }));

    for (const w of enriched) {
      const gName = deriveGroupName(w.hostname);
      const list = groupMap.get(gName);
      if (list) {
        list.push(w);
      } else {
        groupMap.set(gName, [w]);
      }
    }

    const result: WorkerGroup[] = [];
    for (const [name, workers] of groupMap) {
      workers.sort((a, b) => {
        if (a.status === "online" && b.status !== "online") return -1;
        if (a.status !== "online" && b.status === "online") return 1;
        return a.hostname.localeCompare(b.hostname);
      });

      const online = workers.filter((w) => w.status === "online").length;
      const stats = { pending: 0, started: 0, succeeded: 0, failed: 0, retried: 0, total: 0, avg_runtime: 0 };
      const healthSummary = { healthy: 0, degraded: 0, offline: 0 };
      let runtimeCount = 0;

      for (const w of workers) {
        const s = w.taskStats;
        if (s) {
          stats.pending += s.pending;
          stats.started += s.started;
          stats.succeeded += s.succeeded;
          stats.failed += s.failed;
          stats.retried += s.retried;
          stats.total += s.total;
          if (s.avg_runtime > 0) {
            stats.avg_runtime += s.avg_runtime;
            runtimeCount++;
          }
        }

        if (w.health) {
          if (w.health.status === "degraded") healthSummary.degraded++;
          else if (w.health.status === "offline") healthSummary.offline++;
          else healthSummary.healthy++;
        }
      }
      if (runtimeCount > 0) stats.avg_runtime /= runtimeCount;

      result.push({
        name,
        workers,
        online,
        offline: workers.length - online,
        healthSummary,
        stats,
      });
    }

    result.sort((a, b) => b.stats.total - a.stats.total || b.online - a.online);
    return result;
  }, [mergedWorkers, statsMap, healthMap]);

  const totalOnline = useMemo(
    () => mergedWorkers.filter((w) => w.status === "online").length,
    [mergedWorkers],
  );

  function toggleGroup(name: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function handleWorkerClick(workerId: string) {
    router.push(`/workers/${encodeURIComponent(workerId)}`);
  }

  async function handleShutdown(workerId: string) {
    if (shuttingDown) return;
    setShuttingDown(workerId);
    setShutdownConfirm(null);
    try {
      await unwrap(
        fetchClient.POST("/api/v1/workers/{worker_id}/shutdown", {
          params: { path: { worker_id: workerId } },
        })
      );
      refetch();
    } finally {
      setShuttingDown(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Workers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor worker health, resource usage, and task distribution
          </p>
        </div>
        <div className="flex items-center gap-3">
          {mergedWorkers.length > 0 && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{totalOnline} online / {mergedWorkers.length} total</span>
              <span>·</span>
              <span>{groups.length} group{groups.length !== 1 ? "s" : ""}</span>
            </div>
          )}
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {isError && (
        <ErrorAlert>
          Failed to load workers: {(error as Error)?.message ?? "Unknown error"}
        </ErrorAlert>
      )}

      {isLoading && <GroupsSkeleton />}

      {!isLoading && groups.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <Users className="h-12 w-12 opacity-30" />
          <p className="font-medium">No workers found</p>
          <p className="text-sm">Workers will appear here once they connect to the broker</p>
        </div>
      )}

      <div className="space-y-3">
        {groups.map((group) => (
          <GroupCard
            key={group.name}
            group={group}
            expanded={expandedGroups.has(group.name)}
            onToggle={() => toggleGroup(group.name)}
            onWorkerClick={handleWorkerClick}
            shutdownConfirm={shutdownConfirm}
            shuttingDown={shuttingDown}
            onConfirmShutdown={(id) => setShutdownConfirm(id)}
            onCancelShutdown={() => setShutdownConfirm(null)}
            onShutdown={handleShutdown}
          />
        ))}
      </div>
    </div>
  );
}

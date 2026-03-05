"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Cpu,
  MemoryStick,
  Activity,
  Users,
  PowerOff,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { ErrorAlert } from "@/components/shared/error-alert";
import type { WorkerEvent } from "@/types/api";

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

function WorkerCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-5 bg-secondary rounded w-40" />
          <div className="h-4 bg-secondary rounded w-20" />
        </div>
        <div className="h-6 bg-secondary rounded w-16" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 bg-secondary rounded" />
        ))}
      </div>
    </div>
  );
}

type ParsedWorker = {
  worker_id: string;
  hostname: string;
  active_tasks: number;
  cpu_percent: number;
  memory_mb: number;
  pool_size: number;
  pool_type: string;
  status: string;
  last_update: string | number;
};

export default function WorkersPage() {
  const router = useRouter();
  const [shutdownConfirm, setShutdownConfirm] = useState<string | null>(null);
  const [shuttingDown, setShuttingDown] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = $api.useQuery(
    "get",
    "/api/v1/workers",
    { params: { query: { limit: 100 } } },
    { refetchInterval: 15_000 }
  );

  const onlineWorkerIds = new Set<string>(data?.online_workers ?? []);

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
        last_update: ev.timestamp,
      });
    }
  }

  const workerStates = (data as any)?.worker_states ?? [];
  for (const ws of workerStates as any[]) {
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
        last_update: new Date().toISOString(),
      });
    }
  }

  const mergedWorkers: ParsedWorker[] = Array.from(apiWorkerMap.values());
  const seen = new Set<string>(apiWorkerMap.keys());

  for (const wid of onlineWorkerIds) {
    if (!seen.has(wid) && !apiWorkerMap.has(wid)) {
      mergedWorkers.push({
        worker_id: wid,
        hostname: wid.replace("celery@", ""),
        active_tasks: 0,
        cpu_percent: 0,
        memory_mb: 0,
        pool_size: 0,
        pool_type: "",
        status: "online",
        last_update: new Date().toISOString(),
      });
    }
  }

  mergedWorkers.sort((a, b) => {
    if (a.status === "online" && b.status !== "online") return -1;
    if (a.status !== "online" && b.status === "online") return 1;
    return a.hostname.localeCompare(b.hostname);
  });

  function handleRefresh() {
    refetch();
  }

  function handleWorkerClick(workerId: string) {
    router.push(`/workers/${encodeURIComponent(workerId)}`);
  }

  function handleStopPropagation(e: React.MouseEvent) {
    e.stopPropagation();
  }

  function handleConfirmShutdown(workerId: string) {
    setShutdownConfirm(workerId);
  }

  function handleCancelShutdown() {
    setShutdownConfirm(null);
  }

  async function handleShutdown(workerId: string) {
    if (shuttingDown) return;
    setShuttingDown(workerId);
    setShutdownConfirm(null);
    try {
      await unwrap(fetchClient.POST("/api/v1/workers/{worker_id}/shutdown", {
        params: { path: { worker_id: workerId } },
      }));
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
            Monitor worker health and resource usage
          </p>
        </div>
        <div className="flex items-center gap-3">
          {mergedWorkers.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {mergedWorkers.filter((w) => w.status === "online").length} online /{" "}
              {mergedWorkers.length} total
            </span>
          )}
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {isError && (
        <ErrorAlert>
          Failed to load workers:{" "}
          {(error as Error)?.message ?? "Unknown error"}
        </ErrorAlert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {isLoading &&
          Array.from({ length: 6 }).map((_, i) => (
            <WorkerCardSkeleton key={i} />
          ))}

        {!isLoading && mergedWorkers.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
            <Users className="h-12 w-12 opacity-30" />
            <p className="font-medium">No workers found</p>
            <p className="text-sm">
              Workers will appear here once they connect to the broker
            </p>
          </div>
        )}

        {mergedWorkers.map((worker) => {
          const isOnline = worker.status === "online";
          const cpuPct = Math.round(worker.cpu_percent ?? 0);
          const memMb = Math.round(worker.memory_mb ?? 0);

          return (
            <div
              key={worker.worker_id}
              className={`rounded-xl border bg-card p-5 space-y-4 cursor-pointer transition hover:border-primary/50 ${
                isOnline ? "border-border" : "border-border opacity-60"
              }`}
              onClick={() => handleWorkerClick(worker.worker_id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">
                    {worker.hostname}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                    {worker.worker_id.slice(0, 20)}
                    {worker.worker_id.length > 20 ? "..." : ""}
                  </p>
                </div>
                <StatusBadge online={isOnline} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-secondary/50 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <Activity className="h-3 w-3" />
                    Active Tasks
                  </div>
                  <p className="text-lg font-bold text-foreground">
                    {worker.active_tasks ?? 0}
                  </p>
                </div>

                <div className="rounded-lg bg-secondary/50 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <Users className="h-3 w-3" />
                    Pool Size
                  </div>
                  <p className="text-lg font-bold text-foreground">
                    {worker.pool_size ?? "—"}
                  </p>
                </div>

                <div className="rounded-lg bg-secondary/50 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <Cpu className="h-3 w-3" />
                    CPU
                  </div>
                  <p
                    className={`text-lg font-bold ${
                      cpuPct > 80
                        ? "text-destructive"
                        : cpuPct > 60
                          ? "text-[#eab308]"
                          : "text-foreground"
                    }`}
                  >
                    {cpuPct}%
                  </p>
                </div>

                <div className="rounded-lg bg-secondary/50 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <MemoryStick className="h-3 w-3" />
                    Memory
                  </div>
                  <p className="text-lg font-bold text-foreground">
                    {memMb > 0 ? `${memMb} MB` : "—"}
                  </p>
                </div>
              </div>

              <div
                className="flex justify-end"
                onClick={handleStopPropagation}
              >
                {shutdownConfirm === worker.worker_id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Confirm shutdown?
                    </span>
                    <button
                      onClick={() => handleShutdown(worker.worker_id)}
                      disabled={!!shuttingDown}
                      className="px-2 py-1 rounded bg-destructive text-white text-xs hover:bg-destructive/80 transition disabled:opacity-50"
                    >
                      {shuttingDown === worker.worker_id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "Yes, shutdown"
                      )}
                    </button>
                    <button
                      onClick={handleCancelShutdown}
                      className="px-2 py-1 rounded bg-secondary text-foreground text-xs hover:bg-secondary/70 transition"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleConfirmShutdown(worker.worker_id)}
                    disabled={!isOnline}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <PowerOff className="h-3.5 w-3.5" />
                    Shutdown
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

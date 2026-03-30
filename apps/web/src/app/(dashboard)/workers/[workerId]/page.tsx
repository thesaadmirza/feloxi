"use client";

import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Cpu,
  MemoryStick,
  Activity,
  Users,
  PowerOff,
  Loader2,
  AlertTriangle,
  Clock,
  Server,
} from "lucide-react";
import { useState } from "react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { timeAgo, truncateId } from "@/lib/utils";
import { Skeleton } from "@/components/shared/skeleton";
import type { WorkerEvent } from "@/types/api";

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className={`text-2xl font-bold ${color ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

export default function WorkerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const workerId = decodeURIComponent(params.workerId as string);
  const [shutdownConfirm, setShutdownConfirm] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);

  const { data, isLoading, isError, error, refetch } = $api.useQuery(
    "get",
    "/api/v1/workers/{worker_id}",
    { params: { path: { worker_id: workerId } } },
    { enabled: !!workerId, refetchInterval: 10_000 }
  );

  const currentState = data?.current_state as WorkerEvent | null | undefined;
  const recentEvents = (data?.recent_events ?? []) as WorkerEvent[];

  async function handleShutdown() {
    setShuttingDown(true);
    setShutdownConfirm(false);
    try {
      await unwrap(fetchClient.POST("/api/v1/workers/{worker_id}/shutdown", {
        params: { path: { worker_id: workerId } },
      }));
      refetch();
    } catch (err) {
      console.error("Shutdown failed:", err);
    } finally {
      setShuttingDown(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive opacity-60" />
        <p className="text-lg font-medium text-foreground">Worker not found</p>
        <p className="text-sm text-muted-foreground">
          {(error as Error)?.message ?? "Could not load worker details"}
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

  const cpuPct = Math.round(currentState?.cpu_percent ?? 0);
  const memMb = Math.round(currentState?.memory_mb ?? 0);
  const loadAvg = currentState?.load_avg ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/workers")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Workers
          </button>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-mono text-muted-foreground">
            {currentState?.hostname ?? truncateId(workerId, 20)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {shutdownConfirm ? (
            <>
              <span className="text-sm text-muted-foreground">Confirm shutdown?</span>
              <button
                onClick={handleShutdown}
                disabled={shuttingDown}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-destructive text-white text-sm hover:bg-destructive/80 transition disabled:opacity-50"
              >
                {shuttingDown ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PowerOff className="h-4 w-4" />
                )}
                Yes, shutdown
              </button>
              <button
                onClick={() => setShutdownConfirm(false)}
                className="px-3 py-2 rounded-lg bg-secondary text-sm text-foreground hover:bg-secondary/80 transition"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setShutdownConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-destructive/20 text-sm text-destructive hover:bg-destructive/30 transition"
            >
              <PowerOff className="h-4 w-4" />
              Shutdown
            </button>
          )}
        </div>
      </div>

      {/* Worker ID */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Server className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-foreground">
            {currentState?.hostname ?? workerId}
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-8 text-sm">
          <div className="flex gap-2">
            <span className="text-muted-foreground w-24">Worker ID</span>
            <span className="font-mono text-foreground break-all">{workerId}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-24">Pool type</span>
            <span className="text-foreground">{currentState?.pool_type || "—"}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-24">Pool size</span>
            <span className="text-foreground">{currentState?.pool_size ?? "—"}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-24">Software</span>
            <span className="text-foreground">
              {currentState?.sw_ident
                ? `${currentState.sw_ident} ${currentState.sw_ver ?? ""}`
                : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Resource Usage */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Resource Usage
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Active Tasks"
            value={currentState?.active_tasks ?? 0}
            icon={Activity}
          />
          <StatCard
            label="CPU"
            value={`${cpuPct}%`}
            icon={Cpu}
            color={
              cpuPct > 80
                ? "text-destructive"
                : cpuPct > 60
                  ? "text-[#eab308]"
                  : "text-foreground"
            }
          />
          <StatCard
            label="Memory"
            value={memMb > 0 ? `${memMb} MB` : "—"}
            icon={MemoryStick}
          />
          <StatCard
            label="Processed"
            value={currentState?.processed ?? 0}
            icon={Users}
          />
        </div>

        {loadAvg.length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              Load Average
            </h3>
            <div className="flex gap-6">
              {(["1m", "5m", "15m"] as const).map((label, i) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold text-foreground mt-1">
                    {(loadAvg[i] ?? 0).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recent Events Timeline */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Recent Events
        </h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {recentEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              <Clock className="h-8 w-8 opacity-30" />
              <p className="text-sm">No recent events</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentEvents.map((event, idx) => (
                <div
                  key={event.event_id ?? idx}
                  className="flex items-center justify-between px-5 py-3 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded bg-secondary text-xs font-mono text-muted-foreground">
                      {event.event_type}
                    </span>
                    <div className="flex gap-4 text-muted-foreground text-xs">
                      {event.active_tasks != null && (
                        <span>{event.active_tasks} active</span>
                      )}
                      {event.cpu_percent != null && (
                        <span>CPU {Math.round(event.cpu_percent)}%</span>
                      )}
                      {event.memory_mb != null && (
                        <span>{Math.round(event.memory_mb)} MB</span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {timeAgo(event.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

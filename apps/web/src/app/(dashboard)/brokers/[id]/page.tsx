"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Cable,
  Database,
  Plug,
  Play,
  Square,
  Trash2,
  Loader2,
  AlertTriangle,
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  BarChart2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import type { TaskMetricsRow } from "@/types/api";

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-zinc-800 rounded ${className ?? "h-4 w-full"}`}
    />
  );
}

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
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center gap-2 text-sm text-zinc-500 mb-2">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className={`text-2xl font-bold ${color ?? "text-white"}`}>{value}</p>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "connected"
      ? "bg-emerald-400"
      : status === "error"
        ? "bg-red-400"
        : "bg-zinc-600";

  return (
    <span className="relative flex h-2.5 w-2.5">
      {status === "connected" && (
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-30 animate-ping" />
      )}
      <span
        className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`}
      />
    </span>
  );
}

function BrokerTypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-zinc-800 text-zinc-300">
      {type === "redis" ? (
        <Database className="w-3 h-3" />
      ) : (
        <Plug className="w-3 h-3" />
      )}
      {type === "redis" ? "Redis" : "RabbitMQ"}
    </span>
  );
}

/** Aggregate per-task throughput rows into per-minute totals for the chart. */
function aggregateThroughput(rows: TaskMetricsRow[]) {
  const byMinute = new Map<number, { success: number; failure: number }>();
  for (const r of rows) {
    const existing = byMinute.get(r.minute) ?? { success: 0, failure: 0 };
    existing.success += r.success_count;
    existing.failure += r.failure_count;
    byMinute.set(r.minute, existing);
  }
  return Array.from(byMinute.entries())
    .sort(([a], [b]) => a - b)
    .map(([minute, counts]) => ({
      time: new Date(minute).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      ...counts,
    }));
}

export default function BrokerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const brokerId = params.id as string;

  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const {
    data: broker,
    isLoading,
    isError,
    error,
  } = $api.useQuery(
    "get",
    "/api/v1/brokers/{id}",
    { params: { path: { id: brokerId } } },
    { enabled: !!brokerId, refetchInterval: 10_000 },
  );

  const { data: stats } = $api.useQuery(
    "get",
    "/api/v1/brokers/{id}/stats",
    { params: { path: { id: brokerId } } },
    { enabled: !!brokerId, refetchInterval: 10_000 },
  );

  const { data: queuesData } = $api.useQuery(
    "get",
    "/api/v1/brokers/{id}/queues",
    { params: { path: { id: brokerId } } },
    { enabled: !!brokerId && broker?.status === "connected", refetchInterval: 10_000 },
  );

  const { data: throughputData } = $api.useQuery(
    "get",
    "/api/v1/metrics/throughput",
    { params: { query: { from_minutes: 60 } } },
    { enabled: !!brokerId, refetchInterval: 30_000 },
  );

  const startMutation = useMutation({
    mutationFn: () => unwrap(fetchClient.POST("/api/v1/brokers/{id}/start", { params: { path: { id: brokerId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/brokers/{id}"] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => unwrap(fetchClient.POST("/api/v1/brokers/{id}/stop", { params: { path: { id: brokerId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/brokers/{id}"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => unwrap(fetchClient.DELETE("/api/v1/brokers/{id}", { params: { path: { id: brokerId } } })),
    onSuccess: () => router.push("/brokers"),
  });

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
        <AlertTriangle className="h-12 w-12 text-red-400 opacity-60" />
        <p className="text-lg font-medium text-white">Broker not found</p>
        <p className="text-sm text-zinc-500">
          {(error as Error)?.message ?? "Could not load broker details"}
        </p>
        <button
          onClick={() => router.push("/brokers")}
          className="mt-2 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm hover:bg-zinc-700 transition"
        >
          Go back
        </button>
      </div>
    );
  }

  if (!broker) return null;

  const isConnected = broker.status === "connected";
  const isToggling = startMutation.isPending || stopMutation.isPending;

  const successRate =
    stats && stats.total_events > 0
      ? Math.round(
          (stats.success_count / (stats.success_count + stats.failure_count)) * 100
        ) || 0
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/brokers")}
            className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Brokers
          </button>
          <span className="text-zinc-700">/</span>
          <span className="text-sm font-medium text-zinc-200">{broker.name}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Start / Stop */}
          <button
            onClick={() =>
              isConnected ? stopMutation.mutate() : startMutation.mutate()
            }
            disabled={isToggling}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm font-medium hover:bg-zinc-700 transition disabled:opacity-50"
          >
            {isToggling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isConnected ? (
              <Square className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {isConnected ? "Stop" : "Start"}
          </button>

          {/* Delete */}
          {deleteConfirm ? (
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-zinc-500">Delete broker?</span>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-3 py-2 rounded-lg bg-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/30 transition disabled:opacity-50"
              >
                {deleteMutation.isPending ? "..." : "Confirm"}
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:bg-zinc-700 transition"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Broker Info Card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="flex items-center gap-3 mb-4">
          <Cable className="h-5 w-5 text-zinc-400" />
          <h2 className="font-semibold text-white">{broker.name}</h2>
          <StatusDot status={broker.status} />
          <span
            className={`text-xs font-medium capitalize ${
              broker.status === "connected"
                ? "text-emerald-400"
                : broker.status === "error"
                  ? "text-red-400"
                  : "text-zinc-500"
            }`}
          >
            {broker.status}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-8 text-sm">
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">Type</span>
            <BrokerTypeBadge type={broker.broker_type} />
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">Broker ID</span>
            <span className="font-mono text-zinc-300 text-xs break-all">
              {broker.id}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">Created</span>
            <span className="text-zinc-300">{timeAgo(broker.created_at)}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 w-28 shrink-0">Updated</span>
            <span className="text-zinc-300">{timeAgo(broker.updated_at)}</span>
          </div>
        </div>

        {broker.last_error && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            <p className="font-medium mb-1">Last Error</p>
            <p className="text-red-400/80 font-mono text-xs break-all">
              {broker.last_error}
            </p>
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          Ingestion Stats
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Events"
            value={stats?.total_events?.toLocaleString() ?? "0"}
            icon={Activity}
          />
          <StatCard
            label="Last Hour"
            value={stats?.events_last_hour?.toLocaleString() ?? "0"}
            icon={Clock}
          />
          <StatCard
            label="Last 24h"
            value={stats?.events_last_24h?.toLocaleString() ?? "0"}
            icon={BarChart2}
          />
          <StatCard
            label="Success Rate"
            value={stats ? `${successRate}%` : "—"}
            icon={CheckCircle}
            color={
              successRate >= 95
                ? "text-emerald-400"
                : successRate >= 80
                  ? "text-yellow-400"
                  : "text-red-400"
            }
          />
        </div>
      </div>

      {/* Queue Depths */}
      {queuesData && queuesData.data.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            Queue Depths
          </h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="px-4 py-3 font-medium">Queue</th>
                  <th className="px-4 py-3 font-medium text-right">Messages</th>
                </tr>
              </thead>
              <tbody>
                {queuesData.data.map((q) => (
                  <tr
                    key={q.queue_name}
                    className="border-t border-zinc-800/60 hover:bg-white/[0.02] transition"
                  >
                    <td className="px-4 py-3 text-sm font-mono text-zinc-300">
                      {q.queue_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">
                      <span
                        className={
                          q.depth > 100
                            ? "text-yellow-400 font-medium"
                            : "text-zinc-400"
                        }
                      >
                        {q.depth.toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Throughput Chart */}
      {throughputData && throughputData.data.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            Throughput (Last Hour)
          </h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart
                data={aggregateThroughput(throughputData.data)}
                margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="failureGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: "var(--chart-axis)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--chart-axis)" }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--chart-tooltip-bg)",
                    border: "1px solid var(--chart-tooltip-border)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--chart-tooltip-color)",
                  }}
                  labelStyle={{ color: "var(--chart-tooltip-label)" }}
                />
                <Area
                  type="monotone"
                  dataKey="success"
                  stroke="#22c55e"
                  fill="url(#successGrad)"
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="failure"
                  stroke="#ef4444"
                  fill="url(#failureGrad)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Top Tasks */}
      {stats && stats.top_tasks.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            Top Tasks
          </h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="px-4 py-3 font-medium">Task Name</th>
                  <th className="px-4 py-3 font-medium text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {stats.top_tasks.map((task) => (
                  <tr
                    key={task.name}
                    className="border-t border-zinc-800/60 hover:bg-white/[0.02] transition"
                  >
                    <td className="px-4 py-3 text-sm font-mono text-zinc-300">
                      {task.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400 text-right tabular-nums">
                      {task.count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

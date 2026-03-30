"use client";

import { useState, useCallback, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { RefreshCw, Layers, AlertTriangle } from "lucide-react";
import { $api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";

type TimeRange = { label: string; minutes: number };

const TIME_RANGES: TimeRange[] = [
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
  { label: "7d", minutes: 10080 },
];

const TOOLTIP_STYLE = {
  backgroundColor: "var(--chart-tooltip-bg)",
  border: "1px solid var(--chart-tooltip-border)",
  borderRadius: "8px",
  color: "var(--chart-tooltip-color)",
  fontSize: "12px",
};

function backlogStatus(backlog: number): { label: string; cls: string } {
  if (backlog > 10000) return { label: "Critical", cls: "text-red-400 bg-red-400/10 border-red-400/20" };
  if (backlog > 1000) return { label: "Warning", cls: "text-orange-400 bg-orange-400/10 border-orange-400/20" };
  if (backlog > 0) return { label: "Active", cls: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" };
  return { label: "Healthy", cls: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" };
}

export default function QueuesPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>(TIME_RANGES[0]);

  const {
    data,
    isLoading,
    isError,
    refetch,
  } = $api.useQuery(
    "get",
    "/api/v1/metrics/queue-overview",
    { params: { query: { from_minutes: timeRange.minutes } } },
    { refetchInterval: 15_000 },
  );

  const queues = data?.data ?? [];

  const chartData = useMemo(
    () =>
      queues.map((q) => ({
        name: q.queue || "default",
        completed: q.completed,
        failed: q.failed,
        backlog: Math.max(0, q.backlog),
      })),
    [queues],
  );

  const totalBacklog = useMemo(
    () => queues.reduce((acc, q) => acc + Math.max(0, q.backlog), 0),
    [queues],
  );

  const totalEnqueued = useMemo(
    () => queues.reduce((acc, q) => acc + q.enqueued, 0),
    [queues],
  );

  const totalFailed = useMemo(
    () => queues.reduce((acc, q) => acc + q.failed, 0),
    [queues],
  );

  const handleSelectRange = useCallback((r: TimeRange) => setTimeRange(r), []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Queue Health</h1>
          <p className="text-sm text-zinc-400 mt-0.5">Monitor queue depths and throughput</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 p-1 bg-zinc-800 rounded-lg">
            {TIME_RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => handleSelectRange(r)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                  timeRange.minutes === r.minutes
                    ? "bg-zinc-700 text-white shadow-sm"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-white hover:bg-zinc-700 transition"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {isError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Failed to load queue data.
        </div>
      )}

      {!isLoading && queues.length === 0 && (
        <EmptyState
          icon={<Layers className="w-8 h-8" />}
          title="No queue data"
          description="Queue metrics will appear once tasks are processed."
        />
      )}

      {queues.length > 0 && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Queues</p>
              <p className="text-2xl font-bold text-white tabular-nums">{queues.length}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Total Enqueued</p>
              <p className="text-2xl font-bold text-white tabular-nums">{formatNumber(totalEnqueued)}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Total Failed</p>
              <p className="text-2xl font-bold text-red-400 tabular-nums">{formatNumber(totalFailed)}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Est. Backlog</p>
              <p className={`text-2xl font-bold tabular-nums ${totalBacklog > 1000 ? "text-orange-400" : "text-white"}`}>
                {formatNumber(totalBacklog)}
              </p>
            </div>
          </div>

          {chartData.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Queue Throughput</h2>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="name" tick={{ fill: "var(--chart-axis)", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "var(--chart-axis)", fontSize: 10 }} tickLine={false} axisLine={false} width={50} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend />
                  <Bar dataKey="completed" fill="#22c55e" name="Completed" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="failed" fill="#ef4444" name="Failed" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="backlog" fill="#eab308" name="Backlog" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Queue Details</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left text-xs text-zinc-400 font-medium py-2 pr-4 uppercase tracking-wider">Queue</th>
                    <th className="text-right text-xs text-zinc-400 font-medium py-2 pr-4 uppercase tracking-wider">Enqueued</th>
                    <th className="text-right text-xs text-zinc-400 font-medium py-2 pr-4 uppercase tracking-wider">Completed</th>
                    <th className="text-right text-xs text-zinc-400 font-medium py-2 pr-4 uppercase tracking-wider">Failed</th>
                    <th className="text-right text-xs text-zinc-400 font-medium py-2 pr-4 uppercase tracking-wider">Backlog</th>
                    <th className="text-right text-xs text-zinc-400 font-medium py-2 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {queues.map((q) => {
                    const status = backlogStatus(q.backlog);
                    return (
                      <tr key={q.queue} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="py-2.5 pr-4">
                          <span className="text-white font-mono text-xs">{q.queue || "default"}</span>
                        </td>
                        <td className="py-2.5 pr-4 text-right text-zinc-300 text-xs tabular-nums">{formatNumber(q.enqueued)}</td>
                        <td className="py-2.5 pr-4 text-right text-emerald-400 text-xs tabular-nums">{formatNumber(q.completed)}</td>
                        <td className="py-2.5 pr-4 text-right text-red-400 text-xs tabular-nums">{formatNumber(q.failed)}</td>
                        <td className="py-2.5 pr-4 text-right text-zinc-400 text-xs tabular-nums">{formatNumber(Math.max(0, q.backlog))}</td>
                        <td className="py-2.5 text-right">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${status.cls}`}>
                            {status.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

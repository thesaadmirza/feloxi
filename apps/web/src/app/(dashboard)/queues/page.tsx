"use client";

import { useMemo } from "react";
import { RefreshCw, Layers, AlertTriangle } from "lucide-react";
import { $api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";

function depthStatus(depth: number): { label: string; cls: string } {
  if (depth > 10000) return { label: "Critical", cls: "text-red-400 bg-red-400/10 border-red-400/20" };
  if (depth > 1000) return { label: "Warning", cls: "text-orange-400 bg-orange-400/10 border-orange-400/20" };
  if (depth > 0) return { label: "Active", cls: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" };
  return { label: "Empty", cls: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" };
}

export default function QueuesPage() {
  const { data: brokersData } = $api.useQuery("get", "/api/v1/brokers", {}, { refetchInterval: 30_000 });
  const brokers = brokersData?.data ?? [];
  const connectedBroker = brokers.find((b) => b.status === "connected");

  const {
    data: queueData,
    isLoading,
    isError,
    refetch,
  } = $api.useQuery(
    "get",
    "/api/v1/brokers/{id}/queues",
    { params: { path: { id: connectedBroker?.id ?? "" } } },
    { enabled: !!connectedBroker, refetchInterval: 10_000 },
  );

  const queues = useMemo(() => {
    const raw = queueData?.data ?? [];
    // Filter out malformed queue names (Kombu binding artifacts with control chars)
    return raw.filter((q) => q.queue_name && !q.queue_name.includes("\u0006"));
  }, [queueData]);

  const totalDepth = useMemo(
    () => queues.reduce((acc, q) => acc + q.depth, 0),
    [queues],
  );

  const nonEmpty = useMemo(
    () => queues.filter((q) => q.depth > 0).length,
    [queues],
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Queues</h1>
          <p className="text-sm text-zinc-400 mt-0.5">Live queue depths from connected broker</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-white hover:bg-zinc-700 transition"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {isError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Failed to load queue data.
        </div>
      )}

      {!connectedBroker && !isLoading && (
        <EmptyState
          icon={<Layers className="w-8 h-8" />}
          title="No broker connected"
          description="Connect a Redis or RabbitMQ broker to see live queue depths."
        />
      )}

      {connectedBroker && !isLoading && queues.length === 0 && (
        <EmptyState
          icon={<Layers className="w-8 h-8" />}
          title="No queues found"
          description="Queues will appear once tasks are published to the broker."
        />
      )}

      {queues.length > 0 && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Queues</p>
              <p className="text-2xl font-bold text-white tabular-nums">{queues.length}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Active (non-empty)</p>
              <p className={`text-2xl font-bold tabular-nums ${nonEmpty > 0 ? "text-yellow-400" : "text-white"}`}>
                {nonEmpty}
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Total Pending</p>
              <p className={`text-2xl font-bold tabular-nums ${totalDepth > 1000 ? "text-orange-400" : totalDepth > 0 ? "text-yellow-400" : "text-white"}`}>
                {formatNumber(totalDepth)}
              </p>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Queue Details</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left text-xs text-zinc-400 font-medium py-2 pr-4 uppercase tracking-wider">Queue</th>
                    <th className="text-right text-xs text-zinc-400 font-medium py-2 pr-4 uppercase tracking-wider">Depth</th>
                    <th className="text-right text-xs text-zinc-400 font-medium py-2 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {queues
                    .sort((a, b) => b.depth - a.depth || a.queue_name.localeCompare(b.queue_name))
                    .map((q) => {
                      const status = depthStatus(q.depth);
                      return (
                        <tr key={q.queue_name} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="py-2.5 pr-4">
                            <span className="text-white font-mono text-xs">{q.queue_name}</span>
                          </td>
                          <td className="py-2.5 pr-4 text-right text-zinc-300 text-xs tabular-nums">
                            {formatNumber(q.depth)}
                          </td>
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

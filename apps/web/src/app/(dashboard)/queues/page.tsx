"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Layers, AlertTriangle, ChevronDown, Trash2, Loader2 } from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { useHasPermission } from "@/hooks/use-current-user";

function QueueSparkline({ queueName }: { queueName: string }) {
  const { data } = $api.useQuery(
    "get",
    "/api/v1/metrics/queues",
    { params: { query: { queue: queueName, from_minutes: 60 } } },
    { staleTime: 60_000 }
  );

  const points = data?.data ?? [];
  if (points.length < 2) return <span className="text-xs text-muted-foreground">—</span>;

  const values = points.map((p) => p.enqueued);
  const maxVal = Math.max(...values, 1);
  const W = 72;
  const H = 24;
  const coords = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - (v / maxVal) * (H - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const recent = values.slice(-5).reduce((a, b) => a + b, 0);
  const earlier = values.slice(0, 5).reduce((a, b) => a + b, 0);
  const color = recent > earlier * 1.2 ? "#f97316" : recent < earlier * 0.8 ? "#22c55e" : "#6366f1";

  return (
    <svg width={W} height={H} aria-hidden>
      <polyline
        points={coords}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
    </svg>
  );
}

function depthStatus(depth: number): { label: string; cls: string } {
  if (depth > 10000) return { label: "Critical", cls: "text-red-400 bg-red-400/10 border-red-400/20" };
  if (depth > 1000) return { label: "Warning", cls: "text-orange-400 bg-orange-400/10 border-orange-400/20" };
  if (depth > 0) return { label: "Active", cls: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" };
  return { label: "Empty", cls: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" };
}

export default function QueuesPage() {
  const router = useRouter();
  const canManage = useHasPermission("brokers_manage");
  const { data: brokersData } = $api.useQuery("get", "/api/v1/brokers", {}, { refetchInterval: 30_000 });
  const brokers = brokersData?.data ?? [];
  const connectedBrokers = brokers.filter((b) => b.status === "connected");

  const [selectedBrokerId, setSelectedBrokerId] = useState<string | undefined>(undefined);
  const activeBroker = selectedBrokerId
    ? connectedBrokers.find((b) => b.id === selectedBrokerId) ?? connectedBrokers[0]
    : connectedBrokers[0];

  const {
    data: queueData,
    isLoading,
    isError,
    refetch,
  } = $api.useQuery(
    "get",
    "/api/v1/brokers/{id}/queues",
    { params: { path: { id: activeBroker?.id ?? "" } } },
    { enabled: !!activeBroker, refetchInterval: 10_000 },
  );

  const queues = useMemo(() => {
    const raw = queueData?.data ?? [];
    // Filter out malformed queue names (Kombu binding artifacts with control chars)
    return raw.filter((q) => q.queue_name && !q.queue_name.includes(""));
  }, [queueData]);

  const totalDepth = useMemo(
    () => queues.reduce((acc, q) => acc + q.depth, 0),
    [queues],
  );

  const nonEmpty = useMemo(
    () => queues.filter((q) => q.depth > 0).length,
    [queues],
  );

  // Purge state
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  async function handlePurge() {
    if (!activeBroker || !purgeTarget) return;
    setPurging(true);
    setPurgeError(null);
    try {
      await unwrap(
        fetchClient.DELETE("/api/v1/brokers/{id}/queues/{queue_name}" as never, {
          params: { path: { id: activeBroker.id, queue_name: purgeTarget } },
        } as never)
      );
      setPurgeTarget(null);
      refetch();
    } catch (err) {
      setPurgeError(err instanceof Error ? err.message : "Purge failed");
    } finally {
      setPurging(false);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Queues</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Live queue depths from connected broker</p>
        </div>
        <div className="flex items-center gap-2">
          {connectedBrokers.length > 1 && (
            <div className="relative">
              <select
                value={activeBroker?.id ?? ""}
                onChange={(e) => setSelectedBrokerId(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 bg-secondary border border-border text-foreground text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                aria-label="Select broker"
              >
                {connectedBrokers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.broker_type.toUpperCase()} — {b.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            </div>
          )}
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-muted-foreground text-sm hover:text-foreground hover:bg-secondary/80 transition"
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

      {!activeBroker && !isLoading && brokers.length === 0 && (
        <EmptyState
          icon={<Layers className="w-8 h-8" />}
          title="No broker configured"
          description="Add a Redis or RabbitMQ broker in Settings to see live queue depths."
        />
      )}

      {!activeBroker && !isLoading && brokers.length > 0 && (
        <div className="space-y-3">
          <EmptyState
            icon={<AlertTriangle className="w-8 h-8" />}
            title="Broker not connected"
            description="Queue depths come from a live broker connection. Your broker exists but isn't connected right now:"
          />
          <div className="max-w-xl mx-auto space-y-2">
            {brokers.map((b) => (
              <div
                key={b.id}
                className="rounded-lg border border-border bg-card px-4 py-3 text-sm flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{b.name || b.broker_type}</span>
                  <span className="ml-2 text-xs text-muted-foreground uppercase">{b.broker_type}</span>
                  {b.last_error && (
                    <p className="text-xs text-red-400 mt-1 truncate" title={b.last_error}>
                      {b.last_error}
                    </p>
                  )}
                </div>
                <span
                  className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                    b.status === "error"
                      ? "text-red-400 bg-red-400/10 border-red-400/20"
                      : "text-yellow-400 bg-yellow-400/10 border-yellow-400/20"
                  }`}
                >
                  {b.status}
                </span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground text-center">
              Check the broker&apos;s status on the Brokers page — reconnecting it restores this view.
            </p>
          </div>
        </div>
      )}

      {activeBroker && !isLoading && queues.length === 0 && (
        <EmptyState
          icon={<Layers className="w-8 h-8" />}
          title="No queues found"
          description="Queues appear once workers bind them or tasks are published. On RabbitMQ, queue names are discovered from task events — enabling task_send_sent_event in your Celery app helps."
        />
      )}

      {queues.length > 0 && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Queues</p>
              <p className="text-2xl font-bold text-foreground tabular-nums">{queues.length}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Active (non-empty)</p>
              <p className={`text-2xl font-bold tabular-nums ${nonEmpty > 0 ? "text-yellow-400" : "text-foreground"}`}>
                {nonEmpty}
              </p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Total Pending</p>
              <p className={`text-2xl font-bold tabular-nums ${totalDepth > 1000 ? "text-orange-400" : totalDepth > 0 ? "text-yellow-400" : "text-foreground"}`}>
                {formatNumber(totalDepth)}
              </p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4">Queue Details</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs text-muted-foreground font-medium py-2 pr-4 uppercase tracking-wider">Queue</th>
                    <th className="text-right text-xs text-muted-foreground font-medium py-2 pr-4 uppercase tracking-wider">Depth</th>
                    <th className="text-left text-xs text-muted-foreground font-medium py-2 pr-4 uppercase tracking-wider">1h Activity</th>
                    <th className="text-right text-xs text-muted-foreground font-medium py-2 uppercase tracking-wider">Status</th>
                    {canManage && <th className="text-right text-xs text-muted-foreground font-medium py-2 pl-4 uppercase tracking-wider">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {queues
                    .sort((a, b) => b.depth - a.depth || a.queue_name.localeCompare(b.queue_name))
                    .map((q) => {
                      const status = depthStatus(q.depth);
                      return (
                        <tr
                          key={q.queue_name}
                          className="hover:bg-secondary/30 transition-colors group"
                        >
                          <td
                            className="py-2.5 pr-4 cursor-pointer"
                            onClick={() => router.push(`/tasks?queue=${encodeURIComponent(q.queue_name)}`)}
                            title={`View tasks in ${q.queue_name}`}
                          >
                            <span className="text-foreground font-mono text-xs hover:underline">{q.queue_name}</span>
                          </td>
                          <td className="py-2.5 pr-4 text-right text-muted-foreground text-xs tabular-nums">
                            {formatNumber(q.depth)}
                          </td>
                          <td className="py-2.5 pr-4">
                            <QueueSparkline queueName={q.queue_name} />
                          </td>
                          <td className="py-2.5 text-right">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${status.cls}`}>
                              {status.label}
                            </span>
                          </td>
                          {canManage && (
                            <td className="py-2.5 pl-4 text-right">
                              <button
                                onClick={() => setPurgeTarget(q.queue_name)}
                                disabled={q.depth === 0}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition disabled:cursor-not-allowed disabled:opacity-0"
                                title={q.depth === 0 ? "Queue is empty" : "Purge all messages"}
                              >
                                <Trash2 className="h-3 w-3" />
                                Purge
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Purge confirmation modal */}
      {purgeTarget && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => !purging && setPurgeTarget(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full shadow-xl">
              <h3 className="text-lg font-semibold text-foreground mb-2">Purge Queue</h3>
              <p className="text-sm text-muted-foreground mb-1">
                This will permanently delete all pending messages in:
              </p>
              <p className="text-xs font-mono text-foreground bg-secondary px-3 py-2 rounded-lg mb-4 truncate">
                {purgeTarget}
              </p>
              <p className="text-xs text-destructive/80 mb-4">
                Tasks that are already running will not be affected, but any waiting tasks will be lost.
              </p>
              {purgeError && (
                <p className="text-xs text-destructive mb-3">{purgeError}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setPurgeTarget(null); setPurgeError(null); }}
                  disabled={purging}
                  className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePurge}
                  disabled={purging}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition disabled:opacity-50"
                >
                  {purging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Purge Queue
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

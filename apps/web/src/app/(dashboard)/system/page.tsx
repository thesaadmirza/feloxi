"use client";

import {
  Activity,
  Database,
  HardDrive,
  Server,
  Cable,
  RefreshCw,
} from "lucide-react";
import { $api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  healthy: { bg: "bg-[#22c55e]/20", text: "text-[#22c55e]", dot: "bg-[#22c55e]", label: "Healthy" },
  degraded: { bg: "bg-[#eab308]/20", text: "text-[#eab308]", dot: "bg-[#eab308]", label: "Degraded" },
  unhealthy: { bg: "bg-red-500/20", text: "text-red-400", dot: "bg-red-400", label: "Unhealthy" },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.unhealthy;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function ComponentIcon({ name }: { name: string }) {
  if (name === "postgresql") return <Database className="w-4 h-4" />;
  if (name === "clickhouse") return <HardDrive className="w-4 h-4" />;
  if (name === "redis") return <Server className="w-4 h-4" />;
  if (name.startsWith("broker:")) return <Cable className="w-4 h-4" />;
  return <Activity className="w-4 h-4" />;
}

export default function SystemPage() {
  const { data, isLoading, refetch } = $api.useQuery(
    "get",
    "/api/v1/system/health",
    {},
    { refetchInterval: 10_000 },
  );

  const health = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-zinc-100">System Health</h1>
          {health && <StatusBadge status={health.status} />}
        </div>
        <div className="flex items-center gap-2">
          {health && (
            <span className="text-xs text-zinc-500">v{health.version}</span>
          )}
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-zinc-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {health && (
        <>
          {/* Component Health Grid */}
          <section>
            <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-4">
              Components
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {health.components.map((c) => (
                <div
                  key={c.name}
                  className="flex items-start gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-xl"
                >
                  <div className={c.status === "up" ? "text-emerald-400 mt-0.5" : "text-red-400 mt-0.5"}>
                    <ComponentIcon name={c.name} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-zinc-200 truncate">{c.name}</p>
                      <span className={`w-1.5 h-1.5 rounded-full ${c.status === "up" ? "bg-emerald-400" : "bg-red-400"}`} />
                    </div>
                    {c.latency_ms != null && (
                      <p className="text-xs text-zinc-500 mt-0.5">{c.latency_ms}ms</p>
                    )}
                    {c.message && (
                      <p className="text-xs text-red-400/80 mt-1 truncate">{c.message}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Pipeline Metrics */}
          <section>
            <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-4">
              Event Pipeline
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <MetricCard
                label="Received"
                value={formatNumber(health.pipeline.events_received)}
                accent="text-zinc-300"
              />
              <MetricCard
                label="Inserted"
                value={formatNumber(health.pipeline.events_inserted)}
                sub={`${(health.pipeline.success_rate * 100).toFixed(1)}% success`}
                accent="text-emerald-400"
              />
              <MetricCard
                label="Dropped"
                value={formatNumber(health.pipeline.events_dropped)}
                sub={health.pipeline.events_dropped > 0 ? `${(health.pipeline.drop_rate * 100).toFixed(2)}% loss` : undefined}
                accent={health.pipeline.events_dropped > 0 ? "text-red-400" : "text-zinc-400"}
              />
              <MetricCard
                label="Parse Failures"
                value={formatNumber(health.pipeline.events_parse_failed)}
                accent={health.pipeline.events_parse_failed > 0 ? "text-yellow-400" : "text-zinc-400"}
              />
              <MetricCard
                label="Retries"
                value={formatNumber(health.pipeline.insert_retries)}
                accent="text-zinc-400"
              />
            </div>
          </section>

          {/* ClickHouse Storage */}
          {health.storage && (
            <section>
              <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-4">
                ClickHouse Storage
              </h2>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
                {/* Disk usage bar */}
                <div>
                  <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
                    <span>Disk Usage</span>
                    <span>
                      {formatBytes(health.storage.used_bytes)} / {formatBytes(health.storage.total_bytes)}
                    </span>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        health.storage.used_bytes / health.storage.total_bytes > 0.9
                          ? "bg-red-500"
                          : health.storage.used_bytes / health.storage.total_bytes > 0.7
                            ? "bg-yellow-500"
                            : "bg-emerald-500"
                      }`}
                      style={{
                        width: `${Math.min((health.storage.used_bytes / health.storage.total_bytes) * 100, 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">
                    {formatBytes(health.storage.free_bytes)} free
                  </p>
                </div>

                {/* Per-table breakdown */}
                {health.storage.tables.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-zinc-400 mb-2">Tables</p>
                    <div className="space-y-1.5">
                      {health.storage.tables.map((t) => (
                        <div key={t.table} className="flex items-center justify-between text-xs">
                          <span className="text-zinc-300 font-mono">{t.table}</span>
                          <div className="flex items-center gap-4 text-zinc-500">
                            <span>{formatNumber(t.rows)} rows</span>
                            <span className="w-20 text-right">{formatBytes(t.bytes_on_disk)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  accent = "text-zinc-300",
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-xl">
      <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
}

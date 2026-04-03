"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Activity,
  Layers,
  Clock,
  AlertTriangle,
  TrendingDown,
  RefreshCw,
  Cable,
  Users,
  Bell,
  ArrowRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { $api } from "@/lib/api";
import { useWsStore } from "@/stores/ws-store";
import { formatDuration, formatPercent, formatNumber } from "@/lib/utils";
import { LiveIndicator } from "@/components/shared/live-indicator";
import { EmptyState } from "@/components/shared/empty-state";
import type { TaskMetricsRow } from "@/types/api";

type TimeRange = { label: string; minutes: number };

const TIME_RANGES: TimeRange[] = [
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
  { label: "7d", minutes: 10080 },
];

const STATE_COLORS: Record<string, string> = {
  SUCCESS: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  FAILURE: "text-red-400 bg-red-400/10 border-red-400/20",
  STARTED: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  PENDING: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  RETRY: "text-orange-400 bg-orange-400/10 border-orange-400/20",
  REVOKED: "text-zinc-400 bg-zinc-400/10 border-zinc-400/20",
  RECEIVED: "text-violet-400 bg-violet-400/10 border-violet-400/20",
  REJECTED: "text-red-400 bg-red-400/10 border-red-400/20",
};

const TOOLTIP_STYLE = {
  backgroundColor: "var(--chart-tooltip-bg)",
  border: "1px solid var(--chart-tooltip-border)",
  borderRadius: "8px",
  color: "var(--chart-tooltip-color)",
  fontSize: "12px",
};

const ONBOARDING_STEPS = [
  {
    icon: Cable,
    title: "Connect a broker",
    description: "Add your Redis or RabbitMQ broker to start ingesting Celery events.",
    href: "/brokers",
    cta: "Add Broker",
  },
  {
    icon: Users,
    title: "Workers appear automatically",
    description: "Once connected, worker heartbeats and task events stream in real-time.",
    href: "/workers",
    cta: "View Workers",
  },
  {
    icon: Bell,
    title: "Set up alerts",
    description: "Get notified on failure spikes, slow tasks, or workers going offline.",
    href: "/alerts",
    cta: "Create Alert",
  },
];

function PipelineHealthBanner() {
  const { data } = $api.useQuery(
    "get",
    "/api/v1/system/pipeline",
    {},
    { refetchInterval: 15_000 },
  );

  if (!data || data.events_dropped === 0) return null;

  const isCritical = data.drop_rate > 0.1;

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${
      isCritical
        ? "bg-red-500/10 border-red-500/20"
        : "bg-yellow-500/10 border-yellow-500/20"
    }`}>
      <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${isCritical ? "text-red-400" : "text-yellow-400"}`} />
      <div>
        <p className={`text-sm font-medium ${isCritical ? "text-red-300" : "text-yellow-300"}`}>
          {formatNumber(data.events_dropped)} event{data.events_dropped !== 1 ? "s" : ""} not saved to history
        </p>
        <p className="text-xs text-zinc-400 mt-0.5">
          Some events could not be stored. They were delivered live but won&apos;t appear in historical data.{" "}
          <Link href="/system" className="text-zinc-300 hover:text-white underline">View details</Link>
        </p>
      </div>
    </div>
  );
}

function GettingStarted() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8">
      <div className="text-center mb-8">
        <h2 className="text-lg font-bold text-white">Welcome to Feloxi</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Get started by connecting your first Celery broker
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {ONBOARDING_STEPS.map((step, i) => (
          <div
            key={step.title}
            className="flex flex-col items-center text-center p-6 rounded-xl border border-zinc-800 bg-zinc-800/30"
          >
            <div className="w-10 h-10 rounded-xl bg-zinc-700/50 flex items-center justify-center mb-4">
              <step.icon className="w-5 h-5 text-zinc-300" />
            </div>
            <div className="text-xs font-medium text-zinc-500 mb-2">Step {i + 1}</div>
            <h3 className="text-sm font-semibold text-white mb-1">{step.title}</h3>
            <p className="text-xs text-zinc-500 mb-4 leading-relaxed">{step.description}</p>
            <Link
              href={step.href}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-zinc-700 hover:bg-zinc-600 px-3 py-1.5 rounded-lg transition"
            >
              {step.cta}
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const cls = STATE_COLORS[state] ?? "text-zinc-400 bg-zinc-400/10 border-zinc-400/20";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {state}
    </span>
  );
}

type SummaryCardProps = {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: string;
  loading?: boolean;
};

function SummaryCard({ title, value, sub, icon, accent = "text-zinc-300", loading }: SummaryCardProps) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex items-start gap-4">
      <div className={`mt-0.5 ${accent}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">{title}</p>
        {loading ? (
          <div className="h-7 w-20 bg-zinc-800 rounded animate-pulse" />
        ) : (
          <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
        )}
        {sub && !loading && (
          <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}

function buildThroughputChartData(rows: TaskMetricsRow[]) {
  const buckets = new Map<number, { success: number; failure: number }>();
  for (const row of rows) {
    const existing = buckets.get(row.minute) ?? { success: 0, failure: 0 };
    existing.success += row.success_count;
    existing.failure += row.failure_count;
    buckets.set(row.minute, existing);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([minute, v]) => ({
      time: new Date(minute).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      success: v.success,
      failure: v.failure,
    }));
}

function buildFailureRateData(rows: TaskMetricsRow[]) {
  const buckets = new Map<number, { failure: number; total: number }>();
  for (const row of rows) {
    const existing = buckets.get(row.minute) ?? { failure: 0, total: 0 };
    existing.failure += row.failure_count;
    existing.total += row.total_count;
    buckets.set(row.minute, existing);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([minute, v]) => ({
      time: new Date(minute).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      rate: v.total > 0 ? parseFloat(((v.failure / v.total) * 100).toFixed(2)) : 0,
    }));
}

function buildTaskBreakdown(rows: TaskMetricsRow[]) {
  const byName = new Map<string, { success: number; failure: number; total: number }>();
  for (const row of rows) {
    const existing = byName.get(row.task_name) ?? { success: 0, failure: 0, total: 0 };
    existing.success += row.success_count;
    existing.failure += row.failure_count;
    existing.total += row.total_count;
    byName.set(row.task_name, existing);
  }
  return Array.from(byName.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total);
}

function RecentTasks() {
  const wsRecentTasks = useWsStore((s) => s.recentTasks);
  const wsConnected = useWsStore((s) => s.connectionState === "connected");

  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/tasks",
    { params: { query: { limit: 20 } } },
    { refetchInterval: wsConnected ? false : 5_000 },
  );

  if (isLoading && wsRecentTasks.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 bg-zinc-800 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  const apiItems = data?.data ?? [];
  const items = wsRecentTasks.length > 0
    ? wsRecentTasks.slice(0, 20).map((t) => ({
        task_id: t.task_id,
        task_name: t.task_name,
        state: t.state,
        queue: t.queue,
        runtime: t.runtime,
        timestamp: t.timestamp,
      }))
    : apiItems;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="w-8 h-8" />}
        title="No tasks yet"
        description="Task events from connected brokers will appear here."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-left text-xs text-zinc-400 font-medium py-2 pr-4 uppercase tracking-wider">Task</th>
            <th className="text-left text-xs text-zinc-400 font-medium py-2 pr-4 uppercase tracking-wider">State</th>
            <th className="text-left text-xs text-zinc-400 font-medium py-2 pr-4 uppercase tracking-wider">Queue</th>
            <th className="text-left text-xs text-zinc-400 font-medium py-2 uppercase tracking-wider">Runtime</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {items.map((task) => (
            <tr key={`${task.task_id}-${task.timestamp}`} className="hover:bg-zinc-800/30 transition-colors">
              <td className="py-2.5 pr-4">
                <span className="text-white font-mono text-xs">{task.task_name}</span>
              </td>
              <td className="py-2.5 pr-4">
                <StateBadge state={task.state} />
              </td>
              <td className="py-2.5 pr-4 text-zinc-400 text-xs">{task.queue || "default"}</td>
              <td className="py-2.5 text-zinc-400 text-xs">
                {task.runtime != null ? formatDuration(task.runtime) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DashboardPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>(TIME_RANGES[0]);

  const {
    data: overview,
    isLoading,
    isError,
    refetch,
  } = $api.useQuery(
    "get",
    "/api/v1/metrics/overview",
    { params: { query: { from_minutes: timeRange.minutes } } },
    { refetchInterval: 30_000 },
  );

  const { data: throughputData, isLoading: throughputLoading } = $api.useQuery(
    "get",
    "/api/v1/metrics/throughput",
    { params: { query: { from_minutes: timeRange.minutes } } },
    { refetchInterval: 30_000 },
  );

  const rows: TaskMetricsRow[] = throughputData?.data ?? [];
  const chartData = buildThroughputChartData(rows);
  const failureRateData = buildFailureRateData(rows);
  const taskBreakdown = buildTaskBreakdown(rows);

  const successRate = overview
    ? overview.total_tasks > 0
      ? 1 - overview.failure_rate
      : 1
    : null;

  const handleSelectRange = useCallback((r: TimeRange) => setTimeRange(r), []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            Task throughput, failure rates, and performance
          </p>
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
          <LiveIndicator />
        </div>
      </div>

      {isError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Failed to load metrics. The API may be unreachable.
        </div>
      )}

      <PipelineHealthBanner />

      {!isLoading && !isError && overview?.total_tasks === 0 && (
        <GettingStarted />
      )}

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <SummaryCard
          title="Total tasks"
          value={overview?.total_tasks != null ? formatNumber(overview.total_tasks) : "—"}
          sub={`last ${timeRange.label}`}
          icon={<Layers className="w-5 h-5" />}
          loading={isLoading}
        />
        <SummaryCard
          title="Successful"
          value={overview?.success_count != null ? formatNumber(overview.success_count) : "—"}
          icon={<CheckCircle2 className="w-5 h-5" />}
          accent="text-emerald-400"
          loading={isLoading}
        />
        <SummaryCard
          title="Failed"
          value={overview?.failure_count != null ? formatNumber(overview.failure_count) : "—"}
          icon={<XCircle className="w-5 h-5" />}
          accent="text-red-400"
          loading={isLoading}
        />
        <SummaryCard
          title="Failure rate"
          value={overview?.failure_rate != null ? formatPercent(overview.failure_rate) : "—"}
          icon={<TrendingDown className="w-5 h-5" />}
          accent={(overview?.failure_rate ?? 0) > 0.1 ? "text-red-400" : "text-emerald-400"}
          loading={isLoading}
        />
        <SummaryCard
          title="Avg runtime"
          value={overview?.avg_runtime != null ? formatDuration(overview.avg_runtime) : "—"}
          sub={overview?.p95_runtime != null ? `p95: ${formatDuration(overview.p95_runtime)}` : undefined}
          icon={<Clock className="w-5 h-5" />}
          accent="text-yellow-400"
          loading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Task Throughput</h2>
          {isLoading || throughputLoading ? (
            <div className="h-48 rounded-lg bg-zinc-800 animate-pulse" />
          ) : chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center rounded-lg bg-zinc-800/50 border border-zinc-700/50 border-dashed">
              <p className="text-xs text-zinc-500">No data for the selected time range</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={192}>
              <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="dashSuccessGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dashFailureGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="time" tick={{ fill: "var(--chart-axis)", fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "var(--chart-axis)", fontSize: 10 }} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="success" stroke="#22c55e" fill="url(#dashSuccessGrad)" strokeWidth={2} name="Success" />
                <Area type="monotone" dataKey="failure" stroke="#ef4444" fill="url(#dashFailureGrad)" strokeWidth={2} name="Failure" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Failure Rate Over Time</h2>
          {isLoading || throughputLoading ? (
            <div className="h-48 rounded-lg bg-zinc-800 animate-pulse" />
          ) : failureRateData.length === 0 ? (
            <div className="h-48 flex items-center justify-center rounded-lg bg-zinc-800/50 border border-zinc-700/50 border-dashed">
              <p className="text-xs text-zinc-500">No data for the selected time range</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={192}>
              <LineChart data={failureRateData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="time" tick={{ fill: "var(--chart-axis)", fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis unit="%" tick={{ fill: "var(--chart-axis)", fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, "Failure Rate"]} />
                <Line type="monotone" dataKey="rate" stroke="#f97316" strokeWidth={2} dot={false} name="Failure Rate" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Recent Tasks</h2>
            <span className="text-xs text-zinc-500">Last 20 events</span>
          </div>
          <RecentTasks />
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Task Breakdown</h2>
          {throughputLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 bg-zinc-800 rounded animate-pulse" />
              ))}
            </div>
          ) : taskBreakdown.length === 0 ? (
            <div className="h-40 flex items-center justify-center rounded-lg bg-zinc-800/50 border border-zinc-700/50 border-dashed">
              <p className="text-xs text-zinc-500">No task data</p>
            </div>
          ) : (
            <div className="space-y-2">
              {taskBreakdown.slice(0, 10).map((t) => {
                const failPct = t.total > 0 ? (t.failure / t.total) * 100 : 0;
                return (
                  <div key={t.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-white truncate max-w-[60%]" title={t.name}>
                        {t.name}
                      </span>
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <span>{formatNumber(t.total)} tasks</span>
                        {failPct > 0 && (
                          <span className="text-red-400">{failPct.toFixed(1)}% fail</span>
                        )}
                      </div>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500"
                        style={{
                          width: `${Math.min(100, (t.total / (taskBreakdown[0]?.total ?? 1)) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {overview && overview.failure_count > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-300">
              {overview.failure_count} task{overview.failure_count !== 1 ? "s" : ""} failed in the
              last {timeRange.label}
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">
              Visit the Tasks page to inspect failures and retry individual tasks.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

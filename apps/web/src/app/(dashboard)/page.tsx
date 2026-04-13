"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
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
import { $api } from "@/lib/api";
import { formatDuration, formatPercent, formatNumber } from "@/lib/utils";
import { LiveIndicator } from "@/components/shared/live-indicator";
import { TopFailingTasks } from "@/components/dashboard/top-failing-tasks";
import { RecentErrors } from "@/components/dashboard/recent-errors";
import { SlowestTasks } from "@/components/dashboard/slowest-tasks";
import { WorkerLeaderboard } from "@/components/dashboard/worker-leaderboard";
import { RecentTasksSummary } from "@/components/dashboard/recent-tasks-summary";
import {
  FailureRateChart,
  ThroughputChart,
} from "@/components/dashboard/throughput-chart";

type TimeRange = { label: string; minutes: number };

const TIME_RANGES: TimeRange[] = [
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
  { label: "7d", minutes: 10080 },
];

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
    { refetchInterval: 15_000 }
  );

  if (!data || data.events_dropped === 0) return null;

  const isCritical = data.drop_rate > 0.1;

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${
        isCritical
          ? "bg-red-500/10 border-red-500/20"
          : "bg-yellow-500/10 border-yellow-500/20"
      }`}
    >
      <AlertTriangle
        className={`w-4 h-4 mt-0.5 shrink-0 ${
          isCritical ? "text-red-400" : "text-yellow-400"
        }`}
      />
      <div>
        <p
          className={`text-sm font-medium ${
            isCritical ? "text-red-300" : "text-yellow-300"
          }`}
        >
          {formatNumber(data.events_dropped)} event
          {data.events_dropped !== 1 ? "s" : ""} not saved to history
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Some events could not be stored. They were delivered live but won&apos;t
          appear in historical data.{" "}
          <Link href="/system" className="text-foreground hover:opacity-80 underline">
            View details
          </Link>
        </p>
      </div>
    </div>
  );
}

function GettingStarted() {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-8">
      <div className="text-center mb-8">
        <h2 className="text-lg font-bold text-foreground">Welcome to Feloxi</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Get started by connecting your first Celery broker
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {ONBOARDING_STEPS.map((step, i) => (
          <div
            key={step.title}
            className="flex flex-col items-center text-center p-6 rounded-xl border border-border bg-secondary/30"
          >
            <div className="w-10 h-10 rounded-xl bg-secondary/50 flex items-center justify-center mb-4">
              <step.icon className="w-5 h-5 text-foreground" />
            </div>
            <div className="text-xs font-medium text-muted-foreground mb-2">Step {i + 1}</div>
            <h3 className="text-sm font-semibold text-foreground mb-1">{step.title}</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              {step.description}
            </p>
            <Link
              href={step.href}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground bg-secondary hover:opacity-90 px-3 py-1.5 rounded-lg transition"
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

type KpiProps = {
  title: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: string;
  loading?: boolean;
};

function Kpi({
  title,
  value,
  sub,
  icon,
  accent = "text-foreground",
  loading,
}: KpiProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-start gap-4">
      <div className={`mt-0.5 ${accent}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
          {title}
        </p>
        {loading ? (
          <div className="h-7 w-20 bg-secondary rounded animate-pulse" />
        ) : (
          <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
        )}
        {sub && !loading && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
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
    { refetchInterval: 30_000 }
  );

  const handleSelectRange = useCallback((r: TimeRange) => setTimeRange(r), []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Throughput, failure clustering, and performance hotspots
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 p-1 bg-secondary rounded-lg">
            {TIME_RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => handleSelectRange(r)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                  timeRange.minutes === r.minutes
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-muted-foreground text-sm hover:text-foreground hover:opacity-80 transition"
            aria-label="Refresh"
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

      {!isLoading && !isError && overview?.total_tasks === 0 && <GettingStarted />}

      {/* KPI strip */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <Kpi
          title="Total tasks"
          value={overview?.total_tasks != null ? formatNumber(overview.total_tasks) : "—"}
          sub={`last ${timeRange.label}`}
          icon={<Layers className="w-5 h-5" />}
          loading={isLoading}
        />
        <Kpi
          title="Successful"
          value={
            overview?.success_count != null ? formatNumber(overview.success_count) : "—"
          }
          icon={<CheckCircle2 className="w-5 h-5" />}
          accent="text-emerald-400"
          loading={isLoading}
        />
        <Kpi
          title="Failed"
          value={
            overview?.failure_count != null ? formatNumber(overview.failure_count) : "—"
          }
          icon={<XCircle className="w-5 h-5" />}
          accent="text-red-400"
          loading={isLoading}
        />
        <Kpi
          title="Failure rate"
          value={
            overview?.failure_rate != null ? formatPercent(overview.failure_rate) : "—"
          }
          icon={<TrendingDown className="w-5 h-5" />}
          accent={
            (overview?.failure_rate ?? 0) > 0.1 ? "text-red-400" : "text-emerald-400"
          }
          loading={isLoading}
        />
        <Kpi
          title="Avg runtime"
          value={
            overview?.avg_runtime != null ? formatDuration(overview.avg_runtime) : "—"
          }
          sub={
            overview?.p95_runtime != null
              ? `p95: ${formatDuration(overview.p95_runtime)}`
              : undefined
          }
          icon={<Clock className="w-5 h-5" />}
          accent="text-yellow-400"
          loading={isLoading}
        />
      </div>

      {/* Trends */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ThroughputChart fromMinutes={timeRange.minutes} />
        <FailureRateChart fromMinutes={timeRange.minutes} />
      </div>

      {/* Problems */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <TopFailingTasks fromMinutes={timeRange.minutes} />
        <RecentErrors fromMinutes={timeRange.minutes} />
      </div>

      {/* Performance */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SlowestTasks fromMinutes={timeRange.minutes} />
        <WorkerLeaderboard fromMinutes={timeRange.minutes} />
      </div>

      {/* Recent activity */}
      <RecentTasksSummary />
    </div>
  );
}

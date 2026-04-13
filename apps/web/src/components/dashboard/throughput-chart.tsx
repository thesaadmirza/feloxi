"use client";

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
import { TrendingUp, TrendingDown } from "lucide-react";
import { $api } from "@/lib/api";
import {
  DashboardCard,
  DashboardCardEmpty,
  DashboardCardSkeleton,
} from "./dashboard-card";
import type { TaskMetricsRow } from "@/types/api";

const TOOLTIP_STYLE = {
  backgroundColor: "var(--chart-tooltip-bg)",
  border: "1px solid var(--chart-tooltip-border)",
  borderRadius: "8px",
  color: "var(--chart-tooltip-color)",
  fontSize: "12px",
};

function buildThroughputData(rows: TaskMetricsRow[]) {
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
      time: new Date(minute).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      ...v,
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
      time: new Date(minute).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      rate: v.total > 0 ? parseFloat(((v.failure / v.total) * 100).toFixed(2)) : 0,
    }));
}

type Props = { fromMinutes: number };

export function ThroughputChart({ fromMinutes }: Props) {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/metrics/throughput",
    { params: { query: { from_minutes: fromMinutes } } },
    { refetchInterval: 30_000 }
  );

  const rows: TaskMetricsRow[] = (data?.data ?? []) as TaskMetricsRow[];
  const chartData = buildThroughputData(rows);

  return (
    <DashboardCard title="Task Throughput" icon={<TrendingUp className="h-4 w-4" />}>
      {isLoading ? (
        <DashboardCardSkeleton rows={6} />
      ) : chartData.length === 0 ? (
        <DashboardCardEmpty message="No throughput data in this window." />
      ) : (
        <ResponsiveContainer width="100%" height={192}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
            <defs>
              <linearGradient id="throughputSuccess" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="throughputFailure" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis
              dataKey="time"
              tick={{ fill: "var(--chart-axis)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fill: "var(--chart-axis)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={30}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Area
              type="monotone"
              dataKey="success"
              stroke="#22c55e"
              fill="url(#throughputSuccess)"
              strokeWidth={2}
              name="Success"
            />
            <Area
              type="monotone"
              dataKey="failure"
              stroke="#ef4444"
              fill="url(#throughputFailure)"
              strokeWidth={2}
              name="Failure"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </DashboardCard>
  );
}

export function FailureRateChart({ fromMinutes }: Props) {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/metrics/throughput",
    { params: { query: { from_minutes: fromMinutes } } },
    { refetchInterval: 30_000 }
  );

  const rows: TaskMetricsRow[] = (data?.data ?? []) as TaskMetricsRow[];
  const chartData = buildFailureRateData(rows);

  return (
    <DashboardCard
      title="Failure Rate Over Time"
      icon={<TrendingDown className="h-4 w-4" />}
    >
      {isLoading ? (
        <DashboardCardSkeleton rows={6} />
      ) : chartData.length === 0 ? (
        <DashboardCardEmpty message="No failure data in this window." />
      ) : (
        <ResponsiveContainer width="100%" height={192}>
          <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis
              dataKey="time"
              tick={{ fill: "var(--chart-axis)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              unit="%"
              tick={{ fill: "var(--chart-axis)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: number) => [`${v}%`, "Failure Rate"]}
            />
            <Line
              type="monotone"
              dataKey="rate"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
              name="Failure Rate"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </DashboardCard>
  );
}

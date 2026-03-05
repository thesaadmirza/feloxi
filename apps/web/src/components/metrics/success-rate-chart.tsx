"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type DataPoint = {
  minute: string;
  success_count: number;
  failure_count: number;
  total_count: number;
};

type SuccessRateChartProps = {
  data: DataPoint[];
};

const TOOLTIP_STYLE = {
  backgroundColor: "#18181b",
  border: "1px solid #27272a",
  borderRadius: "8px",
  color: "#fafafa",
};

const formatTick = (v: number) => `${v}%`;
const formatTooltip = (value: string) => [`${value}%`, "Success Rate"];

export function SuccessRateChart({ data }: SuccessRateChartProps) {
  const formatted = data.map((d) => ({
    time: new Date(d.minute).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    rate:
      d.total_count > 0
        ? ((d.success_count / d.total_count) * 100).toFixed(1)
        : 100,
  }));

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={formatted}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis dataKey="time" stroke="#71717a" fontSize={12} tickLine={false} />
        <YAxis
          domain={[0, 100]}
          stroke="#71717a"
          fontSize={12}
          tickLine={false}
          tickFormatter={formatTick}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={formatTooltip} />
        <Line
          type="monotone"
          dataKey="rate"
          stroke="#22c55e"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

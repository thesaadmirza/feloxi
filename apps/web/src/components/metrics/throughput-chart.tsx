"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type DataPoint = {
  minute: string;
  success_count: number;
  failure_count: number;
  total_count: number;
};

type ThroughputChartProps = {
  data: DataPoint[];
};

const TOOLTIP_STYLE = {
  backgroundColor: "#18181b",
  border: "1px solid #27272a",
  borderRadius: "8px",
  color: "#fafafa",
};

export function ThroughputChart({ data }: ThroughputChartProps) {
  const formatted = data.map((d) => ({
    ...d,
    time: new Date(d.minute).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
        No throughput data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={formatted}>
        <defs>
          <linearGradient id="colorSuccess" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorFailure" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis dataKey="time" stroke="#71717a" fontSize={12} tickLine={false} />
        <YAxis stroke="#71717a" fontSize={12} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend />
        <Area
          type="monotone"
          dataKey="success_count"
          name="Success"
          stroke="#22c55e"
          fillOpacity={1}
          fill="url(#colorSuccess)"
        />
        <Area
          type="monotone"
          dataKey="failure_count"
          name="Failure"
          stroke="#ef4444"
          fillOpacity={1}
          fill="url(#colorFailure)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

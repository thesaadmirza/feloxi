"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";

export type OutcomePoint = { time: string; success: number; failure: number };

const AXIS_TICK = { fill: "var(--t3)", fontSize: 10.5, fontFamily: "var(--font-mono)" };

function OutcomeTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as OutcomePoint;
  return (
    <div className="rounded-lg border border-line-strong bg-raised px-3 py-2 text-xs shadow-float">
      <div className="mb-1 font-mono text-[11px] text-t3">{label}</div>
      <div className="flex flex-col gap-0.5 tabular-nums">
        <span className="text-t2">
          Succeeded <b className="font-semibold text-foreground">{row.success.toLocaleString()}</b>
        </span>
        <span className={row.failure > 0 ? "text-fail" : "text-t2"}>
          Failed <b className="font-semibold">{row.failure.toLocaleString()}</b>
        </span>
      </div>
    </div>
  );
}

export function OutcomeLegend({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="size-[9px] rounded-[2px]" style={{ background: color }} aria-hidden />
      <span className="text-t2">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">{value.toLocaleString()}</span>
    </span>
  );
}

/// Succeeded and failed tasks per minute as two soft areas. Colours come from
/// the theme tokens so both themes read the same.
export function OutcomeAreaChart({
  data,
  height = 200,
}: {
  data: OutcomePoint[];
  height?: number;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 26, bottom: 0, left: -14 }}>
        <defs>
          <linearGradient id={`${id}-ok`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--ok)", stopOpacity: 0.22 }} />
            <stop offset="100%" style={{ stopColor: "var(--ok)", stopOpacity: 0 }} />
          </linearGradient>
          <linearGradient id={`${id}-fail`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--fail)", stopOpacity: 0.28 }} />
            <stop offset="100%" style={{ stopColor: "var(--fail)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="time" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={44}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: "var(--line-strong)" }}
          content={<OutcomeTooltip />}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="success"
          stroke="var(--ok)"
          fill={`url(#${id}-ok)`}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="failure"
          stroke="var(--fail)"
          fill={`url(#${id}-fail)`}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

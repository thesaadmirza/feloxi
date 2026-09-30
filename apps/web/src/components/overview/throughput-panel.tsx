"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/shared/skeleton";
import { FlatPulse } from "@/components/ui/pulse";
import { bucketIndex, perBucketLabel, type Bucket } from "@/lib/series";

const AXIS_TICK = { fill: "var(--t3)", fontSize: 10, fontFamily: "var(--font-mono)" };

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="size-[9px] rounded-[2px]" style={{ background: color }} aria-hidden />
      <span className="text-t2">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">{value.toLocaleString()}</span>
    </span>
  );
}

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Bucket;
  return (
    <div className="rounded-lg border border-line-strong bg-raised px-3 py-2 text-xs shadow-float">
      <div className="mb-1 font-mono text-[11px] text-t3">{label}</div>
      <div className="flex flex-col gap-0.5 tabular-nums">
        <span className="text-t2">
          Succeeded{" "}
          <b className="font-semibold text-foreground">{row.succeeded.toLocaleString()}</b>
        </span>
        {row.retried > 0 && (
          <span className="text-warn">
            Retried <b className="font-semibold">{row.retried.toLocaleString()}</b>
          </span>
        )}
        {row.failed > 0 && (
          <span className="text-fail">
            Failed <b className="font-semibold">{row.failed.toLocaleString()}</b>
          </span>
        )}
      </div>
    </div>
  );
}

export type ChartBand = { from: number; label: string };

export function ThroughputPanel({
  buckets,
  loading,
  rangeLabel,
  band,
}: {
  buckets: Bucket[];
  loading: boolean;
  rangeLabel: string;
  band?: ChartBand | null;
}) {
  const totals = buckets.reduce(
    (acc, b) => ({ s: acc.s + b.succeeded, r: acc.r + b.retried, f: acc.f + b.failed }),
    { s: 0, r: 0, f: 0 },
  );
  const empty = !loading && totals.s + totals.r + totals.f === 0;
  const per = perBucketLabel(buckets.length > 1 ? buckets[1].t - buckets[0].t : 60_000);
  const bandFrom = band ? buckets[bucketIndex(buckets, band.from)]?.label : undefined;
  const last = buckets[buckets.length - 1]?.label;

  return (
    <Panel aria-label="Tasks by outcome">
      <PanelHeader
        title={`Tasks per ${per}`}
        subtitle={`last ${rangeLabel}, by outcome`}
        action={
          <div className="hidden items-center gap-4 sm:flex">
            <Legend color="var(--bar)" label="Succeeded" value={totals.s} />
            <Legend color="var(--warn)" label="Retried" value={totals.r} />
            <Legend color="var(--fail)" label="Failed" value={totals.f} />
          </div>
        }
      />
      <div className="px-2 pb-3">
        {loading ? (
          <Skeleton className="mx-2 h-[180px] w-[calc(100%-16px)]" />
        ) : empty ? (
          <div className="flex h-[180px] flex-col items-center justify-center gap-2 text-center">
            <FlatPulse />
            <span className="text-[13px] text-t3">No tasks finished in the last {rangeLabel}.</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={buckets}
              barCategoryGap="14%"
              margin={{ top: 22, right: 8, bottom: 0, left: -14 }}
            >
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                interval={Math.max(0, Math.ceil(buckets.length / 6) - 1)}
                minTickGap={12}
              />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={44}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "var(--hover)" }}
                content={<ChartTooltip />}
                isAnimationActive={false}
              />
              {band && bandFrom && last && (
                <ReferenceArea
                  x1={bandFrom}
                  x2={last}
                  fill="var(--fail-wash)"
                  fillOpacity={1}
                  ifOverflow="extendDomain"
                  label={{
                    value: band.label,
                    position: "insideTopRight",
                    fill: "var(--fail)",
                    fontSize: 11,
                    fontWeight: 600,
                    dy: -18,
                  }}
                />
              )}
              <Bar dataKey="succeeded" stackId="o" fill="var(--bar)" isAnimationActive={false} />
              <Bar dataKey="retried" stackId="o" fill="var(--warn)" isAnimationActive={false} />
              <Bar dataKey="failed" stackId="o" fill="var(--fail)" isAnimationActive={false} />
              {last && (
                <ReferenceLine
                  x={last}
                  stroke="var(--amber)"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
}

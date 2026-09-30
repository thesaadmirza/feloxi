"use client";

import { useState } from "react";
import { format } from "date-fns";
import { bucketWidthLabel, type Bucket } from "@/lib/series";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/shared/skeleton";

export type Segment = {
  key: "succeeded" | "failed" | "retried" | "revoked";
  label: string;
  color: string;
};

export const SEGMENTS: Record<Segment["key"], Segment> = {
  succeeded: { key: "succeeded", label: "succeeded", color: "var(--bar)" },
  retried: { key: "retried", label: "retried", color: "var(--warn)" },
  revoked: { key: "revoked", label: "revoked", color: "var(--t4)" },
  failed: { key: "failed", label: "failed", color: "var(--fail)" },
};

/// Compact outcome histogram above the task list. Bars stack bottom-up in
/// `segments` order; clicking one narrows the list to that bucket.
export function TaskHistogram({
  title,
  buckets,
  segments,
  loading,
  endsNow,
  note,
  onZoom,
}: {
  title: string;
  buckets: Bucket[];
  segments: Segment[];
  loading?: boolean;
  endsNow: boolean;
  note?: React.ReactNode;
  onZoom?: (from: number, to: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const step = buckets.length > 1 ? buckets[1].t - buckets[0].t : 60_000;
  const sums = buckets.map((b) => segments.reduce((n, s) => n + b[s.key], 0));
  const max = Math.max(1, ...sums);
  const total = sums.reduce((a, b) => a + b, 0);
  const long = buckets.length > 0 && buckets[buckets.length - 1].t - buckets[0].t > 24 * 3_600_000;
  const fmt = (t: number) => format(t, long ? "MMM d HH:mm" : "HH:mm");
  const ticks = [0, 0.25, 0.5, 0.75].map((f) =>
    Math.min(buckets.length - 1, Math.round(f * (buckets.length - 1))),
  );
  const h = hover != null ? buckets[hover] : null;

  return (
    <Panel className="px-4 pt-3 pb-2.5">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="label truncate">{title}</span>
        <span className="ml-auto shrink-0 truncate text-[11.5px] text-t3">
          {h ? (
            <span className="tabular-nums text-t2">
              {fmt(h.t)}–{format(h.t + step, "HH:mm")} ·{" "}
              {segments
                .map((s) => ({ s, n: h[s.key] }))
                .filter(({ n }, i, all) => n > 0 || all.length === 1)
                .map(({ s, n }) => `${n.toLocaleString()} ${s.label}`)
                .join(" · ") || "no tasks"}
            </span>
          ) : (
            <>
              {bucketWidthLabel(step)} buckets
              {onZoom && total > 0 && (
                <span className="hidden sm:inline"> · click a bar to zoom</span>
              )}
              {note && <> · {note}</>}
            </>
          )}
        </span>
      </div>

      {loading ? (
        <Skeleton className="mt-2.5 h-14 w-full" />
      ) : (
        <div
          role="img"
          aria-label={`${title}: ${total.toLocaleString()} in ${buckets.length} ${bucketWidthLabel(step)} buckets`}
          className="mt-2.5 flex h-14 items-end gap-[2px] border-b border-line"
          onMouseLeave={() => setHover(null)}
        >
          {buckets.map((b, i) => (
            <div
              key={b.t}
              className={`flex h-full min-w-0 flex-1 flex-col-reverse ${onZoom && sums[i] > 0 ? "cursor-zoom-in" : ""}`}
              onMouseEnter={() => setHover(i)}
              onClick={() => onZoom && sums[i] > 0 && onZoom(b.t, b.t + step)}
            >
              {segments.map((s) => {
                const n = b[s.key];
                if (n <= 0) return null;
                return (
                  <div
                    key={s.key}
                    className="w-full last:rounded-t-[1.5px]"
                    style={{
                      height: `${Math.max((n / max) * 100, 2)}%`,
                      background: s.color,
                      opacity: hover == null || hover === i ? 1 : 0.55,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="relative mt-1.5 h-3.5 font-mono text-[10.5px] text-t3">
        {buckets.length > 0 &&
          ticks.map((i, k) => (
            <span
              key={k}
              className="absolute top-0 whitespace-nowrap"
              style={{
                left: `${(i / buckets.length) * 100}%`,
                transform: k === 0 ? undefined : "translateX(-50%)",
              }}
            >
              {fmt(buckets[i].t)}
            </span>
          ))}
        {buckets.length > 0 && (
          <span className="absolute top-0 right-0">
            {endsNow ? "now" : fmt(buckets[buckets.length - 1].t + step)}
          </span>
        )}
      </div>
    </Panel>
  );
}

import { format } from "date-fns";
import type { TaskMetricsRow } from "@/types/api";

export type Bucket = {
  t: number;
  label: string;
  succeeded: number;
  failed: number;
  retried: number;
  revoked: number;
  total: number;
  /// Sum of runtimes of tasks that finished in the bucket, in seconds.
  runtime: number;
};

/// Groups per-minute metric rows into about `target` equal buckets covering
/// the last `fromMinutes`, so a 7-day window still draws ~60 bars.
export function bucketize(
  rows: TaskMetricsRow[],
  fromMinutes: number,
  now = Date.now(),
  target = 60,
): Bucket[] {
  return bucketizeRange(rows, now - fromMinutes * 60_000, now, target);
}

// Bucket widths people read at a glance, in minutes.
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440];

/// Smallest readable width of at least `minutes` (so ~`target` bars at most).
function niceStep(minutes: number): number {
  return STEPS.find((s) => s >= minutes) ?? Math.ceil(minutes / 1440) * 1440;
}

/// Same as `bucketize` for an explicit [start, end] window.
export function bucketizeRange(
  rows: TaskMetricsRow[],
  start: number,
  end: number,
  target = 60,
): Bucket[] {
  const minutes = Math.max(1, Math.round((end - start) / 60_000));
  const bucketMs = niceStep(minutes / target) * 60_000;
  const first = Math.floor(start / bucketMs) * bucketMs;
  const n = Math.max(1, Math.ceil((end - first) / bucketMs));
  const long = minutes > 24 * 60;
  const buckets: Bucket[] = Array.from({ length: n }, (_, i) => {
    const t = first + i * bucketMs;
    return {
      t,
      label: format(t, long ? "MMM d HH:mm" : "HH:mm"),
      succeeded: 0,
      failed: 0,
      retried: 0,
      revoked: 0,
      total: 0,
      runtime: 0,
    };
  });
  for (const r of rows) {
    const i = Math.floor((r.minute - first) / bucketMs);
    if (i < 0 || i >= n) continue;
    const b = buckets[i];
    b.succeeded += r.success_count;
    b.failed += r.failure_count;
    b.retried += r.retry_count;
    b.revoked += r.revoked_count;
    b.total += r.total_count;
    b.runtime += r.total_runtime;
  }
  return buckets;
}

/// "1-min", "30-min", "2-hour" for a bucket width in ms.
export function bucketWidthLabel(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60 || min % 60 !== 0) return `${min}-min`;
  const h = min / 60;
  return h % 24 === 0 ? `${h / 24}-day` : `${h}-hour`;
}

export function bucketIndex(buckets: Bucket[], t: number): number {
  if (buckets.length === 0) return -1;
  const step = buckets.length > 1 ? buckets[1].t - buckets[0].t : 60_000;
  const i = Math.floor((t - buckets[0].t) / step);
  return Math.min(Math.max(i, 0), buckets.length - 1);
}

/// "minute", "30 min", "hour", "3 hours", "day" for chart titles.
export function perBucketLabel(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min <= 1) return "minute";
  if (min < 60) return `${min} min`;
  if (min === 60) return "hour";
  if (min % 1440 === 0) return min === 1440 ? "day" : `${min / 1440} days`;
  return `${Math.round(min / 60)} hours`;
}

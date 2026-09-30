import { describe, it, expect } from "vitest";
import { bucketize, bucketizeRange, bucketWidthLabel, perBucketLabel } from "../series";
import type { TaskMetricsRow } from "@/types/api";

const MIN = 60_000;

function row(minute: number, counts: Partial<TaskMetricsRow> = {}): TaskMetricsRow {
  return {
    tenant_id: "t",
    task_name: "tasks.a",
    queue: "default",
    minute,
    success_count: 0,
    failure_count: 0,
    retry_count: 0,
    revoked_count: 0,
    total_count: 0,
    total_runtime: 0,
    max_runtime: 0,
    total_wait_time: 0,
    wait_time_samples: 0,
    ...counts,
  };
}

describe("bucketizeRange", () => {
  it("uses readable widths instead of range / target", () => {
    const end = Date.UTC(2026, 8, 30, 12, 0);
    const day = bucketizeRange([], end - 24 * 60 * MIN, end, 60);
    expect(day[1].t - day[0].t).toBe(30 * MIN);
    const week = bucketizeRange([], end - 7 * 24 * 60 * MIN, end, 60);
    expect(week[1].t - week[0].t).toBe(180 * MIN);
    const hour = bucketizeRange([], end - 60 * MIN, end, 60);
    expect(hour[1].t - hour[0].t).toBe(MIN);
  });

  it("sums every outcome into the bucket its minute falls in", () => {
    const end = Date.UTC(2026, 8, 30, 12, 0);
    const start = end - 60 * MIN;
    const buckets = bucketizeRange(
      [
        row(start + 5 * MIN, {
          success_count: 3,
          failure_count: 1,
          total_count: 4,
          total_runtime: 2,
        }),
        row(start + 5 * MIN, { retry_count: 2, revoked_count: 1, total_count: 3 }),
      ],
      start,
      end,
    );
    const b = buckets.find((x) => x.t === start + 5 * MIN)!;
    expect(b).toMatchObject({
      succeeded: 3,
      failed: 1,
      retried: 2,
      revoked: 1,
      total: 7,
      runtime: 2,
    });
  });

  it("drops rows outside the window", () => {
    const end = Date.UTC(2026, 8, 30, 12, 0);
    const buckets = bucketizeRange([row(end + 10 * MIN, { total_count: 9 })], end - 60 * MIN, end);
    expect(buckets.reduce((n, b) => n + b.total, 0)).toBe(0);
  });

  it("matches bucketize for a trailing window", () => {
    const now = Date.UTC(2026, 8, 30, 12, 0);
    expect(bucketize([], 360, now).map((b) => b.t)).toEqual(
      bucketizeRange([], now - 360 * MIN, now).map((b) => b.t),
    );
  });
});

describe("bucket labels", () => {
  it("names widths", () => {
    expect(bucketWidthLabel(MIN)).toBe("1-min");
    expect(bucketWidthLabel(30 * MIN)).toBe("30-min");
    expect(bucketWidthLabel(180 * MIN)).toBe("3-hour");
    expect(bucketWidthLabel(1440 * MIN)).toBe("1-day");
  });

  it("phrases chart titles", () => {
    expect(perBucketLabel(MIN)).toBe("minute");
    expect(perBucketLabel(10 * MIN)).toBe("10 min");
    expect(perBucketLabel(60 * MIN)).toBe("hour");
    expect(perBucketLabel(720 * MIN)).toBe("12 hours");
    expect(perBucketLabel(1440 * MIN)).toBe("day");
  });
});

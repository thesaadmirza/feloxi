import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cn,
  formatDuration,
  formatNumber,
  formatPercent,
  truncateId,
  taskStateBadgeClass,
  timeAgo,
} from "../utils";

// ─────────────────────────────────────────────────────────────────────────────
// cn()
// ─────────────────────────────────────────────────────────────────────────────
describe("cn()", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("resolves Tailwind conflicts (last wins)", () => {
    const result = cn("px-2 py-1", "px-4");
    expect(result).toBe("py-1 px-4");
  });

  it("handles empty inputs", () => {
    expect(cn()).toBe("");
  });

  it("handles undefined and null values", () => {
    expect(cn("a", undefined, null, "b")).toBe("a b");
  });

  it("handles array inputs", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("handles object inputs", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });

  it("handles mixed inputs", () => {
    expect(cn("a", ["b", "c"], { d: true, e: false })).toBe("a b c d");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDuration()
// ─────────────────────────────────────────────────────────────────────────────
describe("formatDuration()", () => {
  it("formats sub-microsecond as microseconds", () => {
    // 0 seconds -> 0μs
    expect(formatDuration(0)).toBe("0μs");
  });

  it("formats microseconds", () => {
    expect(formatDuration(0.000500)).toBe("500μs");
  });

  it("formats a very small sub-millisecond value", () => {
    expect(formatDuration(0.0001)).toBe("100μs");
  });

  it("formats milliseconds", () => {
    expect(formatDuration(0.5)).toBe("500.0ms");
  });

  it("formats sub-second correctly", () => {
    expect(formatDuration(0.123)).toBe("123.0ms");
  });

  it("formats boundary at 1ms", () => {
    expect(formatDuration(0.001)).toBe("1.0ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(5)).toBe("5.00s");
  });

  it("formats seconds with decimals", () => {
    expect(formatDuration(12.345)).toBe("12.35s");
  });

  it("formats exactly 1 second", () => {
    expect(formatDuration(1)).toBe("1.00s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(90)).toBe("1m 30s");
  });

  it("formats exact minutes", () => {
    expect(formatDuration(120)).toBe("2m 0s");
  });

  it("formats 60 seconds as 1m 0s", () => {
    expect(formatDuration(60)).toBe("1m 0s");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3661)).toBe("1h 1m");
  });

  it("formats exactly 1 hour", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
  });

  it("formats multiple hours", () => {
    expect(formatDuration(7200)).toBe("2h 0m");
  });

  it("formats large durations", () => {
    expect(formatDuration(86400)).toBe("24h 0m");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatNumber()
// ─────────────────────────────────────────────────────────────────────────────
describe("formatNumber()", () => {
  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("formats small numbers as-is", () => {
    expect(formatNumber(42)).toBe("42");
    expect(formatNumber(999)).toBe("999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatNumber(1000)).toBe("1.0K");
    expect(formatNumber(1500)).toBe("1.5K");
    expect(formatNumber(999999)).toBe("1000.0K");
  });

  it("formats millions with M suffix", () => {
    expect(formatNumber(1000000)).toBe("1.0M");
    expect(formatNumber(2500000)).toBe("2.5M");
  });

  it("formats negative numbers as-is", () => {
    expect(formatNumber(-5)).toBe("-5");
  });

  it("formats decimal numbers", () => {
    expect(formatNumber(3.14)).toBe("3.14");
  });

  it("formats numbers just below 1000", () => {
    expect(formatNumber(999)).toBe("999");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatPercent()
// ─────────────────────────────────────────────────────────────────────────────
describe("formatPercent()", () => {
  it("formats 0%", () => {
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("formats 50%", () => {
    expect(formatPercent(0.5)).toBe("50.0%");
  });

  it("formats 100%", () => {
    expect(formatPercent(1)).toBe("100.0%");
  });

  it("formats fractional percentages", () => {
    expect(formatPercent(0.123)).toBe("12.3%");
  });

  it("formats values greater than 100%", () => {
    expect(formatPercent(1.5)).toBe("150.0%");
  });

  it("formats very small percentages", () => {
    expect(formatPercent(0.001)).toBe("0.1%");
  });

  it("formats negative percentages", () => {
    expect(formatPercent(-0.05)).toBe("-5.0%");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// truncateId()
// ─────────────────────────────────────────────────────────────────────────────
describe("truncateId()", () => {
  it("does not truncate short IDs", () => {
    expect(truncateId("abc")).toBe("abc");
  });

  it("does not truncate IDs at exact boundary length", () => {
    expect(truncateId("12345678")).toBe("12345678");
  });

  it("truncates long IDs", () => {
    expect(truncateId("abcdefghij")).toBe("abcdefgh...");
  });

  it("truncates with custom length", () => {
    expect(truncateId("abcdefghij", 4)).toBe("abcd...");
  });

  it("handles empty string", () => {
    expect(truncateId("")).toBe("");
  });

  it("handles single character", () => {
    expect(truncateId("a")).toBe("a");
  });

  it("handles UUID-like strings", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(truncateId(uuid)).toBe("550e8400...");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// taskStateBadgeClass()
// ─────────────────────────────────────────────────────────────────────────────
describe("taskStateBadgeClass()", () => {
  const states = [
    "PENDING",
    "RECEIVED",
    "STARTED",
    "SUCCESS",
    "FAILURE",
    "RETRY",
    "REVOKED",
    "REJECTED",
  ];

  for (const state of states) {
    it(`returns correct class for ${state}`, () => {
      expect(taskStateBadgeClass(state)).toBe(
        `badge-${state.toLowerCase()}`
      );
    });
  }

  it("handles already lowercase input", () => {
    expect(taskStateBadgeClass("pending")).toBe("badge-pending");
  });

  it("handles mixed case input", () => {
    expect(taskStateBadgeClass("Success")).toBe("badge-success");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// timeAgo()
// ─────────────────────────────────────────────────────────────────────────────
describe("timeAgo()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats "just now" (seconds ago)', () => {
    const date = new Date("2024-06-15T11:59:50Z").toISOString();
    expect(timeAgo(date)).toBe("10s ago");
  });

  it("formats 0 seconds ago", () => {
    const date = new Date("2024-06-15T12:00:00Z").toISOString();
    expect(timeAgo(date)).toBe("0s ago");
  });

  it("formats minutes ago", () => {
    const date = new Date("2024-06-15T11:55:00Z").toISOString();
    expect(timeAgo(date)).toBe("5m ago");
  });

  it("formats 1 minute ago", () => {
    const date = new Date("2024-06-15T11:59:00Z").toISOString();
    expect(timeAgo(date)).toBe("1m ago");
  });

  it("formats hours ago", () => {
    const date = new Date("2024-06-15T09:00:00Z").toISOString();
    expect(timeAgo(date)).toBe("3h ago");
  });

  it("formats 1 hour ago", () => {
    const date = new Date("2024-06-15T11:00:00Z").toISOString();
    expect(timeAgo(date)).toBe("1h ago");
  });

  it("formats days ago", () => {
    const date = new Date("2024-06-13T12:00:00Z").toISOString();
    expect(timeAgo(date)).toBe("2d ago");
  });

  it("formats 1 day ago", () => {
    const date = new Date("2024-06-14T12:00:00Z").toISOString();
    expect(timeAgo(date)).toBe("1d ago");
  });

  it("formats weeks ago as days", () => {
    const date = new Date("2024-06-01T12:00:00Z").toISOString();
    expect(timeAgo(date)).toBe("14d ago");
  });

  it("formats months ago as days", () => {
    const date = new Date("2024-04-15T12:00:00Z").toISOString();
    expect(timeAgo(date)).toBe("61d ago");
  });
});

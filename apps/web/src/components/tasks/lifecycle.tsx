"use client";

import { Fragment } from "react";
import { format } from "date-fns";
import { stateLabel } from "@/components/shared/state-badge";
import { cn, formatDuration } from "@/lib/utils";
import type { TaskEvent } from "@/types/api";

const END_TYPES = new Set(["task-succeeded", "task-failed", "task-revoked", "task-rejected"]);

export type Lifecycle = {
  queuedAt: number | null;
  queuedBy: "sent" | "received" | null;
  receivedAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  endState: string | null;
  /// Seconds between publish (or receipt) and start; null until it starts.
  wait: number | null;
  /// Seconds of execution; the task's own runtime when it reported one.
  run: number | null;
};

/// Reads the last attempt's milestones from the raw event timeline.
export function lifecycleOf(timeline: TaskEvent[], runtime?: number | null): Lifecycle {
  const events = [...timeline].sort((a, b) => a.timestamp - b.timestamp);
  const last = (type: string) =>
    [...events].reverse().find((e) => e.event_type === type)?.timestamp ?? null;
  const sent = events.find((e) => e.event_type === "task-sent")?.timestamp ?? null;
  const receivedAt = last("task-received");
  const startedAt = last("task-started");
  const end = [...events].reverse().find((e) => END_TYPES.has(e.event_type));
  const endedAt = end && (startedAt == null || end.timestamp >= startedAt) ? end.timestamp : null;
  const queuedAt = sent ?? receivedAt;
  const wait =
    startedAt != null && queuedAt != null ? Math.max(0, (startedAt - queuedAt) / 1000) : null;
  const run =
    runtime && runtime > 0
      ? runtime
      : startedAt != null && endedAt != null
        ? Math.max(0, (endedAt - startedAt) / 1000)
        : null;
  return {
    queuedAt,
    queuedBy: sent != null ? "sent" : receivedAt != null ? "received" : null,
    receivedAt,
    startedAt,
    endedAt,
    endState: endedAt != null && end ? end.state : null,
    wait,
    run,
  };
}

const TONE: Record<string, { text: string; box: string }> = {
  SUCCESS: { text: "text-ok", box: "border-ok/60 bg-ok-wash" },
  FAILURE: { text: "text-fail", box: "border-fail/60 bg-fail-wash" },
  REJECTED: { text: "text-fail", box: "border-fail/60 bg-fail-wash" },
  REVOKED: { text: "text-t2", box: "border-line-strong bg-raised" },
};

const HATCH = {
  background: "repeating-linear-gradient(135deg, var(--raised) 0 6px, var(--hover) 6px 12px)",
};

const clock = (ms: number) => format(ms, "HH:mm:ss.SSS");

/// Publish → start → finish as one proportional bar: the hatched part is
/// time spent waiting, the outlined part time spent running.
export function LifecycleBar({
  life,
  state,
  now,
}: {
  life: Lifecycle;
  state: string;
  now: number;
}) {
  const { queuedAt, startedAt, endedAt } = life;
  if (queuedAt == null && startedAt == null) return null;

  const running = startedAt != null && endedAt == null;
  const waiting = startedAt == null && endedAt == null;
  const waitS =
    life.wait ??
    (queuedAt != null ? Math.max(0, ((startedAt ?? endedAt ?? now) - queuedAt) / 1000) : 0);
  const runS =
    life.run ?? (startedAt != null ? Math.max(0, ((endedAt ?? now) - startedAt) / 1000) : 0);
  const total = waitS + runS;
  const waitPct =
    total > 0
      ? Math.min(98, Math.max(startedAt != null ? 2 : 100, (waitS / total) * 100))
      : startedAt != null
        ? 0
        : 100;
  const tone = TONE[life.endState ?? ""] ?? { text: "text-run", box: "border-run/60 bg-run-wash" };
  const endLabel = life.endState ? stateLabel(life.endState) : null;

  const marks: { label: string; at: string; note?: string; tone?: string; end?: boolean }[] = [];
  if (queuedAt != null) {
    marks.push({
      label: life.queuedBy === "sent" ? "Sent" : "Received",
      at: clock(queuedAt),
      note:
        life.queuedBy === "sent" && life.receivedAt != null
          ? `received ${formatDuration(Math.max(0, (life.receivedAt - queuedAt) / 1000))} later`
          : undefined,
    });
  }
  if (startedAt != null) marks.push({ label: "Started", at: clock(startedAt) });
  marks.push(
    endedAt != null && endLabel
      ? { label: endLabel, at: clock(endedAt), tone: tone.text, end: true }
      : { label: stateLabel(state), at: "now", tone: "text-t2", end: true },
  );

  return (
    <div>
      <div className="flex h-9 gap-1 overflow-hidden rounded-md">
        {queuedAt != null && waitPct > 0 && (
          <div
            className="flex min-w-0 items-center rounded-md border border-line-strong px-2.5 text-xs whitespace-nowrap text-t2"
            style={{ ...HATCH, width: `${waitPct}%` }}
            title={`Waited ${formatDuration(waitS)}`}
          >
            {waitPct >= 14 && (
              <span className="truncate">
                {waiting ? "Waiting in queue" : "Waited in queue"} · {formatDuration(waitS)}
                {waiting && " so far"}
              </span>
            )}
          </div>
        )}
        {startedAt != null && (
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center rounded-md border px-2.5 text-xs font-[550] whitespace-nowrap",
              tone.box,
              tone.text,
              running && "animate-pulse",
            )}
            title={`Ran ${formatDuration(runS)}`}
          >
            {100 - waitPct >= 14 && (
              <span className="truncate">
                {running ? "Running" : "Ran"} · {formatDuration(runS)}
                {running && " so far"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Milestones: under the bar on wide screens, a list on phones. */}
      <div className="relative mt-2 hidden min-h-9 text-xs sm:flex">
        {marks.map((m, i) => (
          <div
            key={m.label}
            className={cn(
              "min-w-0",
              i === 0 ? "" : m.end ? "ml-auto text-right" : "absolute top-0 pl-1",
            )}
            style={
              !m.end && i > 0 ? { left: `${Math.min(Math.max(waitPct, 24), 68)}%` } : undefined
            }
          >
            <div className={cn("truncate font-[550]", m.tone ?? "text-foreground")}>
              {m.label}
              {m.note && <span className="font-normal text-t3"> · {m.note}</span>}
            </div>
            <div className="font-mono text-[11.5px] text-t3">{m.at}</div>
          </div>
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs sm:hidden">
        {marks.map((m) => (
          <Fragment key={m.label}>
            <dt className={cn("font-[550]", m.tone ?? "text-foreground")}>{m.label}</dt>
            <dd className="font-mono text-[11.5px] text-t3">{m.at}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

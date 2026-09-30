"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BellOff, Check, CircleCheck, Pencil, X } from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { bucketizeRange } from "@/lib/series";
import { cn, formatDuration } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/shared/empty-state";
import { Pagination } from "@/components/shared/pagination";
import { Skeleton } from "@/components/shared/skeleton";
import { SeverityChip } from "@/components/overview/attention-strip";
import type { AlertHistory, AlertRule, TaskMetricsRow } from "@/types/api";
import { deliveryLabel, ruleTaskName } from "./model";

const clock = (iso: string) => format(new Date(iso), "HH:mm");

function duration(inc: AlertHistory, now: number): number {
  return ((inc.resolved_at ? Date.parse(inc.resolved_at) : now) - Date.parse(inc.fired_at)) / 1000;
}

/// Rounded "8m 12s" style duration, no milliseconds.
function span(seconds: number): string {
  return formatDuration(seconds < 60 ? Math.round(seconds) : seconds);
}

function Deliveries({ channels }: { channels: AlertHistory["channels_sent"] }) {
  const entries = Object.entries(channels ?? {});
  if (entries.length === 0) return <span className="text-t3">No channels notified</span>;
  return (
    <>
      {entries.map(([key, info], i) => (
        <span
          key={key}
          className={cn("inline-flex items-center gap-1", info.success ? "text-t3" : "text-fail")}
        >
          {i > 0 && <span className="mr-1 text-t4">·</span>}
          {info.success ? (
            <Check className="size-3" aria-hidden />
          ) : (
            <X className="size-3" aria-hidden />
          )}
          {deliveryLabel(key)}
          {!info.success && <span> failed</span>}
        </span>
      ))}
    </>
  );
}

function IncidentRow({
  inc,
  name,
  selected,
  now,
  onSelect,
}: {
  inc: AlertHistory;
  name: string;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  const firing = !inc.resolved_at;
  return (
    <li className="border-t border-line-soft">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-hover sm:grid-cols-[96px_minmax(0,1fr)_auto]",
          selected && "bg-hover shadow-[inset_2px_0_0_var(--amber)]",
        )}
      >
        <span className="col-start-1 row-start-1 sm:pt-px">
          {firing ? (
            <SeverityChip severity={inc.severity} />
          ) : (
            <Chip tone="ok" icon={<CircleCheck />}>
              Resolved
            </Chip>
          )}
        </span>
        <span className="col-span-2 col-start-1 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
          <span className={cn("block truncate font-[550]", firing ? "text-foreground" : "text-t2")}>
            {name}
          </span>
          <span className="mt-0.5 block text-[13px] text-t2">{inc.summary}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1 text-xs">
            <Deliveries channels={inc.channels_sent} />
          </span>
        </span>
        <span className="col-start-2 row-start-1 text-right sm:col-start-3">
          <span
            className={cn(
              "block font-semibold tabular-nums",
              firing
                ? inc.severity === "critical"
                  ? "text-fail"
                  : "text-warn"
                : "text-foreground",
            )}
          >
            {span(duration(inc, now))}
          </span>
          <span className="block text-xs whitespace-nowrap text-t3 tabular-nums">
            {firing
              ? `since ${clock(inc.fired_at)}`
              : `${clock(inc.fired_at)} → ${clock(inc.resolved_at!)}`}
          </span>
        </span>
      </button>
    </li>
  );
}

const DETAIL_LABELS: Record<string, string> = {
  failure_rate: "Failure rate",
  threshold: "Threshold",
  window_minutes: "Window",
  recent_failures: "Failures in window",
  task_name: "Task",
  workers_offline_count: "Workers offline",
  grace_period_seconds: "Grace period",
};

function detailValue(key: string, v: unknown): string {
  if (typeof v === "number") {
    if (/rate|threshold/.test(key) && v >= 0 && v <= 1) return `${(v * 100).toFixed(1)}%`;
    if (key.endsWith("_minutes")) return `${v} min`;
    if (key.endsWith("_seconds") || key.endsWith("_secs")) return `${v}s`;
    return v.toLocaleString();
  }
  if (typeof v === "string") return v === "*" ? "all tasks" : v;
  return JSON.stringify(v);
}

/// Failure rate around the incident with the rule's threshold, for rate rules
/// that fired in the last day.
function RateChart({ inc, rule, now }: { inc: AlertHistory; rule: AlertRule; now: number }) {
  const cond = rule.condition as { type: string; threshold?: number; task_name?: string };
  const fired = Date.parse(inc.fired_at);
  const end = inc.resolved_at ? Math.min(now, Date.parse(inc.resolved_at) + 15 * 60_000) : now;
  const start = fired - 30 * 60_000;
  const minutes = Math.ceil((now - start) / 60_000) + 1;
  const enabled = cond.type === "task_failure_rate" && now - fired < 24 * 3_600_000;
  const { data } = $api.useQuery(
    "get",
    "/api/v1/metrics/throughput",
    { params: { query: { from_minutes: minutes } } },
    { enabled, staleTime: 30_000 },
  );

  const series = useMemo(() => {
    const task = cond.task_name && cond.task_name !== "*" ? cond.task_name : null;
    const rows = ((data?.data ?? []) as TaskMetricsRow[]).filter(
      (r) => !task || r.task_name === task,
    );
    return bucketizeRange(rows, start, end, 48).map((b) => {
      const done = b.succeeded + b.failed;
      return { t: b.t, rate: done > 0 ? b.failed / done : 0 };
    });
  }, [data, cond.task_name, start, end]);

  if (!enabled || !data || series.length < 2) return null;
  const threshold = cond.threshold ?? 0.1;
  const max = Math.max(threshold * 1.4, ...series.map((p) => p.rate)) || 1;
  const w = 100;
  const h = 64;
  const x = (i: number) => (i / (series.length - 1)) * w;
  const y = (v: number) => h - 2 - (v / max) * (h - 6);
  const line = series
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(p.rate).toFixed(2)}`)
    .join(" ");
  const firedX = Math.max(
    0,
    Math.min(w, ((fired - series[0].t) / (series[series.length - 1].t - series[0].t)) * w),
  );

  return (
    <div className="mt-4">
      <div className="relative h-24">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
          aria-hidden
        >
          <path d={`${line} L${w},${h} L0,${h} Z`} fill="var(--fail-wash)" />
          <path
            d={line}
            fill="none"
            stroke="var(--fail)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            x2={w}
            y1={y(threshold)}
            y2={y(threshold)}
            stroke="var(--t3)"
            strokeDasharray="3 3"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={firedX}
            x2={firedX}
            y1={0}
            y2={h}
            stroke="var(--amber)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="absolute left-0 font-mono text-[10.5px] text-t3"
          style={{ top: `calc(${(y(threshold) / h) * 100}% - 16px)` }}
        >
          threshold {(threshold * 100).toFixed(0)}%
        </span>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10.5px] text-t3">
        <span>{format(series[0].t, "HH:mm")}</span>
        <span>{inc.resolved_at ? format(end, "HH:mm") : "now"}</span>
      </div>
    </div>
  );
}

const JUMP: Record<string, { label: string; href: (task: string | null) => string }> = {
  task_failure_rate: {
    label: "Failed runs",
    href: (t) => `/tasks?state=FAILURE${t ? `&task_name=${encodeURIComponent(t)}` : ""}`,
  },
  task_failed: {
    label: "Failed runs",
    href: (t) => `/tasks?state=FAILURE${t ? `&task_name=${encodeURIComponent(t)}` : ""}`,
  },
  error_rate_spike: {
    label: "Failed runs",
    href: (t) => `/tasks?state=FAILURE${t ? `&task_name=${encodeURIComponent(t)}` : ""}`,
  },
  task_duration: {
    label: "Matching tasks",
    href: (t) => `/tasks${t ? `?task_name=${encodeURIComponent(t)}` : ""}`,
  },
  latency_anomaly: {
    label: "Matching tasks",
    href: (t) => `/tasks${t ? `?task_name=${encodeURIComponent(t)}` : ""}`,
  },
  throughput_anomaly: {
    label: "Tasks",
    href: (t) => `/tasks${t ? `?task_name=${encodeURIComponent(t)}` : ""}`,
  },
  queue_depth: { label: "Queues", href: () => "/queues" },
  worker_offline: { label: "Workers", href: () => "/workers" },
  beat_missed: { label: "Beat", href: () => "/beat" },
  no_events: { label: "System health", href: () => "/system" },
};

function IncidentDetail({
  inc,
  rule,
  name,
  now,
  canWrite,
  onEdit,
}: {
  inc: AlertHistory;
  rule?: AlertRule;
  name: string;
  now: number;
  canWrite: boolean;
  onEdit: (rule: AlertRule) => void;
}) {
  const queryClient = useQueryClient();
  const firing = !inc.resolved_at;
  const task = ruleTaskName(rule);
  const jump = rule ? JUMP[rule.condition.type] : undefined;
  const details = Object.entries(inc.details ?? {}).filter(
    ([, v]) => v !== null && v !== "" && typeof v !== "object",
  );

  const silence = useMutation({
    mutationFn: () =>
      unwrap(
        fetchClient.POST("/api/v1/alerts/silences", {
          body: {
            rule_id: inc.rule_id,
            duration_minutes: 60,
            reason: `Silenced from incident: ${name}`,
          } as never,
        }),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/alerts/silences"] }),
  });

  return (
    <Panel aria-label="Incident" className="p-4 xl:sticky xl:top-20">
      <div className="flex flex-wrap items-center gap-2 text-xs text-t3">
        {firing ? (
          <SeverityChip severity={inc.severity} />
        ) : (
          <Chip tone="ok" icon={<CircleCheck />}>
            Resolved
          </Chip>
        )}
        <span>rule · {name}</span>
      </div>
      <h2 className="mt-2.5 text-[17px] leading-snug font-semibold tracking-[-0.01em]">
        {inc.summary}
      </h2>
      <p className="mt-1 text-[13px] text-t2">
        {firing ? "Firing for " : "Resolved after "}
        <span
          className={cn(
            "font-semibold tabular-nums",
            firing && (inc.severity === "critical" ? "text-fail" : "text-warn"),
          )}
        >
          {span(duration(inc, now))}
        </span>
        {task && (
          <>
            {" "}
            · task <span className="font-mono text-[12.5px]">{task}</span>
          </>
        )}
      </p>

      {rule && <RateChart inc={inc} rule={rule} now={now} />}

      {details.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-background/40 p-3 text-[13px]">
          {details.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="label">{DETAIL_LABELS[k] ?? k.replace(/_/g, " ")}</dt>
              <dd className="mt-0.5 truncate tabular-nums">{detailValue(k, v)}</dd>
            </div>
          ))}
        </dl>
      )}

      <ol className="mt-4 flex flex-col gap-3 text-[13px]">
        <li className="grid grid-cols-[64px_12px_minmax(0,1fr)] items-start gap-2.5">
          <span className="font-mono text-[11.5px] text-t3">
            {format(new Date(inc.fired_at), "HH:mm:ss")}
          </span>
          <span
            className={cn(
              "mt-1 size-2.5 rounded-full border-2",
              inc.severity === "critical" ? "border-fail" : "border-warn",
            )}
            aria-hidden
          />
          <span>Fired</span>
        </li>
        {Object.entries(inc.channels_sent ?? {}).map(([key, info]) => (
          <li key={key} className="grid grid-cols-[64px_12px_minmax(0,1fr)] items-start gap-2.5">
            <span className="font-mono text-[11.5px] text-t3">
              {format(new Date(inc.fired_at), "HH:mm:ss")}
            </span>
            <span
              className={cn(
                "mt-1 size-2.5 rounded-full border-2",
                info.success ? "border-ok" : "border-fail",
              )}
              aria-hidden
            />
            <span className="min-w-0">
              {deliveryLabel(key)}
              <span className={cn("block text-xs", info.success ? "text-t3" : "text-fail")}>
                {info.success ? "delivered" : `failed${info.error ? `: ${info.error}` : ""}`}
              </span>
            </span>
          </li>
        ))}
        <li className="grid grid-cols-[64px_12px_minmax(0,1fr)] items-start gap-2.5">
          <span className="font-mono text-[11.5px] text-t3">
            {inc.resolved_at ? format(new Date(inc.resolved_at), "HH:mm:ss") : "now"}
          </span>
          <span
            className={cn(
              "mt-1 size-2.5 rounded-full border-2",
              inc.resolved_at ? "border-ok bg-ok" : "border-line-strong",
            )}
            aria-hidden
          />
          <span>{inc.resolved_at ? "Resolved" : "Still firing"}</span>
        </li>
      </ol>

      {(silence.isSuccess || silence.isError) && (
        <p className={cn("mt-3 text-xs", silence.isSuccess ? "text-ok" : "text-fail")}>
          {silence.isSuccess
            ? "Silenced for an hour. Incidents still open and resolve; notifications wait."
            : "Couldn't create the silence."}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {canWrite && firing && (
          <Button
            size="sm"
            onClick={() => silence.mutate()}
            disabled={silence.isPending || silence.isSuccess}
          >
            <BellOff />
            Silence 1h
          </Button>
        )}
        {canWrite && rule && (
          <Button size="sm" onClick={() => onEdit(rule)}>
            <Pencil />
            Edit rule
          </Button>
        )}
        {jump && (
          <Link
            href={jump.href(task)}
            className="ml-auto inline-flex items-center gap-1 text-xs text-t3 transition-colors hover:text-foreground"
          >
            {jump.label} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
    </Panel>
  );
}

export function Incidents({
  history,
  rules,
  loading,
  hasMore,
  total,
  page,
  limit,
  onNext,
  onPrev,
  canWrite,
  onEdit,
}: {
  history: AlertHistory[];
  rules: AlertRule[];
  loading: boolean;
  hasMore: boolean;
  total?: number;
  page: number;
  limit: number;
  onNext: () => void;
  onPrev: () => void;
  canWrite: boolean;
  onEdit: (rule: AlertRule) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const now = Date.now();
  const byId = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const firing = history.filter((h) => !h.resolved_at);
  const resolved = history.filter((h) => h.resolved_at);
  const selected = history.find((h) => h.id === selectedId) ?? firing[0] ?? resolved[0];
  const nameOf = (h: AlertHistory) => byId.get(h.rule_id)?.name ?? h.rule_name ?? "Deleted rule";

  if (loading) {
    return (
      <Panel className="flex flex-col gap-2 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </Panel>
    );
  }

  if (history.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={<CircleCheck />}
          title="No incidents yet"
          description="When a rule fires, the incident shows up here with who was notified and when it resolved."
        />
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,1fr)]">
      <Panel className="overflow-hidden">
        {firing.length > 0 && (
          <>
            <h3 className="label px-4 pt-3.5 pb-2">Firing</h3>
            <ul>
              {firing.map((h) => (
                <IncidentRow
                  key={h.id}
                  inc={h}
                  name={nameOf(h)}
                  selected={h.id === selected?.id}
                  now={now}
                  onSelect={() => setSelectedId(h.id)}
                />
              ))}
            </ul>
          </>
        )}
        {resolved.length > 0 && (
          <>
            <h3
              className={cn(
                "label px-4 pb-2",
                firing.length > 0 ? "border-t border-border pt-4" : "pt-3.5",
              )}
            >
              Resolved
            </h3>
            <ul>
              {resolved.map((h) => (
                <IncidentRow
                  key={h.id}
                  inc={h}
                  name={nameOf(h)}
                  selected={h.id === selected?.id}
                  now={now}
                  onSelect={() => setSelectedId(h.id)}
                />
              ))}
            </ul>
          </>
        )}
        <Pagination
          total={total}
          limit={limit}
          hasMore={hasMore}
          currentCount={history.length}
          page={page}
          onNext={onNext}
          onPrev={onPrev}
        />
      </Panel>
      {selected && (
        <IncidentDetail
          inc={selected}
          rule={byId.get(selected.rule_id)}
          name={nameOf(selected)}
          now={now}
          canWrite={canWrite}
          onEdit={onEdit}
        />
      )}
    </div>
  );
}

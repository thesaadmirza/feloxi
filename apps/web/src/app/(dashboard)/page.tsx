"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Bell, Cable, Server, X } from "lucide-react";
import { $api } from "@/lib/api";
import { useCurrentUser } from "@/hooks/use-current-user";
import { userHasPermission } from "@/lib/auth";
import { TIME_RANGE_PRESETS, type TimeRangeId } from "@/lib/constants";
import { bucketize } from "@/lib/series";
import { formatDuration, formatNumber } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Readout, Readouts } from "@/components/ui/readout";
import { Segmented } from "@/components/ui/segmented";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { LiveIndicator } from "@/components/shared/live-indicator";
import { ErrorAlert } from "@/components/shared/error-alert";
import { AttentionStrip, useFiringAlerts } from "@/components/overview/attention-strip";
import { ThroughputPanel } from "@/components/overview/throughput-panel";
import { FailingNow } from "@/components/overview/failing-now";
import { QueuesPanel } from "@/components/overview/queues-panel";
import { SlowestTasks } from "@/components/overview/slowest-tasks";
import { WorkersPanel } from "@/components/overview/workers-panel";
import type { TaskMetricsRow } from "@/types/api";

const TIME_RANGE_KEY = "fp_dashboard_time_range";
const ONBOARDING_DISMISSED_KEY = "fp_onboarding_dismissed";
const RANGES = TIME_RANGE_PRESETS.map((r) => ({ value: r.id, label: r.label }));

const ONBOARDING_STEPS = [
  {
    icon: Cable,
    title: "Connect a broker",
    description: "Add your Redis or RabbitMQ URL. Feloxi reads the events Celery already sends.",
    href: "/brokers",
    cta: "Add broker",
  },
  {
    icon: Server,
    title: "Workers appear on their own",
    description: "Start workers with --events and their heartbeats and tasks stream in live.",
    href: "/workers",
    cta: "View workers",
  },
  {
    icon: Bell,
    title: "Set up alerts",
    description: "Page on failure spikes, slow tasks or workers going quiet.",
    href: "/alerts",
    cta: "Create alert",
  },
];

function GettingStarted({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Panel className="relative p-6 sm:p-8">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDismiss}
        aria-label="Dismiss getting started"
        className="absolute top-3 right-3"
      >
        <X />
      </Button>
      <h2 className="text-lg font-semibold tracking-[-0.01em]">Welcome to Feloxi</h2>
      <p className="mt-1 text-[13.5px] text-t2">
        Three steps from an empty dashboard to your first live task graph.
      </p>
      <ol className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
        {ONBOARDING_STEPS.map((step, i) => (
          <li key={step.title} className="flex flex-col gap-2 bg-card p-5">
            <span className="font-mono text-xs text-link">0{i + 1}</span>
            <h3 className="text-[15px] font-semibold">{step.title}</h3>
            <p className="text-[13px] leading-relaxed text-t2">{step.description}</p>
            <Link
              href={step.href}
              className="mt-auto inline-flex items-center gap-1 pt-2 text-[13px] font-[550] text-link hover:underline"
            >
              {step.cta}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function Change({
  value,
  suffix,
  tone = "neutral",
}: {
  value: number;
  suffix: string;
  tone?: "neutral" | "bad-up";
}) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.05) return <span>no change</span>;
  const up = value > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const color = tone === "bad-up" ? (up ? "text-fail" : "text-ok") : "text-t3";
  return (
    <span className={`flex items-center gap-0.5 ${color}`}>
      <Icon aria-hidden />
      {Math.abs(value).toFixed(value >= 10 || value <= -10 ? 0 : 1)}
      {suffix}
      <span className="sr-only">{up ? " up" : " down"} vs previous window</span>
    </span>
  );
}

/// Keeps a short in-memory trail of a live value so readouts without stored
/// history still show a trace while the page is open.
function useTrail(value: number | undefined, at: number, max = 40) {
  const [trail, setTrail] = useState<number[]>([]);
  useEffect(() => {
    if (value == null) return;
    setTrail((t) => [...t.slice(-(max - 1)), value]);
  }, [value, at, max]);
  return trail;
}

export default function OverviewPage() {
  const user = useCurrentUser();
  const [range, setRange] = useState<TimeRangeId>("1h");
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const minutes = TIME_RANGE_PRESETS.find((r) => r.id === range)?.minutes ?? 60;

  // Restored after mount: reading localStorage while rendering would not match
  // the server-rendered markup.
  useEffect(() => {
    const saved = localStorage.getItem(TIME_RANGE_KEY);
    if (saved && TIME_RANGE_PRESETS.some((r) => r.id === saved)) setRange(saved as TimeRangeId);
    if (localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "true") setOnboardingDismissed(true);
  }, []);

  const selectRange = useCallback((r: TimeRangeId) => {
    setRange(r);
    localStorage.setItem(TIME_RANGE_KEY, r);
  }, []);

  const dismissOnboarding = useCallback(() => {
    setOnboardingDismissed(true);
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true");
  }, []);

  const overview = $api.useQuery(
    "get",
    "/api/v1/metrics/overview",
    { params: { query: { from_minutes: minutes } } },
    { refetchInterval: 30_000 },
  );
  const overview2 = $api.useQuery(
    "get",
    "/api/v1/metrics/overview",
    { params: { query: { from_minutes: minutes * 2 } } },
    { refetchInterval: 60_000 },
  );
  const throughput = $api.useQuery(
    "get",
    "/api/v1/metrics/throughput",
    { params: { query: { from_minutes: minutes } } },
    { refetchInterval: 30_000 },
  );
  const live = $api.useQuery("get", "/api/v1/dashboard/live", {}, { refetchInterval: 15_000 });
  const canAlerts = userHasPermission(user, "alerts_read");
  const firing = useFiringAlerts(canAlerts);

  const buckets = useMemo(
    () =>
      bucketize(
        (throughput.data?.data ?? []) as TaskMetricsRow[],
        minutes,
        throughput.dataUpdatedAt || Date.now(),
      ),
    [throughput.data, throughput.dataUpdatedAt, minutes],
  );

  const o = overview.data;
  const o2 = overview2.data;
  const prevTotal = o && o2 ? o2.total_tasks - o.total_tasks : 0;
  const prevRate =
    o && o2 && prevTotal > 0 ? (o2.failure_count - o.failure_count) / prevTotal : null;
  const totalChange = o && prevTotal > 0 ? ((o.total_tasks - prevTotal) / prevTotal) * 100 : null;
  const rateChange = o && prevRate != null ? (o.failure_rate - prevRate) * 100 : null;

  const backlogTrail = useTrail(live.data?.queue_depth_total, live.dataUpdatedAt);
  const busyTrail = useTrail(live.data?.active_tasks_total, live.dataUpdatedAt);

  const band = useMemo(() => {
    const start = Date.now() - minutes * 60_000;
    const inWindow = firing.filter((a) => Date.parse(a.fired_at) >= start);
    if (inWindow.length === 0) return null;
    const first = inWindow.reduce((a, b) =>
      Date.parse(a.fired_at) <= Date.parse(b.fired_at) ? a : b,
    );
    return { from: Date.parse(first.fired_at), label: `${first.name} · firing` };
  }, [firing, minutes]);

  const label = TIME_RANGE_PRESETS.find((r) => r.id === range)?.label ?? range;
  const updated = overview.dataUpdatedAt
    ? new Date(overview.dataUpdatedAt).toLocaleTimeString()
    : null;

  return (
    <>
      <PageHeader
        title="Overview"
        meta={updated ? `updated ${updated}` : undefined}
        actions={
          <>
            <Segmented label="Time range" options={RANGES} value={range} onChange={selectRange} />
            <LiveIndicator />
          </>
        }
      />
      <PageBody>
        {overview.isError && (
          <ErrorAlert>Couldn&apos;t load metrics. The API may be unreachable.</ErrorAlert>
        )}

        {!overview.isLoading &&
          !overview.isError &&
          o?.total_tasks === 0 &&
          !onboardingDismissed && <GettingStarted onDismiss={dismissOnboarding} />}

        <AttentionStrip enabled={canAlerts} />

        <Readouts>
          <Readout
            label="Throughput"
            value={o ? formatNumber(o.total_tasks) : "—"}
            unit={`in ${label}`}
            delta={totalChange != null ? <Change value={totalChange} suffix="%" /> : undefined}
            spark={buckets.map((b) => b.total)}
            loading={overview.isLoading}
            href={`/tasks?range=${range}`}
          />
          <Readout
            label="Failure rate"
            value={
              o ? (
                <span className={o.failure_rate > 0.05 ? "text-fail" : undefined}>
                  {(o.failure_rate * 100).toFixed(1)}
                </span>
              ) : (
                "—"
              )
            }
            unit="%"
            delta={
              rateChange != null ? (
                <Change value={rateChange} suffix=" pts" tone="bad-up" />
              ) : undefined
            }
            spark={buckets.map((b) => (b.total > 0 ? b.failed / b.total : 0))}
            sparkColor="var(--fail)"
            loading={overview.isLoading}
            href={`/tasks?state=FAILURE&range=${range}`}
          />
          <Readout
            label="Avg runtime"
            value={o ? formatDuration(o.avg_runtime) : "—"}
            delta={o ? <span>p95 {formatDuration(o.p95_runtime)}</span> : undefined}
            spark={buckets.map((b) =>
              b.succeeded + b.failed > 0 ? b.runtime / (b.succeeded + b.failed) : 0,
            )}
            loading={overview.isLoading}
            href={`/tasks?range=${range}`}
          />
          <Readout
            label="Backlog"
            value={live.data ? formatNumber(live.data.queue_depth_total) : "—"}
            unit="queued"
            delta={live.data ? <span>{live.data.queues.length} queues</span> : undefined}
            spark={backlogTrail}
            sparkColor="var(--warn)"
            loading={live.isLoading}
            href="/queues"
          />
          <Readout
            label="Workers"
            value={live.data ? live.data.online_workers_total : "—"}
            unit="online"
            delta={
              live.data ? (
                <span>
                  {live.data.worker_capacity_total > 0
                    ? `${live.data.active_tasks_total}/${live.data.worker_capacity_total} slots busy`
                    : `${live.data.active_tasks_total} running`}
                </span>
              ) : undefined
            }
            spark={busyTrail}
            loading={live.isLoading}
            href="/workers"
            className="col-span-2 lg:col-span-1"
          />
        </Readouts>

        <ThroughputPanel
          buckets={buckets}
          loading={throughput.isLoading}
          rangeLabel={label}
          band={band}
        />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <FailingNow fromMinutes={minutes} />
          <QueuesPanel />
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <SlowestTasks fromMinutes={minutes} />
          <WorkersPanel fromMinutes={minutes} />
        </div>
      </PageBody>
    </>
  );
}

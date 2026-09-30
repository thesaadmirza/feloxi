"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowRight, CalendarClock, Check, Clock, TriangleAlert } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Chip, type Tone } from "@/components/ui/chip";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Skeleton } from "@/components/shared/skeleton";
import { CodeBlock } from "@/components/infra/code-block";
import { RefreshButton } from "@/components/infra/refresh-button";

type BeatScheduleEntry = {
  schedule_name: string;
  task_name: string;
  last_run_at?: number | null;
  next_run_at?: number | null;
};

type BeatSchedulesResponse = {
  schedules: BeatScheduleEntry[] | null;
};

async function fetchBeatSchedules(): Promise<BeatSchedulesResponse> {
  const res = await fetch("/api/v1/beat/schedules", { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

type ScheduleStatus = {
  label: "Never run" | "Missed" | "On schedule";
  tone: Tone;
  icon: React.ReactNode;
};

function scheduleStatus(entry: BeatScheduleEntry): ScheduleStatus {
  const now = Date.now();
  if (!entry.last_run_at) {
    return { label: "Never run", tone: "neutral", icon: <Clock aria-hidden /> };
  }
  const nextRun = entry.next_run_at ? entry.next_run_at * 1000 : null;
  const overdue = nextRun && nextRun < now - 60_000;
  if (overdue) {
    return { label: "Missed", tone: "fail", icon: <TriangleAlert aria-hidden /> };
  }
  return { label: "On schedule", tone: "ok", icon: <Check strokeWidth={2.6} aria-hidden /> };
}

function when(seconds: number) {
  const ms = Math.round(seconds * 1000);
  return { ms, iso: new Date(ms).toISOString() };
}

const SETUP_STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Run Beat",
    body: (
      <>
        <p>Start Celery Beat with events enabled:</p>
        <CodeBlock code="celery beat --app=myapp -l info" className="mt-2.5" />
      </>
    ),
  },
  {
    title: "Connect your broker",
    body: (
      <p>
        Ensure your broker is connected in{" "}
        <Link href="/brokers" className="font-[550] text-link hover:underline">
          Brokers
        </Link>
        .
      </p>
    ),
  },
  {
    title: "Wait for a run",
    body: <p>Beat task events will appear automatically after the first scheduled run.</p>,
  },
];

export default function BeatPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["beat-schedules"],
    queryFn: fetchBeatSchedules,
    refetchInterval: 30_000,
  });

  const schedules: BeatScheduleEntry[] = useMemo(
    () => (Array.isArray(data?.schedules) ? (data.schedules as BeatScheduleEntry[]) : []),
    [data],
  );

  const enriched = useMemo(
    () => schedules.map((s) => ({ ...s, status: scheduleStatus(s) })),
    [schedules],
  );

  const missed = useMemo(
    () => enriched.filter((s) => s.status.label === "Missed").length,
    [enriched],
  );
  const onSchedule = useMemo(
    () => enriched.filter((s) => s.status.label === "On schedule").length,
    [enriched],
  );

  const sorted = useMemo(
    () =>
      [...enriched].sort((a, b) => {
        if (a.status.label === "Missed" && b.status.label !== "Missed") return -1;
        if (b.status.label === "Missed" && a.status.label !== "Missed") return 1;
        return a.schedule_name.localeCompare(b.schedule_name);
      }),
    [enriched],
  );

  const meta =
    schedules.length > 0
      ? `${schedules.length} schedule${schedules.length === 1 ? "" : "s"} · ${onSchedule} on schedule · ${missed} missed`
      : undefined;

  return (
    <>
      <PageHeader
        title="Beat schedules"
        meta={meta}
        actions={<RefreshButton onRefresh={() => refetch()} label="Refresh schedules" />}
      />
      <PageBody>
        {isError && (
          <ErrorAlert>
            Couldn&apos;t load Beat schedule data: {(error as Error)?.message}
          </ErrorAlert>
        )}

        {isLoading && (
          <Panel className="flex flex-col gap-2 p-4" aria-label="Loading schedules">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </Panel>
        )}

        {!isLoading && !isError && schedules.length === 0 && (
          <>
            <Panel>
              <EmptyState
                icon={<CalendarClock />}
                title="No beat schedule data"
                description="Beat schedule information will appear here once Celery Beat starts publishing events to the connected broker."
              />
            </Panel>

            <Panel aria-label="Set up Beat monitoring">
              <PanelHeader title="Set up Beat monitoring" />
              <ol className="grid grid-cols-1 gap-px border-y border-border bg-border md:grid-cols-3">
                {SETUP_STEPS.map((step, i) => (
                  <li key={step.title} className="flex min-w-0 flex-col gap-1.5 bg-card px-4 py-4">
                    <span className="font-mono text-xs text-link">0{i + 1}</span>
                    <h3 className="text-[13.5px] font-semibold text-foreground">{step.title}</h3>
                    <div className="text-[13px] leading-relaxed text-t2">{step.body}</div>
                  </li>
                ))}
              </ol>
              <p className="px-4 py-3 text-xs leading-relaxed text-t3">
                You can also set up a{" "}
                <Link href="/alerts" className="font-[550] text-link hover:underline">
                  Beat missed alert
                </Link>{" "}
                to get notified when schedules stop running.
              </p>
            </Panel>
          </>
        )}

        {schedules.length > 0 && (
          <Panel className="overflow-hidden" aria-label="Beat schedules">
            <div className="overflow-x-auto">
              <Table className="table-fixed">
                <THead>
                  <Th>Schedule</Th>
                  <Th className="hidden md:table-cell md:w-[30%]">Task</Th>
                  <Th className="w-[128px] sm:w-[136px]">Status</Th>
                  <Th className="hidden w-[104px] sm:table-cell">Last run</Th>
                  <Th className="hidden w-[128px] sm:table-cell">Next run</Th>
                  <Th className="w-[52px] sm:w-[88px]">
                    <span className="sr-only">Tasks</span>
                  </Th>
                </THead>
                <tbody>
                  {sorted.map((entry) => {
                    const { status, ...baseEntry } = entry;
                    const last = baseEntry.last_run_at ? when(baseEntry.last_run_at) : null;
                    const next = baseEntry.next_run_at ? when(baseEntry.next_run_at) : null;
                    return (
                      <Tr
                        key={baseEntry.schedule_name}
                        className="group transition-colors hover:bg-hover"
                      >
                        <Td className="min-w-0">
                          <span
                            className="block truncate font-[550] text-foreground"
                            title={baseEntry.schedule_name}
                          >
                            {baseEntry.schedule_name}
                          </span>
                          <span
                            className="mt-0.5 block truncate font-mono text-[11.5px] text-t3 md:hidden"
                            title={baseEntry.task_name}
                          >
                            {baseEntry.task_name}
                          </span>
                        </Td>
                        <Td className="hidden min-w-0 md:table-cell">
                          <span
                            className="block truncate font-mono text-[12px] text-t2"
                            title={baseEntry.task_name}
                          >
                            {baseEntry.task_name}
                          </span>
                        </Td>
                        <Td>
                          <Chip tone={status.tone} icon={status.icon}>
                            {status.label}
                          </Chip>
                        </Td>
                        <Td className="hidden text-t2 tabular-nums sm:table-cell">
                          {last ? (
                            <span title={last.iso}>{timeAgo(last.ms)}</span>
                          ) : (
                            <span className="text-t4">—</span>
                          )}
                        </Td>
                        <Td className="hidden text-t2 tabular-nums sm:table-cell">
                          {next ? (
                            <span title={next.iso}>{format(next.ms, "d MMM, HH:mm")}</span>
                          ) : (
                            <span className="text-t4">—</span>
                          )}
                        </Td>
                        <Td align="right" className="py-2">
                          <Button
                            asChild
                            variant="ghost"
                            size="sm"
                            className="sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                          >
                            <Link
                              href={`/tasks?task_name=${encodeURIComponent(baseEntry.task_name)}`}
                              aria-label={`Tasks for ${baseEntry.schedule_name}`}
                            >
                              <span className="max-sm:sr-only">Tasks</span>
                              <ArrowRight aria-hidden />
                            </Link>
                          </Button>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </Panel>
        )}
      </PageBody>
    </>
  );
}

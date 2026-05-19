"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Timer,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronRight,
  CalendarClock,
} from "lucide-react";
import { timeAgo, formatDateTimeLocal } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";

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

function scheduleStatus(entry: BeatScheduleEntry): { label: string; cls: string; icon: React.ReactNode } {
  const now = Date.now();
  if (!entry.last_run_at) {
    return {
      label: "Never run",
      cls: "text-muted-foreground bg-secondary border-border",
      icon: <Clock className="h-3 w-3" />,
    };
  }
  const nextRun = entry.next_run_at ? entry.next_run_at * 1000 : null;
  const overdue = nextRun && nextRun < now - 60_000;
  if (overdue) {
    return {
      label: "Missed",
      cls: "text-red-400 bg-red-400/10 border-red-400/20",
      icon: <AlertTriangle className="h-3 w-3" />,
    };
  }
  return {
    label: "On schedule",
    cls: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    icon: <CheckCircle2 className="h-3 w-3" />,
  };
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-secondary rounded w-full" />
        </td>
      ))}
    </tr>
  );
}

export default function BeatPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["beat-schedules"],
    queryFn: fetchBeatSchedules,
    refetchInterval: 30_000,
  });

  const schedules: BeatScheduleEntry[] = Array.isArray(data?.schedules)
    ? (data.schedules as BeatScheduleEntry[])
    : [];

  const enriched = useMemo(
    () => schedules.map((s) => ({ ...s, status: scheduleStatus(s) })),
    [schedules]
  );

  const missed = useMemo(() => enriched.filter((s) => s.status.label === "Missed").length, [enriched]);
  const onSchedule = useMemo(() => enriched.filter((s) => s.status.label === "On schedule").length, [enriched]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Beat Schedules</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Celery Beat periodic task tracking — last run times and missed schedules
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-muted-foreground text-sm hover:text-foreground hover:bg-secondary/80 transition"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {isError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Failed to load beat schedule data: {(error as Error)?.message}
        </div>
      )}

      {!isLoading && !isError && schedules.length === 0 && (
        <div className="space-y-4">
          <EmptyState
            icon={<CalendarClock className="w-8 h-8" />}
            title="No beat schedule data"
            description="Beat schedule information will appear here once Celery Beat starts publishing events to the connected broker."
          />
          <div className="rounded-xl border border-border bg-card p-6 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">How to enable Beat monitoring</h2>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>Start Celery Beat with events enabled: <code className="px-1.5 py-0.5 bg-secondary rounded text-xs font-mono text-foreground">celery beat --app=myapp -l info</code></li>
              <li>Ensure your broker is connected in <Link href="/brokers" className="text-primary underline underline-offset-2">Brokers</Link></li>
              <li>Beat task events will appear automatically after the first scheduled run</li>
            </ol>
            <p className="text-xs text-muted-foreground pt-1">
              You can also set up a <Link href="/alerts" className="text-primary underline underline-offset-2">Beat Missed alert</Link> to get notified when schedules stop running.
            </p>
          </div>
        </div>
      )}

      {schedules.length > 0 && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Schedules</p>
              <p className="text-2xl font-bold text-foreground tabular-nums">{schedules.length}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">On Schedule</p>
              <p className={`text-2xl font-bold tabular-nums ${onSchedule > 0 ? "text-emerald-400" : "text-foreground"}`}>
                {onSchedule}
              </p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Missed</p>
              <p className={`text-2xl font-bold tabular-nums ${missed > 0 ? "text-red-400" : "text-foreground"}`}>
                {missed}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/40">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Schedule</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Task</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Run</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Next Run</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {isLoading &&
                    Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
                  {!isLoading &&
                    [...enriched]
                      .sort((a, b) => {
                        if (a.status.label === "Missed" && b.status.label !== "Missed") return -1;
                        if (b.status.label === "Missed" && a.status.label !== "Missed") return 1;
                        return a.schedule_name.localeCompare(b.schedule_name);
                      })
                      .map((entry) => {
                        const { status, ...baseEntry } = entry;
                        return (
                          <tr
                            key={baseEntry.schedule_name}
                            className="border-b border-border hover:bg-secondary/30 transition-colors group"
                          >
                            <td className="px-4 py-3 font-medium text-foreground">
                              {baseEntry.schedule_name}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[220px] truncate">
                              {baseEntry.task_name}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${status.cls}`}>
                                {status.icon}
                                {status.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground text-xs">
                              {baseEntry.last_run_at
                                ? timeAgo(Math.round(baseEntry.last_run_at * 1000))
                                : "—"}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground text-xs">
                              {baseEntry.next_run_at
                                ? formatDateTimeLocal(Math.round(baseEntry.next_run_at * 1000))
                                : "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Link
                                href={`/tasks?task_name=${encodeURIComponent(baseEntry.task_name)}`}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary opacity-0 group-hover:opacity-100 transition"
                              >
                                Tasks
                                <ChevronRight className="h-3 w-3" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

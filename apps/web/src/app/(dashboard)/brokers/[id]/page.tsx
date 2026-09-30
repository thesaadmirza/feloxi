"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Play, SearchX, Square, Trash2 } from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Panel, PanelHeader, PanelLink } from "@/components/ui/panel";
import { FlatPulse } from "@/components/ui/pulse";
import { Readout, Readouts } from "@/components/ui/readout";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Skeleton } from "@/components/shared/skeleton";
import { BrokerStatusChip, BrokerTypeTag } from "@/components/infra/broker-status";
import { DepthBar } from "@/components/infra/depth-bar";
import { errorText, maskUrlPasswords } from "@/components/infra/error-text";
import { EVEN_READOUTS } from "@/components/infra/even-readouts";
import { OutcomeAreaChart, OutcomeLegend } from "@/components/infra/outcome-chart";
import type { TaskMetricsRow } from "@/types/api";

/** Aggregate per-task throughput rows into per-minute totals for the chart. */
function aggregateThroughput(rows: TaskMetricsRow[]) {
  const byMinute = new Map<number, { success: number; failure: number }>();
  for (const r of rows) {
    const existing = byMinute.get(r.minute) ?? { success: 0, failure: 0 };
    existing.success += r.success_count;
    existing.failure += r.failure_count;
    byMinute.set(r.minute, existing);
  }
  return Array.from(byMinute.entries())
    .sort(([a], [b]) => a - b)
    .map(([minute, counts]) => ({
      time: new Date(minute).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      ...counts,
    }));
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3 border-t border-line-soft px-4 py-2.5 text-[13px]">
      <dt className="text-t3">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

function PanelNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-t border-line-soft px-4 pt-4 pb-6 text-center text-[13px] text-t3">
      {children}
    </p>
  );
}

export default function BrokerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const brokerId = params.id as string;

  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const {
    data: broker,
    isLoading,
    isError,
    error,
  } = $api.useQuery(
    "get",
    "/api/v1/brokers/{id}",
    { params: { path: { id: brokerId } } },
    { enabled: !!brokerId, refetchInterval: 10_000 },
  );

  const { data: stats, isLoading: statsLoading } = $api.useQuery(
    "get",
    "/api/v1/brokers/{id}/stats",
    { params: { path: { id: brokerId } } },
    { enabled: !!brokerId, refetchInterval: 10_000 },
  );

  const { data: queuesData, isLoading: queuesLoading } = $api.useQuery(
    "get",
    "/api/v1/brokers/{id}/queues",
    { params: { path: { id: brokerId } } },
    { enabled: !!brokerId && broker?.status === "connected", refetchInterval: 10_000 },
  );

  const { data: throughputData, isLoading: throughputLoading } = $api.useQuery(
    "get",
    "/api/v1/metrics/throughput",
    { params: { query: { from_minutes: 60 } } },
    { enabled: !!brokerId, refetchInterval: 30_000 },
  );

  const startMutation = useMutation({
    mutationFn: () =>
      unwrap(
        fetchClient.POST("/api/v1/brokers/{id}/start", { params: { path: { id: brokerId } } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/brokers/{id}"] }),
  });

  const stopMutation = useMutation({
    mutationFn: () =>
      unwrap(fetchClient.POST("/api/v1/brokers/{id}/stop", { params: { path: { id: brokerId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/brokers/{id}"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      unwrap(fetchClient.DELETE("/api/v1/brokers/{id}", { params: { path: { id: brokerId } } })),
    onSuccess: () => router.push("/brokers"),
  });

  const chart = useMemo(
    () => (throughputData ? aggregateThroughput(throughputData.data) : []),
    [throughputData],
  );
  const chartTotals = useMemo(
    () =>
      chart.reduce((acc, p) => ({ s: acc.s + p.success, f: acc.f + p.failure }), { s: 0, f: 0 }),
    [chart],
  );

  if (isLoading) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Brokers", href: "/brokers" }, { label: "…" }]} />
        <PageBody>
          <Skeleton className="h-[106px] w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </PageBody>
      </>
    );
  }

  if (isError) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Brokers", href: "/brokers" }, { label: "Not found" }]} />
        <PageBody>
          <Panel>
            <EmptyState
              icon={<SearchX />}
              title="Broker not found"
              description={errorText(error) ?? "Could not load broker details"}
              action={
                <Button asChild>
                  <Link href="/brokers">Back to brokers</Link>
                </Button>
              }
            />
          </Panel>
        </PageBody>
      </>
    );
  }

  if (!broker) return null;

  const isConnected = broker.status === "connected";
  const isToggling = startMutation.isPending || stopMutation.isPending;

  const successRate =
    stats && stats.total_events > 0
      ? Math.round((stats.success_count / (stats.success_count + stats.failure_count)) * 100) || 0
      : 0;
  const finished = stats ? stats.success_count + stats.failure_count : 0;

  const queues = queuesData?.data ?? [];
  const maxDepth = Math.max(0, ...queues.map((q) => q.depth));
  const topTasks = stats?.top_tasks ?? [];

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Brokers", href: "/brokers" }, { label: broker.name }]}
        meta={
          <span className="inline-flex items-center gap-2">
            <BrokerStatusChip broker={broker} />
            <span className="font-mono">{broker.broker_type}</span>
          </span>
        }
        actions={
          <>
            <Button
              onClick={() => (isConnected ? stopMutation.mutate() : startMutation.mutate())}
              disabled={isToggling}
            >
              {isToggling ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : isConnected ? (
                <Square aria-hidden />
              ) : (
                <Play aria-hidden />
              )}
              {isConnected ? "Stop" : "Start"}
            </Button>
            <Button variant="danger" onClick={() => setDeleteConfirm(true)}>
              <Trash2 aria-hidden />
              Delete
            </Button>
          </>
        }
      />
      <PageBody>
        {broker.last_error && (
          <ErrorAlert>
            <span className="font-semibold">Last error</span>
            <span className="mt-0.5 block font-mono text-[12px] break-all opacity-90">
              {maskUrlPasswords(broker.last_error)}
            </span>
          </ErrorAlert>
        )}

        <Readouts className={cn("lg:grid-cols-4", EVEN_READOUTS)}>
          <Readout
            label="Total events"
            value={stats?.total_events?.toLocaleString() ?? "0"}
            loading={statsLoading}
          />
          <Readout
            label="Last hour"
            value={stats?.events_last_hour?.toLocaleString() ?? "0"}
            unit="events"
            loading={statsLoading}
          />
          <Readout
            label="Last 24h"
            value={stats?.events_last_24h?.toLocaleString() ?? "0"}
            unit="events"
            loading={statsLoading}
          />
          <Readout
            label="Success rate"
            value={
              stats && finished > 0 ? (
                <span
                  className={cn(successRate < 80 ? "text-fail" : successRate < 95 && "text-warn")}
                >
                  {successRate}
                </span>
              ) : (
                "—"
              )
            }
            unit={stats && finished > 0 ? "%" : undefined}
            delta={
              stats && finished > 0 ? (
                <span>{stats.failure_count.toLocaleString()} failed</span>
              ) : undefined
            }
            loading={statsLoading}
          />
        </Readouts>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Panel aria-label="Tasks per minute">
            <PanelHeader
              title="Tasks per minute"
              subtitle="last hour, all brokers"
              action={
                chart.length > 0 ? (
                  <div className="hidden items-center gap-4 sm:flex">
                    <OutcomeLegend color="var(--ok)" label="Succeeded" value={chartTotals.s} />
                    <OutcomeLegend color="var(--fail)" label="Failed" value={chartTotals.f} />
                  </div>
                ) : undefined
              }
            />
            <div className="px-2 pb-3">
              {throughputLoading ? (
                <Skeleton className="mx-2 h-[200px] w-[calc(100%-16px)]" />
              ) : chart.length === 0 ? (
                <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-center">
                  <FlatPulse />
                  <span className="text-[13px] text-t3">No tasks finished in the last hour.</span>
                </div>
              ) : (
                <OutcomeAreaChart data={chart} />
              )}
            </div>
          </Panel>

          <Panel aria-label="Connection details">
            <PanelHeader title="Connection" />
            <dl className="pb-1">
              <DetailRow label="Status">
                <BrokerStatusChip broker={broker} />
              </DetailRow>
              <DetailRow label="Type">
                <BrokerTypeTag type={broker.broker_type} />
              </DetailRow>
              <DetailRow label="Broker ID">
                <span className="block truncate font-mono text-[12px] text-t2" title={broker.id}>
                  {broker.id}
                </span>
              </DetailRow>
              <DetailRow label="Created">
                <span title={new Date(broker.created_at).toLocaleString()}>
                  {timeAgo(broker.created_at)}
                </span>
              </DetailRow>
              <DetailRow label="Updated">
                <span title={new Date(broker.updated_at).toLocaleString()}>
                  {timeAgo(broker.updated_at)}
                </span>
              </DetailRow>
            </dl>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel aria-label="Queue depths">
            <PanelHeader
              title="Queues"
              subtitle="messages waiting now"
              action={<PanelLink href="/queues">All queues</PanelLink>}
            />
            {!isConnected ? (
              <PanelNote>Queue depths show while the broker is connected.</PanelNote>
            ) : queuesLoading ? (
              <div className="flex flex-col gap-2 px-4 pb-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : queues.length === 0 ? (
              <PanelNote>No queues reported by the broker.</PanelNote>
            ) : (
              <Table className="table-fixed border-t border-border">
                <THead>
                  <Th>Queue</Th>
                  <Th align="right" className="w-[45%]">
                    Messages
                  </Th>
                </THead>
                <tbody>
                  {queues.map((q) => (
                    <Tr key={q.queue_name}>
                      <Td>
                        <Link
                          href={`/tasks?queue=${encodeURIComponent(q.queue_name)}`}
                          className="block truncate font-mono text-[12.5px] text-foreground transition-colors hover:text-link"
                          title={q.queue_name}
                        >
                          {q.queue_name}
                        </Link>
                      </Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-3">
                          <DepthBar value={q.depth} max={maxDepth} className="flex-1" />
                          <span className="w-[52px] shrink-0 text-foreground">
                            {q.depth.toLocaleString()}
                          </span>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel aria-label="Top tasks">
            <PanelHeader title="Top tasks" subtitle="by finished runs" />
            {statsLoading ? (
              <div className="flex flex-col gap-2 px-4 pb-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : topTasks.length === 0 ? (
              <PanelNote>No finished tasks from this broker yet.</PanelNote>
            ) : (
              <Table className="table-fixed border-t border-border">
                <THead>
                  <Th>Task</Th>
                  <Th align="right" className="w-[96px]">
                    Runs
                  </Th>
                </THead>
                <tbody>
                  {topTasks.map((task) => (
                    <Tr key={task.name}>
                      <Td>
                        <Link
                          href={`/tasks?task_name=${encodeURIComponent(task.name)}`}
                          className="block truncate font-mono text-[12.5px] text-foreground transition-colors hover:text-link"
                          title={task.name}
                        >
                          {task.name}
                        </Link>
                      </Td>
                      <Td align="right" className="text-t2">
                        {task.count.toLocaleString()}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>
      </PageBody>

      <ConfirmDialog
        open={deleteConfirm}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeleteConfirm(false);
            deleteMutation.reset();
          }
        }}
        title="Delete this broker?"
        description="Feloxi stops consuming its events and removes the connection. Events already stored are kept."
        subject={broker.name}
        confirmLabel="Delete broker"
        tone="danger"
        busy={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      >
        {deleteMutation.isError && (
          <p className="text-xs text-fail">
            {errorText(deleteMutation.error) ?? "Couldn't delete the broker."}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, CircleDot, Layers, OctagonAlert, Trash2, TriangleAlert } from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { useHasPermission } from "@/hooks/use-current-user";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Chip, type Tone } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { Sparkline } from "@/components/ui/sparkline";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Skeleton } from "@/components/shared/skeleton";
import { DepthBar, type DepthTone } from "@/components/infra/depth-bar";
import { errorText, maskUrlPasswords } from "@/components/infra/error-text";
import { RefreshButton } from "@/components/infra/refresh-button";
import { WarnAlert } from "@/components/infra/warn-alert";

const TREND = {
  rising: { color: "var(--warn)", word: "rising" },
  falling: { color: "var(--ok)", word: "falling" },
  steady: { color: "var(--t2)", word: "steady" },
} as const;

function QueueSparkline({ queueName }: { queueName: string }) {
  const { data } = $api.useQuery(
    "get",
    "/api/v1/metrics/queues",
    { params: { query: { queue: queueName, from_minutes: 60 } } },
    { staleTime: 60_000 },
  );

  const points = data?.data ?? [];
  if (points.length < 2) return <span className="text-t4">—</span>;

  const values = points.map((p) => p.enqueued);
  const recent = values.slice(-5).reduce((a, b) => a + b, 0);
  const earlier = values.slice(0, 5).reduce((a, b) => a + b, 0);
  const trend =
    TREND[recent > earlier * 1.2 ? "rising" : recent < earlier * 0.8 ? "falling" : "steady"];

  return (
    <div className="w-[88px]">
      <Sparkline
        values={values}
        color={trend.color}
        height={22}
        label={`Enqueued per minute over the last hour, ${trend.word}`}
      />
    </div>
  );
}

type DepthStatus = { label: string; tone: Tone; icon: React.ReactNode; bar: DepthTone };

function depthStatus(depth: number): DepthStatus {
  if (depth > 10000)
    return { label: "Critical", tone: "fail", icon: <OctagonAlert />, bar: "fail" };
  if (depth > 1000) return { label: "Warning", tone: "warn", icon: <TriangleAlert />, bar: "warn" };
  if (depth > 0) return { label: "Active", tone: "neutral", icon: <CircleDot />, bar: "neutral" };
  return { label: "Empty", tone: "ok", icon: <Check strokeWidth={2.6} />, bar: "neutral" };
}

export default function QueuesPage() {
  const canManage = useHasPermission("brokers_manage");
  const { data: brokersData, isLoading: brokersLoading } = $api.useQuery(
    "get",
    "/api/v1/brokers",
    {},
    { refetchInterval: 30_000 },
  );
  const brokers = brokersData?.data ?? [];
  const connectedBrokers = brokers.filter((b) => b.status === "connected");

  const [selectedBrokerId, setSelectedBrokerId] = useState<string | undefined>(undefined);
  // Live depths come from a direct on-demand broker connection, independent of
  // the event consumer — so any broker is queryable, whatever its consumer
  // status. Prefer a connected one as the default.
  const activeBroker =
    (selectedBrokerId ? brokers.find((b) => b.id === selectedBrokerId) : undefined) ??
    connectedBrokers[0] ??
    brokers[0];

  const {
    data: queueData,
    isLoading,
    isError,
    error,
    refetch,
  } = $api.useQuery(
    "get",
    "/api/v1/brokers/{id}/queues",
    { params: { path: { id: activeBroker?.id ?? "" } } },
    { enabled: !!activeBroker, refetchInterval: 10_000 },
  );

  const queues = useMemo(() => {
    const raw = queueData?.data ?? [];
    // Filter out malformed queue names (Kombu binding artifacts with control chars)
    return raw.filter((q) => q.queue_name && !q.queue_name.includes("\u0006"));
  }, [queueData]);

  const sorted = useMemo(
    () => [...queues].sort((a, b) => b.depth - a.depth || a.queue_name.localeCompare(b.queue_name)),
    [queues],
  );

  const totalDepth = useMemo(() => queues.reduce((acc, q) => acc + q.depth, 0), [queues]);

  const nonEmpty = useMemo(() => queues.filter((q) => q.depth > 0).length, [queues]);

  const maxDepth = sorted[0]?.depth ?? 0;

  // Purge state
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  async function handlePurge() {
    if (!activeBroker || !purgeTarget) return;
    setPurging(true);
    setPurgeError(null);
    try {
      await unwrap(
        fetchClient.DELETE(
          "/api/v1/brokers/{id}/queues/{queue_name}" as never,
          {
            params: { path: { id: activeBroker.id, queue_name: purgeTarget } },
          } as never,
        ),
      );
      setPurgeTarget(null);
      refetch();
    } catch (err) {
      setPurgeError(err instanceof Error ? err.message : "Purge failed");
    } finally {
      setPurging(false);
    }
  }

  const meta =
    activeBroker && queueData
      ? [
          `${queues.length} queue${queues.length === 1 ? "" : "s"}`,
          `${nonEmpty} non-empty`,
          `${totalDepth.toLocaleString()} waiting`,
          brokers.length > 1 ? null : activeBroker.name,
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  return (
    <>
      <PageHeader
        title="Queues"
        meta={meta}
        actions={
          <>
            {brokers.length > 1 && (
              <Select
                value={activeBroker?.id ?? ""}
                onChange={(e) => setSelectedBrokerId(e.target.value)}
                aria-label="Select broker"
                className="h-8 w-auto max-w-[320px] min-w-0"
              >
                {brokers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name || b.id.slice(0, 8)} · {b.broker_type}
                    {b.status !== "connected" ? ` · ${b.status}` : ""}
                  </option>
                ))}
              </Select>
            )}
            <RefreshButton onRefresh={() => refetch()} label="Refresh queues" />
          </>
        }
      />
      <PageBody>
        {isError && (
          <ErrorAlert>
            Couldn&apos;t load queue data{activeBroker ? ` from ${activeBroker.name}` : ""}.
            {errorText(error) && <span className="opacity-80"> {errorText(error)}</span>}
          </ErrorAlert>
        )}

        {activeBroker && activeBroker.status !== "connected" && (
          <WarnAlert>
            Event consumer for this broker is{" "}
            <span className="font-semibold">
              {activeBroker.status === "error" ? "reporting an error" : activeBroker.status}
            </span>
            {activeBroker.last_error ? (
              <span className="opacity-80"> — {maskUrlPasswords(activeBroker.last_error)}</span>
            ) : null}
            . Depths below come from a direct broker connection and stay live; task events may be
            delayed until the consumer reconnects (it retries automatically).
          </WarnAlert>
        )}

        {!activeBroker && !isLoading && !brokersLoading && (
          <Panel>
            <EmptyState
              icon={<Layers />}
              title="No broker configured"
              description="Add a Redis or RabbitMQ broker in Settings to see live queue depths."
              action={
                canManage ? (
                  <Button asChild>
                    <Link href="/brokers">Add broker</Link>
                  </Button>
                ) : undefined
              }
            />
          </Panel>
        )}

        {(brokersLoading || (activeBroker && isLoading)) && (
          <Panel className="flex flex-col gap-2 p-4" aria-label="Loading queues">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </Panel>
        )}

        {activeBroker && !isLoading && !isError && queues.length === 0 && (
          <Panel>
            <EmptyState
              icon={<Layers />}
              title="No queues found"
              description="Queues appear once workers bind them or tasks are published. On RabbitMQ, queue names are discovered from task events — enabling task_send_sent_event in your Celery app helps."
            />
          </Panel>
        )}

        {queues.length > 0 && (
          <Panel className="overflow-hidden" aria-label="Queue depths">
            <div className="overflow-x-auto">
              <Table className="table-fixed">
                <THead>
                  <Th>Queue</Th>
                  <Th align="right" className="w-[76px] sm:w-[38%]">
                    Depth
                  </Th>
                  <Th
                    className="hidden w-[124px] md:table-cell"
                    title="Messages enqueued per minute"
                  >
                    Last hour
                  </Th>
                  <Th className="w-[104px] sm:w-[128px]">Status</Th>
                  {canManage && (
                    <Th className="w-[52px] sm:w-[104px]">
                      <span className="sr-only">Actions</span>
                    </Th>
                  )}
                </THead>
                <tbody>
                  {sorted.map((q) => {
                    const status = depthStatus(q.depth);
                    return (
                      <Tr key={q.queue_name} className="group transition-colors hover:bg-hover">
                        <Td className="min-w-0">
                          <Link
                            href={`/tasks?queue=${encodeURIComponent(q.queue_name)}`}
                            title={`View tasks in ${q.queue_name}`}
                            className="block truncate font-mono text-[12.5px] text-foreground transition-colors hover:text-link"
                          >
                            {q.queue_name}
                          </Link>
                        </Td>
                        <Td align="right">
                          <div className="flex items-center justify-end gap-3">
                            <DepthBar
                              value={q.depth}
                              max={maxDepth}
                              tone={status.bar}
                              className="hidden flex-1 sm:block"
                            />
                            <span className="w-[60px] shrink-0 font-semibold text-foreground">
                              {q.depth.toLocaleString()}
                            </span>
                          </div>
                        </Td>
                        <Td className="hidden md:table-cell">
                          <QueueSparkline queueName={q.queue_name} />
                        </Td>
                        <Td>
                          <Chip tone={status.tone} icon={status.icon}>
                            {status.label}
                          </Chip>
                        </Td>
                        {canManage && (
                          <Td align="right" className="py-2">
                            <div className="flex h-7 items-center justify-end">
                              {q.depth > 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setPurgeTarget(q.queue_name)}
                                  title="Purge all messages"
                                  className="hover:text-fail sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                                >
                                  <Trash2 aria-hidden />
                                  <span className="max-sm:sr-only">Purge</span>
                                </Button>
                              )}
                            </div>
                          </Td>
                        )}
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </Panel>
        )}
      </PageBody>

      <ConfirmDialog
        open={purgeTarget != null}
        onOpenChange={(open) => {
          if (!open && !purging) {
            setPurgeTarget(null);
            setPurgeError(null);
          }
        }}
        title="Purge this queue?"
        description="Permanently deletes every message waiting in this queue. Tasks that are already running aren't affected, but any waiting tasks are lost."
        subject={purgeTarget}
        confirmLabel="Purge queue"
        tone="danger"
        busy={purging}
        onConfirm={handlePurge}
      >
        {purgeError && <p className="text-xs text-fail">{purgeError}</p>}
      </ConfirmDialog>
    </>
  );
}

"use client";

import {
  Activity,
  Cable,
  Check,
  Database,
  HardDrive,
  OctagonAlert,
  Server,
  TriangleAlert,
  X,
} from "lucide-react";
import { $api } from "@/lib/api";
import { cn, formatNumber, timeAgo } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Chip, Tag, type Tone } from "@/components/ui/chip";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Readout, Readouts } from "@/components/ui/readout";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { ErrorAlert, Notice } from "@/components/shared/error-alert";
import { Skeleton } from "@/components/shared/skeleton";
import { EVEN_READOUTS } from "@/components/infra/even-readouts";
import { InfoTip } from "@/components/infra/info-tip";
import { RefreshButton } from "@/components/infra/refresh-button";
import { WarnAlert } from "@/components/infra/warn-alert";

type OverallStatus = { tone: Tone; label: string; icon: React.ReactNode; description: string };

const STATUS: Record<string, OverallStatus> = {
  healthy: {
    tone: "ok",
    label: "Healthy",
    icon: <Check strokeWidth={2.6} aria-hidden />,
    description: "All systems operational. Events are being processed normally.",
  },
  degraded: {
    tone: "warn",
    label: "Degraded",
    icon: <TriangleAlert aria-hidden />,
    description:
      "A non-critical dependency is reporting errors. Live dashboard and ingestion still work.",
  },
  unhealthy: {
    tone: "fail",
    label: "Unhealthy",
    icon: <OctagonAlert aria-hidden />,
    description:
      "A critical dependency is down. Events cannot be stored until the issue is resolved.",
  },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function ComponentIcon({ name }: { name: string }) {
  if (name === "postgresql") return <Database aria-hidden />;
  if (name === "clickhouse") return <HardDrive aria-hidden />;
  if (name === "redis") return <Server aria-hidden />;
  if (name.startsWith("broker:")) return <Cable aria-hidden />;
  return <Activity aria-hidden />;
}

function StatusBanner({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.unhealthy;
  const body = (
    <>
      <span className="font-semibold">{s.label}.</span> {s.description}
    </>
  );
  if (status === "healthy") return <Notice>{body}</Notice>;
  if (status === "degraded") return <WarnAlert>{body}</WarnAlert>;
  return <ErrorAlert>{body}</ErrorAlert>;
}

export default function SystemPage() {
  const {
    data: health,
    isLoading,
    isError,
    refetch,
  } = $api.useQuery("get", "/api/v1/system/health", {}, { refetchInterval: 10_000 });

  const { data: deadLetters } = $api.useQuery(
    "get",
    "/api/v1/system/dead-letters",
    {},
    { refetchInterval: 30_000 },
  );

  const overall = health ? (STATUS[health.status] ?? STATUS.unhealthy) : null;
  const components = health?.components ?? [];
  const up = components.filter((c) => c.status === "up").length;
  const down = components.length - up;

  const storage = health?.storage;
  const usedRatio =
    storage && storage.total_bytes > 0 ? storage.used_bytes / storage.total_bytes : 0;

  return (
    <>
      <PageHeader
        title="System health"
        meta={
          health && overall ? (
            <span className="inline-flex items-center gap-2">
              <Chip tone={overall.tone} icon={overall.icon}>
                {overall.label}
              </Chip>
              <span>
                {down > 0
                  ? `${down} of ${components.length} dependencies down`
                  : `${components.length} dependencies up`}{" "}
                · v{health.version}
              </span>
            </span>
          ) : undefined
        }
        actions={<RefreshButton onRefresh={() => refetch()} label="Refresh health" />}
      />
      <PageBody>
        {isError && (
          <ErrorAlert>Couldn&apos;t load system health. The API may be unreachable.</ErrorAlert>
        )}

        {health && <StatusBanner status={health.status} />}

        {isLoading && (
          <>
            <Skeleton className="h-[172px] w-full rounded-xl" />
            <Skeleton className="h-[106px] w-full rounded-xl" />
          </>
        )}

        {health && (
          <>
            <Panel aria-label="Dependencies">
              <PanelHeader title="Dependencies" subtitle={`${up} of ${components.length} up`} />
              <div className="overflow-hidden rounded-b-xl border-t border-line-soft">
                <ul className="-mr-px -mb-px grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                  {components.map((c) => {
                    const isUp = c.status === "up";
                    return (
                      <li
                        key={c.name}
                        className="flex min-w-0 items-start gap-3 border-r border-b border-line-soft px-4 py-3"
                      >
                        <span className="mt-px text-t3 [&_svg]:size-4">
                          <ComponentIcon name={c.name} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div
                            className="truncate font-mono text-[12.5px] text-foreground"
                            title={c.name}
                          >
                            {c.name}
                          </div>
                          <div className="mt-0.5 text-xs text-t3 tabular-nums">
                            {c.latency_ms != null && isUp
                              ? `${c.latency_ms} ms latency`
                              : isUp
                                ? "Responding"
                                : "Not responding"}
                          </div>
                          {c.message && (
                            <p className="mt-1 text-xs break-words text-t3">{c.message}</p>
                          )}
                        </div>
                        <Chip
                          tone={isUp ? "ok" : "fail"}
                          icon={
                            isUp ? (
                              <Check strokeWidth={2.6} aria-hidden />
                            ) : (
                              <X strokeWidth={2.6} aria-hidden />
                            )
                          }
                        >
                          {isUp ? "Up" : "Down"}
                        </Chip>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Panel>

            <section aria-labelledby="pipeline-heading" className="flex flex-col gap-2.5">
              <div className="flex items-center gap-1.5">
                <h2 id="pipeline-heading" className="label">
                  Event pipeline
                </h2>
                <InfoTip label="About the event pipeline">
                  <p>
                    Celery events flow through this pipeline: broker → parse → store in ClickHouse.
                    Events are always delivered live via WebSocket, but &quot;dropped&quot; events
                    won&apos;t appear in historical queries or metrics.
                  </p>
                  <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                    <dt className="text-foreground">Received</dt>
                    <dd>Total events from brokers</dd>
                    <dt className="text-foreground">Stored</dt>
                    <dd>Saved to database</dd>
                    <dt className="text-foreground">Lost</dt>
                    <dd>Failed to save after retry</dd>
                    <dt className="text-foreground">Unreadable</dt>
                    <dd>Could not be parsed</dd>
                    <dt className="text-foreground">Retries</dt>
                    <dd>Auto-retry attempts</dd>
                  </dl>
                </InfoTip>
              </div>
              <Readouts className={EVEN_READOUTS}>
                <Readout
                  label="Received"
                  value={formatNumber(health.pipeline.events_received)}
                  unit="events"
                />
                <Readout
                  label="Stored"
                  value={formatNumber(health.pipeline.events_inserted)}
                  delta={<span>{(health.pipeline.success_rate * 100).toFixed(1)}%</span>}
                />
                <Readout
                  label="Lost"
                  value={
                    <span className={cn(health.pipeline.events_dropped > 0 && "text-fail")}>
                      {formatNumber(health.pipeline.events_dropped)}
                    </span>
                  }
                  delta={
                    health.pipeline.events_dropped > 0 ? (
                      <span>{(health.pipeline.drop_rate * 100).toFixed(2)}% of total</span>
                    ) : undefined
                  }
                />
                <Readout
                  label="Unreadable"
                  value={
                    <span className={cn(health.pipeline.events_parse_failed > 0 && "text-warn")}>
                      {formatNumber(health.pipeline.events_parse_failed)}
                    </span>
                  }
                />
                <Readout
                  label="Retries"
                  value={formatNumber(health.pipeline.insert_retries)}
                  className="col-span-2 lg:col-span-1"
                />
              </Readouts>
            </section>

            {deadLetters && deadLetters.data.length > 0 && (
              <Panel className="overflow-hidden" aria-label="Recent failures">
                <PanelHeader
                  title="Recent failures"
                  subtitle="event batches that couldn't be stored"
                />
                <div className="overflow-x-auto border-t border-border">
                  <Table className="min-w-[560px] table-fixed">
                    <THead>
                      <Th className="w-[104px]">When</Th>
                      <Th className="w-[112px]">Type</Th>
                      <Th align="right" className="w-[88px]">
                        Events
                      </Th>
                      <Th>Error</Th>
                    </THead>
                    <tbody>
                      {deadLetters.data.slice(0, 20).map((dl) => (
                        <Tr key={dl.id}>
                          <Td className="whitespace-nowrap text-t2 tabular-nums">
                            <span title={new Date(dl.failed_at).toLocaleString()}>
                              {timeAgo(dl.failed_at)}
                            </span>
                          </Td>
                          <Td>
                            <Tag>{dl.event_type}</Tag>
                          </Td>
                          <Td align="right" className="font-mono text-[12.5px] text-t2">
                            {dl.event_count.toLocaleString()}
                          </Td>
                          <Td className="min-w-0">
                            <span className="block truncate text-t2" title={dl.error_message}>
                              {dl.error_message}
                            </span>
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </Panel>
            )}

            {storage && (
              <Panel className="overflow-hidden" aria-label="Storage">
                <PanelHeader title="Storage" subtitle="ClickHouse" />
                <div className="px-4 pb-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
                    <span className="text-t2">Disk</span>
                    <span className="font-mono text-[12.5px] text-foreground tabular-nums">
                      {formatBytes(storage.used_bytes)} / {formatBytes(storage.total_bytes)}
                    </span>
                  </div>
                  <div
                    className="mt-2 h-2 overflow-hidden rounded-full bg-raised"
                    role="meter"
                    aria-label="ClickHouse disk used"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(usedRatio * 100)}
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        usedRatio > 0.9 ? "bg-fail" : usedRatio > 0.7 ? "bg-warn" : "bg-bar-hi",
                      )}
                      style={{ width: `${Math.min(usedRatio * 100, 100)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-t3 tabular-nums">
                    <span>
                      {formatBytes(storage.free_bytes)} free · {Math.round(usedRatio * 100)}% used
                    </span>
                    {usedRatio > 0.9 && (
                      <span className="inline-flex items-center gap-1 text-fail">
                        <TriangleAlert className="size-3.5" aria-hidden />
                        Disk nearly full, events may be dropped
                      </span>
                    )}
                  </div>
                </div>

                {storage.tables.length > 0 && (
                  <div className="overflow-x-auto border-t border-border">
                    <Table className="table-fixed">
                      <THead>
                        <Th>Table</Th>
                        <Th align="right" className="w-[92px] sm:w-[120px]">
                          Rows
                        </Th>
                        <Th align="right" className="w-[92px] sm:w-[112px]">
                          On disk
                        </Th>
                      </THead>
                      <tbody>
                        {storage.tables.map((t) => (
                          <Tr key={t.table}>
                            <Td className="min-w-0">
                              <span
                                className="block truncate font-mono text-[12.5px] text-t2"
                                title={t.table}
                              >
                                {t.table}
                              </span>
                            </Td>
                            <Td align="right" className="font-mono text-[12.5px] text-foreground">
                              {t.rows.toLocaleString()}
                            </Td>
                            <Td align="right" className="font-mono text-[12.5px] text-foreground">
                              {formatBytes(t.bytes_on_disk)}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </Panel>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}

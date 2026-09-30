"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, PowerOff, Search, Server } from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { cn, formatDuration, timeAgo } from "@/lib/utils";
import { useHasPermission } from "@/hooks/use-current-user";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { LiveToggle } from "@/components/ui/live-toggle";
import { Panel } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert, Notice } from "@/components/shared/error-alert";
import { Skeleton } from "@/components/shared/skeleton";
import { SlotMeter } from "@/components/overview/workers-panel";
import type { WorkerEvent, WorkerHealthRow, WorkerTaskStats } from "@/types/api";

/// Workers shown per group before "Show all".
const GROUP_PREVIEW = 20;

type Status = "online" | "degraded" | "offline";

type ParsedWorker = {
  worker_id: string;
  hostname: string;
  active_tasks: number;
  cpu_percent: number;
  memory_mb: number;
  pool_size: number;
  pool_type: string;
  load_avg: number[];
  online: boolean;
  status: Status;
  health?: WorkerHealthRow;
  taskStats?: WorkerTaskStats;
};

type WorkerGroup = {
  name: string;
  workers: ParsedWorker[];
  online: number;
  running: number;
  slots: number;
  done: number;
  failed: number;
};

/// Workers of one deployment share a node name up to a numeric or hash
/// suffix. For Celery's default "celery@host" names the host is what varies:
/// celery@worker-alpha-1 and -2 → worker-alpha; worker-payments@box → worker-payments.
function stripSuffix(name: string): string {
  const match = name.match(/^(.+?)(?:-[a-f0-9]{6,}.*|-\d+)$/i);
  return match ? match[1] : name;
}

function deriveGroupName(hostname: string): string {
  const at = hostname.indexOf("@");
  if (at > 0) {
    const node = hostname.slice(0, at);
    return node === "celery" ? stripSuffix(hostname.slice(at + 1)) : stripSuffix(node);
  }
  const clean = stripSuffix(hostname);
  if (clean !== hostname) return clean;
  const parts = hostname.split("-");
  return parts.length > 2 ? parts.slice(0, -1).join("-") : hostname;
}

const STATUS: Record<Status, { label: string; dot: string; text: string }> = {
  online: { label: "Online", dot: "bg-ok", text: "text-foreground" },
  degraded: { label: "Degraded", dot: "bg-warn", text: "text-warn" },
  offline: { label: "Offline", dot: "bg-fail", text: "text-fail" },
};

function StatusCell({ worker }: { worker: ParsedWorker }) {
  const s = STATUS[worker.status];
  const gap = worker.health?.max_gap_secs;
  return (
    <span
      className={cn("inline-flex items-center gap-2 text-[12.5px] font-[550]", s.text)}
      title={
        worker.status === "degraded" && gap
          ? `Heartbeats up to ${Math.round(gap)}s apart in the last hour`
          : undefined
      }
    >
      <span className={cn("size-[7px] shrink-0 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

function loadText(load: number[]): string {
  return load.length
    ? load
        .slice(0, 3)
        .map((n) => n.toFixed(1))
        .join("  ")
    : "—";
}

export default function WorkersPage() {
  const router = useRouter();
  const canShutdown = useHasPermission("workers_shutdown");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("all");
  const [sortBy, setSortBy] = useState<"total" | "online" | "name" | "failed">("total");
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [live, setLive] = useState(true);
  const [shutdownTarget, setShutdownTarget] = useState<ParsedWorker | null>(null);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  const refetchInterval = live ? 15_000 : (false as const);
  const { data, isLoading, isError, error, refetch } = $api.useQuery(
    "get",
    "/api/v1/workers",
    { params: { query: { limit: 500 } } },
    { refetchInterval },
  );
  const { data: statsData } = $api.useQuery(
    "get",
    "/api/v1/workers/stats",
    {},
    { refetchInterval },
  );
  const { data: healthData } = $api.useQuery(
    "get",
    "/api/v1/workers/health",
    { params: { query: { hours: 1 } } },
    { refetchInterval },
  );

  const statsMap = useMemo(
    () => new Map((statsData?.data ?? []).map((r) => [r.worker_id, r])),
    [statsData],
  );
  const healthMap = useMemo(
    () => new Map((healthData?.data ?? []).map((r) => [r.worker_id, r])),
    [healthData],
  );
  const onlineIds = useMemo(
    () => new Set<string>(data?.online_workers ?? []),
    [data?.online_workers],
  );

  const workers = useMemo(() => {
    const byId = new Map<string, Omit<ParsedWorker, "status">>();
    // Newest event first per worker: the list is ordered by time, descending.
    for (const ev of (data?.worker_events ?? []) as WorkerEvent[]) {
      if (byId.has(ev.worker_id)) continue;
      byId.set(ev.worker_id, {
        worker_id: ev.worker_id,
        hostname: ev.hostname,
        active_tasks: ev.active_tasks,
        cpu_percent: ev.cpu_percent,
        memory_mb: ev.memory_mb,
        pool_size: ev.pool_size,
        pool_type: ev.pool_type,
        load_avg: ev.load_avg ?? [],
        online: onlineIds.has(ev.worker_id),
      });
    }
    for (const ws of data?.worker_states ?? []) {
      if (!ws.worker_id || byId.has(ws.worker_id)) continue;
      byId.set(ws.worker_id, {
        worker_id: ws.worker_id,
        hostname: ws.hostname ?? ws.worker_id.replace("celery@", ""),
        active_tasks: ws.active_tasks ?? 0,
        cpu_percent: ws.cpu_percent ?? 0,
        memory_mb: ws.memory_mb ?? 0,
        pool_size: ws.pool_size ?? 0,
        pool_type: ws.pool_type ?? "",
        load_avg: ws.load_avg ?? [],
        online: true,
      });
    }
    for (const wid of onlineIds) {
      if (byId.has(wid)) continue;
      byId.set(wid, {
        worker_id: wid,
        hostname: wid.replace("celery@", ""),
        active_tasks: 0,
        cpu_percent: 0,
        memory_mb: 0,
        pool_size: 0,
        pool_type: "",
        load_avg: [],
        online: true,
      });
    }
    return [...byId.values()].map((w): ParsedWorker => {
      const health = healthMap.get(w.worker_id);
      const status: Status = !w.online
        ? "offline"
        : health?.status === "degraded"
          ? "degraded"
          : "online";
      return { ...w, status, health, taskStats: statsMap.get(w.worker_id) };
    });
  }, [data, onlineIds, statsMap, healthMap]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workers.filter(
      (w) =>
        (statusFilter === "all" || (statusFilter === "online" ? w.online : !w.online)) &&
        (!q ||
          w.hostname.toLowerCase().includes(q) ||
          w.worker_id.toLowerCase().includes(q) ||
          deriveGroupName(w.hostname).toLowerCase().includes(q)),
    );
  }, [workers, search, statusFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, ParsedWorker[]>();
    for (const w of visible) {
      const name = grouped ? deriveGroupName(w.hostname) : "";
      map.set(name, [...(map.get(name) ?? []), w]);
    }
    const result: WorkerGroup[] = [...map].map(([name, list]) => {
      list.sort(
        (a, b) => Number(b.online) - Number(a.online) || a.hostname.localeCompare(b.hostname),
      );
      return {
        name,
        workers: list,
        online: list.filter((w) => w.online).length,
        running: list.reduce((n, w) => n + (w.online ? w.active_tasks : 0), 0),
        slots: list.reduce((n, w) => n + (w.online ? w.pool_size : 0), 0),
        done: list.reduce((n, w) => n + (w.taskStats?.succeeded ?? 0), 0),
        failed: list.reduce((n, w) => n + (w.taskStats?.failed ?? 0), 0),
      };
    });
    return result.sort((a, b) => {
      switch (sortBy) {
        case "online":
          return b.online - a.online || b.done - a.done;
        case "name":
          return a.name.localeCompare(b.name);
        case "failed":
          return b.failed - a.failed;
        default:
          return b.done + b.failed - (a.done + a.failed) || b.online - a.online;
      }
    });
  }, [visible, grouped, sortBy]);

  // Flat view sorts the workers themselves.
  const flat = useMemo(() => {
    if (grouped) return [];
    const list = [...visible];
    const total = (w: ParsedWorker) => (w.taskStats?.succeeded ?? 0) + (w.taskStats?.failed ?? 0);
    return list.sort((a, b) => {
      switch (sortBy) {
        case "online":
          return Number(b.online) - Number(a.online) || total(b) - total(a);
        case "name":
          return a.hostname.localeCompare(b.hostname);
        case "failed":
          return (b.taskStats?.failed ?? 0) - (a.taskStats?.failed ?? 0);
        default:
          return total(b) - total(a);
      }
    });
  }, [grouped, visible, sortBy]);

  const totalOnline = workers.filter((w) => w.online).length;
  const totalRunning = workers.reduce((n, w) => n + (w.online ? w.active_tasks : 0), 0);
  const totalSlots = workers.reduce((n, w) => n + (w.online ? w.pool_size : 0), 0);
  const deployments = new Set(workers.map((w) => deriveGroupName(w.hostname))).size;
  const showResources = workers.some((w) => w.cpu_percent > 0 || w.memory_mb > 0);
  const showPool = workers.some((w) => w.pool_type || w.pool_size > 0);

  const meta =
    workers.length > 0
      ? [
          `${totalOnline} of ${workers.length} online`,
          `${deployments} deployment${deployments === 1 ? "" : "s"}`,
          totalSlots > 0 ? `${totalRunning}/${totalSlots} slots busy` : `${totalRunning} running`,
        ].join(" · ")
      : undefined;

  async function shutdown() {
    if (!shutdownTarget) return;
    setShuttingDown(true);
    setActionError(null);
    try {
      await unwrap(
        fetchClient.POST("/api/v1/workers/{worker_id}/shutdown", {
          params: { path: { worker_id: shutdownTarget.worker_id } },
        }),
      );
      setNotice(`Shutdown sent to ${shutdownTarget.hostname}.`);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't send the shutdown command.");
    } finally {
      setShuttingDown(false);
      setShutdownTarget(null);
    }
  }

  const columns = 8 + (showPool ? 1 : 0) + (showResources ? 2 : 0) + (canShutdown ? 1 : 0);

  const row = (w: ParsedWorker) => {
    const s = w.taskStats;
    return (
      <tr
        key={w.worker_id}
        onClick={() => router.push(`/workers/${encodeURIComponent(w.worker_id)}`)}
        className={cn(
          "group cursor-pointer border-t border-line-soft transition-colors hover:bg-hover",
          !w.online && "bg-fail-wash/30",
        )}
      >
        <td className="py-2.5 pr-3 pl-4">
          <StatusCell worker={w} />
        </td>
        <td className="px-3 py-2.5">
          <Link
            href={`/workers/${encodeURIComponent(w.worker_id)}`}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "block truncate font-mono text-[12.5px] hover:text-link",
              w.online ? "text-foreground" : "text-t3",
            )}
            title={w.worker_id}
          >
            {w.hostname}
          </Link>
        </td>
        {showPool && (
          <td className="hidden px-3 py-2.5 text-[12.5px] whitespace-nowrap text-t2 lg:table-cell">
            {w.pool_type || w.pool_size ? (
              [w.pool_type, w.pool_size || null].filter(Boolean).join(" · ")
            ) : (
              <span className="text-t4">—</span>
            )}
          </td>
        )}
        <td className="px-3 py-2.5">
          {w.online ? (
            w.pool_size > 0 ? (
              <span className="flex items-center gap-2">
                <SlotMeter busy={w.active_tasks} slots={w.pool_size} />
                <span className="sr-only">
                  {w.active_tasks} of {w.pool_size} slots busy
                </span>
              </span>
            ) : (
              <span className="text-[12.5px] whitespace-nowrap text-t2 tabular-nums">
                {w.active_tasks} running
              </span>
            )
          ) : (
            <span className="text-t4">—</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {s ? s.succeeded.toLocaleString() : <span className="text-t4">—</span>}
        </td>
        <td
          className={cn(
            "px-3 py-2.5 text-right tabular-nums",
            s && s.failed > 0 ? "text-foreground" : "text-t3",
          )}
        >
          {s ? s.failed.toLocaleString() : <span className="text-t4">—</span>}
        </td>
        <td className="hidden px-3 py-2.5 text-right text-t2 tabular-nums md:table-cell">
          {s && s.avg_runtime > 0 ? (
            formatDuration(s.avg_runtime)
          ) : (
            <span className="text-t4">—</span>
          )}
        </td>
        {showResources && (
          <>
            <td className="hidden px-3 py-2.5 text-right tabular-nums xl:table-cell">
              <span
                className={
                  w.cpu_percent > 80 ? "text-fail" : w.cpu_percent > 60 ? "text-warn" : "text-t2"
                }
              >
                {w.online ? `${Math.round(w.cpu_percent)}%` : "—"}
              </span>
            </td>
            <td className="hidden px-3 py-2.5 text-right text-t2 tabular-nums xl:table-cell">
              {w.memory_mb > 0 ? `${Math.round(w.memory_mb)} MB` : "—"}
            </td>
          </>
        )}
        <td className="hidden px-3 py-2.5 text-right font-mono text-[12px] whitespace-pre text-t2 xl:table-cell">
          {w.online ? loadText(w.load_avg) : <span className="text-t4">—</span>}
        </td>
        <td
          className={cn(
            "px-3 py-2.5 text-right whitespace-nowrap tabular-nums",
            w.online ? "text-t3" : "text-fail",
          )}
        >
          {w.health?.last_heartbeat ? (
            timeAgo(w.health.last_heartbeat)
          ) : (
            <span className="text-t4">—</span>
          )}
        </td>
        {canShutdown && (
          <td className="w-12 py-2.5 pr-3 pl-1 text-right" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!w.online}
              onClick={() => setShutdownTarget(w)}
              aria-label={`Shut down ${w.hostname}`}
              title="Shut down"
              className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-fail disabled:opacity-0"
            >
              <PowerOff />
            </Button>
          </td>
        )}
      </tr>
    );
  };

  return (
    <>
      <PageHeader
        title="Workers"
        meta={meta}
        actions={
          <>
            <div className="relative w-56 shrink-0 max-sm:w-44">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-t3"
                aria-hidden
              />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Filter by name"
                aria-label="Filter workers by name"
                className="h-8 pl-8"
              />
            </div>
            <Segmented
              label="Status"
              options={[
                { value: "all", label: "All" },
                { value: "online", label: "Online" },
                { value: "offline", label: "Offline" },
              ]}
              value={statusFilter}
              onChange={setStatusFilter}
            />
            <Select
              value={grouped ? "group" : "flat"}
              onChange={(e) => setGrouped(e.target.value === "group")}
              aria-label="Grouping"
              className="h-8 w-auto"
            >
              <option value="group">Group by deployment</option>
              <option value="flat">No grouping</option>
            </Select>
            <Select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              aria-label="Sort workers by"
              className="h-8 w-auto"
            >
              <option value="total">Most tasks</option>
              <option value="failed">Most failures</option>
              <option value="online">Most online</option>
              <option value="name">Name</option>
            </Select>
            <LiveToggle on={live} onChange={setLive} every="15s" />
          </>
        }
      />
      <PageBody>
        {isError && (
          <ErrorAlert>
            Couldn&apos;t load workers: {(error as Error)?.message ?? "unknown error"}
          </ErrorAlert>
        )}
        {actionError && (
          <ErrorAlert onDismiss={() => setActionError(null)}>{actionError}</ErrorAlert>
        )}
        {notice && <Notice onDismiss={() => setNotice(null)}>{notice}</Notice>}

        {isLoading ? (
          <Panel className="flex flex-col gap-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </Panel>
        ) : workers.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Server />}
              title="No workers yet"
              description="Workers appear once they connect to the broker. Start them with the -E flag (or worker_send_task_events = True) so they publish events."
            />
          </Panel>
        ) : visible.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Search />}
              title={
                search.trim() ? `No workers match “${search.trim()}”` : `No ${statusFilter} workers`
              }
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setSearchInput("");
                    setStatusFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          </Panel>
        ) : (
          <Panel className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-b border-border [&>th]:whitespace-nowrap">
                    <th className="label w-[112px] py-2.5 pr-3 pl-4 text-left font-medium">
                      Status
                    </th>
                    <th className="label px-3 py-2.5 text-left font-medium">Worker</th>
                    {showPool && (
                      <th className="label hidden w-[120px] px-3 py-2.5 text-left font-medium lg:table-cell">
                        Pool
                      </th>
                    )}
                    <th className="label w-[150px] px-3 py-2.5 text-left font-medium">
                      Slots in use
                    </th>
                    <th className="label w-[104px] px-3 py-2.5 text-right font-medium">Done 24h</th>
                    <th className="label w-[104px] px-3 py-2.5 text-right font-medium">
                      Failed 24h
                    </th>
                    <th className="label hidden w-[120px] px-3 py-2.5 text-right font-medium md:table-cell">
                      Avg runtime
                    </th>
                    {showResources && (
                      <>
                        <th className="label hidden w-[64px] px-3 py-2.5 text-right font-medium xl:table-cell">
                          CPU
                        </th>
                        <th className="label hidden w-[88px] px-3 py-2.5 text-right font-medium xl:table-cell">
                          Memory
                        </th>
                      </>
                    )}
                    <th className="label hidden w-[120px] px-3 py-2.5 text-right font-medium xl:table-cell">
                      Load 1/5/15
                    </th>
                    <th className="label w-[104px] px-3 py-2.5 text-right font-medium">
                      Heartbeat
                    </th>
                    {canShutdown && <th className="w-12" aria-label="Actions" />}
                  </tr>
                </thead>
                {grouped ? (
                  groups.map((g) => {
                    const isCollapsed = collapsed.has(g.name);
                    const shown = showAll.has(g.name)
                      ? g.workers
                      : g.workers.slice(0, GROUP_PREVIEW);
                    return (
                      <tbody key={g.name}>
                        <tr className="border-t border-border bg-background/40">
                          <td colSpan={columns} className="px-2 py-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setCollapsed((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(g.name)) next.delete(g.name);
                                  else next.add(g.name);
                                  return next;
                                })
                              }
                              aria-expanded={!isCollapsed}
                              className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-hover"
                            >
                              <ChevronDown
                                className={cn(
                                  "size-3.5 shrink-0 text-t3 transition-transform",
                                  isCollapsed && "-rotate-90",
                                )}
                                aria-hidden
                              />
                              <span className="truncate font-mono text-[13px] font-semibold text-foreground">
                                {g.name}
                              </span>
                              <span className="truncate text-xs text-t3">
                                {g.workers.length} worker{g.workers.length === 1 ? "" : "s"} ·{" "}
                                {g.online} online ·{" "}
                                {g.slots > 0
                                  ? `${g.running}/${g.slots} slots busy`
                                  : `${g.running} running`}
                                {g.failed > 0 && ` · ${g.failed.toLocaleString()} failed`}
                              </span>
                            </button>
                          </td>
                        </tr>
                        {!isCollapsed && shown.map(row)}
                        {!isCollapsed && g.workers.length > shown.length && (
                          <tr className="border-t border-line-soft">
                            <td colSpan={columns} className="px-4 py-2">
                              <button
                                type="button"
                                onClick={() => setShowAll((prev) => new Set(prev).add(g.name))}
                                className="text-xs text-t3 transition-colors hover:text-foreground"
                              >
                                Show all {g.workers.length} workers
                              </button>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    );
                  })
                ) : (
                  <tbody>{flat.map(row)}</tbody>
                )}
              </table>
            </div>
          </Panel>
        )}
      </PageBody>

      <ConfirmDialog
        open={shutdownTarget != null}
        onOpenChange={(open) => !open && !shuttingDown && setShutdownTarget(null)}
        title="Shut down this worker?"
        description="The worker finishes the tasks it is running, then exits. It won't come back unless your process manager restarts it."
        subject={shutdownTarget?.worker_id}
        confirmLabel="Shut down"
        tone="danger"
        busy={shuttingDown}
        onConfirm={shutdown}
      />
    </>
  );
}

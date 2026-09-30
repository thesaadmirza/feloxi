"use client";

import { useMemo } from "react";
import Link from "next/link";
import { $api } from "@/lib/api";
import { cn, formatNumber } from "@/lib/utils";
import { Panel, PanelHeader, PanelLink } from "@/components/ui/panel";
import { Skeleton } from "@/components/shared/skeleton";
import type { WorkerTaskStats } from "@/types/api";

/// One block per pool slot; amber-free on purpose. A full pool turns orange
/// because saturated workers are the usual reason queues back up.
export function SlotMeter({ busy, slots }: { busy: number; slots: number }) {
  if (slots <= 0) return <span className="text-xs text-t3">—</span>;
  const full = busy >= slots;
  if (slots > 16) {
    return (
      <span className="block h-2 w-20 overflow-hidden rounded-full bg-raised">
        <span
          className={cn("block h-full", full ? "bg-warn" : "bg-t2")}
          style={{ width: `${Math.min(100, (busy / slots) * 100)}%` }}
        />
      </span>
    );
  }
  return (
    <span className="flex gap-[3px]" aria-label={`${busy} of ${slots} slots busy`}>
      {Array.from({ length: slots }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-2.5 w-2 rounded-[2px]",
            i < busy ? (full ? "bg-warn" : "bg-t2") : "border border-border bg-raised",
          )}
        />
      ))}
    </span>
  );
}

export function WorkersPanel({
  fromMinutes,
  className,
  limit = 6,
}: {
  fromMinutes: number;
  className?: string;
  limit?: number;
}) {
  const live = $api.useQuery("get", "/api/v1/dashboard/live", {}, { refetchInterval: 15_000 });
  const stats = $api.useQuery(
    "get",
    "/api/v1/workers/stats",
    { params: { query: { from_minutes: fromMinutes } } },
    { refetchInterval: 30_000 },
  );
  const done = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of (stats.data?.data ?? []) as WorkerTaskStats[])
      m.set(r.worker_id, r.succeeded + r.failed);
    return m;
  }, [stats.data]);
  const workers = (live.data?.workers ?? []).slice(0, limit);

  return (
    <Panel className={className} aria-label="Workers">
      <PanelHeader
        title="Workers"
        subtitle="slots in use · done in window"
        action={<PanelLink href="/workers">All workers</PanelLink>}
      />
      {live.isLoading ? (
        <div className="flex flex-col gap-2 px-4 pb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : workers.length === 0 ? (
        <p className="px-4 pt-4 pb-8 text-center text-[13px] text-t3">
          No workers online right now.
        </p>
      ) : (
        <ul className="border-t border-line-soft">
          {workers.map((w) => (
            <li key={w.worker_id} className="border-b border-line-soft last:border-b-0">
              <Link
                href={`/workers/${encodeURIComponent(w.worker_id)}`}
                className="flex h-10 items-center gap-3 px-4 transition-colors hover:bg-hover"
              >
                <span className="size-[7px] shrink-0 rounded-full bg-ok" aria-hidden />
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground"
                  title={w.worker_id}
                >
                  {w.worker_id}
                </span>
                {w.pool_size > 0 && <SlotMeter busy={w.active_tasks} slots={w.pool_size} />}
                <span className="w-[72px] text-right text-xs whitespace-nowrap text-t3 tabular-nums">
                  {w.pool_size > 0
                    ? `${w.active_tasks}/${w.pool_size} busy`
                    : `${w.active_tasks} running`}
                </span>
                <span className="w-12 text-right text-xs tabular-nums text-t2">
                  {formatNumber(done.get(w.worker_id) ?? 0)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

"use client";

import { $api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { Panel, PanelHeader, PanelLink } from "@/components/ui/panel";
import { Skeleton } from "@/components/shared/skeleton";

/// Live broker depth per queue: what is waiting right now.
export function QueuesPanel({ className, limit = 6 }: { className?: string; limit?: number }) {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/dashboard/live",
    {},
    { refetchInterval: 15_000 },
  );
  const queues = (data?.queues ?? []).slice(0, limit);
  const max = Math.max(1, ...queues.map((q) => q.depth));

  return (
    <Panel className={className} aria-label="Queues">
      <PanelHeader
        title="Queues"
        subtitle="waiting now"
        action={<PanelLink href="/queues">All queues</PanelLink>}
      />
      {isLoading ? (
        <div className="flex flex-col gap-2 px-4 pb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : queues.length === 0 ? (
        <p className="px-4 pt-4 pb-8 text-center text-[13px] text-t3">
          No queues reported by the broker yet.
        </p>
      ) : (
        <ul className="border-t border-line-soft">
          {queues.map((q) => (
            <li
              key={q.queue_name}
              className="flex flex-col gap-1.5 border-b border-line-soft px-4 py-2.5 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground">
                  {q.queue_name}
                </span>
                <span className="font-semibold tabular-nums text-foreground">
                  {q.depth > 0 ? (
                    formatNumber(q.depth)
                  ) : (
                    <span className="text-xs font-normal text-t3">idle</span>
                  )}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-raised">
                <div
                  className="h-full rounded-full bg-bar-hi"
                  style={{ width: `${Math.max((q.depth / max) * 100, q.depth > 0 ? 1.5 : 0)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

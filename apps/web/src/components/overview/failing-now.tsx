"use client";

import { useMemo } from "react";
import Link from "next/link";
import { $api } from "@/lib/api";
import { mergeFailureGroups } from "@/lib/fingerprint";
import { timeAgo } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import { Panel, PanelHeader, PanelLink } from "@/components/ui/panel";
import { FlatPulse } from "@/components/ui/pulse";
import { Skeleton } from "@/components/shared/skeleton";
import type { FailureGroupRow } from "@/types/api";
import { ExceptionMessage } from "./exception-message";

const NEW_WINDOW_MS = 60 * 60_000;
const BASELINE_MINUTES = 24 * 60;

/// Exceptions in the window, folded by fingerprint so messages that differ
/// only by an ID or URL count as one problem.
export function FailingNow({
  fromMinutes,
  limit = 5,
  className,
}: {
  fromMinutes: number;
  limit?: number;
  className?: string;
}) {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/metrics/failure-groups",
    { params: { query: { from_minutes: fromMinutes, limit: 200 } } },
    { refetchInterval: 30_000 },
  );

  // first_seen is clipped to the window, so "new" and "since" are judged
  // against a 24h baseline (the same query when the window is already 24h+).
  const baselineMinutes = Math.max(fromMinutes, BASELINE_MINUTES);
  const baseline = $api.useQuery(
    "get",
    "/api/v1/metrics/failure-groups",
    { params: { query: { from_minutes: baselineMinutes, limit: 200 } } },
    { refetchInterval: 60_000 },
  );
  const firstSeen = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of mergeFailureGroups((baseline.data?.data ?? []) as FailureGroupRow[]))
      m.set(g.fingerprint.key, g.first_seen);
    return m;
  }, [baseline.data]);

  const groups = useMemo(
    () => mergeFailureGroups((data?.data ?? []) as FailureGroupRow[]).slice(0, limit),
    [data, limit],
  );
  const now = Date.now();

  return (
    <Panel className={className} aria-label="Failing now">
      <PanelHeader
        title="Failing now"
        subtitle="exceptions grouped by fingerprint"
        action={<PanelLink href="/tasks?state=FAILURE">All failures</PanelLink>}
      />
      {isLoading ? (
        <div className="flex flex-col gap-2 px-4 pb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 pt-6 pb-10 text-center">
          <FlatPulse />
          <span className="text-[13px] font-semibold">No failures in this window</span>
          <span className="text-xs text-t3">New exceptions show up here within seconds.</span>
        </div>
      ) : (
        <ul className="border-t border-line-soft">
          {groups.map((g) => {
            const since = firstSeen.get(g.fingerprint.key) ?? g.first_seen;
            const fresh = baseline.data != null && now - since < NEW_WINDOW_MS;
            return (
              <li key={g.fingerprint.key} className="border-b border-line-soft last:border-b-0">
                <Link
                  href={`/tasks/${g.latest_task_id}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 py-2.5 transition-colors hover:bg-hover"
                  title={g.example}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12.5px] font-semibold text-fail">
                        {g.fingerprint.type || "Exception"}
                      </span>
                      {fresh && <Chip tone="amber">New</Chip>}
                      {g.variants > 1 && (
                        <span className="text-[11px] text-t3">{g.variants} variants</span>
                      )}
                    </div>
                    <ExceptionMessage
                      parts={g.fingerprint.parts}
                      className="mt-0.5 block text-[13px] leading-normal text-foreground"
                    />
                    <div className="mt-0.5 truncate font-mono text-[11.5px] text-t3">
                      {g.task_names[0]}
                      {g.task_names.length > 1 && ` +${g.task_names.length - 1}`}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 pt-0.5 text-right">
                    <span className="text-[15px] font-semibold tabular-nums text-foreground">
                      {g.count.toLocaleString()}
                    </span>
                    <span className="text-xs whitespace-nowrap text-t3">
                      {timeAgo(g.last_seen)}
                    </span>
                    <span className="text-[11px] whitespace-nowrap text-t3">
                      since {timeAgo(since).replace(" ago", "")}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

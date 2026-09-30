"use client";

import Link from "next/link";
import { Ban, ListTodo, RotateCw } from "lucide-react";
import { splitException } from "@/lib/fingerprint";
import { shortTaskName } from "@/lib/names";
import { cn, displayTaskName, formatDuration, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { StateBadge } from "@/components/shared/state-badge";
import { Skeleton } from "@/components/shared/skeleton";
import { EmptyState } from "@/components/shared/empty-state";

export type TaskRow = {
  task_id: string;
  task_name: string;
  state: string;
  queue: string;
  worker_id: string;
  runtime: number;
  timestamp: number;
  exception: string;
  event_type?: string;
};

/// States a revoke can still stop. Finished tasks ignore it.
export const UNFINISHED = new Set(["PENDING", "RECEIVED", "STARTED", "RETRY"]);

function stop(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export function ExceptionText({ raw, className }: { raw: string; className?: string }) {
  if (!raw) return <span className="text-t4">—</span>;
  const { type, message } = splitException(raw);
  return (
    <span className={cn("block truncate", className)} title={raw.split("\n")[0]}>
      {type && <span className="font-mono text-[12px] text-fail">{type}</span>}
      {type && message && " "}
      <span className="text-t2">{message}</span>
    </span>
  );
}

export function TaskTable({
  rows,
  loading,
  error,
  timeLabel,
  selectable,
  selected,
  onToggle,
  onToggleAll,
  canRetry,
  canRevoke,
  onRetry,
  onRevoke,
  onOpen,
  workerLabel,
  footer,
}: {
  rows: TaskRow[];
  loading: boolean;
  error: string | null;
  timeLabel: string;
  selectable: boolean;
  selected: Map<string, TaskRow>;
  onToggle: (row: TaskRow) => void;
  onToggleAll: () => void;
  canRetry: boolean;
  canRevoke: boolean;
  onRetry: (row: TaskRow) => void;
  onRevoke: (row: TaskRow) => void;
  onOpen: (taskId: string) => void;
  workerLabel: (id: string) => string;
  footer?: React.ReactNode;
}) {
  const onPage = rows.filter((r) => selected.has(r.task_id)).length;
  const all = rows.length > 0 && onPage === rows.length;

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full table-fixed text-[13px]">
        <thead>
          <tr className="border-b border-border">
            {selectable && (
              <th className="hidden w-10 py-2.5 pl-4 sm:table-cell">
                <Checkbox
                  ref={(el) => {
                    if (el) el.indeterminate = onPage > 0 && !all;
                  }}
                  checked={all}
                  onChange={onToggleAll}
                  disabled={rows.length === 0}
                  aria-label="Select all tasks on this page"
                />
              </th>
            )}
            <th className="label w-[104px] px-3 py-2.5 text-left font-medium sm:w-[112px]">
              State
            </th>
            <th className="label px-3 py-2.5 text-left font-medium md:w-[26%]">Task</th>
            <th className="label hidden px-3 py-2.5 text-left font-medium md:table-cell">
              Exception
            </th>
            <th className="label hidden w-[112px] px-3 py-2.5 text-left font-medium lg:table-cell">
              Queue
            </th>
            <th className="label hidden w-[200px] px-3 py-2.5 text-left font-medium 2xl:table-cell">
              Worker
            </th>
            <th className="label hidden w-[88px] px-3 py-2.5 text-right font-medium sm:table-cell">
              Runtime
            </th>
            <th className="label w-[84px] py-2.5 pr-4 pl-3 text-right font-medium sm:w-[96px]">
              {timeLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className="border-b border-line-soft last:border-b-0">
                <td colSpan={8} className="px-4 py-2">
                  <Skeleton className="h-5 w-full" />
                </td>
              </tr>
            ))}

          {!loading && error && (
            <tr>
              <td colSpan={8} className="px-4 py-12 text-center text-[13px] text-fail">
                Couldn&apos;t load tasks: {error}
              </td>
            </tr>
          )}

          {!loading && !error && rows.length === 0 && (
            <tr>
              <td colSpan={8}>
                <EmptyState
                  icon={<ListTodo />}
                  title="No tasks match"
                  description="Widen the time range or remove a filter."
                />
              </td>
            </tr>
          )}

          {!loading &&
            !error &&
            rows.map((row) => {
              const isSel = selected.has(row.task_id);
              const revocable = canRevoke && UNFINISHED.has(row.state.toUpperCase());
              return (
                <tr
                  key={`${row.task_id}-${row.timestamp}-${row.event_type ?? ""}`}
                  onClick={() => onOpen(row.task_id)}
                  aria-selected={selectable ? isSel : undefined}
                  className="group cursor-pointer border-b border-line-soft transition-colors last:border-b-0 hover:bg-hover"
                >
                  {selectable && (
                    <td className="hidden py-2 pl-4 sm:table-cell" onClick={stop}>
                      <Checkbox
                        checked={isSel}
                        onChange={() => onToggle(row)}
                        aria-label={`Select ${displayTaskName(row.task_name)} ${row.task_id}`}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <StateBadge state={row.state} />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/tasks/${row.task_id}`}
                      onClick={stop}
                      className="block truncate font-mono text-[12.5px] text-foreground hover:text-link"
                      title={`${row.task_name}\n${row.task_id}`}
                    >
                      <span className="md:hidden">
                        {shortTaskName(displayTaskName(row.task_name))}
                      </span>
                      <span className="hidden md:inline">{displayTaskName(row.task_name)}</span>
                    </Link>
                    {row.exception && (
                      <ExceptionText raw={row.exception} className="mt-0.5 text-xs md:hidden" />
                    )}
                  </td>
                  <td className="hidden px-3 py-2 md:table-cell">
                    <ExceptionText raw={row.exception} />
                  </td>
                  <td
                    className="hidden truncate px-3 py-2 font-mono text-[12px] text-t2 lg:table-cell"
                    title={row.queue}
                  >
                    {row.queue || <span className="text-t4">—</span>}
                  </td>
                  <td
                    className="hidden truncate px-3 py-2 font-mono text-[12px] text-t3 2xl:table-cell"
                    title={row.worker_id}
                  >
                    {row.worker_id ? (
                      workerLabel(row.worker_id)
                    ) : (
                      <span className="text-t4">—</span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-right tabular-nums text-t2 sm:table-cell">
                    {row.runtime > 0 ? (
                      formatDuration(row.runtime)
                    ) : (
                      <span className="text-t4">—</span>
                    )}
                  </td>
                  <td className="relative py-2 pr-4 pl-3 text-right">
                    <span
                      className="whitespace-nowrap text-t3 tabular-nums transition-opacity group-focus-within:opacity-0 group-hover:opacity-0"
                      title={new Date(row.timestamp).toLocaleString()}
                    >
                      {timeAgo(row.timestamp)}
                    </span>
                    {(canRetry || revocable) && (
                      <div
                        className="absolute inset-y-0 right-0 flex items-center gap-1 bg-gradient-to-l from-hover from-75% to-transparent pr-3 pl-8 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                        onClick={stop}
                      >
                        {canRetry && (
                          <Button size="sm" onClick={() => onRetry(row)}>
                            <RotateCw />
                            Retry
                          </Button>
                        )}
                        {revocable && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => onRevoke(row)}
                            aria-label="Revoke"
                            title="Revoke"
                          >
                            <Ban />
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
      {footer}
    </div>
  );
}

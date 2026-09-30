"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bug, ChevronRight } from "lucide-react";
import type { MergedFailureGroup } from "@/lib/fingerprint";
import { shortTaskName } from "@/lib/names";
import { cn, timeAgo } from "@/lib/utils";
import { Skeleton } from "@/components/shared/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ExceptionMessage } from "@/components/overview/exception-message";
import { Traceback } from "./traceback";

/// Longest literal run of a normalized message: a search string that finds
/// every variant of the group ("Payment declined for order").
export function searchPhrase(g: MergedFailureGroup): string {
  const texts = g.fingerprint.parts.flatMap((p) =>
    "text" in p ? [p.text.trim().replace(/[:,;]+$/, "")] : [],
  );
  const best = texts.sort((a, b) => b.length - a.length)[0];
  return best && best.length >= 4 ? best : g.fingerprint.type;
}

export function FailureGroups({
  groups,
  loading,
  error,
}: {
  groups: MergedFailureGroup[];
  loading: boolean;
  error: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-12 text-center text-[13px] text-fail">
        Couldn&apos;t load exception groups.
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card">
        <EmptyState
          icon={<Bug />}
          title="No exceptions in this window"
          description="Widen the time range to look further back."
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full table-fixed text-[13px]">
        <thead>
          <tr className="border-b border-border">
            <th className="w-10" aria-label="Expand" />
            <th className="label py-2.5 pr-3 text-left font-medium">Exception</th>
            <th className="label hidden w-[26%] px-3 py-2.5 text-left font-medium lg:table-cell">
              Tasks
            </th>
            <th className="label w-[72px] px-3 py-2.5 text-right font-medium">Count</th>
            <th className="label hidden w-[108px] px-3 py-2.5 text-right font-medium whitespace-nowrap sm:table-cell">
              First seen
            </th>
            <th className="label w-[96px] py-2.5 pr-4 pl-3 text-right font-medium whitespace-nowrap sm:w-[108px]">
              Last seen
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const key = g.fingerprint.key;
            const isOpen = open === key;
            const toggle = () => setOpen(isOpen ? null : key);
            return (
              <Fragment key={key}>
                <tr
                  onClick={toggle}
                  className={cn(
                    "cursor-pointer border-b border-line-soft transition-colors hover:bg-hover",
                    isOpen && "bg-hover",
                  )}
                >
                  <td className="py-2.5 pl-3 align-top">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle();
                      }}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Hide" : "Show"} details for ${g.fingerprint.type || "exception"}`}
                      className="grid size-6 place-items-center rounded-md text-t3 transition-colors hover:bg-raised hover:text-foreground"
                    >
                      <ChevronRight
                        className={cn("size-3.5 transition-transform", isOpen && "rotate-90")}
                        aria-hidden
                      />
                    </button>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-[12.5px] font-semibold text-fail">
                        {g.fingerprint.type || "Exception"}
                      </span>
                      {g.variants > 1 && (
                        <span className="shrink-0 text-[11px] text-t3">{g.variants} variants</span>
                      )}
                    </div>
                    <ExceptionMessage
                      parts={g.fingerprint.parts}
                      className="mt-0.5 block truncate text-foreground"
                    />
                  </td>
                  <td
                    className="hidden truncate px-3 py-2.5 font-mono text-[12px] text-t2 lg:table-cell"
                    title={g.task_names.join("\n")}
                  >
                    {shortTaskName(g.task_names[0] ?? "")}
                    {g.task_names.length > 1 && (
                      <span className="text-t3"> +{g.task_names.length - 1}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                    {g.count.toLocaleString()}
                  </td>
                  <td className="hidden px-3 py-2.5 text-right whitespace-nowrap text-t3 sm:table-cell">
                    {timeAgo(g.first_seen)}
                  </td>
                  <td className="py-2.5 pr-4 pl-3 text-right whitespace-nowrap text-t3">
                    {timeAgo(g.last_seen)}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-line-soft">
                    <td colSpan={6} className="px-4 pt-2 pb-4 sm:pl-[52px]">
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-t3">
                        <Link
                          href={`/tasks?state=FAILURE&search=${encodeURIComponent(searchPhrase(g))}`}
                          className="inline-flex items-center gap-1 font-[550] text-link hover:underline"
                        >
                          Show these tasks <ArrowRight className="size-3" aria-hidden />
                        </Link>
                        <Link
                          href={`/tasks/${g.latest_task_id}`}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          Latest occurrence{" "}
                          <span className="font-mono">{g.latest_task_id.slice(0, 8)}</span>
                        </Link>
                        <span className="min-w-0 truncate">
                          In <span className="font-mono text-t2">{g.task_names.join(", ")}</span>
                        </span>
                      </div>
                      {g.variants > 1 && (
                        <ul className="mt-3 flex flex-col gap-1 border-l-2 border-line-strong pl-3">
                          {g.samples.map((s, i) => (
                            <li
                              key={i}
                              className="truncate font-mono text-[11.5px] text-t2"
                              title={s}
                            >
                              {s.split("\n")[0]}
                            </li>
                          ))}
                          {g.variants > g.samples.length && (
                            <li className="text-[11.5px] text-t3">
                              and {g.variants - g.samples.length} more
                            </li>
                          )}
                        </ul>
                      )}
                      {g.traceback ? (
                        <Traceback raw={g.traceback} className="mt-3 max-h-80 overflow-y-auto" />
                      ) : (
                        <p className="mt-3 text-xs text-t3">
                          No traceback recorded for the latest occurrence.
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

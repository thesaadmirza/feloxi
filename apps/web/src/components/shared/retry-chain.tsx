"use client";

import Link from "next/link";
import { $api } from "@/lib/api";
import { getStateColor } from "@/lib/constants";
import { truncateId } from "@/lib/utils";
import { Skeleton } from "@/components/shared/skeleton";

interface RetryChainProps {
  taskId: string;
}

export default function RetryChain({ taskId }: RetryChainProps) {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/tasks/{task_id}/retry-chain",
    { params: { path: { task_id: taskId } } },
    { staleTime: 5 * 60 * 1000 },
  );

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!data || data.attempts.length <= 1) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {data.attempts.map((attempt, idx) => {
        const isCurrent = attempt.task_id === taskId;
        const color = getStateColor(attempt.state);

        return (
          <div key={attempt.task_id} className="flex items-center gap-2 shrink-0">
            {idx > 0 && (
              <div className="w-6 h-px bg-border" />
            )}
            <Link
              href={`/tasks/${attempt.task_id}`}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg border transition-colors hover:bg-secondary/50 ${
                isCurrent
                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                  : "border-border"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-xs font-medium text-foreground">
                  Attempt {idx + 1}
                </span>
              </div>
              <span
                className="text-[10px] font-medium uppercase tracking-wider"
                style={{ color }}
              >
                {attempt.state}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {truncateId(attempt.task_id, 10)}
              </span>
            </Link>
          </div>
        );
      })}
    </div>
  );
}

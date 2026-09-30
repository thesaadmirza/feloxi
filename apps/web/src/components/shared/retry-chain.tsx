"use client";

import Link from "next/link";
import { $api } from "@/lib/api";
import { cn, formatDuration } from "@/lib/utils";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StateGlyph, stateLabel } from "@/components/shared/state-badge";

interface RetryChainProps {
  taskId: string;
}

/// Every attempt of a task that was retried from Feloxi, oldest first.
export default function RetryChain({ taskId }: RetryChainProps) {
  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/tasks/{task_id}/retry-chain",
    { params: { path: { task_id: taskId } } },
    { staleTime: 5 * 60 * 1000 },
  );

  if (isLoading || !data || data.attempts.length <= 1) return null;

  return (
    <Panel aria-label="Retries" className="pb-3">
      <PanelHeader title="Retried from Feloxi" subtitle={`${data.attempts.length} attempts`} />
      <ol className="flex flex-col gap-1.5 px-3">
        {data.attempts.map((attempt, idx) => {
          const isCurrent = attempt.task_id === taskId;
          return (
            <li key={attempt.task_id}>
              <Link
                href={`/tasks/${attempt.task_id}`}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[12.5px] transition-colors",
                  isCurrent ? "border-amber-line bg-amber-wash/50" : "border-border hover:bg-hover",
                )}
              >
                <StateGlyph state={attempt.state} />
                <span className="font-[550] text-foreground">Attempt {idx + 1}</span>
                <span className="text-t3">{stateLabel(attempt.state)}</span>
                <span className="ml-auto font-mono text-[11.5px] text-t3">
                  {attempt.runtime > 0 ? `${formatDuration(attempt.runtime)} · ` : ""}
                  {attempt.task_id.slice(0, 8)}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

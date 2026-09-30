"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { $api } from "@/lib/api";
import { cn, displayTaskName, formatDuration } from "@/lib/utils";
import { Modal } from "@/components/ui/dialog";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/shared/skeleton";
import { StateGlyph } from "@/components/shared/state-badge";
import WorkflowDag from "@/components/shared/workflow-dag";
import type { DagEdge, DagNode } from "@/types/api";

const MAX_STEPS = 6;

/// The task's place in its chain, group or chord as a short step list, with
/// the full graph a click away.
/// Nodes in dependency order (parents before children), ties kept in API order.
function ordered(nodes: DagNode[], edges: DagEdge[]): DagNode[] {
  const ids = new Set(nodes.map((n) => n.task_id));
  const indegree = new Map(nodes.map((n) => [n.task_id, 0]));
  const next = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  }
  const byId = new Map(nodes.map((n) => [n.task_id, n]));
  const queue = nodes.filter((n) => indegree.get(n.task_id) === 0).map((n) => n.task_id);
  const out: DagNode[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(byId.get(id)!);
    for (const t of next.get(id) ?? []) {
      indegree.set(t, (indegree.get(t) ?? 1) - 1);
      if (indegree.get(t) === 0) queue.push(t);
    }
  }
  return [...out, ...nodes.filter((n) => !seen.has(n.task_id))];
}

export function WorkflowPanel({
  rootId,
  current,
}: {
  rootId: string;
  /// The open task; its state and runtime win over the workflow summary's.
  current: { task_id: string; state: string; runtime: number | null };
}) {
  const currentTaskId = current.task_id;
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = $api.useQuery("get", "/api/v1/workflows/{root_id}", {
    params: { path: { root_id: rootId } },
  });

  const kind = useMemo(() => {
    const types = new Set((data?.edges ?? []).map((e) => e.edge_type));
    if (types.size === 1) return [...types][0];
    return types.size > 1 ? "workflow" : "task";
  }, [data]);

  const nodes = useMemo(
    () =>
      ordered(data?.nodes ?? [], data?.edges ?? []).map((n) =>
        n.task_id === current.task_id
          ? { ...n, state: current.state, runtime: current.runtime ?? n.runtime }
          : n,
      ),
    [data, current.task_id, current.state, current.runtime],
  );
  const at = nodes.findIndex((n) => n.task_id === currentTaskId);
  // Keep the current step in view when the workflow is long.
  const from =
    nodes.length <= MAX_STEPS || at < 0
      ? 0
      : Math.min(Math.max(0, at - 2), nodes.length - MAX_STEPS);
  const shown = nodes.slice(from, from + MAX_STEPS);

  return (
    <Panel aria-label="Workflow">
      <PanelHeader
        title="Workflow"
        subtitle={
          data ? `${kind} · ${nodes.length} step${nodes.length === 1 ? "" : "s"}` : undefined
        }
        action={
          data && nodes.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1 text-xs text-t3 transition-colors hover:text-foreground"
            >
              Graph <ArrowRight className="size-3.5" aria-hidden />
            </button>
          ) : undefined
        }
      />
      {isLoading ? (
        <div className="flex flex-col gap-2 px-4 pb-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError || !data ? (
        <p className="px-4 pb-4 text-[13px] text-t3">Couldn&apos;t load this workflow.</p>
      ) : (
        <ol className="flex flex-col gap-1.5 px-3 pb-3">
          {from > 0 && (
            <li className="px-2 text-[11.5px] text-t3">
              {from} earlier step{from === 1 ? "" : "s"}
            </li>
          )}
          {shown.map((n) => {
            const current = n.task_id === currentTaskId;
            return (
              <li key={n.task_id}>
                <Link
                  href={`/tasks/${n.task_id}`}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "block rounded-lg border px-3 py-2 transition-colors",
                    current ? "border-amber-line bg-amber-wash/50" : "border-border hover:bg-hover",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <StateGlyph state={n.state} />
                    <span
                      className="truncate font-mono text-[12px] text-foreground"
                      title={n.task_name}
                    >
                      {displayTaskName(n.task_name)}
                    </span>
                  </div>
                  <div className="mt-0.5 pl-[21px] text-[11.5px] text-t3">
                    {current && <span className="text-link">this task</span>}
                    {current && n.runtime != null && n.runtime > 0 && " · "}
                    {n.runtime != null && n.runtime > 0
                      ? formatDuration(n.runtime)
                      : !current && "not finished"}
                  </div>
                </Link>
              </li>
            );
          })}
          {from + MAX_STEPS < nodes.length && (
            <li className="px-2 text-[11.5px] text-t3">
              {nodes.length - from - MAX_STEPS} more step
              {nodes.length - from - MAX_STEPS === 1 ? "" : "s"}
            </li>
          )}
        </ol>
      )}
      {data && (
        <Modal
          open={open}
          onOpenChange={setOpen}
          title="Workflow graph"
          description={`${nodes.length} tasks from root ${data.root_id.slice(0, 8)}`}
          size="xl"
        >
          <WorkflowDag
            nodes={data.nodes}
            edges={data.edges}
            rootId={data.root_id}
            currentTaskId={currentTaskId}
          />
        </Modal>
      )}
    </Panel>
  );
}

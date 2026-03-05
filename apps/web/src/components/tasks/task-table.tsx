"use client";

import Link from "next/link";
import type { TaskEvent } from "@/types/api";
import { cn, truncateId, formatDuration, timeAgo, taskStateBadgeClass } from "@/lib/utils";

type TaskTableProps = {
  tasks: TaskEvent[];
  onRetry?: (taskId: string) => void;
  onRevoke?: (taskId: string) => void;
};

export function TaskTable({ tasks, onRetry, onRevoke }: TaskTableProps) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No tasks found
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-4 py-3 font-medium">Task ID</th>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">State</th>
            <th className="px-4 py-3 font-medium">Queue</th>
            <th className="px-4 py-3 font-medium">Worker</th>
            <th className="px-4 py-3 font-medium">Runtime</th>
            <th className="px-4 py-3 font-medium">Time</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <TaskRow
              key={task.event_id}
              task={task}
              onRetry={onRetry}
              onRevoke={onRevoke}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({
  task,
  onRetry,
  onRevoke,
}: {
  task: TaskEvent;
  onRetry?: (taskId: string) => void;
  onRevoke?: (taskId: string) => void;
}) {
  const handleRetry = () => onRetry?.(task.task_id);
  const handleRevoke = () => onRevoke?.(task.task_id);

  return (
    <tr className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
      <td className="px-4 py-3">
        <Link
          href={`/tasks/${task.task_id}`}
          className="font-mono text-xs text-primary hover:underline"
        >
          {truncateId(task.task_id)}
        </Link>
      </td>
      <td className="px-4 py-3 font-medium">{task.task_name}</td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "px-2 py-0.5 rounded text-xs font-medium",
            taskStateBadgeClass(task.state)
          )}
        >
          {task.state}
        </span>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {task.queue || "—"}
      </td>
      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
        {task.worker_id ? truncateId(task.worker_id, 20) : "—"}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {task.runtime > 0 ? formatDuration(task.runtime) : "—"}
      </td>
      <td className="px-4 py-3 text-muted-foreground text-xs">
        {timeAgo(task.timestamp)}
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          {task.state === "FAILURE" && onRetry && (
            <button
              onClick={handleRetry}
              className="px-2 py-1 text-xs bg-primary/20 text-primary rounded hover:bg-primary/30"
            >
              Retry
            </button>
          )}
          {!["SUCCESS", "FAILURE", "REVOKED"].includes(task.state) &&
            onRevoke && (
              <button
                onClick={handleRevoke}
                className="px-2 py-1 text-xs bg-destructive/20 text-destructive rounded hover:bg-destructive/30"
              >
                Revoke
              </button>
            )}
        </div>
      </td>
    </tr>
  );
}

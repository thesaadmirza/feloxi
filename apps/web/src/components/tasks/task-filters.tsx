"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useCallback } from "react";
import type { TaskState } from "@/types/api";

const TASK_STATES: TaskState[] = [
  "PENDING",
  "RECEIVED",
  "STARTED",
  "SUCCESS",
  "FAILURE",
  "RETRY",
  "REVOKED",
];

type TaskFiltersProps = {
  taskNames?: string[];
  queueNames?: string[];
};

export function TaskFilters({ taskNames = [], queueNames = [] }: TaskFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentState = searchParams.get("state") || "";
  const currentTaskName = searchParams.get("task_name") || "";
  const currentQueue = searchParams.get("queue") || "";

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/tasks?${params.toString()}`);
    },
    [router, searchParams]
  );

  const handleStateChange = (e: React.ChangeEvent<HTMLSelectElement>) =>
    updateFilter("state", e.target.value);

  const handleTaskNameChange = (e: React.ChangeEvent<HTMLSelectElement>) =>
    updateFilter("task_name", e.target.value);

  const handleQueueChange = (e: React.ChangeEvent<HTMLSelectElement>) =>
    updateFilter("queue", e.target.value);

  const clearFilters = () => router.push("/tasks");

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      <select
        value={currentState}
        onChange={handleStateChange}
        className="bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground"
      >
        <option value="">All States</option>
        {TASK_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        value={currentTaskName}
        onChange={handleTaskNameChange}
        className="bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground"
      >
        <option value="">All Task Types</option>
        {taskNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      <select
        value={currentQueue}
        onChange={handleQueueChange}
        className="bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground"
      >
        <option value="">All Queues</option>
        {queueNames.map((q) => (
          <option key={q} value={q}>
            {q}
          </option>
        ))}
      </select>

      {(currentState || currentTaskName || currentQueue) && (
        <button
          onClick={clearFilters}
          className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition"
        >
          Clear Filters
        </button>
      )}
    </div>
  );
}

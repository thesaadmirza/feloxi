import { fetchClient, unwrap } from "@/lib/api";

function parseJson(raw: string | undefined, fallback: unknown): unknown {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/// Publishes a fresh copy of a task. List rows carry no args or kwargs, so
/// the merged task record is fetched first and its arguments are resent,
/// the same payload the task page sends.
export async function retryTask(taskId: string) {
  const task = await unwrap(
    fetchClient.GET("/api/v1/tasks/{task_id}", { params: { path: { task_id: taskId } } }),
  );
  return unwrap(
    fetchClient.POST("/api/v1/tasks/{task_id}/retry", {
      params: { path: { task_id: taskId } },
      body: {
        task_name: task.task_name,
        args: parseJson(task.args, []),
        kwargs: parseJson(task.kwargs, {}),
        queue: task.queue,
      },
    }),
  );
}

export async function revokeTask(taskId: string) {
  return unwrap(
    fetchClient.POST("/api/v1/tasks/{task_id}/revoke", { params: { path: { task_id: taskId } } }),
  );
}

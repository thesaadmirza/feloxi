/// "tasks.payments.process_payment" → "payments.process_payment": the module
/// and function, which is what tells two tasks apart in a narrow column.
export function shortTaskName(name: string): string {
  const parts = name.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : name;
}

/// Drops a node-name prefix every worker shares ("celery@") so the part that
/// differs, usually the host, is what gets shown.
export function workerLabeler(ids: string[]): (id: string) => string {
  if (ids.length < 2) return (id) => id;
  const prefix = ids[0].includes("@") ? ids[0].slice(0, ids[0].indexOf("@") + 1) : "";
  if (!prefix || !ids.every((id) => id.startsWith(prefix) && id.length > prefix.length))
    return (id) => id;
  return (id) => id.slice(prefix.length);
}

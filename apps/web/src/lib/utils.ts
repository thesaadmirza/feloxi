import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  if (seconds < 0.001) return `${(seconds * 1_000_000).toFixed(0)}μs`;
  if (seconds < 1) return `${(seconds * 1000).toFixed(1)}ms`;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function truncateId(id: string, len = 8): string {
  return id.length > len ? `${id.slice(0, len)}...` : id;
}

/// Take the first line of a (possibly multi-line) string and cap it at `max`
/// chars. Used to render stack traces / exception messages in list cells.
export function truncateFirstLine(raw: string, max = 80): string {
  const firstLine = raw.split("\n")[0]?.trim() ?? "";
  return firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine;
}

/// Format `ms` since epoch as `YYYY-MM-DDTHH:mm` in local time, the format
/// required by `<input type="datetime-local">`.
export function formatDateTimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
export function displayTaskName(name: string | undefined | null): string {
  if (!name || name === "unknown") return "unnamed task";
  return name;
}

export function timeAgo(dateInput: string | number): string {
  const now = Date.now();
  const date = typeof dateInput === "number" ? dateInput : new Date(dateInput).getTime();
  const diff = (now - date) / 1000;

  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

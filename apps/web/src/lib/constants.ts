export const STATE_COLORS: Record<string, string> = {
  PENDING: "#3b82f6",
  RECEIVED: "#8b5cf6",
  STARTED: "#f59e0b",
  SUCCESS: "#22c55e",
  FAILURE: "#ef4444",
  RETRY: "#f97316",
  REVOKED: "#6b7280",
  REJECTED: "#dc2626",
};

export const EDGE_TYPE_COLORS: Record<string, string> = {
  chain: "#3b82f6",
  group: "#8b5cf6",
  chord: "#f59e0b",
  callback: "#22c55e",
};

export const DAG_LAYOUT = {
  nodeWidth: 320,
  nodeHeight: 80,
  horizontalGap: 60,
  verticalGap: 44,
} as const;

export function getStateColor(state: string): string {
  return STATE_COLORS[state.toUpperCase()] ?? "#6b7280";
}

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

export type TimeRangeId = "15m" | "1h" | "6h" | "24h" | "7d" | "30d";

export const TIME_RANGE_PRESETS: readonly {
  id: TimeRangeId;
  label: string;
  minutes: number;
}[] = [
  { id: "15m", label: "15m", minutes: 15 },
  { id: "1h", label: "1h", minutes: 60 },
  { id: "6h", label: "6h", minutes: 60 * 6 },
  { id: "24h", label: "24h", minutes: 60 * 24 },
  { id: "7d", label: "7d", minutes: 60 * 24 * 7 },
  { id: "30d", label: "30d", minutes: 60 * 24 * 30 },
];

export const DEFAULT_TIME_RANGE: TimeRangeId = "24h";

export function getStateColor(state: string): string {
  return STATE_COLORS[state.toUpperCase()] ?? "#6b7280";
}

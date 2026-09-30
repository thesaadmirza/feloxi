// Theme-aware: these resolve through the CSS tokens in globals.css, so they
// work in inline styles and SVG attributes in both night and day themes.
export const STATE_COLORS: Record<string, string> = {
  PENDING: "var(--t3)",
  RECEIVED: "var(--t3)",
  STARTED: "var(--run)",
  SUCCESS: "var(--ok)",
  FAILURE: "var(--fail)",
  RETRY: "var(--warn)",
  REVOKED: "var(--t3)",
  REJECTED: "var(--fail)",
};

export const EDGE_TYPE_COLORS: Record<string, string> = {
  chain: "var(--t3)",
  group: "var(--run)",
  chord: "var(--t2)",
  callback: "var(--t3)",
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

/// "in the last …" wording for a preset.
export const TIME_RANGE_PHRASE: Record<TimeRangeId, string> = {
  "15m": "last 15 minutes",
  "1h": "last hour",
  "6h": "last 6 hours",
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "30d": "last 30 days",
};

export const AUTH_INPUT_BASE =
  "w-full h-10 px-3 rounded-lg bg-card border text-foreground placeholder:text-t3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-amber transition-colors";
export const AUTH_INPUT_NORMAL = "border-line-strong hover:border-t4";
export const AUTH_INPUT_ERROR = "border-fail/60 focus:ring-fail/30 focus:border-fail";

export function getStateColor(state: string): string {
  return STATE_COLORS[state.toUpperCase()] ?? "var(--t3)";
}

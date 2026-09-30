import type { AlertChannel, AlertRule } from "@/types/api";

export type ConditionType =
  | "task_failure_rate"
  | "queue_depth"
  | "worker_offline"
  | "task_duration"
  | "beat_missed"
  | "task_failed"
  | "no_events"
  | "throughput_anomaly"
  | "latency_anomaly"
  | "error_rate_spike";

export const CONDITION_TYPES: { value: ConditionType; label: string; description: string }[] = [
  {
    value: "task_failure_rate",
    label: "Task failure rate",
    description: "Alert when task failure rate exceeds a threshold over a rolling window",
  },
  {
    value: "queue_depth",
    label: "Queue depth",
    description: "Alert when a queue's pending task count exceeds a threshold",
  },
  {
    value: "worker_offline",
    label: "Worker offline",
    description: "Alert when a worker stops sending heartbeats",
  },
  {
    value: "task_duration",
    label: "Task duration",
    description: "Alert when a task's runtime percentile exceeds a threshold",
  },
  {
    value: "beat_missed",
    label: "Beat missed",
    description: "Alert when a Celery Beat scheduled task stops running",
  },
  {
    value: "task_failed",
    label: "Task failed",
    description: "Alert immediately when a specific task fails",
  },
  {
    value: "no_events",
    label: "No events",
    description:
      "Alert when no task events are received for a period (dead broker / all workers down)",
  },
  {
    value: "throughput_anomaly",
    label: "Throughput anomaly",
    description:
      "Alert when task throughput deviates significantly from the historical baseline (z-score)",
  },
  {
    value: "latency_anomaly",
    label: "Latency anomaly",
    description:
      "Alert when task latency deviates significantly from the historical baseline (z-score)",
  },
  {
    value: "error_rate_spike",
    label: "Error rate spike",
    description: "Alert when the error rate spikes relative to the recent baseline",
  },
];

export const CHANNEL_TYPES = [
  "slack_connection",
  "discord_connection",
  "slack",
  "email",
  "webhook",
  "pagerduty",
] as const;
export const CHANNEL_LABELS: Record<(typeof CHANNEL_TYPES)[number], string> = {
  slack_connection: "Slack (connected)",
  discord_connection: "Discord (connected)",
  slack: "Slack (webhook)",
  email: "Email",
  webhook: "Webhook",
  pagerduty: "PagerDuty",
};

export function conditionSummary(rule: AlertRule): string {
  const c = rule.condition;
  switch (c.type) {
    case "task_failure_rate": {
      const threshold = typeof c.threshold === "number" ? c.threshold : 0.1;
      return `Failure rate > ${(threshold * 100).toFixed(0)}% over ${c.window_minutes}m`;
    }
    case "queue_depth":
      return `Queue "${c.queue}" depth > ${c.threshold}`;
    case "worker_offline":
      return `Worker offline for > ${c.grace_period_seconds}s`;
    case "task_duration":
      return `Task "${c.task_name}" > ${c.threshold_seconds}s (p${Math.round((c.percentile ?? 0.95) * 100)})`;
    case "beat_missed":
      return c.schedule_name
        ? `Beat schedule "${c.schedule_name}" missed`
        : "Any beat schedule missed";
    case "task_failed":
      return `Task "${c.task_name}" failed`;
    case "no_events":
      return `No events for > ${c.silence_minutes}m`;
    case "throughput_anomaly":
      return `Throughput anomaly (z > ${c.zscore_threshold}) over ${c.window_minutes}m`;
    case "latency_anomaly":
      return `Latency anomaly (z > ${c.zscore_threshold}) over ${c.window_minutes}m`;
    case "error_rate_spike":
      return `Error rate spike > ${c.spike_factor}× baseline (${c.baseline_hours}h window)`;
    default:
      return (c as { type: string }).type;
  }
}

export type ChannelForm = {
  // Widened to string so rules created via API with not-yet-UI-editable
  // variants (discord/pagerduty/webhook _connection) still round-trip.
  type: string;
  [key: string]: unknown;
};

export function normalizeChannel(ch: ChannelForm): AlertChannel {
  // Severity floor applies to every channel kind; omit when unset ("any").
  const minSeverity = (ch.min_severity as string) || undefined;
  switch (ch.type) {
    case "slack_connection":
      return {
        type: "slack_connection",
        integration_id: (ch.integration_id as string) ?? "",
        channel_id: (ch.channel_id as string) ?? "",
        channel_name: (ch.channel_name as string) ?? "",
        min_severity: minSeverity,
      } as AlertChannel;
    case "discord_connection":
      return {
        type: "discord_connection",
        integration_id: (ch.integration_id as string) ?? "",
        min_severity: minSeverity,
      } as AlertChannel;
    case "slack":
      return {
        type: "slack",
        webhook_url: (ch.webhook_url as string) ?? "",
        min_severity: minSeverity,
      } as AlertChannel;
    case "email": {
      const raw = ch.to;
      const to = Array.isArray(raw)
        ? (raw as string[])
        : ((raw as string) ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      return { type: "email", to, min_severity: minSeverity } as AlertChannel;
    }
    case "webhook":
      return {
        type: "webhook",
        url: (ch.url as string) ?? "",
        headers: (ch.headers as Record<string, string> | null) ?? null,
        min_severity: minSeverity,
      } as AlertChannel;
    case "pagerduty":
      return {
        type: "pagerduty",
        routing_key: (ch.routing_key as string) ?? "",
        min_severity: minSeverity,
      } as AlertChannel;
    default:
      // Unknown/not-yet-UI-editable variants (e.g. discord_connection): pass
      // through verbatim so editing an existing rule doesn't drop them.
      return ch as unknown as AlertChannel;
  }
}

/// Returns a human error if a channel form is incomplete, else null.
export function channelError(ch: ChannelForm): string | null {
  switch (ch.type) {
    case "slack_connection":
      if (!ch.integration_id) return "Select a Slack workspace";
      if (!ch.channel_id) return "Select a Slack channel";
      return null;
    case "discord_connection":
      return ch.integration_id ? null : "Select a Discord webhook";
    case "slack":
      return ch.webhook_url ? null : "Enter a Slack webhook URL";
    case "email": {
      const raw = ch.to;
      const list = Array.isArray(raw)
        ? raw
        : ((raw as string) ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      return list.length > 0 ? null : "Enter at least one recipient";
    }
    case "webhook":
      return ch.url ? null : "Enter a webhook URL";
    case "pagerduty":
      return ch.routing_key ? null : "Enter a PagerDuty routing key";
    default:
      return null;
  }
}

export function normalizeCondition(
  type: ConditionType,
  values: Record<string, unknown>,
): Record<string, unknown> {
  switch (type) {
    case "task_failure_rate":
      return {
        type,
        threshold: (values.threshold as number) ?? 0.1,
        window_minutes: (values.window_minutes as number) ?? 10,
        task_name: ((values.task_name as string) || "").trim() || "*",
      };
    case "queue_depth":
      return {
        type,
        threshold: (values.threshold as number) ?? 100,
        queue: (values.queue as string) ?? "",
      };
    case "worker_offline":
      return {
        type,
        grace_period_seconds: (values.grace_period_seconds as number) ?? 60,
      };
    case "task_duration":
      return {
        type,
        threshold_seconds: (values.threshold_seconds as number) ?? 300,
        percentile: (values.percentile as number) ?? 0.95,
        task_name: ((values.task_name as string) || "").trim() || "*",
      };
    case "beat_missed":
      return {
        type,
        schedule_name: ((values.schedule_name as string) || "").trim(),
      };
    case "task_failed":
      return {
        type,
        task_name: ((values.task_name as string) || "").trim() || "*",
      };
    case "no_events":
      return {
        type,
        silence_minutes: (values.silence_minutes as number) ?? 15,
      };
    case "throughput_anomaly":
      return {
        type,
        zscore_threshold: (values.zscore_threshold as number) ?? 3.0,
        window_minutes: (values.window_minutes as number) ?? 30,
        task_name: ((values.task_name as string) || "").trim() || "*",
      };
    case "latency_anomaly":
      return {
        type,
        zscore_threshold: (values.zscore_threshold as number) ?? 3.0,
        window_minutes: (values.window_minutes as number) ?? 30,
        task_name: ((values.task_name as string) || "").trim() || "*",
      };
    case "error_rate_spike":
      return {
        type,
        spike_factor: (values.spike_factor as number) ?? 2.0,
        baseline_hours: (values.baseline_hours as number) ?? 24,
        task_name: ((values.task_name as string) || "").trim() || "*",
      };
  }
}

export const CONDITION_DEFAULTS: Record<ConditionType, Record<string, unknown>> = {
  task_failure_rate: { threshold: 0.1, window_minutes: 10, task_name: "*" },
  queue_depth: { threshold: 100 },
  worker_offline: { grace_period_seconds: 60 },
  task_duration: { threshold_seconds: 300, percentile: 0.95, task_name: "*" },
  beat_missed: { schedule_name: "" },
  task_failed: { task_name: "*" },
  no_events: { silence_minutes: 15 },
  throughput_anomaly: { zscore_threshold: 3.0, window_minutes: 30, task_name: "*" },
  latency_anomaly: { zscore_threshold: 3.0, window_minutes: 30, task_name: "*" },
  error_rate_spike: { spike_factor: 2.0, baseline_hours: 24, task_name: "*" },
};

const CHANNEL_KIND: Record<string, string> = {
  slack: "Slack",
  slack_connection: "Slack",
  discord_connection: "Discord",
  email: "Email",
  webhook: "Webhook",
  webhook_connection: "Webhook",
  pagerduty: "PagerDuty",
  pagerduty_connection: "PagerDuty",
};

/// Short name of a delivery channel: "Slack #ops-alerts", "Email sre@acme.dev",
/// "Webhook hooks.example.com".
export function channelLabel(ch: { type: string; [key: string]: unknown }): string {
  const kind = CHANNEL_KIND[ch.type] ?? ch.type;
  if (ch.type === "slack_connection" && ch.channel_name)
    return `${kind} #${ch.channel_name as string}`;
  if (ch.type === "email") {
    const to = Array.isArray(ch.to) ? (ch.to as string[]) : [];
    return to.length ? `${kind} ${to[0]}${to.length > 1 ? ` +${to.length - 1}` : ""}` : kind;
  }
  if (ch.type === "webhook" && typeof ch.url === "string") {
    try {
      return `${kind} ${new URL(ch.url).host}`;
    } catch {
      return kind;
    }
  }
  return kind;
}

/// Name of a channel key in an incident's delivery log ("webhook", "slack:…").
export function deliveryLabel(key: string): string {
  const [type, rest] = key.split(/:(.*)/);
  return CHANNEL_KIND[type] ? `${CHANNEL_KIND[type]}${rest ? ` ${rest}` : ""}` : key;
}

/// The task a rule watches, when it watches one (not "*").
export function ruleTaskName(rule: AlertRule | undefined): string | null {
  const c = rule?.condition as { task_name?: string } | undefined;
  return c?.task_name && c.task_name !== "*" ? c.task_name : null;
}

export type { AlertChannel };

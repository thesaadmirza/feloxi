"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Bell,
  History,
  Edit2,
  Trash2,
  Loader2,
  AlertTriangle,
  CheckCircle,
  BellOff,
  Zap,
  X,
  Save,
  ChevronDown,
  ChevronRight,
  Send,
} from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Pagination } from "@/components/shared/pagination";
import { useHasPermission } from "@/hooks/use-current-user";
import type { AlertRule, AlertHistory, AlertChannel } from "@/types/api";

const HISTORY_LIMIT = 50;

type TabId = "rules" | "history";
type ConditionType =
  | "task_failure_rate"
  | "queue_depth"
  | "worker_offline"
  | "task_duration";

const CONDITION_TYPES: { value: ConditionType; label: string; description: string }[] = [
  { value: "task_failure_rate", label: "Task Failure Rate", description: "Alert when task failure rate exceeds a threshold" },
  { value: "queue_depth", label: "Queue Depth", description: "Alert when queue length exceeds a threshold" },
  { value: "worker_offline", label: "Worker Offline", description: "Alert when a worker goes offline" },
  { value: "task_duration", label: "Task Duration", description: "Alert when task runtime exceeds a threshold" },
];

const CHANNEL_TYPES = ["slack", "email", "webhook", "pagerduty"] as const;
const inputClass = "w-full bg-secondary border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "block text-sm font-medium text-muted-foreground mb-1";

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    critical: "bg-destructive/20 text-destructive",
    warning: "bg-[#eab308]/20 text-[#eab308]",
    info: "bg-[#3b82f6]/20 text-[#3b82f6]",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[severity] ?? styles.info}`}>
      {severity}
    </span>
  );
}

function ChannelChip({ type }: { type: string }) {
  const icons: Record<string, string> = { slack: "S", email: "@", webhook: "W", pagerduty: "PD" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded bg-secondary text-xs font-mono text-muted-foreground">
      {icons[type] ?? type}
    </span>
  );
}

function conditionSummary(rule: AlertRule): string {
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
      return `Task "${c.task_name}" > ${c.threshold_seconds}s`;
    default:
      return c.type;
  }
}

type ChannelForm = {
  type: (typeof CHANNEL_TYPES)[number];
  [key: string]: unknown;
};

function ConditionFields({
  type,
  values,
  onChange,
}: {
  type: ConditionType;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  switch (type) {
    case "task_failure_rate":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Failure Rate Threshold (0–1)</label>
            <input type="number" min="0" max="1" step="0.01" value={(values.threshold as number) ?? 0.1}
              onChange={(e) => onChange("threshold", parseFloat(e.target.value))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Window (minutes)</label>
            <input type="number" min="1" value={(values.window_minutes as number) ?? 10}
              onChange={(e) => onChange("window_minutes", parseInt(e.target.value))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Task Name (optional)</label>
            <input type="text" value={(values.task_name as string) ?? ""}
              onChange={(e) => onChange("task_name", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Queue (optional)</label>
            <input type="text" value={(values.queue as string) ?? ""}
              onChange={(e) => onChange("queue", e.target.value)} className={inputClass} />
          </div>
        </div>
      );
    case "queue_depth":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Queue Name</label>
            <input type="text" value={(values.queue as string) ?? ""}
              onChange={(e) => onChange("queue", e.target.value)} className={inputClass} required />
          </div>
          <div>
            <label className={labelClass}>Depth Threshold</label>
            <input type="number" min="1" value={(values.threshold as number) ?? 100}
              onChange={(e) => onChange("threshold", parseInt(e.target.value))} className={inputClass} />
          </div>
        </div>
      );
    case "worker_offline":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Offline Timeout (seconds)</label>
            <input type="number" min="10" value={(values.timeout_seconds as number) ?? 60}
              onChange={(e) => onChange("timeout_seconds", parseInt(e.target.value))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Worker ID (optional)</label>
            <input type="text" value={(values.worker_id as string) ?? ""}
              onChange={(e) => onChange("worker_id", e.target.value)} className={inputClass} />
          </div>
        </div>
      );
    case "task_duration":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Task Name</label>
            <input type="text" value={(values.task_name as string) ?? ""}
              onChange={(e) => onChange("task_name", e.target.value)} className={inputClass} required />
          </div>
          <div>
            <label className={labelClass}>Duration Threshold (seconds)</label>
            <input type="number" min="1" value={(values.threshold_seconds as number) ?? 300}
              onChange={(e) => onChange("threshold_seconds", parseInt(e.target.value))} className={inputClass} />
          </div>
        </div>
      );
    default:
      return null;
  }
}

function ChannelEditor({
  channel, index, onChange, onRemove,
}: {
  channel: ChannelForm;
  index: number;
  onChange: (index: number, key: string, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  const fieldClass = "flex-1 bg-secondary border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring";
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <select value={channel.type} onChange={(e) => onChange(index, "type", e.target.value)}
          className="bg-secondary border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring">
          {CHANNEL_TYPES.map((t) => (<option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>))}
        </select>
        <button type="button" onClick={() => onRemove(index)}
          className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {channel.type === "slack" && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground w-24 shrink-0">Webhook URL</label>
          <input type="url" value={(channel.webhook_url as string) ?? ""}
            onChange={(e) => onChange(index, "webhook_url", e.target.value)} className={fieldClass}
            placeholder="https://hooks.slack.com/services/..." />
        </div>
      )}
      {channel.type === "email" && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground w-24 shrink-0">Email</label>
          <input type="email" value={(channel.email as string) ?? ""}
            onChange={(e) => onChange(index, "email", e.target.value)} className={fieldClass}
            placeholder="ops@company.com" />
        </div>
      )}
      {channel.type === "webhook" && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground w-24 shrink-0">URL</label>
          <input type="url" value={(channel.url as string) ?? ""}
            onChange={(e) => onChange(index, "url", e.target.value)} className={fieldClass}
            placeholder="https://your-server.com/webhook" />
        </div>
      )}
      {channel.type === "pagerduty" && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground w-24 shrink-0">Routing Key</label>
          <input type="text" value={(channel.routing_key as string) ?? ""}
            onChange={(e) => onChange(index, "routing_key", e.target.value)} className={fieldClass}
            placeholder="PagerDuty Events API v2 key" />
        </div>
      )}
    </div>
  );
}

function AlertRuleModal({
  editRule,
  onClose,
}: {
  editRule?: AlertRule | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEditing = !!editRule;

  const [name, setName] = useState(editRule?.name ?? "");
  const [isEnabled, setIsEnabled] = useState(editRule?.is_enabled ?? true);
  const [conditionType, setConditionType] = useState<ConditionType>(() => {
    if (editRule) return (editRule.condition.type as ConditionType) ?? "task_failure_rate";
    return "task_failure_rate";
  });
  const [conditionValues, setConditionValues] = useState<Record<string, unknown>>(() => {
    if (editRule) {
      const { type: _, ...rest } = editRule.condition as Record<string, unknown>;
      return rest;
    }
    return { threshold: 0.1, window_minutes: 10 };
  });
  const [channels, setChannels] = useState<ChannelForm[]>(() => {
    if (editRule) return (editRule.channels as ChannelForm[]) ?? [];
    return [];
  });
  const [cooldownSecs, setCooldownSecs] = useState(editRule?.cooldown_secs ?? 300);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name,
        is_enabled: isEnabled,
        condition: { type: conditionType, ...conditionValues },
        channels: channels as AlertChannel[],
        cooldown_secs: cooldownSecs,
      };
      if (isEditing)
        return unwrap(
          fetchClient.PUT("/api/v1/alerts/rules/{rule_id}", {
            params: { path: { rule_id: editRule!.id } },
            body: body as never,
          })
        );
      return unwrap(
        fetchClient.POST("/api/v1/alerts/rules", { body: body as never })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/alerts/rules"] });
      onClose();
    },
    onError: (err) => {
      setSubmitError(err instanceof Error ? err.message : "Request failed");
    },
  });

  function updateCondition(key: string, value: unknown) {
    setConditionValues((prev) => ({ ...prev, [key]: value }));
  }

  function addChannel() {
    setChannels((prev) => [...prev, { type: "slack" }]);
  }

  function updateChannel(index: number, key: string, value: unknown) {
    setChannels((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  }

  function removeChannel(index: number) {
    setChannels((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="text-lg font-semibold text-foreground">
            {isEditing ? "Edit Alert Rule" : "Create Alert Rule"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); setSubmitError(null); mutation.mutate(); }}
          className="p-6 space-y-6"
        >
          {submitError && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-destructive/40 bg-destructive/5 text-destructive text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {submitError}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className={labelClass}>Rule Name <span className="text-destructive">*</span></label>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass}
                placeholder="e.g. High failure rate" />
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-ring" />
              <span className="text-sm text-foreground">Enabled</span>
            </label>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Condition</h3>
            <div>
              <label className={labelClass}>Type</label>
              <select value={conditionType}
                onChange={(e) => {
                  const ct = e.target.value as ConditionType;
                  setConditionType(ct);
                  const defaults: Record<ConditionType, Record<string, unknown>> = {
                    task_failure_rate: { threshold: 0.1, window_minutes: 10 },
                    queue_depth: { threshold: 100 },
                    worker_offline: { timeout_seconds: 60 },
                    task_duration: { threshold_seconds: 300 },
                  };
                  setConditionValues(defaults[ct] ?? {});
                }}
                className={inputClass}>
                {CONDITION_TYPES.map((ct) => (<option key={ct.value} value={ct.value}>{ct.label}</option>))}
              </select>
              <p className="text-xs text-muted-foreground mt-1.5">
                {CONDITION_TYPES.find((c) => c.value === conditionType)?.description}
              </p>
            </div>
            <ConditionFields type={conditionType} values={conditionValues} onChange={updateCondition} />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Notifications</h3>
              <button type="button" onClick={addChannel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-sm text-foreground hover:bg-secondary/80 transition">
                <Plus className="h-4 w-4" /> Add Channel
              </button>
            </div>
            {channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">No channels configured. Alert will fire but won&apos;t send notifications.</p>
            ) : (
              <div className="space-y-3">
                {channels.map((ch, i) => (
                  <ChannelEditor key={i} channel={ch} index={i} onChange={updateChannel} onRemove={removeChannel} />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Settings</h3>
            <div>
              <label className={labelClass}>Cooldown (seconds)</label>
              <input type="number" min="0" value={cooldownSecs}
                onChange={(e) => setCooldownSecs(parseInt(e.target.value))}
                className={`${inputClass} max-w-xs`} />
              <p className="text-xs text-muted-foreground mt-1">Minimum time between repeated notifications.</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg bg-secondary text-sm text-foreground hover:bg-secondary/80 transition">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isEditing ? "Save Changes" : "Create Rule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RulesTab({
  rules,
  isLoading,
  onEdit,
  onCreate,
  canWrite,
}: {
  rules: AlertRule[];
  isLoading: boolean;
  onEdit: (rule: AlertRule) => void;
  onCreate: () => void;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const toggleMutation = useMutation({
    mutationFn: (rule: AlertRule) =>
      unwrap(
        fetchClient.PUT("/api/v1/alerts/rules/{rule_id}", {
          params: { path: { rule_id: rule.id } },
          body: {
            name: rule.name,
            description: rule.description,
            condition: rule.condition,
            channels: rule.channels as AlertChannel[],
            cooldown_secs: rule.cooldown_secs,
            is_enabled: !rule.is_enabled,
          } as never,
        })
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/alerts/rules"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        fetchClient.DELETE("/api/v1/alerts/rules/{rule_id}", {
          params: { path: { rule_id: id } },
        })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/alerts/rules"] });
      setConfirmDelete(null);
      setDeletingId(null);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5 animate-pulse space-y-3">
            <div className="h-4 bg-secondary rounded w-48" />
            <div className="h-3 bg-secondary rounded w-72" />
          </div>
        ))}
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground rounded-xl border border-border bg-card">
        <BellOff className="h-12 w-12 opacity-30" />
        <p className="font-medium">No alert rules configured</p>
        {canWrite ? (
          <>
            <p className="text-sm">Create your first alert rule to get notified</p>
            <button
              onClick={onCreate}
              className="mt-2 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition"
            >
              <Plus className="h-4 w-4" />
              Create Alert Rule
            </button>
          </>
        ) : (
          <p className="text-sm">No rules have been created yet</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rules.map((rule) => (
        <div key={rule.id} className="rounded-xl border border-border bg-card p-5 hover:border-border/80 transition">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 mb-1">
                <Zap className="h-4 w-4 text-primary shrink-0" />
                <h3 className="font-semibold text-foreground truncate">{rule.name}</h3>
                {rule.is_enabled ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#22c55e]/20 text-[#22c55e] text-xs">
                    <CheckCircle className="h-3 w-3" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-xs">
                    <BellOff className="h-3 w-3" /> Disabled
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mb-3">{conditionSummary(rule)}</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Channels:</span>
                {rule.channels.length === 0 ? (
                  <span className="text-xs text-muted-foreground">None</span>
                ) : (
                  rule.channels.map((ch, i) => <ChannelChip key={i} type={ch.type} />)
                )}
                {rule.cooldown_secs > 0 && (
                  <span className="text-xs text-muted-foreground ml-2">· cooldown {rule.cooldown_secs}s</span>
                )}
                {rule.last_fired_at && (
                  <span className="text-xs text-muted-foreground ml-2">· last fired {timeAgo(rule.last_fired_at)}</span>
                )}
              </div>
            </div>

            {canWrite && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleMutation.mutate(rule)}
                  disabled={toggleMutation.isPending}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${rule.is_enabled ? "bg-primary" : "bg-border"}`}
                  title={rule.is_enabled ? "Disable rule" : "Enable rule"}>
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full shadow transition-transform ${rule.is_enabled ? "translate-x-4 bg-primary-foreground" : "translate-x-1 bg-muted-foreground"}`} />
                </button>

                <button onClick={() => onEdit(rule)}
                  className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition" title="Edit rule">
                  <Edit2 className="h-4 w-4" />
                </button>

                {confirmDelete === rule.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={async () => { setDeletingId(rule.id); await deleteMutation.mutateAsync(rule.id); }}
                      disabled={deleteMutation.isPending}
                      className="px-2 py-1 rounded bg-destructive text-white text-xs hover:bg-destructive/80 transition">
                      {deletingId === rule.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
                    </button>
                    <button onClick={() => setConfirmDelete(null)}
                      className="px-2 py-1 rounded bg-secondary text-xs text-foreground hover:bg-secondary/70 transition">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDelete(rule.id)}
                    className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition" title="Delete rule">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function DeliveryLog({ channels }: { channels: Record<string, { success: boolean; error?: string | null }> }) {
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Delivery Log</p>
      <div className="space-y-1.5">
        {Object.entries(channels).map(([ch, info]) => (
          <div key={ch} className="flex items-center gap-2 text-xs">
            <ChannelChip type={ch} />
            {info.success ? (
              <span className="flex items-center gap-1 text-[#22c55e]">
                <CheckCircle className="h-3 w-3" /> Delivered
              </span>
            ) : (
              <span className="flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3 w-3" /> Failed
                {info.error && <span className="text-muted-foreground ml-1">— {info.error}</span>}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type HistoryTabProps = {
  history: AlertHistory[];
  isLoading: boolean;
  hasMore: boolean;
  total?: number;
  page: number;
  onNext: () => void;
  onPrev: () => void;
};

function HistoryTab({ history, isLoading, hasMore, total, page, onNext, onPrev }: HistoryTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 animate-pulse space-y-2">
            <div className="h-4 bg-secondary rounded w-56" />
            <div className="h-3 bg-secondary rounded w-80" />
          </div>
        ))}
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground rounded-xl border border-border bg-card">
        <History className="h-12 w-12 opacity-30" />
        <p className="font-medium">No alerts fired yet</p>
        <p className="text-sm">Alert history will appear here when rules trigger</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="divide-y divide-border">
        {history.map((entry) => {
          const isExpanded = expandedId === entry.id;
          const hasDeliveryLog = entry.channels_sent && Object.keys(entry.channels_sent).length > 0;
          const hasDetails = entry.details && Object.keys(entry.details).length > 0;

          return (
            <div key={entry.id} className="hover:bg-secondary/20 transition">
              <button
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                className="w-full flex items-start justify-between px-5 py-4 gap-4 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {(hasDeliveryLog || hasDetails) ? (
                      isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> :
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : <div className="w-3.5" />}
                    <SeverityBadge severity={entry.severity} />
                    <span className="text-sm font-medium text-foreground truncate">{entry.summary}</span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-5">
                    Rule: {entry.rule_name ?? entry.rule_id.slice(0, 8)}
                    {entry.resolved_at && (
                      <span className="ml-2 text-[#22c55e]">· resolved {timeAgo(entry.resolved_at)}</span>
                    )}
                    {hasDeliveryLog && (
                      <span className="ml-2">
                        · <Send className="inline h-3 w-3" />{" "}
                        {Object.values(entry.channels_sent!).filter((c) => c.success).length}/
                        {Object.keys(entry.channels_sent!).length} delivered
                      </span>
                    )}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{timeAgo(entry.fired_at)}</span>
              </button>

              {isExpanded && (
                <div className="px-5 pb-4 ml-5 space-y-3">
                  {hasDetails && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Details</p>
                      <div className="rounded-lg bg-secondary/50 p-3">
                        <pre className="text-xs text-foreground whitespace-pre-wrap font-mono">
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {hasDeliveryLog && <DeliveryLog channels={entry.channels_sent!} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Pagination
        total={total}
        limit={HISTORY_LIMIT}
        hasMore={hasMore}
        currentCount={history.length}
        page={page}
        onNext={onNext}
        onPrev={onPrev}
      />
    </div>
  );
}

export default function AlertsPage() {
  const canWrite = useHasPermission("alerts_write");
  const [activeTab, setActiveTab] = useState<TabId>("rules");
  const [historyOffset, setHistoryOffset] = useState(0);
  const [modalState, setModalState] = useState<{
    open: boolean;
    editRule?: AlertRule | null;
  }>({ open: false });

  const {
    data: rulesData,
    isLoading: rulesLoading,
    isError: rulesError,
  } = $api.useQuery("get", "/api/v1/alerts/rules");

  const {
    data: historyData,
    isLoading: historyLoading,
    isError: historyError,
  } = $api.useQuery(
    "get",
    "/api/v1/alerts/history",
    { params: { query: { limit: HISTORY_LIMIT, offset: historyOffset } } },
    { enabled: activeTab === "history" }
  );

  const rules = (rulesData?.data ?? []) as AlertRule[];
  const history = (historyData?.data ?? []) as AlertHistory[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure alert rules and view firing history</p>
        </div>
        {canWrite && (
          <button
            onClick={() => setModalState({ open: true, editRule: null })}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
          >
            <Plus className="h-4 w-4" />
            Create Rule
          </button>
        )}
      </div>

      <div className="flex gap-1 p-1 bg-secondary rounded-lg w-fit">
        <button
          onClick={() => setActiveTab("rules")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
            activeTab === "rules" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Bell className="h-4 w-4" />
          Rules
          {rules.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-xs">{rules.length}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
            activeTab === "history" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="h-4 w-4" />
          History
        </button>
      </div>

      {activeTab === "rules" && rulesError && (
        <ErrorAlert>
          Failed to load alert rules
        </ErrorAlert>
      )}
      {activeTab === "history" && historyError && (
        <ErrorAlert>
          Failed to load alert history
        </ErrorAlert>
      )}

      {activeTab === "rules" && (
        <RulesTab
          rules={rules}
          isLoading={rulesLoading}
          onEdit={(rule) => setModalState({ open: true, editRule: rule })}
          onCreate={() => setModalState({ open: true, editRule: null })}
          canWrite={canWrite}
        />
      )}
      {activeTab === "history" && (
        <HistoryTab
          history={history}
          isLoading={historyLoading}
          hasMore={historyData?.has_more ?? false}
          total={historyData?.total ?? undefined}
          page={Math.floor(historyOffset / HISTORY_LIMIT) + 1}
          onNext={() => setHistoryOffset((prev) => prev + HISTORY_LIMIT)}
          onPrev={() => setHistoryOffset((prev) => Math.max(0, prev - HISTORY_LIMIT))}
        />
      )}

      {modalState.open && (
        <AlertRuleModal
          editRule={modalState.editRule}
          onClose={() => setModalState({ open: false })}
        />
      )}
    </div>
  );
}

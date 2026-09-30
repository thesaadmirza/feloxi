"use client";

import { useEffect, useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { ErrorAlert } from "@/components/shared/error-alert";
import type { AlertRule } from "@/types/api";
import {
  CHANNEL_LABELS,
  CHANNEL_TYPES,
  CONDITION_DEFAULTS,
  CONDITION_TYPES,
  channelError,
  normalizeChannel,
  normalizeCondition,
  type ChannelForm,
  type ConditionType,
} from "./model";

type Values = Record<string, unknown>;

function NumberField({
  label,
  name,
  values,
  onChange,
  fallback,
  min,
  max,
  step,
  float,
  hint,
}: {
  label: string;
  name: string;
  values: Values;
  onChange: (key: string, value: unknown) => void;
  fallback: number;
  min?: number;
  max?: number;
  step?: number;
  float?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={(values[name] as number) ?? fallback}
        onChange={(e) =>
          onChange(name, float ? parseFloat(e.target.value) : parseInt(e.target.value))
        }
      />
    </Field>
  );
}

function TextField({
  label,
  name,
  values,
  onChange,
  placeholder,
  required,
  hint,
}: {
  label: string;
  name: string;
  values: Values;
  onChange: (key: string, value: unknown) => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        type="text"
        required={required}
        placeholder={placeholder}
        value={(values[name] as string) ?? ""}
        onChange={(e) => onChange(name, e.target.value)}
        className={
          name === "task_name" || name === "queue" || name === "schedule_name"
            ? "font-mono text-[12.5px]"
            : undefined
        }
      />
    </Field>
  );
}

function ConditionFields({
  type,
  values,
  onChange,
}: {
  type: ConditionType;
  values: Values;
  onChange: (key: string, value: unknown) => void;
}) {
  const p = { values, onChange };
  switch (type) {
    case "task_failure_rate":
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            {...p}
            name="threshold"
            label="Failure rate threshold (0–1)"
            fallback={0.1}
            min={0}
            max={1}
            step={0.01}
            float
          />
          <NumberField
            {...p}
            name="window_minutes"
            label="Window (minutes)"
            fallback={10}
            min={1}
          />
          <div className="sm:col-span-2">
            <TextField
              {...p}
              name="task_name"
              label="Task name"
              placeholder="*"
              hint="Use * for all tasks."
            />
          </div>
        </div>
      );
    case "queue_depth":
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField {...p} name="queue" label="Queue name" required />
          <NumberField {...p} name="threshold" label="Depth threshold" fallback={100} min={1} />
        </div>
      );
    case "worker_offline":
      return (
        <NumberField
          {...p}
          name="grace_period_seconds"
          label="Grace period (seconds)"
          fallback={60}
          min={10}
        />
      );
    case "task_duration":
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField {...p} name="task_name" label="Task name" placeholder="*" required />
          <NumberField
            {...p}
            name="threshold_seconds"
            label="Duration threshold (s)"
            fallback={300}
            min={1}
          />
          <NumberField
            {...p}
            name="percentile"
            label="Percentile (0–1)"
            fallback={0.95}
            min={0}
            max={1}
            step={0.01}
            float
          />
        </div>
      );
    case "beat_missed":
      return (
        <TextField
          {...p}
          name="schedule_name"
          label="Schedule name"
          placeholder="e.g. cleanup, send-digest"
          hint="The periodic task's name in your beat schedule. Leave blank to alert on any missed beat."
        />
      );
    case "task_failed":
      return (
        <TextField
          {...p}
          name="task_name"
          label="Task name"
          placeholder="*"
          hint="Use * for any task."
        />
      );
    case "no_events":
      return (
        <NumberField
          {...p}
          name="silence_minutes"
          label="Silence window (minutes)"
          fallback={15}
          min={1}
          hint="Fires when no task events arrive within the window: a dead broker, or every worker down."
        />
      );
    case "throughput_anomaly":
    case "latency_anomaly":
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField {...p} name="task_name" label="Task name" placeholder="*" />
          <NumberField
            {...p}
            name="zscore_threshold"
            label="Z-score threshold"
            fallback={3}
            min={1}
            step={0.1}
            float
          />
          <NumberField
            {...p}
            name="window_minutes"
            label="Window (minutes)"
            fallback={30}
            min={5}
          />
          <p className="text-xs text-t3 sm:col-span-3">
            Fires when {type === "throughput_anomaly" ? "throughput" : "latency"} moves more than
            this many standard deviations from its historical mean. Higher is less sensitive.
          </p>
        </div>
      );
    case "error_rate_spike":
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField {...p} name="task_name" label="Task name" placeholder="*" />
          <NumberField
            {...p}
            name="spike_factor"
            label="Spike factor"
            fallback={2}
            min={1.1}
            step={0.1}
            float
          />
          <NumberField
            {...p}
            name="baseline_hours"
            label="Baseline window (hours)"
            fallback={24}
            min={1}
          />
          <p className="text-xs text-t3 sm:col-span-3">
            Fires when the error rate is this many times its baseline. 2.0 means double the usual
            rate.
          </p>
        </div>
      );
    default:
      return null;
  }
}

function NotConnected({ what }: { what: string }) {
  return (
    <p className="text-[13px] text-t3">
      No {what} connected yet. Connect one in{" "}
      <a href="/settings/notifications" className="text-link hover:underline">
        Settings → Email &amp; webhooks
      </a>
      .
    </p>
  );
}

function DiscordConnectionEditor({
  channel,
  index,
  onChange,
}: {
  channel: ChannelForm;
  index: number;
  onChange: (index: number, key: string, value: unknown) => void;
}) {
  const { data: integrationsData } = $api.useQuery("get", "/api/v1/integrations");
  const discordIntegrations = (integrationsData?.data ?? []).filter(
    (i) => i.kind === "discord" && i.status === "active",
  );
  const integrationId = (channel.integration_id as string) ?? "";

  if (discordIntegrations.length === 0) return <NotConnected what="Discord channel" />;

  const stale = !!integrationId && !discordIntegrations.some((i) => i.id === integrationId);

  return (
    <div className="flex flex-col gap-2">
      <Select
        aria-label="Discord channel"
        value={stale ? "" : integrationId}
        onChange={(e) => onChange(index, "integration_id", e.target.value)}
      >
        <option value="">Select a Discord webhook…</option>
        {discordIntegrations.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </Select>
      {stale && (
        <p className="text-xs text-warn">
          The Discord webhook this rule used is gone. Pick another.
        </p>
      )}
    </div>
  );
}

function SlackConnectionEditor({
  channel,
  index,
  onChange,
}: {
  channel: ChannelForm;
  index: number;
  onChange: (index: number, key: string, value: unknown) => void;
}) {
  const { data: integrationsData } = $api.useQuery("get", "/api/v1/integrations");
  const slackIntegrations = (integrationsData?.data ?? []).filter(
    (i) => i.kind === "slack" && i.status === "active",
  );
  const integrationId = (channel.integration_id as string) ?? "";
  const channelId = (channel.channel_id as string) ?? "";
  const channelName = (channel.channel_name as string) ?? "";

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function sendTest() {
    if (!integrationId || !channelId) return;
    setTesting(true);
    setTestResult(null);
    const { data, error } = await fetchClient.POST("/api/v1/integrations/{id}/test", {
      params: { path: { id: integrationId } },
      body: { channel_id: channelId } as never,
    });
    setTesting(false);
    if (error)
      setTestResult({ ok: false, msg: "Test failed: rate-limited or missing permission." });
    else if (data?.success) setTestResult({ ok: true, msg: `Test sent to #${channelName}` });
    else setTestResult({ ok: false, msg: data?.error ?? "Test failed" });
  }

  if (slackIntegrations.length === 0) return <NotConnected what="Slack workspace" />;

  // A rule pointing at a workspace that's gone or inactive gets a warning
  // instead of a silent reset.
  const staleIntegration =
    !!integrationId && !slackIntegrations.some((i) => i.id === integrationId);

  return (
    <div className="flex flex-col gap-2">
      <Select
        aria-label="Slack workspace"
        value={staleIntegration ? "" : integrationId}
        onChange={(e) => {
          onChange(index, "integration_id", e.target.value);
          onChange(index, "channel_id", "");
          onChange(index, "channel_name", "");
        }}
      >
        <option value="">Select a workspace…</option>
        {slackIntegrations.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </Select>
      {staleIntegration && (
        <p className="text-xs text-warn">
          The Slack workspace this rule used is gone. Pick another.
        </p>
      )}
      {integrationId && !staleIntegration && (
        <ChannelCombobox
          key={integrationId}
          integrationId={integrationId}
          selectedId={channelId}
          selectedName={channelName}
          onSelect={(id, name) => {
            onChange(index, "channel_id", id);
            onChange(index, "channel_name", name);
            setTestResult(null);
          }}
        />
      )}
      {integrationId && !staleIntegration && channelId && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={sendTest} disabled={testing}>
            {testing ? <Loader2 className="animate-spin" /> : <Send />}
            Send test
          </Button>
          {testResult && (
            <span className={cn("text-xs", testResult.ok ? "text-ok" : "text-fail")}>
              {testResult.msg}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/// Live, server-side channel search. Slack workspaces can have thousands of
/// channels, so instead of shipping the whole list to the browser this queries
/// the API as the user types (debounced); the server filters its cached list
/// and returns a small page.
function ChannelCombobox({
  integrationId,
  selectedId,
  selectedName,
  onSelect,
}: {
  integrationId: string;
  selectedId: string;
  selectedName: string;
  onSelect: (id: string, name: string) => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching, isError, error } = $api.useQuery(
    "get",
    "/api/v1/integrations/{id}/slack/channels",
    { params: { path: { id: integrationId }, query: { q: debounced, limit: 50 } } },
    { enabled: open, placeholderData: (prev) => prev },
  );
  const rateLimited =
    (error as { error?: { code?: string } } | null)?.error?.code === "RATE_LIMITED";
  const results = data?.data ?? [];
  const total = data?.total ?? 0;
  const truncated = data?.truncated ?? false;

  async function refresh() {
    setRefreshing(true);
    // Bust the server-side cache (re-enumerate from Slack), then refetch.
    await fetchClient.GET("/api/v1/integrations/{id}/slack/channels", {
      params: { path: { id: integrationId }, query: { refresh: true, limit: 1 } },
    });
    await queryClient.invalidateQueries({
      queryKey: ["get", "/api/v1/integrations/{id}/slack/channels"],
    });
    setRefreshing(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={selectedId ? `#${selectedName} · type to change` : "Search channels…"}
        aria-label="Slack channel"
      />

      {open && (
        <div className="max-h-56 overflow-auto rounded-lg border border-line-strong bg-raised p-1">
          {isError ? (
            <p className="px-2.5 py-2 text-[13px] text-fail">
              {rateLimited
                ? "Slack is busy listing channels. Wait a few seconds and try again."
                : "Couldn't load channels. The connection may need reconnecting."}
            </p>
          ) : isFetching && results.length === 0 ? (
            <p className="px-2.5 py-2 text-[13px] text-t3">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-2.5 py-2 text-[13px] text-t3">
              {debounced ? `No channels match “${debounced}”.` : "No channels found."}
            </p>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onSelect(c.id, c.name);
                  setQuery("");
                  setDebounced("");
                  setOpen(false);
                }}
                className={cn(
                  "flex h-8 w-full items-center justify-between rounded-md px-2.5 text-left text-[13px] transition-colors hover:bg-hover",
                  c.id === selectedId ? "text-link" : "text-foreground",
                )}
              >
                <span className="truncate">#{c.name}</span>
                {c.id === selectedId && <Check className="size-4 shrink-0" />}
              </button>
            ))
          )}
          {truncated && (
            <p className="border-t border-border px-2.5 py-1.5 text-xs text-t3">
              Showing {results.length} of {total}. Keep typing to narrow.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-t3">
        <span>
          {selectedId ? (
            <>
              Selected: <span className="text-foreground">#{selectedName}</span>
            </>
          ) : (
            "Type to search channels"
          )}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3", (refreshing || isFetching) && "animate-spin")} />{" "}
          Refresh
        </button>
      </div>
      <p className="text-xs text-t3">
        Private channel missing? Invite the Feloxi bot in Slack (
        <code className="font-mono">/invite @Feloxi</code>), then refresh.
      </p>
    </div>
  );
}

function ChannelEditor({
  channel,
  index,
  onChange,
  onRemove,
}: {
  channel: ChannelForm;
  index: number;
  onChange: (index: number, key: string, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-3.5">
      <div className="flex items-center gap-2">
        <Select
          aria-label="Channel type"
          value={channel.type}
          onChange={(e) => onChange(index, "type", e.target.value)}
          className="w-auto"
        >
          {CHANNEL_TYPES.map((t) => (
            <option key={t} value={t}>
              {CHANNEL_LABELS[t]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Minimum severity"
          value={(channel.min_severity as string) ?? ""}
          onChange={(e) => onChange(index, "min_severity", e.target.value || undefined)}
          className="w-auto"
        >
          <option value="">All severities</option>
          <option value="warning">Warning and above</option>
          <option value="critical">Critical only</option>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onRemove(index)}
          aria-label="Remove channel"
          className="ml-auto hover:text-fail"
        >
          <Trash2 />
        </Button>
      </div>
      {channel.type === "slack_connection" && (
        <SlackConnectionEditor channel={channel} index={index} onChange={onChange} />
      )}
      {channel.type === "discord_connection" && (
        <DiscordConnectionEditor channel={channel} index={index} onChange={onChange} />
      )}
      {channel.type === "slack" && (
        <Field label="Webhook URL" htmlFor={`${id}-slack`}>
          <Input
            id={`${id}-slack`}
            type="url"
            value={(channel.webhook_url as string) ?? ""}
            onChange={(e) => onChange(index, "webhook_url", e.target.value)}
            placeholder="https://hooks.slack.com/services/…"
          />
        </Field>
      )}
      {channel.type === "email" && (
        <Field label="Recipients" htmlFor={`${id}-to`} hint="Separate addresses with commas.">
          <Input
            id={`${id}-to`}
            type="text"
            value={
              Array.isArray(channel.to)
                ? (channel.to as string[]).join(", ")
                : ((channel.to as string) ?? "")
            }
            onChange={(e) => onChange(index, "to", e.target.value)}
            placeholder="ops@company.com, team@company.com"
          />
        </Field>
      )}
      {channel.type === "webhook" && (
        <Field label="URL" htmlFor={`${id}-url`}>
          <Input
            id={`${id}-url`}
            type="url"
            value={(channel.url as string) ?? ""}
            onChange={(e) => onChange(index, "url", e.target.value)}
            placeholder="https://your-server.com/webhook"
          />
        </Field>
      )}
      {channel.type === "pagerduty" && (
        <Field label="Routing key" htmlFor={`${id}-pd`}>
          <Input
            id={`${id}-pd`}
            type="text"
            value={(channel.routing_key as string) ?? ""}
            onChange={(e) => onChange(index, "routing_key", e.target.value)}
            placeholder="PagerDuty Events API v2 key"
            className="font-mono text-[12.5px]"
          />
        </Field>
      )}
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="label">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AlertRuleModal({
  editRule,
  onClose,
}: {
  editRule?: AlertRule | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEditing = !!editRule;
  const ids = useId();

  const [name, setName] = useState(editRule?.name ?? "");
  const [isEnabled, setIsEnabled] = useState(editRule?.is_enabled ?? true);
  const [conditionType, setConditionType] = useState<ConditionType>(() =>
    editRule
      ? ((editRule.condition.type as ConditionType) ?? "task_failure_rate")
      : "task_failure_rate",
  );
  const [conditionValues, setConditionValues] = useState<Values>(() => {
    if (editRule) {
      const { type: _, ...rest } = editRule.condition as Values;
      return rest;
    }
    return { threshold: 0.1, window_minutes: 10 };
  });
  const [channels, setChannels] = useState<ChannelForm[]>(() =>
    editRule ? ((editRule.channels as ChannelForm[]) ?? []) : [],
  );
  const [cooldownSecs, setCooldownSecs] = useState(editRule?.cooldown_secs ?? 300);
  const [severityOverride, setSeverityOverride] = useState<string>(
    editRule?.severity_override ?? "",
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name,
        is_enabled: isEnabled,
        condition: normalizeCondition(conditionType, conditionValues),
        channels: channels.map(normalizeChannel),
        cooldown_secs: cooldownSecs,
        severity_override: severityOverride || null,
      };
      if (isEditing)
        return unwrap(
          fetchClient.PUT("/api/v1/alerts/rules/{rule_id}", {
            params: { path: { rule_id: editRule!.id } },
            body: body as never,
          }),
        );
      return unwrap(fetchClient.POST("/api/v1/alerts/rules", { body: body as never }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/alerts/rules"] });
      onClose();
    },
    onError: (err) => setSubmitError(err instanceof Error ? err.message : "Request failed"),
  });

  function updateChannel(index: number, key: string, value: unknown) {
    setChannels((prev) => {
      const next = [...prev];
      next[index] =
        key === "type" ? { type: value as ChannelForm["type"] } : { ...next[index], [key]: value };
      return next;
    });
  }

  const formId = `${ids}-form`;

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={isEditing ? "Edit alert rule" : "New alert rule"}
      description="A rule watches one condition and notifies its channels when it fires and when it resolves."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="animate-spin" />}
            {isEditing ? "Save changes" : "Create rule"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitError(null);
          const bad = channels.map(channelError).find(Boolean);
          if (bad) {
            setSubmitError(bad);
            return;
          }
          mutation.mutate();
        }}
        className="flex flex-col gap-5"
      >
        {submitError && <ErrorAlert>{submitError}</ErrorAlert>}

        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Name" htmlFor={`${ids}-name`}>
            <Input
              id={`${ids}-name`}
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Payments failing"
            />
          </Field>
          <label className="flex h-9 cursor-pointer items-center gap-2.5 text-[13px]">
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} aria-label="Rule enabled" />
            Enabled
          </label>
        </div>

        <Section title="Condition">
          <Field
            label="Type"
            htmlFor={`${ids}-type`}
            hint={CONDITION_TYPES.find((c) => c.value === conditionType)?.description}
          >
            <Select
              id={`${ids}-type`}
              value={conditionType}
              onChange={(e) => {
                const ct = e.target.value as ConditionType;
                setConditionType(ct);
                setConditionValues(CONDITION_DEFAULTS[ct] ?? {});
              }}
            >
              {CONDITION_TYPES.map((ct) => (
                <option key={ct.value} value={ct.value}>
                  {ct.label}
                </option>
              ))}
            </Select>
          </Field>
          <ConditionFields
            type={conditionType}
            values={conditionValues}
            onChange={(k, v) => setConditionValues((prev) => ({ ...prev, [k]: v }))}
          />
        </Section>

        <Section
          title="Notify"
          action={
            <Button
              size="sm"
              onClick={() => setChannels((prev) => [...prev, { type: "slack_connection" }])}
            >
              <Plus />
              Add channel
            </Button>
          }
        >
          {channels.length === 0 ? (
            <p className="text-[13px] text-t3">
              No channels yet. The rule still fires and shows up here, but nobody is notified.
            </p>
          ) : (
            channels.map((ch, i) => (
              <ChannelEditor
                key={i}
                channel={ch}
                index={i}
                onChange={updateChannel}
                onRemove={(idx) => setChannels((prev) => prev.filter((_, j) => j !== idx))}
              />
            ))
          )}
        </Section>

        <Section title="Delivery">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Cooldown (seconds)"
              htmlFor={`${ids}-cooldown`}
              hint="Minimum time between repeat notifications."
            >
              <Input
                id={`${ids}-cooldown`}
                type="number"
                min={0}
                value={cooldownSecs}
                onChange={(e) => setCooldownSecs(parseInt(e.target.value))}
              />
            </Field>
            <Field
              label="Severity"
              htmlFor={`${ids}-severity`}
              hint="Overrides the condition's severity. Channels can filter on it."
            >
              <Select
                id={`${ids}-severity`}
                value={severityOverride}
                onChange={(e) => setSeverityOverride(e.target.value)}
              >
                <option value="">Automatic</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </Select>
            </Field>
          </div>
        </Section>
      </form>
    </Modal>
  );
}

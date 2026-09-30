"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plug, Send, Trash2, TriangleAlert } from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { ErrorAlert, Notice } from "@/components/shared/error-alert";
import { JsonViewer } from "@/components/shared/json-viewer";
import { Skeleton } from "@/components/shared/skeleton";
import { CopyButton } from "@/components/settings/copy-button";
import { CodeWell, IconTile, SettingsHeader, SettingsRow } from "@/components/settings/section";
import { UnitInput } from "@/components/settings/unit-input";

// Label and mark per integration kind. Adding a new kind here gives it a
// name + tile everywhere it's listed.
const PROVIDER_META: Record<string, { label: string; badge: string }> = {
  slack: { label: "Slack", badge: "S" },
  discord: { label: "Discord", badge: "D" },
  pagerduty: { label: "PagerDuty", badge: "PD" },
  webhook: { label: "Webhook", badge: "W" },
};

// OAuth "Connect" providers. Add an entry (and set its *_CLIENT_ID/SECRET on the
// server) to surface a new Connect button — no other UI changes needed.
const CONNECT_PROVIDERS: {
  key: "slack" | "discord" | "google";
  label: string;
  description: string;
  connectUrl: string;
}[] = [
  {
    key: "slack",
    label: "Slack",
    description: "Post alerts to channels in a Slack workspace.",
    connectUrl: "/api/v1/integrations/slack/connect",
  },
  {
    key: "discord",
    label: "Discord",
    description: "Post alerts to a channel on a Discord server.",
    connectUrl: "/api/v1/integrations/discord/connect",
  },
];

const WEBHOOK_PAYLOAD_EXAMPLE = {
  id: "alert-uuid",
  rule_name: "High failure rate",
  severity: "critical",
  summary: "Failure rate exceeded 10% threshold...",
  fired_at: "2026-03-03T21:00:00Z",
  details: {
    failure_rate: 0.15,
    p95_runtime: 12.5,
    recent_failures: 42,
  },
};

const PASSWORD_MASK = "••••••••";

function ProviderMark({ kind }: { kind: string }) {
  const meta = PROVIDER_META[kind];
  return (
    <IconTile>
      <span className="font-mono text-[12px] font-semibold text-foreground">
        {meta?.badge ?? kind.slice(0, 2).toUpperCase()}
      </span>
    </IconTile>
  );
}

function ConnectedIntegrationsCard() {
  const queryClient = useQueryClient();
  const { data: providers, isLoading: providersLoading } = $api.useQuery(
    "get",
    "/api/v1/integrations/providers",
  );
  const { data: integrationsData, isLoading } = $api.useQuery("get", "/api/v1/integrations");
  const integrations = integrationsData?.data ?? [];

  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const slackRedirectUrl = (providers as { slack_redirect_url?: string } | undefined)
    ?.slack_redirect_url;
  const discordRedirectUrl = (providers as { discord_redirect_url?: string } | undefined)
    ?.discord_redirect_url;

  // Listen for any OAuth popup's postMessage and refresh the list on success.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; ok?: boolean; error?: string };
      if (!data?.type?.endsWith("-oauth")) return;
      setConnecting(null);
      if (data.ok) {
        setConnectError(null);
        setConnectSuccess("Integration connected");
        queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/integrations"] });
      } else {
        setConnectSuccess(null);
        setConnectError(data.error ?? "Connection failed");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [queryClient]);

  function connect(p: (typeof CONNECT_PROVIDERS)[number]) {
    setConnectError(null);
    setConnectSuccess(null);
    const popup = window.open(p.connectUrl, `feloxi-${p.key}-oauth`, "width=600,height=750");
    if (!popup) {
      setConnectError("Popup blocked. Allow popups for this site and try again.");
      return;
    }
    setConnecting(p.key);
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        setConnecting((c) => (c === p.key ? null : c));
      }
    }, 500);
  }

  async function remove(id: string) {
    setDeletingId(id);
    setConnectError(null);
    const { error } = await fetchClient.DELETE("/api/v1/integrations/{id}", {
      params: { path: { id } },
    });
    setDeletingId(null);
    setConfirmDeleteId(null);
    if (error) {
      setConnectError("Couldn't remove the integration. You may not have permission.");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/integrations"] });
  }

  const available = CONNECT_PROVIDERS.filter(
    (p) => (providers as Record<string, boolean> | undefined)?.[p.key],
  );
  const deleteTarget = integrations.find((i) => i.id === confirmDeleteId);

  return (
    <Panel aria-label="Chat integrations">
      <PanelHeader title="Chat integrations" />
      <p className="px-4 pb-3.5 text-[13px] leading-relaxed text-t2">
        Connect a workspace once, then pick channels per alert rule. Webhook and PagerDuty
        destinations can also be pasted directly on a rule without connecting.
      </p>

      {(connectError || connectSuccess) && (
        <div className="flex flex-col gap-2 px-4 pb-3.5">
          {connectError && (
            <ErrorAlert onDismiss={() => setConnectError(null)}>{connectError}</ErrorAlert>
          )}
          {connectSuccess && (
            <Notice onDismiss={() => setConnectSuccess(null)}>{connectSuccess}</Notice>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="border-t border-line-soft px-4 py-3.5">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : integrations.length === 0 ? (
        <div className="flex items-center gap-3 border-t border-line-soft px-4 py-3 text-[13px] text-t3">
          <Plug className="size-4 shrink-0" aria-hidden />
          <span>No integrations connected yet. Connect one to route alerts to a chat channel.</span>
        </div>
      ) : (
        integrations.map((i) => {
          const meta = PROVIDER_META[i.kind];
          const created = i.created_at ? new Date(i.created_at).toLocaleDateString() : null;
          return (
            <SettingsRow
              key={i.id}
              icon={<ProviderMark kind={i.kind} />}
              title={
                <>
                  <span className="min-w-0 truncate">{i.name}</span>
                  {i.status === "active" ? (
                    <Chip tone="ok" icon={<Check strokeWidth={2.6} />}>
                      Active
                    </Chip>
                  ) : (
                    <Chip tone="fail" icon={<TriangleAlert />}>
                      {i.status.charAt(0).toUpperCase() + i.status.slice(1)}
                    </Chip>
                  )}
                </>
              }
              description={
                <>
                  {meta?.label ?? i.kind}
                  {created && ` · connected ${created}`}
                </>
              }
              action={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setConfirmDeleteId(i.id)}
                  aria-label={`Remove ${i.name}`}
                  className="hover:text-fail"
                >
                  <Trash2 />
                </Button>
              }
            />
          );
        })
      )}

      {/* One row per configured OAuth provider. */}
      {available.length > 0
        ? available.map((p) => (
            <SettingsRow
              key={p.key}
              icon={<ProviderMark kind={p.key} />}
              title={p.label}
              description={p.description}
              action={
                <Button size="sm" onClick={() => connect(p)} disabled={!!connecting}>
                  {connecting === p.key && <Loader2 className="animate-spin" />}
                  {connecting === p.key ? `Waiting for ${p.label}…` : `Connect ${p.label}`}
                </Button>
              }
            />
          ))
        : !providersLoading && (
            <p className="border-t border-line-soft px-4 py-3 text-[12.5px] leading-relaxed text-t3">
              No OAuth integrations are configured on this server. Set a provider&apos;s{" "}
              <code className="font-mono text-[11.5px] text-t2">*_CLIENT_ID</code> and{" "}
              <code className="font-mono text-[11.5px] text-t2">*_CLIENT_SECRET</code> to enable
              one-click connect, or paste a webhook URL directly on an alert rule.
            </p>
          )}

      {/* Self-hosted setup: the exact redirect URL to register in the provider app. */}
      {slackRedirectUrl && (
        <SettingsRow
          title="Setting up the Slack app?"
          align="start"
          description={
            <>
              Add this redirect URL in your Slack app under{" "}
              <span className="font-mono text-[12px]">OAuth &amp; Permissions → Redirect URLs</span>
              . It must match exactly. Bot token scopes:{" "}
              <span className="font-mono text-[12px]">
                chat:write, chat:write.public, channels:read, groups:read
              </span>
              .
            </>
          }
        >
          <CodeWell
            className="mt-2"
            actions={<CopyButton text={slackRedirectUrl} resetAfter={1500} />}
          >
            {slackRedirectUrl}
          </CodeWell>
        </SettingsRow>
      )}
      {discordRedirectUrl && (
        <SettingsRow
          title="Setting up the Discord app?"
          align="start"
          description={
            <>
              Add this redirect URL in your Discord application under{" "}
              <span className="font-mono text-[12px]">OAuth2 → Redirects</span>. It must match
              exactly. The connect flow uses the{" "}
              <span className="font-mono text-[12px]">webhook.incoming</span> scope; you pick the
              server and channel on Discord&apos;s consent screen.
            </>
          }
        >
          <CodeWell
            className="mt-2"
            actions={<CopyButton text={discordRedirectUrl} resetAfter={1500} />}
          >
            {discordRedirectUrl}
          </CodeWell>
        </SettingsRow>
      )}

      <ConfirmDialog
        open={confirmDeleteId != null}
        onOpenChange={(open) => !open && deletingId == null && setConfirmDeleteId(null)}
        title="Remove this integration?"
        description="Alert rules can no longer post to its channels until you connect it again."
        subject={deleteTarget?.name}
        confirmLabel="Remove integration"
        tone="danger"
        busy={deletingId != null}
        onConfirm={() => confirmDeleteId && remove(confirmDeleteId)}
      />
    </Panel>
  );
}

export default function NotificationSettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = $api.useQuery("get", "/api/v1/settings/notifications");

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpTls, setSmtpTls] = useState(true);

  const [webhookTimeout, setWebhookTimeout] = useState(10);
  const [webhookRetries, setWebhookRetries] = useState(1);

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (settings) {
      const s = settings as {
        smtp?: {
          host?: string;
          port?: number;
          username?: string;
          from_address?: string;
          tls?: boolean;
          has_password?: boolean;
        };
        webhook_defaults?: {
          timeout_seconds?: number;
          retry_count?: number;
        };
      };
      if (s.smtp) {
        setSmtpHost(s.smtp.host ?? "");
        setSmtpPort(s.smtp.port ?? 587);
        setSmtpUsername(s.smtp.username ?? "");
        setSmtpFrom(s.smtp.from_address ?? "");
        setSmtpTls(s.smtp.tls ?? true);
        if (s.smtp.has_password) {
          setSmtpPassword(PASSWORD_MASK);
        }
      }
      if (s.webhook_defaults) {
        setWebhookTimeout(s.webhook_defaults.timeout_seconds ?? 10);
        setWebhookRetries(s.webhook_defaults.retry_count ?? 1);
      }
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      unwrap(
        fetchClient.PUT("/api/v1/settings/notifications", {
          body: {
            smtp: {
              host: smtpHost,
              port: smtpPort,
              username: smtpUsername,
              password: smtpPassword === PASSWORD_MASK ? "" : smtpPassword,
              from_address: smtpFrom,
              tls: smtpTls,
            },
            webhook_defaults: {
              timeout_seconds: webhookTimeout,
              retry_count: webhookRetries,
            },
          } as never,
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["get", "/api/v1/settings/notifications"],
      });
      setSaveSuccess(true);
      setSaveError(null);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: (err) => {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    },
  });

  const testMutation = useMutation({
    mutationFn: () =>
      unwrap(
        fetchClient.POST("/api/v1/settings/notifications/test", {
          body: { channel: "email" } as never,
        }),
      ),
    onSuccess: () => {
      setTestResult({ success: true, message: "Test email sent" });
      setTimeout(() => setTestResult(null), 5000);
    },
    onError: (err) => {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "Test failed",
      });
    },
  });

  return (
    <>
      <SettingsHeader
        title="Email & webhooks"
        description="Where alert notifications go: chat apps, email through your SMTP server, and webhooks."
      />

      <ConnectedIntegrationsCard />

      {isLoading ? (
        <>
          <Skeleton className="h-[420px] w-full rounded-xl" />
          <Skeleton className="h-[200px] w-full rounded-xl" />
        </>
      ) : (
        <>
          <Panel aria-label="Email delivery">
            <PanelHeader title="Email delivery" subtitle="SMTP" />
            <p className="px-4 pb-3.5 text-[13px] leading-relaxed text-t2">
              Alert emails and member invites go out through this server. Leave the host blank to
              turn email off.
            </p>
            <div className="grid grid-cols-1 gap-4 border-t border-line-soft px-4 py-4 sm:grid-cols-2">
              <Field label="SMTP host" htmlFor="smtp-host">
                <Input
                  id="smtp-host"
                  type="text"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.gmail.com"
                  className="font-mono text-[12.5px]"
                />
              </Field>
              <Field label="Port" htmlFor="smtp-port">
                <Input
                  id="smtp-port"
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(parseInt(e.target.value))}
                  className="font-mono text-[12.5px] tabular-nums"
                />
              </Field>
              <Field label="Username" htmlFor="smtp-username">
                <Input
                  id="smtp-username"
                  type="text"
                  value={smtpUsername}
                  onChange={(e) => setSmtpUsername(e.target.value)}
                  placeholder="alerts@company.com"
                  autoComplete="off"
                />
              </Field>
              <Field label="Password" htmlFor="smtp-password">
                <Input
                  id="smtp-password"
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  onFocus={() => {
                    if (smtpPassword === PASSWORD_MASK) setSmtpPassword("");
                  }}
                  placeholder="App password"
                  autoComplete="new-password"
                />
              </Field>
              <Field label="From address" htmlFor="smtp-from">
                <Input
                  id="smtp-from"
                  type="email"
                  value={smtpFrom}
                  onChange={(e) => setSmtpFrom(e.target.value)}
                  placeholder="alerts@company.com"
                />
              </Field>
            </div>
            <div className="flex items-start gap-3.5 border-t border-line-soft px-4 py-3.5">
              <Switch
                id="smtp-tls"
                checked={smtpTls}
                onCheckedChange={setSmtpTls}
                aria-describedby="smtp-tls-help"
                className="mt-px"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <label
                  htmlFor="smtp-tls"
                  className="cursor-pointer text-[13.5px] font-[550] text-foreground"
                >
                  Use TLS
                </label>
                <p id="smtp-tls-help" className="text-[13px] text-t2">
                  Upgrades the connection with STARTTLS, which most providers expect on port 587.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-soft px-4 py-3">
              <Button
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || !smtpHost}
              >
                {testMutation.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                Send test email
              </Button>
              {testResult ? (
                <span
                  role="status"
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 text-[13px]",
                    testResult.success ? "text-ok" : "text-fail",
                  )}
                >
                  {testResult.success ? (
                    <Check className="size-3.5 shrink-0" strokeWidth={2.6} aria-hidden />
                  ) : (
                    <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                  )}
                  {testResult.message}
                </span>
              ) : (
                <span className="text-xs text-t3">
                  Sends to the from address, using the saved settings.
                </span>
              )}
            </div>
          </Panel>

          <Panel aria-label="Webhook defaults">
            <PanelHeader title="Webhook defaults" />
            <p className="px-4 pb-3.5 text-[13px] leading-relaxed text-t2">
              Default settings for webhook notification channels. Per-rule webhooks can override
              these.
            </p>
            <div className="grid grid-cols-1 gap-4 border-t border-line-soft px-4 py-4 sm:grid-cols-2">
              <Field
                label="Timeout"
                htmlFor="webhook-timeout"
                hint="How long to wait for a response."
              >
                <UnitInput
                  id="webhook-timeout"
                  unit="seconds"
                  min="1"
                  max="60"
                  value={webhookTimeout}
                  onChange={(e) => setWebhookTimeout(parseInt(e.target.value))}
                  className="text-left"
                />
              </Field>
              <Field
                label="Retries"
                htmlFor="webhook-retries"
                hint="How many times to retry a failed delivery."
              >
                <Input
                  id="webhook-retries"
                  type="number"
                  min="0"
                  max="5"
                  value={webhookRetries}
                  onChange={(e) => setWebhookRetries(parseInt(e.target.value))}
                  className="tabular-nums"
                />
              </Field>
            </div>
            <div className="flex flex-col gap-3 border-t border-line-soft px-4 py-4">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[13.5px] font-[550] text-foreground">Payload format</h3>
                <p className="text-[13px] text-t2">
                  Every webhook notification is a JSON POST with this structure.
                </p>
              </div>
              <JsonViewer value={WEBHOOK_PAYLOAD_EXAMPLE} label="Request body" />
            </div>
          </Panel>

          {saveSuccess && (
            <Notice onDismiss={() => setSaveSuccess(false)}>Notification settings saved.</Notice>
          )}
          {saveError && <ErrorAlert onDismiss={() => setSaveError(null)}>{saveError}</ErrorAlert>}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => router.push("/settings")}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending && <Loader2 className="animate-spin" />}
              Save changes
            </Button>
          </div>
        </>
      )}
    </>
  );
}

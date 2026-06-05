"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Mail,
  Globe,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Send,
  Plug,
  Trash2,
  Copy,
  Check,
} from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";

const inputClass =
  "w-full bg-secondary border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "block text-sm font-medium text-muted-foreground mb-1";

// Visual metadata per integration kind. Adding a new kind here gives it an icon
// + label everywhere it's listed.
const PROVIDER_META: Record<string, { label: string; badge: string; color: string }> = {
  slack: { label: "Slack", badge: "S", color: "#611f69" },
  discord: { label: "Discord", badge: "D", color: "#5865f2" },
  pagerduty: { label: "PagerDuty", badge: "PD", color: "#06ac38" },
  webhook: { label: "Webhook", badge: "W", color: "#64748b" },
};

// OAuth "Connect" providers. Add an entry (and set its *_CLIENT_ID/SECRET on the
// server) to surface a new Connect button — no other UI changes needed.
const CONNECT_PROVIDERS: { key: "slack" | "discord" | "google"; label: string; connectUrl: string }[] =
  [{ key: "slack", label: "Slack", connectUrl: "/api/v1/integrations/slack/connect" }];

function ProviderBadge({ kind }: { kind: string }) {
  const meta = PROVIDER_META[kind] ?? { badge: kind.slice(0, 2).toUpperCase(), color: "#64748b" };
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
      style={{ backgroundColor: meta.color }}
      aria-hidden
    >
      {meta.badge}
    </span>
  );
}

function ConnectedIntegrationsCard() {
  const queryClient = useQueryClient();
  const { data: providers, isLoading: providersLoading } = $api.useQuery(
    "get",
    "/api/v1/integrations/providers"
  );
  const { data: integrationsData, isLoading } = $api.useQuery("get", "/api/v1/integrations");
  const integrations = integrationsData?.data ?? [];

  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const slackRedirectUrl = (providers as { slack_redirect_url?: string } | undefined)
    ?.slack_redirect_url;

  function copyRedirect() {
    if (!slackRedirectUrl) return;
    navigator.clipboard?.writeText(slackRedirectUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  }

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
      setConnectError("Popup blocked — allow popups for this site and try again.");
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
    (p) => (providers as Record<string, boolean> | undefined)?.[p.key]
  );

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-foreground">Connected Integrations</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Connect a workspace once, then pick channels per alert rule. Webhook and PagerDuty
        destinations can also be pasted directly on a rule without connecting.
      </p>

      {connectError && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-destructive/40 bg-destructive/5 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {connectError}
        </div>
      )}
      {connectSuccess && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e] text-sm">
          <CheckCircle className="h-4 w-4 shrink-0" /> {connectSuccess}
        </div>
      )}

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : integrations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">No integrations connected yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Connect one below to route alerts to a chat channel.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {integrations.map((i) => {
            const meta = PROVIDER_META[i.kind];
            const created = i.created_at ? new Date(i.created_at).toLocaleDateString() : null;
            return (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                <ProviderBadge kind={i.kind} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{i.name}</p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        i.status === "active"
                          ? "bg-[#22c55e]/15 text-[#22c55e]"
                          : "bg-destructive/15 text-destructive"
                      }`}
                    >
                      {i.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {meta?.label ?? i.kind}
                    {created && ` · connected ${created}`}
                  </p>
                </div>
                {confirmDeleteId === i.id ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => remove(i.id)}
                      disabled={deletingId === i.id}
                      className="px-2 py-1 rounded bg-destructive/20 text-destructive text-xs font-medium hover:bg-destructive/30 transition"
                    >
                      {deletingId === i.id ? "Removing…" : "Confirm"}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-1 rounded bg-secondary text-muted-foreground text-xs hover:text-foreground transition"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(i.id)}
                    className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition shrink-0"
                    aria-label={`Remove ${i.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Add-integration area — one button per configured OAuth provider. */}
      {available.length > 0 ? (
        <div className="space-y-2 pt-1">
          {integrations.length > 0 && (
            <p className="text-xs font-medium text-muted-foreground">Add another integration</p>
          )}
          <div className="flex flex-wrap gap-2">
            {available.map((p) => (
              <button
                key={p.key}
                onClick={() => connect(p)}
                disabled={!!connecting}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition disabled:opacity-60"
              >
                {connecting === p.key ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ProviderBadge kind={p.key} />
                )}
                {connecting === p.key ? `Waiting for ${p.label}…` : `Connect ${p.label}`}
              </button>
            ))}
          </div>
        </div>
      ) : (
        !providersLoading && (
          <p className="text-xs text-muted-foreground">
            No OAuth integrations are configured on this server. Set a provider&apos;s
            <code> *_CLIENT_ID</code> / <code>*_CLIENT_SECRET</code> to enable one-click connect, or
            paste a webhook URL directly on an alert rule.
          </p>
        )
      )}

      {/* Self-hosted setup: the exact redirect URL to register in the provider app. */}
      {slackRedirectUrl && (
        <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-1.5">
          <p className="text-xs font-medium text-foreground">Setting up the Slack app?</p>
          <p className="text-xs text-muted-foreground">
            Add this <span className="font-medium">Redirect URL</span> in your Slack app under{" "}
            <span className="font-mono">OAuth &amp; Permissions → Redirect URLs</span> (must match
            exactly):
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-background px-2 py-1.5 text-xs text-foreground">
              {slackRedirectUrl}
            </code>
            <button
              type="button"
              onClick={copyRedirect}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-[#22c55e]" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Bot token scopes: <span className="font-mono">chat:write, chat:write.public,
            channels:read, groups:read</span>.
          </p>
        </div>
      )}
    </div>
  );
}

export default function NotificationSettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = $api.useQuery(
    "get",
    "/api/v1/settings/notifications"
  );

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
          setSmtpPassword("••••••••");
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
              password: smtpPassword === "••••••••" ? "" : smtpPassword,
              from_address: smtpFrom,
              tls: smtpTls,
            },
            webhook_defaults: {
              timeout_seconds: webhookTimeout,
              retry_count: webhookRetries,
            },
          } as never,
        })
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
        })
      ),
    onSuccess: () => {
      setTestResult({ success: true, message: "Test email sent successfully" });
      setTimeout(() => setTestResult(null), 5000);
    },
    onError: (err) => {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "Test failed",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/settings")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="h-4 w-4" /> Settings
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium text-foreground">
          Notifications
        </span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Notification Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure SMTP and webhook defaults for alert notifications
        </p>
      </div>

      <ConnectedIntegrationsCard />

      {saveSuccess && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e] text-sm">
          <CheckCircle className="h-4 w-4 shrink-0" />
          Settings saved successfully
        </div>
      )}
      {saveError && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/40 bg-destructive/5 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {saveError}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-foreground">
            SMTP Configuration
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure SMTP for email alert delivery. Leave blank to disable email
          notifications.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>SMTP Host</label>
            <input
              type="text"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              className={inputClass}
              placeholder="smtp.gmail.com"
            />
          </div>
          <div>
            <label className={labelClass}>Port</label>
            <input
              type="number"
              value={smtpPort}
              onChange={(e) => setSmtpPort(parseInt(e.target.value))}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Username</label>
            <input
              type="text"
              value={smtpUsername}
              onChange={(e) => setSmtpUsername(e.target.value)}
              className={inputClass}
              placeholder="alerts@company.com"
            />
          </div>
          <div>
            <label className={labelClass}>Password</label>
            <input
              type="password"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              onFocus={() => {
                if (smtpPassword === "••••••••") setSmtpPassword("");
              }}
              className={inputClass}
              placeholder="App password"
            />
          </div>
          <div>
            <label className={labelClass}>From Address</label>
            <input
              type="email"
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              className={inputClass}
              placeholder="alerts@company.com"
            />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={smtpTls}
                onChange={(e) => setSmtpTls(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
              />
              <span className="text-sm text-foreground">Use TLS</span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending || !smtpHost}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-sm text-foreground hover:bg-secondary/80 transition disabled:opacity-50"
          >
            {testMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send Test Email
          </button>
          {testResult && (
            <span
              className={`text-sm ${testResult.success ? "text-[#22c55e]" : "text-destructive"}`}
            >
              {testResult.message}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-foreground">Webhook Defaults</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Default settings for webhook notification channels. Per-rule webhooks
          can override these.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Timeout (seconds)</label>
            <input
              type="number"
              min="1"
              max="60"
              value={webhookTimeout}
              onChange={(e) => setWebhookTimeout(parseInt(e.target.value))}
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Max wait time for webhook response
            </p>
          </div>
          <div>
            <label className={labelClass}>Retry Count</label>
            <input
              type="number"
              min="0"
              max="5"
              value={webhookRetries}
              onChange={(e) => setWebhookRetries(parseInt(e.target.value))}
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Number of retries on failure
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="font-semibold text-foreground">
          Webhook Payload Format
        </h2>
        <p className="text-sm text-muted-foreground">
          All webhook notifications send a JSON POST request with the following
          structure:
        </p>
        <div className="rounded-lg bg-secondary/50 p-4">
          <pre className="text-xs text-foreground font-mono whitespace-pre-wrap">{`{
  "id": "alert-uuid",
  "rule_name": "High failure rate",
  "severity": "critical",
  "summary": "Failure rate exceeded 10% threshold...",
  "fired_at": "2026-03-03T21:00:00Z",
  "details": {
    "failure_rate": 0.15,
    "p95_runtime": 12.5,
    "recent_failures": 42
  }
}`}</pre>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          onClick={() => router.push("/settings")}
          className="px-4 py-2 rounded-lg bg-secondary text-sm text-foreground hover:bg-secondary/80 transition"
        >
          Cancel
        </button>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle className="h-4 w-4" />
          )}
          Save Settings
        </button>
      </div>
    </div>
  );
}

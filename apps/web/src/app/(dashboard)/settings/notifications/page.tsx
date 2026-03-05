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
} from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";

const inputClass =
  "w-full bg-secondary border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "block text-sm font-medium text-muted-foreground mb-1";

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

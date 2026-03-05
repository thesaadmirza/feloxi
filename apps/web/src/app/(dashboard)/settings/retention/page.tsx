"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Database,
  Save,
  Loader2,
  CheckCircle,
  Info,
} from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Skeleton } from "@/components/shared/skeleton";

type RetentionSettings = {
  task_events_days: number;
  worker_events_days: number;
  alert_history_days: number;
};

const DEFAULT_RETENTION: RetentionSettings = {
  task_events_days: 30,
  worker_events_days: 14,
  alert_history_days: 90,
};

const FIELDS: { key: keyof RetentionSettings; label: string; description: string }[] = [
  {
    key: "task_events_days",
    label: "Task Events",
    description:
      "How long to keep task state events, args, kwargs, results, and exceptions",
  },
  {
    key: "worker_events_days",
    label: "Worker Events",
    description: "How long to keep worker heartbeat events, CPU, and memory snapshots",
  },
  {
    key: "alert_history_days",
    label: "Alert History",
    description: "How long to keep alert firing history and resolution records",
  },
];

export default function RetentionPage() {
  const router = useRouter();
  const [values, setValues] = useState<RetentionSettings>(DEFAULT_RETENTION);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const { data, isLoading, isError, error } = $api.useQuery("get", "/api/v1/settings/retention");

  useEffect(() => {
    if (data) {
      setValues({
        task_events_days: data.task_events_days ?? DEFAULT_RETENTION.task_events_days,
        worker_events_days: data.worker_events_days ?? DEFAULT_RETENTION.worker_events_days,
        alert_history_days: data.alert_history_days ?? DEFAULT_RETENTION.alert_history_days,
      });
    }
  }, [data]);

  function handleChange(key: keyof RetentionSettings, rawValue: string) {
    const n = parseInt(rawValue, 10);
    if (isNaN(n) || n < 1) return;
    setValues((prev) => ({ ...prev, [key]: n }));
    setDirty(true);
    setSaveSuccess(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      await unwrap(
        fetchClient.PUT("/api/v1/settings/retention", { body: values as never })
      );
      setSaveSuccess(true);
      setDirty(false);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save retention settings"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/settings")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Settings
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium text-foreground">Retention Policies</span>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-xl border border-primary/30 bg-primary/5 text-sm">
        <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <p className="text-muted-foreground">
          Retention policies control how long Feloxi stores historical data.
          Longer retention increases storage usage. Changes take effect on the
          next cleanup cycle (runs daily).
        </p>
      </div>

      {isError && (
        <ErrorAlert>
          {(error as Error)?.message ?? "Failed to load retention settings"}
        </ErrorAlert>
      )}

      {saveSuccess && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e] text-sm">
          <CheckCircle className="h-4 w-4 shrink-0" />
          Retention settings saved successfully
        </div>
      )}

      {saveError && (
        <ErrorAlert>
          {saveError}
        </ErrorAlert>
      )}

      <form onSubmit={handleSave} className="rounded-xl border border-border bg-card p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-foreground">Retention Periods</h2>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {FIELDS.map(({ key, label, description }) => (
              <div key={key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      {label}
                    </label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <input
                      type="number"
                      min="1"
                      max="3650"
                      value={values[key]}
                      onChange={(e) => handleChange(key, e.target.value)}
                      className="w-20 bg-secondary border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring text-right"
                    />
                    <span className="text-sm text-muted-foreground">days</span>
                  </div>
                </div>

                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, (values[key] / 365) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Estimated storage usage depends on your task volume and payload sizes.
          </p>
          <button
            type="submit"
            disabled={saving || !dirty || isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Changes
          </button>
        </div>
      </form>
    </div>
  );
}

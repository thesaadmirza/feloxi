"use client";

import { useState, useEffect } from "react";
import { Bell, ListChecks, Loader2, Server } from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ErrorAlert, Notice } from "@/components/shared/error-alert";
import { Skeleton } from "@/components/shared/skeleton";
import { SettingsHeader, SettingsRow } from "@/components/settings/section";
import { UnitInput } from "@/components/settings/unit-input";

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

const FIELDS: {
  key: keyof RetentionSettings;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    key: "task_events_days",
    label: "Task events",
    description: "Task state changes with their args, kwargs, results and exceptions.",
    icon: <ListChecks strokeWidth={1.7} />,
  },
  {
    key: "worker_events_days",
    label: "Worker events",
    description: "Worker heartbeats with CPU and memory snapshots.",
    icon: <Server strokeWidth={1.7} />,
  },
  {
    key: "alert_history_days",
    label: "Alert history",
    description: "When each alert fired and how it was resolved.",
    icon: <Bell strokeWidth={1.7} />,
  },
];

export default function RetentionPage() {
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
      await unwrap(fetchClient.PUT("/api/v1/settings/retention", { body: values as never }));
      setSaveSuccess(true);
      setDirty(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save retention settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingsHeader
        title="Retention"
        description="How long Feloxi keeps history. Changes take effect at the next daily cleanup."
      />

      {isError && (
        <ErrorAlert>
          {(error as unknown as Error)?.message ?? "Failed to load retention settings"}
        </ErrorAlert>
      )}

      {saveSuccess && (
        <Notice onDismiss={() => setSaveSuccess(false)}>Retention settings saved.</Notice>
      )}

      {saveError && <ErrorAlert onDismiss={() => setSaveError(null)}>{saveError}</ErrorAlert>}

      <Panel aria-label="Retention periods">
        <form onSubmit={handleSave}>
          <PanelHeader title="Keep data for" />

          {isLoading ? (
            <div className="flex flex-col gap-3 border-t border-line-soft px-4 py-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            FIELDS.map(({ key, label, description, icon }) => (
              <SettingsRow
                key={key}
                icon={icon}
                title={<label htmlFor={`retention-${key}`}>{label}</label>}
                description={<span id={`retention-${key}-help`}>{description}</span>}
                wrapAction
                action={
                  <UnitInput
                    id={`retention-${key}`}
                    unit="days"
                    min="1"
                    max="3650"
                    value={values[key]}
                    onChange={(e) => handleChange(key, e.target.value)}
                    aria-describedby={`retention-${key}-help`}
                    wrapperClassName="w-[116px]"
                  />
                }
              />
            ))
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-4 py-3">
            <p className="text-xs text-t3">
              Each period can be 1 to 3,650 days. Longer periods use more storage.
            </p>
            <Button
              type="submit"
              variant="primary"
              disabled={saving || !dirty || isLoading}
              className="ml-auto"
            >
              {saving && <Loader2 className="animate-spin" />}
              Save changes
            </Button>
          </div>
        </form>
      </Panel>
    </>
  );
}

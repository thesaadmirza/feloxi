"use client";

import { forwardRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff, Loader2 } from "lucide-react";
import { fetchClient, unwrap } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field, Input, Select } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Skeleton } from "@/components/shared/skeleton";
import type { AlertRule, AlertSilence } from "@/types/api";

function timeUntil(dateInput: string): string {
  const diff = (new Date(dateInput).getTime() - Date.now()) / 1000;
  if (diff <= 0) return "now";
  if (diff < 3600) return `${Math.ceil(diff / 60)}m`;
  if (diff < 86400) return `${Math.ceil(diff / 3600)}h`;
  return `${Math.ceil(diff / 86400)}d`;
}

export const Silences = forwardRef<
  HTMLDivElement,
  {
    rules: AlertRule[];
    canWrite: boolean;
    silences: AlertSilence[];
    loading: boolean;
    error: boolean;
  }
>(function Silences({ rules, canWrite, silences, loading, error }, formRef) {
  const queryClient = useQueryClient();
  const [ruleId, setRuleId] = useState<string>("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [reason, setReason] = useState("");

  const ruleNames = new Map(rules.map((r) => [r.id, r.name]));
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/alerts/silences"] });

  const createMutation = useMutation({
    mutationFn: () =>
      unwrap(
        fetchClient.POST("/api/v1/alerts/silences", {
          body: {
            rule_id: ruleId || null,
            reason: reason.trim() || null,
            duration_minutes: durationMinutes,
          } as never,
        }),
      ),
    onSuccess: () => {
      setReason("");
      invalidate();
    },
  });

  const expireMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        fetchClient.DELETE("/api/v1/alerts/silences/{silence_id}", {
          params: { path: { silence_id: id } },
        }),
      ),
    onSuccess: invalidate,
  });

  const now = Date.now();
  const isActive = (s: AlertSilence) => new Date(s.ends_at).getTime() > now;

  return (
    <div className="flex flex-col gap-5">
      {canWrite && (
        <div ref={formRef} className="scroll-mt-20">
          <Panel aria-label="New silence">
            <PanelHeader
              title="New silence"
              subtitle="notifications wait; incidents still open and resolve"
            />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate();
              }}
              className="grid grid-cols-1 items-end gap-4 px-4 pb-4 sm:grid-cols-[1fr_180px_1.3fr_auto]"
            >
              <Field label="Scope" htmlFor="silence-scope">
                <Select
                  id="silence-scope"
                  value={ruleId}
                  onChange={(e) => setRuleId(e.target.value)}
                >
                  <option value="">All rules</option>
                  {rules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Duration" htmlFor="silence-duration">
                <Select
                  id="silence-duration"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(parseInt(e.target.value))}
                >
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={240}>4 hours</option>
                  <option value={1440}>24 hours</option>
                  <option value={10080}>7 days</option>
                </Select>
              </Field>
              <Field label="Reason" htmlFor="silence-reason">
                <Input
                  id="silence-reason"
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. planned maintenance"
                />
              </Field>
              <Button type="submit" className="h-9" disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="animate-spin" /> : <BellOff />}
                Silence
              </Button>
              {createMutation.isError && (
                <p className="text-xs text-fail sm:col-span-4">
                  {createMutation.error instanceof Error
                    ? createMutation.error.message
                    : "Couldn't create the silence."}
                </p>
              )}
            </form>
          </Panel>
        </div>
      )}

      {error && <ErrorAlert>Couldn&apos;t load silences.</ErrorAlert>}

      {loading ? (
        <Panel className="p-4">
          <Skeleton className="h-12 w-full" />
        </Panel>
      ) : silences.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<BellOff />}
            title="No silences"
            description="Alerts notify normally."
          />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <ul>
            {silences.map((s) => {
              const active = isActive(s);
              return (
                <li
                  key={s.id}
                  className={cn(
                    "flex items-center gap-4 border-t border-line-soft px-4 py-3 first:border-t-0",
                    !active && "opacity-60",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-[550]">
                        {s.rule_id ? (ruleNames.get(s.rule_id) ?? "Deleted rule") : "All rules"}
                      </span>
                      {active ? (
                        <Chip tone="warn" icon={<BellOff />}>
                          Active
                        </Chip>
                      ) : (
                        <Chip>Expired</Chip>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] text-t3">
                      {active ? `Ends in ${timeUntil(s.ends_at)}` : `Ended ${timeAgo(s.ends_at)}`}
                      {s.reason ? ` · ${s.reason}` : ""}
                    </p>
                  </div>
                  {canWrite && active && (
                    <Button
                      size="sm"
                      onClick={() => expireMutation.mutate(s.id)}
                      disabled={expireMutation.isPending}
                    >
                      End now
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
});

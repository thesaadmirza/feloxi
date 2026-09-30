"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff, Pencil, Plus, Trash2 } from "lucide-react";
import { fetchClient, unwrap } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Skeleton } from "@/components/shared/skeleton";
import { SeverityChip } from "@/components/overview/attention-strip";
import type { AlertChannel, AlertRule } from "@/types/api";
import { CONDITION_TYPES, channelLabel, conditionSummary } from "./model";

export function RulesList({
  rules,
  loading,
  canWrite,
  firingRuleIds,
  onEdit,
  onCreate,
}: {
  rules: AlertRule[];
  loading: boolean;
  canWrite: boolean;
  firingRuleIds: Set<string>;
  onEdit: (rule: AlertRule) => void;
  onCreate: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<AlertRule | null>(null);
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/alerts/rules"] });

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
            severity_override: rule.severity_override ?? null,
          } as never,
        }),
      ),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        fetchClient.DELETE("/api/v1/alerts/rules/{rule_id}", { params: { path: { rule_id: id } } }),
      ),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(null);
    },
  });

  if (loading) {
    return (
      <Panel className="flex flex-col gap-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </Panel>
    );
  }

  if (rules.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={<BellOff />}
          title="No alert rules yet"
          description={
            canWrite
              ? "Page on failure spikes, slow tasks, backed-up queues or workers going quiet."
              : "Nobody has created a rule yet."
          }
          action={
            canWrite ? (
              <Button variant="primary" onClick={onCreate}>
                <Plus />
                New rule
              </Button>
            ) : undefined
          }
        />
      </Panel>
    );
  }

  return (
    <>
      {toggleMutation.isError && (
        <ErrorAlert onDismiss={() => toggleMutation.reset()}>
          Couldn&apos;t update the rule.
        </ErrorAlert>
      )}
      <Panel className="overflow-hidden">
        <ul>
          {rules.map((rule) => {
            const firing = firingRuleIds.has(rule.id);
            return (
              <li
                key={rule.id}
                className="flex items-start gap-4 border-t border-line-soft px-4 py-3.5 first:border-t-0"
              >
                {canWrite && (
                  <Switch
                    checked={rule.is_enabled}
                    onCheckedChange={() => toggleMutation.mutate(rule)}
                    disabled={toggleMutation.isPending}
                    aria-label={rule.is_enabled ? `Disable ${rule.name}` : `Enable ${rule.name}`}
                    className="mt-0.5"
                  />
                )}
                <div className={cn("min-w-0 flex-1", !rule.is_enabled && "opacity-60")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-[550]">{rule.name}</span>
                    {firing && <SeverityChip severity={rule.severity_override ?? "warning"} />}
                    {!rule.is_enabled && <span className="text-xs text-t3">Paused</span>}
                  </div>
                  <p className="mt-0.5 text-[13px] text-t2">
                    <span className="text-t3">
                      {CONDITION_TYPES.find((c) => c.value === rule.condition.type)?.label ??
                        rule.condition.type}{" "}
                      ·{" "}
                    </span>
                    {conditionSummary(rule)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-t3">
                    {rule.channels.length === 0 ? (
                      <span>No channels</span>
                    ) : (
                      rule.channels.map((ch, i) => (
                        <Tag key={i}>{channelLabel(ch as { type: string })}</Tag>
                      ))
                    )}
                    <span className="ml-1">
                      {rule.cooldown_secs > 0 && `cooldown ${rule.cooldown_secs}s`}
                      {rule.last_fired_at && ` · last fired ${timeAgo(rule.last_fired_at)}`}
                    </span>
                  </div>
                </div>
                {canWrite && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onEdit(rule)}
                      aria-label={`Edit ${rule.name}`}
                      title="Edit"
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setConfirmDelete(rule)}
                      aria-label={`Delete ${rule.name}`}
                      title="Delete"
                      className="hover:text-fail"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <ConfirmDialog
        open={confirmDelete != null}
        onOpenChange={(open) => !open && !deleteMutation.isPending && setConfirmDelete(null)}
        title="Delete this rule?"
        description="Its incident history stays; the rule stops watching and notifying."
        subject={confirmDelete?.name}
        confirmLabel="Delete rule"
        tone="danger"
        busy={deleteMutation.isPending}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
      />
    </>
  );
}

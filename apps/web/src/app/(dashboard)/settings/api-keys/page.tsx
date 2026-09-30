"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Eye, EyeOff, KeyRound, Loader2, Plus } from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip, Tag } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Skeleton } from "@/components/shared/skeleton";
import { CopyButton } from "@/components/settings/copy-button";
import { CodeWell, IconTile, SettingsHeader } from "@/components/settings/section";
import type { ApiKey } from "@/types/api";

// Must match the names the API checks (auth::rbac::PERMISSIONS).
const PERMISSION_OPTIONS = [
  { value: "tasks_read", label: "Read tasks" },
  { value: "tasks_retry", label: "Retry tasks" },
  { value: "tasks_revoke", label: "Revoke tasks" },
  { value: "workers_read", label: "Read workers" },
  { value: "workers_shutdown", label: "Shut down workers" },
  { value: "metrics_read", label: "Read metrics" },
  { value: "beat_read", label: "Read beat schedules" },
  { value: "alerts_read", label: "Read alerts" },
  { value: "alerts_write", label: "Manage alerts" },
  { value: "settings_read", label: "Read settings" },
  { value: "settings_write", label: "Change settings" },
  { value: "brokers_manage", label: "Manage brokers" },
  { value: "*", label: "Everything you can do" },
];

const DEFAULT_PERMS = ["tasks_read", "workers_read", "metrics_read"];

function keyCount(keys: ApiKey[]) {
  const active = keys.filter((k) => k.is_active).length;
  const revoked = keys.length - active;
  return revoked > 0 ? `${active} active · ${revoked} revoked` : `${active} active`;
}

export default function ApiKeysPage() {
  const queryClient = useQueryClient();

  const [newKeyName, setNewKeyName] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<string[]>(DEFAULT_PERMS);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showCreatedKey, setShowCreatedKey] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const createdKeyRef = useRef<HTMLElement>(null);

  // The key shows at the top of the page; bring it into view when it's
  // created from the form further down (or sits under the sticky header).
  useEffect(() => {
    const el = createdKeyRef.current;
    if (!createdKey || !el) return;
    const { top, bottom } = el.getBoundingClientRect();
    if (top >= 64 && bottom <= window.innerHeight) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [createdKey]);

  const { data, isLoading, isError, error } = $api.useQuery("get", "/api/v1/api-keys");
  const keys = (data?.data ?? []) as ApiKey[];
  const revokeTarget = keys.find((k) => k.id === confirmRevoke);

  const createMutation = useMutation({
    mutationFn: () =>
      unwrap(
        fetchClient.POST("/api/v1/api-keys", {
          body: { name: newKeyName, permissions: selectedPerms } as never,
        }),
      ),
    onSuccess: (res: { key: string }) => {
      queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/api-keys"] });
      setCreatedKey(res.key);
      setNewKeyName("");
      setSelectedPerms(DEFAULT_PERMS);
      setCreateError(null);
    },
    onError: (err) => {
      setCreateError(err instanceof Error ? err.message : "Failed to create key");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        fetchClient.DELETE("/api/v1/api-keys/{key_id}", {
          params: { path: { key_id: id } },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/api-keys"] });
      setConfirmRevoke(null);
      setRevokingId(null);
    },
  });

  function togglePerm(perm: string) {
    if (perm === "*") {
      setSelectedPerms(["*"]);
      return;
    }
    setSelectedPerms((prev) => {
      const withoutAll = prev.filter((p) => p !== "*");
      if (withoutAll.includes(perm)) {
        return withoutAll.filter((p) => p !== perm);
      }
      return [...withoutAll, perm];
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim() || selectedPerms.length === 0) return;
    setCreatedKey(null);
    createMutation.mutate();
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    setRevokeError(null);
    try {
      await revokeMutation.mutateAsync(id);
    } catch (err) {
      setConfirmRevoke(null);
      setRevokingId(null);
      setRevokeError(err instanceof Error ? err.message : "Failed to revoke key");
    }
  }

  const permOption = (opt: (typeof PERMISSION_OPTIONS)[number]) => {
    const checked =
      selectedPerms.includes(opt.value) || (opt.value !== "*" && selectedPerms.includes("*"));
    return (
      <label
        key={opt.value}
        className="flex h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2 transition-colors hover:bg-hover"
      >
        <Checkbox checked={checked} onChange={() => togglePerm(opt.value)} />
        <span className="truncate text-[13px] text-foreground">{opt.label}</span>
        <span className="shrink-0 font-mono text-[11px] text-t3">{opt.value}</span>
      </label>
    );
  };

  return (
    <>
      <SettingsHeader
        title="API keys"
        description="Keys let scripts and services call the Feloxi API. Each key only gets the permissions you pick."
      />

      {revokeError && <ErrorAlert onDismiss={() => setRevokeError(null)}>{revokeError}</ErrorAlert>}

      {createdKey && (
        <section
          ref={createdKeyRef}
          aria-label="New API key"
          className="flex scroll-mt-20 flex-col gap-3 rounded-xl border border-amber-line bg-amber-wash p-4"
        >
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-link" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-foreground">Copy your new key now</p>
              <p className="mt-0.5 text-[13px] text-t2">
                It won&apos;t be shown again. Send it as{" "}
                <code className="font-mono text-[12px]">Authorization: Bearer &lt;key&gt;</code>.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCreatedKey(null)} className="-my-1">
              Dismiss
            </Button>
          </div>
          <CodeWell
            className="bg-card"
            actions={
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowCreatedKey(!showCreatedKey)}
                  aria-label={showCreatedKey ? "Hide key" : "Show key"}
                >
                  {showCreatedKey ? <EyeOff /> : <Eye />}
                </Button>
                <CopyButton text={createdKey} />
              </>
            }
          >
            {showCreatedKey ? createdKey : `${createdKey.slice(0, 8)}${"•".repeat(32)}`}
          </CodeWell>
        </section>
      )}

      {isError ? (
        <ErrorAlert>{(error as unknown as Error)?.message ?? "Failed to load API keys"}</ErrorAlert>
      ) : (
        <Panel aria-label="API keys">
          <PanelHeader title="Keys" subtitle={keys.length > 0 ? keyCount(keys) : undefined} />
          {isLoading ? (
            <div className="flex flex-col gap-3 border-t border-line-soft px-4 py-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : keys.length === 0 ? (
            <EmptyState
              icon={<KeyRound />}
              title="No API keys yet"
              description="Create one below to call the API from scripts or CI."
              className="border-t border-line-soft"
            />
          ) : (
            <ul>
              {keys.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center gap-3.5 border-t border-line-soft px-4 py-3.5"
                >
                  <IconTile>
                    <KeyRound />
                  </IconTile>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-h-5 flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="min-w-0 truncate text-[13.5px] font-[550] text-foreground">
                        {k.name}
                      </span>
                      {!k.is_active && <Chip icon={<Ban />}>Revoked</Chip>}
                    </div>
                    {/* Separators sit in each item's left padding; the ones that land at
                        the start of a wrapped line are clipped away. */}
                    <div className="overflow-hidden text-[13px] text-t3">
                      <div className="-ml-3 flex flex-wrap items-center">
                        {[
                          <span key="prefix" className="font-mono text-[12px] text-t2">
                            {k.key_prefix}••••••••
                          </span>,
                          `Created ${timeAgo(k.created_at)}`,
                          k.last_used_at && `last used ${timeAgo(k.last_used_at)}`,
                          k.expires_at && `expires ${new Date(k.expires_at).toLocaleDateString()}`,
                        ]
                          .filter(Boolean)
                          .map((part, i) => (
                            <span
                              key={i}
                              className="relative pl-3 whitespace-nowrap before:absolute before:left-1 before:content-['·']"
                            >
                              {part}
                            </span>
                          ))}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1" aria-label="Permissions">
                      {k.permissions.map((p) => (
                        <Tag key={p}>{p}</Tag>
                      ))}
                    </div>
                  </div>
                  {k.is_active && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setConfirmRevoke(k.id)}
                      aria-label={`Revoke ${k.name}`}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Panel aria-label="Create a key">
        <PanelHeader title="Create a key" />
        <form onSubmit={handleCreate}>
          <div className="flex flex-col gap-4 border-t border-line-soft px-4 py-4">
            <Field label="Name" htmlFor="api-key-name">
              <Input
                id="api-key-name"
                type="text"
                required
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Production API key"
              />
            </Field>

            <div
              role="group"
              aria-labelledby="api-key-permissions"
              className="flex min-w-0 flex-col gap-1.5"
            >
              <span id="api-key-permissions" className="text-[12.5px] font-[550] text-t2">
                Permissions
              </span>
              <div className="-mx-2 grid grid-cols-1 gap-x-4 gap-y-px sm:grid-cols-2">
                {PERMISSION_OPTIONS.filter((o) => o.value !== "*").map(permOption)}
              </div>
              <div className="-mx-2 mt-1 border-t border-line-soft pt-1.5">
                {PERMISSION_OPTIONS.filter((o) => o.value === "*").map(permOption)}
              </div>
            </div>

            {createError && <ErrorAlert>{createError}</ErrorAlert>}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-line-soft px-4 py-3">
            <Button
              type="submit"
              variant="primary"
              disabled={
                createMutation.isPending || !newKeyName.trim() || selectedPerms.length === 0
              }
            >
              {createMutation.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              Create key
            </Button>
          </div>
        </form>
      </Panel>

      <ConfirmDialog
        open={confirmRevoke != null}
        onOpenChange={(open) => !open && !revokeMutation.isPending && setConfirmRevoke(null)}
        title="Revoke this key?"
        description={`Requests signed with “${revokeTarget?.name ?? "this key"}” will be refused from now on. This can't be undone.`}
        subject={revokeTarget ? `${revokeTarget.key_prefix}••••••••` : undefined}
        confirmLabel="Revoke key"
        tone="danger"
        busy={revokingId != null && revokeMutation.isPending}
        onConfirm={() => confirmRevoke && handleRevoke(confirmRevoke)}
      />
    </>
  );
}

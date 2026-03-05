"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Key,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Copy,
  Eye,
  EyeOff,
} from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { Skeleton } from "@/components/shared/skeleton";
import type { ApiKey } from "@/types/api";

const PERMISSION_OPTIONS = [
  { value: "tasks:read", label: "Tasks (read)" },
  { value: "tasks:write", label: "Tasks (write)" },
  { value: "workers:read", label: "Workers (read)" },
  { value: "workers:write", label: "Workers (write)" },
  { value: "metrics:read", label: "Metrics (read)" },
  { value: "alerts:read", label: "Alerts (read)" },
  { value: "alerts:write", label: "Alerts (write)" },
  { value: "settings:read", label: "Settings (read)" },
  { value: "settings:write", label: "Settings (write)" },
  { value: "*", label: "All permissions (admin)" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={copy}
      className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition"
      title="Copy"
    >
      {copied ? (
        <CheckCircle className="h-4 w-4 text-[#22c55e]" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </button>
  );
}

export default function ApiKeysPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [newKeyName, setNewKeyName] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<string[]>([
    "tasks:read",
    "workers:read",
    "metrics:read",
  ]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showCreatedKey, setShowCreatedKey] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = $api.useQuery("get", "/api/v1/api-keys");
  const keys = (data?.data ?? []) as ApiKey[];

  const createMutation = useMutation({
    mutationFn: () =>
      unwrap(
        fetchClient.POST("/api/v1/api-keys", {
          body: { name: newKeyName, permissions: selectedPerms } as never,
        })
      ),
    onSuccess: (res: { key: string }) => {
      queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/api-keys"] });
      setCreatedKey(res.key);
      setNewKeyName("");
      setSelectedPerms(["tasks:read", "workers:read", "metrics:read"]);
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
        })
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
        <span className="text-sm font-medium text-foreground">API Keys</span>
      </div>

      {createdKey && (
        <div className="rounded-xl border border-[#22c55e]/50 bg-[#22c55e]/10 p-5 space-y-3">
          <div className="flex items-center gap-2 text-[#22c55e] font-semibold">
            <CheckCircle className="h-4 w-4" />
            API key created — copy it now, it won&apos;t be shown again
          </div>
          <div className="flex items-center gap-2 bg-secondary/80 rounded-lg px-3 py-2">
            <code className="flex-1 text-xs font-mono text-foreground break-all">
              {showCreatedKey
                ? createdKey
                : `${createdKey.slice(0, 8)}${"•".repeat(32)}`}
            </code>
            <button
              onClick={() => setShowCreatedKey(!showCreatedKey)}
              className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition"
            >
              {showCreatedKey ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
            <CopyButton text={createdKey} />
          </div>
          <button
            onClick={() => setCreatedKey(null)}
            className="text-xs text-muted-foreground hover:text-foreground transition"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <Key className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-foreground">Existing Keys</h2>
          {keys.length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full bg-secondary text-xs text-muted-foreground">
              {keys.length}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center gap-3 p-5 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {(error as Error)?.message ?? "Failed to load API keys"}
          </div>
        ) : keys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Key className="h-10 w-10 opacity-30" />
            <p className="text-sm">No API keys yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {keys.map((k: ApiKey) => (
              <div key={k.id} className="flex items-start justify-between px-5 py-4 gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-foreground">{k.name}</p>
                    {!k.is_active && (
                      <span className="px-1.5 py-0.5 rounded-full bg-secondary text-xs text-muted-foreground">
                        Revoked
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground mb-1">
                    {k.key_prefix}••••••••••••••••
                  </p>
                  <div className="flex flex-wrap gap-1 mb-1">
                    {k.permissions.map((p) => (
                      <span
                        key={p}
                        className="px-1.5 py-0.5 rounded bg-secondary text-xs font-mono text-muted-foreground"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Created {timeAgo(k.created_at)}
                    {k.last_used_at && ` · last used ${timeAgo(k.last_used_at)}`}
                    {k.expires_at && ` · expires ${new Date(k.expires_at).toLocaleDateString()}`}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {k.is_active &&
                    (confirmRevoke === k.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={async () => {
                            setRevokingId(k.id);
                            await revokeMutation.mutateAsync(k.id);
                          }}
                          disabled={revokeMutation.isPending}
                          className="px-2 py-1 rounded bg-destructive text-white text-xs hover:bg-destructive/80 transition"
                        >
                          {revokingId === k.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Revoke"
                          )}
                        </button>
                        <button
                          onClick={() => setConfirmRevoke(null)}
                          className="px-2 py-1 rounded bg-secondary text-xs text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRevoke(k.id)}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition text-xs"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Revoke
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Plus className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-foreground">Create New Key</h2>
        </div>

        {createError && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-destructive/40 bg-destructive/5 text-destructive text-sm mb-4">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {createError}
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Key Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              required
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Production API Key"
              className="w-full bg-secondary border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Permissions
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PERMISSION_OPTIONS.map((opt) => {
                const checked =
                  selectedPerms.includes(opt.value) ||
                  (opt.value !== "*" && selectedPerms.includes("*"));
                return (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-secondary/50 hover:bg-secondary cursor-pointer transition"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePerm(opt.value)}
                      className="rounded border-border"
                    />
                    <span className="text-sm text-foreground">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={
                createMutation.isPending ||
                !newKeyName.trim() ||
                selectedPerms.length === 0
              }
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Key className="h-4 w-4" />
              )}
              Create API Key
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Users,
  Mail,
  UserPlus,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Shield,
  Trash2,
} from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { Skeleton } from "@/components/shared/skeleton";

type TeamMember = {
  id: string;
  email: string;
  display_name: string | null;
  roles?: string[];
  created_at?: string;
  is_active?: boolean;
};

const ROLES = ["admin", "editor", "viewer"] as const;

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    admin: "bg-primary/20 text-primary",
    editor: "bg-[#3b82f6]/20 text-[#3b82f6]",
    viewer: "bg-secondary text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        colors[role] ?? colors.viewer
      }`}
    >
      <Shield className="h-3 w-3" />
      {role}
    </span>
  );
}

export default function TeamPage() {
  const router = useRouter();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<(typeof ROLES)[number]>("viewer");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = $api.useQuery("get", "/api/v1/team");

  const members = (data?.members ?? []) as TeamMember[];

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || inviting) return;
    setInviting(true);
    setInviteError(null);
    setInviteSuccess(false);

    try {
      await unwrap(
        fetchClient.POST("/api/v1/team/members", {
          body: { email: inviteEmail.trim(), role: inviteRole } as never,
        })
      );
      setInviteSuccess(true);
      setInviteEmail("");
      refetch();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to send invitation");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(memberId: string) {
    setRemovingId(memberId);
    setRemoveError(null);
    try {
      await unwrap(
        fetchClient.DELETE("/api/v1/team/members/{member_id}", {
          params: { path: { member_id: memberId } },
        })
      );
      setConfirmRemove(null);
      refetch();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setRemovingId(null);
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
        <span className="text-sm font-medium text-foreground">Team</span>
      </div>

      {removeError && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-destructive/40 bg-destructive/5 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {removeError}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <Users className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-foreground">Team Members</h2>
          {members.length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full bg-secondary text-xs text-muted-foreground">
              {members.length}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center gap-3 p-5 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {(error as Error)?.message ?? "Failed to load team"}
          </div>
        ) : members.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Users className="h-10 w-10 opacity-30" />
            <p className="text-sm">No team members found</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between px-5 py-4 gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center text-sm font-semibold text-foreground shrink-0">
                    {(member.display_name ?? member.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {member.display_name ?? member.email}
                    </p>
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <Mail className="h-3 w-3 shrink-0" />
                      {member.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(member.roles ?? []).map((r) => (
                    <RoleBadge key={r} role={r} />
                  ))}
                  {confirmRemove === member.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRemove(member.id)}
                        className="px-2 py-1 rounded bg-destructive text-white text-xs"
                      >
                        {removingId === member.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Remove"
                        )}
                      </button>
                      <button
                        onClick={() => setConfirmRemove(null)}
                        className="px-2 py-1 rounded bg-secondary text-xs text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRemove(member.id)}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
                      title="Remove member"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-foreground">Add Team Member</h2>
        </div>

        {inviteSuccess && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e] text-sm mb-4">
            <CheckCircle className="h-4 w-4 shrink-0" />
            Team member added successfully!
          </div>
        )}

        {inviteError && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-destructive/40 bg-destructive/5 text-destructive text-sm mb-4">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {inviteError}
          </div>
        )}

        <form onSubmit={handleInvite} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Email Address
              </label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="w-full bg-secondary border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Role
              </label>
              <select
                value={inviteRole}
                onChange={(e) =>
                  setInviteRole(e.target.value as (typeof ROLES)[number])
                }
                className="w-full bg-secondary border border-border text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={inviting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {inviting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Add Member
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

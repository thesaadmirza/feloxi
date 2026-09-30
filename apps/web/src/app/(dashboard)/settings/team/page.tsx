"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Check,
  Ellipsis,
  KeyRound,
  Loader2,
  MailCheck,
  MailWarning,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { useCurrentUser } from "@/hooks/use-current-user";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog, Modal } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";
import { PasswordInput } from "@/components/shared/password-input";
import { Skeleton } from "@/components/shared/skeleton";
import { CopyButton } from "@/components/settings/copy-button";
import { CodeWell, SettingsHeader } from "@/components/settings/section";

type InviteResult = {
  email: string;
  invite_url: string;
  email_sent: boolean;
  email_error?: string | null;
  expires_at?: string;
};

type TeamMember = {
  id: string;
  email: string;
  display_name: string | null;
  roles?: string[];
  created_at?: string;
  is_active?: boolean;
};

const DEFAULT_INVITE_ROLE = "viewer";

const roleLabel = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

function initials(text: string) {
  const parts = text.split(/[\s._@-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : text.slice(0, 2)).toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line-strong bg-raised text-[11px] font-semibold text-t2"
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export default function TeamPage() {
  const currentUser = useCurrentUser();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [resetOpenId, setResetOpenId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccessId, setResetSuccessId] = useState<string | null>(null);
  const resetSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when a row-menu item opens a dialog, so the closing menu doesn't pull
  // focus back to its trigger while the dialog is taking it.
  const menuOpensDialog = useRef(false);

  /// Radix runs a menu item's onSelect before the (focus-trapping) menu has
  /// closed, so a dialog opened right there loses its initial focus. Open it
  /// on the next tick instead.
  function openFromMenu(open: () => void) {
    menuOpensDialog.current = true;
    setTimeout(open, 0);
  }

  useEffect(() => {
    return () => {
      if (resetSuccessTimerRef.current) clearTimeout(resetSuccessTimerRef.current);
    };
  }, []);

  // PasswordInput has no autoFocus prop; focus it once the dialog is up.
  useEffect(() => {
    if (!resetOpenId) return;
    const t = setTimeout(() => document.getElementById("reset-password-input")?.focus(), 0);
    return () => clearTimeout(t);
  }, [resetOpenId]);

  const { data, isLoading, isError, error, refetch } = $api.useQuery("get", "/api/v1/team");

  const members = (data?.members ?? []) as TeamMember[];
  const availableRoles: string[] = (data?.roles ?? []).map((r) => r.name);

  useEffect(() => {
    if (inviteRole || availableRoles.length === 0) return;
    setInviteRole(
      availableRoles.includes(DEFAULT_INVITE_ROLE) ? DEFAULT_INVITE_ROLE : availableRoles[0],
    );
  }, [availableRoles, inviteRole]);

  const memberName = (id: string | null) => {
    const m = members.find((x) => x.id === id);
    return m ? (m.display_name ?? m.email) : "this member";
  };
  const removeTarget = members.find((m) => m.id === confirmRemove);

  function openInvite() {
    setInviteError(null);
    setInviteOpen(true);
  }

  function finishInvite() {
    setInviteOpen(false);
    setInviteResult(null);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteRole || inviting) return;
    setInviting(true);
    setInviteError(null);
    setInviteResult(null);

    try {
      const result = (await unwrap(
        fetchClient.POST("/api/v1/team/members", {
          body: { email: inviteEmail.trim(), role: inviteRole } as never,
        }),
      )) as InviteResult;
      setInviteResult(result);
      setInviteEmail("");
      refetch();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to send invitation");
    } finally {
      setInviting(false);
    }
  }

  function openReset(memberId: string) {
    setResetOpenId(memberId);
    setResetPassword("");
    setResetError(null);
  }

  function cancelReset() {
    setResetOpenId(null);
    setResetPassword("");
    setResetError(null);
  }

  async function handleResetPassword(memberId: string) {
    setResetSubmitting(true);
    setResetError(null);
    try {
      await unwrap(
        fetchClient.POST("/api/v1/team/members/{member_id}/password", {
          params: { path: { member_id: memberId } },
          body: { password: resetPassword },
        }),
      );
      setResetOpenId(null);
      setResetPassword("");
      setResetSuccessId(memberId);
      if (resetSuccessTimerRef.current) clearTimeout(resetSuccessTimerRef.current);
      resetSuccessTimerRef.current = setTimeout(() => setResetSuccessId(null), 3000);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setResetSubmitting(false);
    }
  }

  async function handleRemove(memberId: string) {
    setRemovingId(memberId);
    setRemoveError(null);
    try {
      await unwrap(
        fetchClient.DELETE("/api/v1/team/members/{member_id}", {
          params: { path: { member_id: memberId } },
        }),
      );
      setConfirmRemove(null);
      refetch();
    } catch (err) {
      setConfirmRemove(null);
      setRemoveError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <>
      <SettingsHeader
        title="Members"
        description="People who can sign in to this organization. Their role decides what they can see and change."
        action={
          <Button variant="primary" onClick={openInvite}>
            <UserPlus />
            Invite member
          </Button>
        }
      />

      {removeError && <ErrorAlert onDismiss={() => setRemoveError(null)}>{removeError}</ErrorAlert>}

      {isError ? (
        <ErrorAlert>{(error as unknown as Error)?.message ?? "Failed to load team"}</ErrorAlert>
      ) : (
        <Panel aria-label="Members">
          <PanelHeader
            title="People"
            subtitle={
              members.length > 0
                ? `${members.length} ${members.length === 1 ? "member" : "members"}`
                : undefined
            }
          />
          {isLoading ? (
            <div className="flex flex-col gap-3 border-t border-line-soft px-4 py-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title="No members yet"
              description="Invite people to give them access to this organization."
              className="border-t border-line-soft"
            />
          ) : (
            <ul>
              {members.map((member) => {
                const name = member.display_name ?? member.email;
                const isYou = currentUser?.id === member.id;
                return (
                  <li
                    key={member.id}
                    className="flex items-center gap-3 border-t border-line-soft px-4 py-3"
                  >
                    <Avatar name={name} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[13.5px] font-[550] text-foreground">
                          {name}
                        </span>
                        {isYou && <span className="text-xs text-t3">You</span>}
                        {resetSuccessId === member.id && (
                          <Chip tone="ok" icon={<Check strokeWidth={2.6} />}>
                            Password reset
                          </Chip>
                        )}
                      </div>
                      {member.display_name && (
                        <span className="truncate text-[13px] text-t3">{member.email}</span>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      {(member.roles ?? []).map((r) => (
                        <Chip key={r} title={`Role: ${r}`}>
                          {roleLabel(r)}
                        </Chip>
                      ))}
                    </div>
                    <Menu>
                      <MenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
                          <Ellipsis />
                        </Button>
                      </MenuTrigger>
                      <MenuContent
                        onCloseAutoFocus={(e) => {
                          if (!menuOpensDialog.current) return;
                          menuOpensDialog.current = false;
                          e.preventDefault();
                        }}
                      >
                        <div className="truncate px-2.5 pt-1.5 pb-1 text-xs text-t3">
                          {member.email}
                        </div>
                        <MenuItem onSelect={() => openFromMenu(() => openReset(member.id))}>
                          <KeyRound />
                          Reset password
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          onSelect={() => openFromMenu(() => setConfirmRemove(member.id))}
                          className="text-fail data-[highlighted]:bg-fail-wash [&_svg]:text-fail"
                        >
                          <Trash2 />
                          Remove member
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      <Modal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title={inviteResult ? "Invitation created" : "Invite member"}
        description={
          inviteResult
            ? undefined
            : "Feloxi emails them a link to join. If email isn't set up, you get a link to share instead."
        }
        footer={
          inviteResult ? (
            <>
              <Button onClick={() => setInviteResult(null)}>Invite another</Button>
              <Button variant="primary" onClick={finishInvite}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" form="invite-member" disabled={inviting}>
                {inviting ? <Loader2 className="animate-spin" /> : <UserPlus />}
                Send invite
              </Button>
            </>
          )
        }
      >
        {inviteResult ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-t2">
                {inviteResult.email_sent ? (
                  <Chip tone="ok" icon={<MailCheck />}>
                    Email sent
                  </Chip>
                ) : (
                  <Chip tone="warn" icon={<MailWarning />}>
                    Email not sent
                  </Chip>
                )}
                <span className="min-w-0 truncate text-foreground">{inviteResult.email}</span>
              </div>
              <p className="text-[13px] leading-relaxed text-t2">
                {inviteResult.email_sent
                  ? "An email with the sign-in link has been sent."
                  : inviteResult.email_error
                    ? `Email delivery failed (${inviteResult.email_error}). Share the link below manually.`
                    : "Email was not sent. Share the link below manually."}
              </p>
            </div>
            <Field
              label="Invite link"
              hint={
                inviteResult.expires_at
                  ? `Expires ${format(new Date(inviteResult.expires_at), "d MMM yyyy, HH:mm")}.`
                  : undefined
              }
            >
              <CodeWell actions={<CopyButton text={inviteResult.invite_url} />}>
                {inviteResult.invite_url}
              </CodeWell>
            </Field>
          </div>
        ) : (
          <form id="invite-member" onSubmit={handleInvite} className="flex flex-col gap-4">
            {inviteError && <ErrorAlert>{inviteError}</ErrorAlert>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
              <Field label="Email" htmlFor="invite-email">
                <Input
                  id="invite-email"
                  type="email"
                  required
                  autoFocus
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                />
              </Field>
              <Field label="Role" htmlFor="invite-role">
                <Select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  {availableRoles.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={resetOpenId != null}
        onOpenChange={(open) => !open && cancelReset()}
        title="Reset password"
        description={`Set a new password for ${memberName(resetOpenId)}. They'll be signed out of all sessions and must sign in again.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={cancelReset} disabled={resetSubmitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="reset-password"
              disabled={resetSubmitting}
            >
              {resetSubmitting && <Loader2 className="animate-spin" />}
              Set password
            </Button>
          </>
        }
      >
        <form
          id="reset-password"
          onSubmit={(e) => {
            e.preventDefault();
            if (resetOpenId) handleResetPassword(resetOpenId);
          }}
        >
          <Field label="New password" htmlFor="reset-password-input" error={resetError}>
            <PasswordInput
              id="reset-password-input"
              name="new-password"
              value={resetPassword}
              onChange={setResetPassword}
              hasError={!!resetError}
            />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmRemove != null}
        onOpenChange={(open) => !open && removingId == null && setConfirmRemove(null)}
        title="Remove this member?"
        description={`${memberName(confirmRemove)} loses access to this organization right away.`}
        subject={removeTarget?.email}
        confirmLabel="Remove member"
        tone="danger"
        busy={removingId != null}
        onConfirm={() => confirmRemove && handleRemove(confirmRemove)}
      />
    </>
  );
}

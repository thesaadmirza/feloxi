"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { AuthShell, AuthSpinner } from "@/components/auth/auth-shell";
import { ErrorAlert } from "@/components/shared/error-alert";
import { PasswordInput } from "@/components/shared/password-input";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { saveUser } from "@/lib/auth";

export default function AcceptInvitePage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params.token;

  const {
    data: preview,
    isLoading: loadingPreview,
    error: previewError,
  } = $api.useQuery(
    "get",
    "/api/v1/auth/invite/{token}",
    { params: { path: { token: token ?? "" } } },
    { enabled: !!token, retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
  );

  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !preview) return;
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const auth = await unwrap(
        fetchClient.POST("/api/v1/auth/accept-invite", {
          body: {
            token,
            password,
            display_name: displayName.trim() || undefined,
          },
        }),
      );
      saveUser(auth.user);
      router.push("/");
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to accept invitation. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingPreview) {
    return (
      <AuthShell>
        <AuthSpinner label="Loading invitation" quiet />
      </AuthShell>
    );
  }

  if (previewError || !preview) {
    return (
      <AuthShell title="Invitation unavailable">
        <ErrorAlert>This invitation link is invalid or has expired.</ErrorAlert>
        <p className="mt-3 text-[13px] leading-relaxed text-t3">
          Ask your admin to send a new invitation.
        </p>
        <Button asChild variant="primary" size="lg" className="mt-6 w-full">
          <Link href="/auth/login">Go to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Join ${preview.tenant_name}`}
      subtitle={
        <>
          You&apos;ve been invited as{" "}
          <span className="font-[550] text-foreground">{preview.role}</span>. Set a password to
          activate your account.
        </>
      }
    >
      {formError && <ErrorAlert className="mb-5">{formError}</ErrorAlert>}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" value={preview.email} disabled className="h-10" />
        </Field>

        <Field
          label={
            <>
              Your name <span className="ml-1 font-normal text-t3">Optional</span>
            </>
          }
          htmlFor="display_name"
        >
          <Input
            id="display_name"
            type="text"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="h-10"
          />
        </Field>

        <Field label="Password" htmlFor="password">
          <PasswordInput value={password} onChange={setPassword} required />
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={submitting}
          className="mt-1 w-full"
        >
          {submitting && <Loader2 className="animate-spin" />}
          {submitting ? "Activating account…" : "Activate account"}
        </Button>
      </form>
    </AuthShell>
  );
}

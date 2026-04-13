"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertTriangle } from "lucide-react";
import { FeloxiLogo } from "@/components/icons/feloxi-logo";
import { PasswordInput } from "@/components/shared/password-input";
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
    { enabled: !!token, retry: false, staleTime: Infinity, refetchOnWindowFocus: false }
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
        })
      );
      saveUser(auth.user);
      router.push("/");
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to accept invitation. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const inputBase =
    "w-full px-3 py-2.5 rounded-lg bg-zinc-800/50 border text-zinc-200 placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-colors";
  const inputNormal = "border-zinc-800 hover:border-zinc-700";

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <FeloxiLogo size={28} className="text-zinc-300" />
          <span className="text-2xl font-semibold text-zinc-200 tracking-tight">Feloxi</span>
        </div>

        <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-8 shadow-xl">
          {loadingPreview ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
            </div>
          ) : previewError || !preview ? (
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-500/10 mb-4">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h1 className="text-xl font-semibold text-zinc-100 mb-2">
                Invitation unavailable
              </h1>
              <p className="text-sm text-zinc-500 mb-6">
                This invitation link is invalid or has expired.
              </p>
              <Link
                href="/auth/login"
                className="inline-flex px-4 py-2.5 rounded-lg bg-white hover:bg-zinc-200 text-zinc-900 text-sm font-medium transition-colors"
              >
                Go to sign in
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-zinc-100 mb-1">
                Join {preview.tenant_name}
              </h1>
              <p className="text-sm text-zinc-500 mb-6">
                You&apos;ve been invited as{" "}
                <span className="text-zinc-300">{preview.role}</span>. Set a password to activate
                your account.
              </p>

              {formError && (
                <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                    Email address
                  </label>
                  <input
                    type="email"
                    value={preview.email}
                    disabled
                    className={`${inputBase} ${inputNormal} opacity-70 cursor-not-allowed`}
                  />
                </div>

                <div>
                  <label
                    htmlFor="display_name"
                    className="block text-sm font-medium text-zinc-400 mb-1.5"
                  >
                    Your name
                    <span className="ml-1.5 text-xs text-zinc-600 font-normal">Optional</span>
                  </label>
                  <input
                    id="display_name"
                    type="text"
                    autoComplete="name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className={`${inputBase} ${inputNormal}`}
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-zinc-400 mb-1.5"
                  >
                    Password
                  </label>
                  <PasswordInput value={password} onChange={setPassword} required />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white hover:bg-zinc-200 disabled:opacity-60 disabled:cursor-not-allowed text-zinc-900 text-sm font-medium transition-colors"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {submitting ? "Activating account…" : "Activate account"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

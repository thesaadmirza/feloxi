"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertTriangle, Building2 } from "lucide-react";
import { FeloxiLogo } from "@/components/icons/feloxi-logo";
import { fetchClient, unwrap } from "@/lib/api";
import { saveUser } from "@/lib/auth";
import type { OrgSummary, AuthResponse, OrgPickerResponse } from "@/types/api";

type VerifyResult = AuthResponse | OrgPickerResponse;

export default function MagicLinkVerifyPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [pickingOrg, setPickingOrg] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      try {
        const result = (await unwrap(
          fetchClient.POST("/api/v1/auth/magic-link/verify", { body: { token } }),
        )) as VerifyResult;
        if (cancelled) return;
        if ("needs_org_selection" in result) {
          setOrgs(result.organizations);
          setLoading(false);
          return;
        }
        saveUser(result.user);
        router.push("/");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "This sign-in link is invalid or expired.");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router]);

  async function handleOrgPick(slug: string) {
    if (!token) return;
    setPickingOrg(true);
    setError(null);
    try {
      const result = (await unwrap(
        fetchClient.POST("/api/v1/auth/magic-link/verify", {
          body: { token, tenant_slug: slug },
        }),
      )) as VerifyResult;
      if ("needs_org_selection" in result) {
        setError("Please select an organization.");
        setPickingOrg(false);
        return;
      }
      saveUser(result.user);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in. Please request a new link.");
      setPickingOrg(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <FeloxiLogo size={28} className="text-zinc-300" />
          <span className="text-2xl font-semibold text-zinc-200 tracking-tight">Feloxi</span>
        </div>

        <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-8 shadow-xl">
          {loading && (
            <div className="flex flex-col items-center text-center py-6">
              <Loader2 className="w-6 h-6 text-zinc-500 animate-spin mb-4" />
              <p className="text-sm text-zinc-400">Signing you in…</p>
            </div>
          )}

          {error && !orgs && (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-6 h-6 text-red-400" />
              </div>
              <h1 className="text-xl font-semibold text-zinc-100 mb-2">Link invalid</h1>
              <p className="text-sm text-zinc-500 mb-6 leading-relaxed">{error}</p>
              <Link
                href="/auth/login"
                className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-white hover:bg-zinc-200 text-zinc-900 text-sm font-medium transition-colors"
              >
                Request a new link
              </Link>
            </div>
          )}

          {orgs && (
            <>
              <h1 className="text-xl font-semibold text-zinc-100 mb-1">Choose an organization</h1>
              <p className="text-sm text-zinc-500 mb-6">
                Your email belongs to multiple organizations. Select one to continue.
              </p>

              {error && (
                <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                {orgs.map((org) => (
                  <button
                    key={org.slug}
                    onClick={() => handleOrgPick(org.slug)}
                    disabled={pickingOrg}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-zinc-800
                      hover:border-zinc-600 hover:bg-white/[0.03] transition-colors text-left
                      disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-zinc-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-200 truncate">{org.name}</p>
                      <p className="text-xs text-zinc-600 truncate">{org.slug}</p>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

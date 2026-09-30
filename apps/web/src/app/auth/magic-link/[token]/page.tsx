"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell, AuthSpinner } from "@/components/auth/auth-shell";
import { OrgPicker } from "@/components/auth/org-picker";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Button } from "@/components/ui/button";
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

  // Verify each token once. Strict mode mounts effects twice in development,
  // and a second request would find the link already used.
  const verified = useRef<string | null>(null);

  useEffect(() => {
    if (!token || verified.current === token) return;
    verified.current = token;

    (async () => {
      try {
        const result = (await unwrap(
          fetchClient.POST("/api/v1/auth/magic-link/verify", { body: { token } }),
        )) as VerifyResult;
        if ("needs_org_selection" in result) {
          setOrgs(result.organizations);
          setLoading(false);
          return;
        }
        saveUser(result.user);
        router.push("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "This sign-in link is invalid or expired.");
        setLoading(false);
      }
    })();
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

  if (orgs) {
    return (
      <AuthShell
        title="Choose an organization"
        subtitle="Your email belongs to multiple organizations. Select one to continue."
      >
        {error && <ErrorAlert className="mb-4">{error}</ErrorAlert>}
        <OrgPicker orgs={orgs} onPick={handleOrgPick} busy={pickingOrg} />
      </AuthShell>
    );
  }

  if (error) {
    return (
      <AuthShell
        title="Couldn't sign you in"
        subtitle="Sign-in links work once and expire after 15 minutes."
      >
        <ErrorAlert>{error}</ErrorAlert>
        <Button asChild variant="primary" size="lg" className="mt-6 w-full">
          <Link href="/auth/login">Request a new link</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Signing you in">
      {loading && <AuthSpinner label="Checking your sign-in link…" />}
    </AuthShell>
  );
}

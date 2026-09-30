"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, KeyRound, Loader2, Mail } from "lucide-react";
import { AuthDivider, AuthShell, AuthSpinner } from "@/components/auth/auth-shell";
import { GoogleIcon } from "@/components/auth/google-icon";
import { OrgPicker } from "@/components/auth/org-picker";
import { ErrorAlert, Notice } from "@/components/shared/error-alert";
import { PasswordInput } from "@/components/shared/password-input";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { fetchClient, unwrap } from "@/lib/api";
import { saveUser } from "@/lib/auth";
import type { OrgSummary, LoginResponse } from "@/types/api";

type FormValues = {
  email: string;
  password: string;
};

type FormErrors = {
  email?: string;
  password?: string;
  form?: string;
};

function validateEmail(email: string): string | undefined {
  if (!email.trim()) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address";
  }
  return undefined;
}

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  const emailErr = validateEmail(values.email);
  if (emailErr) errors.email = emailErr;
  if (!values.password) {
    errors.password = "Password is required";
  }
  return errors;
}

export default function LoginPage() {
  const router = useRouter();
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [allowSignup, setAllowSignup] = useState(false);
  const [values, setValues] = useState<FormValues>({ email: "", password: "" });
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);

  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [pickingOrg, setPickingOrg] = useState(false);

  const [mode, setMode] = useState<"magic" | "password">("password");
  const [magicLinkEnabled, setMagicLinkEnabled] = useState(false);
  const [googleSSO, setGoogleSSO] = useState(false);
  const [magicSending, setMagicSending] = useState(false);
  const [magicSentTo, setMagicSentTo] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/setup/status", { credentials: "include" })
      .then((r) => r.json())
      .then(
        (data: {
          needs_setup: boolean;
          allow_signup: boolean;
          magic_link_enabled?: boolean;
          google_sso_enabled?: boolean;
        }) => {
          if (data.needs_setup) {
            router.replace("/setup");
          } else {
            setAllowSignup(data.allow_signup);
            const magicEnabled = !!data.magic_link_enabled;
            setMagicLinkEnabled(magicEnabled);
            setGoogleSSO(!!data.google_sso_enabled);
            if (magicEnabled) setMode("magic");
            setCheckingSetup(false);
          }
        },
      )
      .catch(() => setCheckingSetup(false));
  }, [router]);

  // Surface an SSO failure passed back from the Google callback redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoError = params.get("sso_error");
    if (ssoError) {
      setErrors({ form: ssoError });
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined, form: undefined }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationErrors = validate(values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setLoading(true);
    setErrors({});
    try {
      const result = (await unwrap(
        fetchClient.POST("/api/v1/auth/login", {
          body: {
            email: values.email.trim(),
            password: values.password,
          },
        }),
      )) as LoginResponse;

      if ("needs_org_selection" in result) {
        // Multiple orgs — show picker
        setOrgs(result.organizations);
        setLoading(false);
        return;
      }

      // Single org — logged in directly
      saveUser(result.user);
      router.push("/");
    } catch (err) {
      if (err instanceof Error) {
        setErrors({ form: err.message });
      } else {
        setErrors({ form: "An unexpected error occurred. Please try again." });
      }
      setLoading(false);
    }
  }

  async function handleOrgPick(slug: string) {
    setPickingOrg(true);
    setErrors({});
    try {
      const result = (await unwrap(
        fetchClient.POST("/api/v1/auth/login", {
          body: {
            email: values.email.trim(),
            password: values.password,
            tenant_slug: slug,
          },
        }),
      )) as LoginResponse;

      if ("needs_org_selection" in result) {
        // Shouldn't happen when slug is provided, but handle gracefully
        setErrors({ form: "Please select an organization." });
        setPickingOrg(false);
        return;
      }

      saveUser(result.user);
      router.push("/");
    } catch (err) {
      if (err instanceof Error) {
        setErrors({ form: err.message });
      } else {
        setErrors({ form: "An unexpected error occurred. Please try again." });
      }
      setPickingOrg(false);
    }
  }

  function handleBackToSignIn() {
    setOrgs(null);
    setErrors({});
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    const emailErr = validateEmail(values.email);
    if (emailErr) {
      setErrors({ email: emailErr });
      return;
    }
    setMagicSending(true);
    setErrors({});
    try {
      await unwrap(
        fetchClient.POST("/api/v1/auth/magic-link", {
          body: { email: values.email.trim() },
        }),
      );
      setMagicSentTo(values.email.trim());
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : "Couldn't send sign-in link. Please try again.",
      });
    } finally {
      setMagicSending(false);
    }
  }

  if (checkingSetup) {
    return (
      <AuthShell>
        <AuthSpinner label="Loading" quiet />
      </AuthShell>
    );
  }

  if (magicSentTo) {
    return (
      <AuthShell title="Check your inbox">
        <Notice>
          If an account exists for <span className="font-[550]">{magicSentTo}</span>, a sign-in link
          is on its way.
        </Notice>
        <p className="mt-3 text-[13px] text-t3">The link expires in 15 minutes.</p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-6 -ml-2.5"
          onClick={() => {
            setMagicSentTo(null);
            setErrors({});
          }}
        >
          <ArrowLeft />
          Back to sign in
        </Button>
      </AuthShell>
    );
  }

  if (orgs) {
    return (
      <AuthShell
        title="Choose an organization"
        subtitle="Your email belongs to multiple organizations. Select one to continue."
      >
        {errors.form && <ErrorAlert className="mb-4">{errors.form}</ErrorAlert>}
        <OrgPicker orgs={orgs} onPick={handleOrgPick} busy={pickingOrg} />
        <Button variant="ghost" size="sm" className="mt-6 -ml-2.5" onClick={handleBackToSignIn}>
          <ArrowLeft />
          Back to sign in
        </Button>
      </AuthShell>
    );
  }

  const emailField = (
    <Field label="Email" htmlFor="email" error={errors.email}>
      <Input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        autoFocus
        value={values.email}
        onChange={handleChange}
        placeholder="you@example.com"
        aria-invalid={errors.email ? true : undefined}
        className="h-10"
      />
    </Field>
  );

  return (
    <AuthShell
      title="Sign in"
      subtitle={
        allowSignup ? (
          <>
            Don&apos;t have an account?{" "}
            <Link href="/auth/register" className="font-[550] text-link hover:underline">
              Create one
            </Link>
          </>
        ) : undefined
      }
    >
      {errors.form && <ErrorAlert className="mb-5">{errors.form}</ErrorAlert>}

      {googleSSO && (
        <>
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => {
              window.location.href = "/api/v1/auth/google/connect";
            }}
          >
            <GoogleIcon />
            Continue with Google
          </Button>
          <AuthDivider>or with email</AuthDivider>
        </>
      )}

      {/* Keyed so switching modes remounts the form. Otherwise React reuses the
          clicked "instead" button as the other form's submit button, and the
          same click submits it. */}
      {mode === "magic" ? (
        <form key="magic" onSubmit={handleMagicLink} noValidate className="flex flex-col gap-4">
          {emailField}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={magicSending}
            className="mt-1 w-full"
          >
            {magicSending ? <Loader2 className="animate-spin" /> : <Mail />}
            {magicSending ? "Sending…" : "Email me a sign-in link"}
          </Button>

          {magicLinkEnabled && (
            <Button
              variant="ghost"
              size="sm"
              className="self-center text-t3"
              onClick={() => setMode("password")}
            >
              <KeyRound />
              Sign in with password instead
            </Button>
          )}
        </form>
      ) : (
        <form key="password" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {emailField}

          <Field label="Password" htmlFor="password" error={errors.password}>
            <PasswordInput
              value={values.password}
              onChange={(v) => {
                setValues((prev) => ({ ...prev, password: v }));
                if (errors.password) {
                  setErrors((prev) => ({ ...prev, password: undefined, form: undefined }));
                }
              }}
              autoComplete="current-password"
              placeholder="••••••••"
              hasError={!!errors.password}
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={loading}
            className="mt-1 w-full"
          >
            {loading && <Loader2 className="animate-spin" />}
            {loading ? "Signing in…" : "Sign in"}
          </Button>

          {magicLinkEnabled && (
            <Button
              variant="ghost"
              size="sm"
              className="self-center text-t3"
              onClick={() => setMode("magic")}
            >
              <Mail />
              Email me a sign-in link instead
            </Button>
          )}
        </form>
      )}
    </AuthShell>
  );
}

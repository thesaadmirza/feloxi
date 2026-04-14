"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Building2, Mail, CheckCircle2 } from "lucide-react";
import { FeloxiLogo } from "@/components/icons/feloxi-logo";
import { PasswordInput } from "@/components/shared/password-input";
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

  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [magicSending, setMagicSending] = useState(false);
  const [magicSentTo, setMagicSentTo] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/setup/status", { credentials: "include" })
      .then((r) => r.json())
      .then((data: { needs_setup: boolean; allow_signup: boolean }) => {
        if (data.needs_setup) {
          router.replace("/setup");
        } else {
          setAllowSignup(data.allow_signup);
          setCheckingSetup(false);
        }
      })
      .catch(() => setCheckingSetup(false));
  }, [router]);

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
      const result = await unwrap(fetchClient.POST("/api/v1/auth/login", {
        body: {
          email: values.email.trim(),
          password: values.password,
        },
      })) as LoginResponse;

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
      const result = await unwrap(fetchClient.POST("/api/v1/auth/login", {
        body: {
          email: values.email.trim(),
          password: values.password,
          tenant_slug: slug,
        },
      })) as LoginResponse;

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

  if (checkingSetup) return null;

  if (magicSentTo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-center gap-3 mb-8">
            <FeloxiLogo size={28} className="text-zinc-300" />
            <span className="text-2xl font-semibold text-zinc-200 tracking-tight">Feloxi</span>
          </div>

          <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-8 shadow-xl text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <h1 className="text-xl font-semibold text-zinc-100 mb-2">Check your inbox</h1>
            <p className="text-sm text-zinc-500 leading-relaxed">
              If an account exists for <span className="text-zinc-300">{magicSentTo}</span>, a
              sign-in link is on its way. The link expires in 15 minutes.
            </p>
            <button
              onClick={() => {
                setMagicSentTo(null);
                setErrors({});
              }}
              className="mt-6 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (orgs) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-center gap-3 mb-8">
            <FeloxiLogo size={28} className="text-zinc-300" />
            <span className="text-2xl font-semibold text-zinc-200 tracking-tight">Feloxi</span>
          </div>

          <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-8 shadow-xl">
            <h1 className="text-xl font-semibold text-zinc-100 mb-1">Choose an organization</h1>
            <p className="text-sm text-zinc-500 mb-6">
              Your email belongs to multiple organizations. Select one to continue.
            </p>

            {errors.form && (
              <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {errors.form}
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

            <button
              onClick={handleBackToSignIn}
              className="mt-4 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <FeloxiLogo size={28} className="text-zinc-300" />
          <span className="text-2xl font-semibold text-zinc-200 tracking-tight">Feloxi</span>
        </div>

        <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-8 shadow-xl">
          <h1 className="text-xl font-semibold text-zinc-100 mb-1">Sign in to your account</h1>
          {allowSignup && (
            <p className="text-sm text-zinc-500 mb-6">
              Don&apos;t have an account?{" "}
              <Link href="/auth/register" className="text-zinc-300 hover:text-white transition-colors">
                Create one free
              </Link>
            </p>
          )}
          {!allowSignup && <div className="mb-6" />}

          {errors.form && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {errors.form}
            </div>
          )}

          {mode === "magic" ? (
            <form onSubmit={handleMagicLink} noValidate className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-zinc-400 mb-1.5">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={values.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                  className={[
                    "w-full px-3 py-2.5 rounded-lg bg-zinc-800/50 border text-zinc-200 placeholder:text-zinc-600",
                    "text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-colors",
                    errors.email
                      ? "border-red-500/50 focus:ring-red-500"
                      : "border-zinc-800 hover:border-zinc-700",
                  ].join(" ")}
                />
                {errors.email && (
                  <p className="mt-1.5 text-xs text-red-400">{errors.email}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={magicSending}
                className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                  bg-white hover:bg-zinc-200 disabled:opacity-60 disabled:cursor-not-allowed
                  text-zinc-900 text-sm font-medium transition-colors"
              >
                {magicSending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Mail className="w-4 h-4" />
                )}
                {magicSending ? "Sending…" : "Email me a sign-in link"}
              </button>

              <button
                type="button"
                onClick={() => setMode("password")}
                className="w-full text-center text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Sign in with password instead
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-zinc-400 mb-1.5">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={values.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                  className={[
                    "w-full px-3 py-2.5 rounded-lg bg-zinc-800/50 border text-zinc-200 placeholder:text-zinc-600",
                    "text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-colors",
                    errors.email
                      ? "border-red-500/50 focus:ring-red-500"
                      : "border-zinc-800 hover:border-zinc-700",
                  ].join(" ")}
                />
                {errors.email && (
                  <p className="mt-1.5 text-xs text-red-400">{errors.email}</p>
                )}
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-zinc-400 mb-1.5">
                  Password
                </label>
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
                {errors.password && (
                  <p className="mt-1.5 text-xs text-red-400">{errors.password}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                  bg-white hover:bg-zinc-200 disabled:opacity-60 disabled:cursor-not-allowed
                  text-zinc-900 text-sm font-medium transition-colors"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? "Signing in…" : "Sign in"}
              </button>

              <button
                type="button"
                onClick={() => setMode("magic")}
                className="w-full text-center text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Email me a sign-in link instead
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

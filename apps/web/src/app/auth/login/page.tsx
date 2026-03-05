"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2, Building2 } from "lucide-react";
import { FeloxiLogo } from "@/components/icons/feloxi-logo";
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

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.email.trim()) {
    errors.email = "Email is required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = "Enter a valid email address";
  }
  if (!values.password) {
    errors.password = "Password is required";
  }
  return errors;
}

export default function LoginPage() {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({ email: "", password: "" });
  const [errors, setErrors] = useState<FormErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Org picker state
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [pickingOrg, setPickingOrg] = useState(false);

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
              onClick={() => { setOrgs(null); setErrors({}); }}
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
          <p className="text-sm text-zinc-500 mb-6">
            Don&apos;t have an account?{" "}
            <Link href="/auth/register" className="text-zinc-300 hover:text-white transition-colors">
              Create one free
            </Link>
          </p>

          {errors.form && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {errors.form}
            </div>
          )}

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
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={values.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  className={[
                    "w-full px-3 py-2.5 pr-10 rounded-lg bg-zinc-800/50 border text-zinc-200 placeholder:text-zinc-600",
                    "text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-colors",
                    errors.password
                      ? "border-red-500/50 focus:ring-red-500"
                      : "border-zinc-800 hover:border-zinc-700",
                  ].join(" ")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
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
          </form>
        </div>
      </div>
    </div>
  );
}

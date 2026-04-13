"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { FeloxiLogo } from "@/components/icons/feloxi-logo";
import { PasswordInput } from "@/components/shared/password-input";
import { fetchClient, unwrap } from "@/lib/api";
import { saveUser } from "@/lib/auth";

type FormValues = {
  tenant_name: string;
  tenant_slug: string;
  email: string;
  password: string;
  display_name: string;
};

type FormErrors = {
  tenant_name?: string;
  tenant_slug?: string;
  email?: string;
  password?: string;
  display_name?: string;
  form?: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
}

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.tenant_name.trim()) {
    errors.tenant_name = "Organization name is required";
  }
  if (!values.tenant_slug.trim()) {
    errors.tenant_slug = "Organization slug is required";
  } else if (!/^[a-z0-9-]+$/.test(values.tenant_slug)) {
    errors.tenant_slug = "Slug may only contain lowercase letters, numbers, and hyphens";
  } else if (values.tenant_slug.length < 3) {
    errors.tenant_slug = "Slug must be at least 3 characters";
  }
  if (!values.email.trim()) {
    errors.email = "Email is required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = "Enter a valid email address";
  }
  if (!values.password) {
    errors.password = "Password is required";
  } else if (values.password.length < 8) {
    errors.password = "Password must be at least 8 characters";
  }
  return errors;
}

export default function RegisterPage() {
  const router = useRouter();
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [signupDisabled, setSignupDisabled] = useState(false);

  useEffect(() => {
    fetch("/api/v1/setup/status", { credentials: "include" })
      .then((r) => r.json())
      .then((data: { needs_setup: boolean; allow_signup: boolean }) => {
        if (data.needs_setup) {
          router.replace("/setup");
        } else if (!data.allow_signup) {
          setSignupDisabled(true);
          setCheckingSetup(false);
        } else {
          setCheckingSetup(false);
        }
      })
      .catch(() => setCheckingSetup(false));
  }, [router]);

  const [values, setValues] = useState<FormValues>({
    tenant_name: "",
    tenant_slug: "",
    email: "",
    password: "",
    display_name: "",
  });
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;

    setValues((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "tenant_name" && !slugManuallyEdited) {
        next.tenant_slug = slugify(value);
      }
      return next;
    });

    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined, form: undefined }));
    }
  }

  function handleSlugChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSlugManuallyEdited(true);
    handleChange(e);
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
      const auth = await unwrap(fetchClient.POST("/api/v1/auth/register", {
        body: {
          tenant_name: values.tenant_name.trim(),
          tenant_slug: values.tenant_slug.trim(),
          email: values.email.trim(),
          password: values.password,
          display_name: values.display_name.trim() || undefined,
        },
      }));
      saveUser(auth.user);
      router.push("/");
    } catch (err) {
      if (err instanceof Error) {
        setErrors({ form: err.message });
      } else {
        setErrors({ form: "An unexpected error occurred. Please try again." });
      }
    } finally {
      setLoading(false);
    }
  }

  if (checkingSetup) return null;

  if (signupDisabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-center gap-3 mb-8">
            <FeloxiLogo size={28} className="text-zinc-300" />
            <span className="text-2xl font-semibold text-zinc-200 tracking-tight">Feloxi</span>
          </div>
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-8 shadow-xl text-center">
            <h1 className="text-xl font-semibold text-zinc-100 mb-2">Registration disabled</h1>
            <p className="text-sm text-zinc-500 mb-6">
              Public registration is disabled on this instance. Contact your administrator for an
              invite.
            </p>
            <Link
              href="/auth/login"
              className="inline-flex px-4 py-2.5 rounded-lg bg-white hover:bg-zinc-200 text-zinc-900 text-sm font-medium transition-colors"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const inputBase = "w-full px-3 py-2.5 rounded-lg bg-zinc-800/50 border text-zinc-200 placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-colors";
  const inputNormal = "border-zinc-800 hover:border-zinc-700";
  const inputError = "border-red-500/50 focus:ring-red-500";

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <FeloxiLogo size={28} className="text-zinc-300" />
          <span className="text-2xl font-semibold text-zinc-200 tracking-tight">Feloxi</span>
        </div>

        <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-8 shadow-xl">
          <h1 className="text-xl font-semibold text-zinc-100 mb-1">Create your account</h1>
          <p className="text-sm text-zinc-500 mb-6">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-zinc-300 hover:text-white transition-colors">
              Sign in
            </Link>
          </p>

          {errors.form && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {errors.form}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label htmlFor="tenant_name" className="block text-sm font-medium text-zinc-400 mb-1.5">
                Organization name
              </label>
              <input
                id="tenant_name"
                name="tenant_name"
                type="text"
                autoComplete="organization"
                autoFocus
                value={values.tenant_name}
                onChange={handleChange}
                placeholder="Your company name"
                className={[inputBase, errors.tenant_name ? inputError : inputNormal].join(" ")}
              />
              {errors.tenant_name && (
                <p className="mt-1.5 text-xs text-red-400">{errors.tenant_name}</p>
              )}
            </div>

            <div>
              <label htmlFor="tenant_slug" className="block text-sm font-medium text-zinc-400 mb-1.5">
                Organization slug
                <span className="ml-1.5 text-xs text-zinc-600 font-normal">Used in URLs</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 text-sm select-none">
                  feloxi/
                </span>
                <input
                  id="tenant_slug"
                  name="tenant_slug"
                  type="text"
                  autoComplete="off"
                  value={values.tenant_slug}
                  onChange={handleSlugChange}
                  placeholder="your-company"
                  className={["pl-[3.75rem] pr-3", inputBase, errors.tenant_slug ? inputError : inputNormal].join(" ")}
                />
              </div>
              {errors.tenant_slug && (
                <p className="mt-1.5 text-xs text-red-400">{errors.tenant_slug}</p>
              )}
            </div>

            <div>
              <label htmlFor="display_name" className="block text-sm font-medium text-zinc-400 mb-1.5">
                Your name
                <span className="ml-1.5 text-xs text-zinc-600 font-normal">Optional</span>
              </label>
              <input
                id="display_name"
                name="display_name"
                type="text"
                autoComplete="name"
                value={values.display_name}
                onChange={handleChange}
                placeholder="Your name"
                className={[inputBase, inputNormal].join(" ")}
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-zinc-400 mb-1.5">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={values.email}
                onChange={handleChange}
                placeholder="you@example.com"
                className={[inputBase, errors.email ? inputError : inputNormal].join(" ")}
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
              {loading ? "Creating account…" : "Create account"}
            </button>

            <p className="text-center text-xs text-zinc-600 pt-1">
              By creating an account, you agree to our{" "}
              <span className="text-zinc-500">Terms of Service</span> and{" "}
              <span className="text-zinc-500">Privacy Policy</span>.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

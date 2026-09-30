"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { AuthShell, AuthSpinner } from "@/components/auth/auth-shell";
import { SlugInput } from "@/components/auth/slug-input";
import { ErrorAlert } from "@/components/shared/error-alert";
import { PasswordInput } from "@/components/shared/password-input";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { fetchClient, unwrap } from "@/lib/api";
import { saveUser } from "@/lib/auth";
import { slugify } from "@/lib/utils";

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
      const auth = await unwrap(
        fetchClient.POST("/api/v1/auth/register", {
          body: {
            tenant_name: values.tenant_name.trim(),
            tenant_slug: values.tenant_slug.trim(),
            email: values.email.trim(),
            password: values.password,
            display_name: values.display_name.trim() || undefined,
          },
        }),
      );
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

  if (checkingSetup) {
    return (
      <AuthShell>
        <AuthSpinner label="Loading" quiet />
      </AuthShell>
    );
  }

  if (signupDisabled) {
    return (
      <AuthShell
        title="Registration disabled"
        subtitle="Public registration is disabled on this instance. Contact your administrator for an invite."
      >
        <Button asChild variant="primary" size="lg" className="w-full">
          <Link href="/auth/login">Back to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle={
        <>
          Already have an account?{" "}
          <Link href="/auth/login" className="font-[550] text-link hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {errors.form && <ErrorAlert className="mb-5">{errors.form}</ErrorAlert>}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Organization name" htmlFor="tenant_name" error={errors.tenant_name}>
          <Input
            id="tenant_name"
            name="tenant_name"
            type="text"
            autoComplete="organization"
            autoFocus
            value={values.tenant_name}
            onChange={handleChange}
            placeholder="Your company name"
            aria-invalid={errors.tenant_name ? true : undefined}
            className="h-10"
          />
        </Field>

        <Field
          label="Organization slug"
          htmlFor="tenant_slug"
          hint="Used in URLs"
          error={errors.tenant_slug}
        >
          <SlugInput
            id="tenant_slug"
            name="tenant_slug"
            type="text"
            autoComplete="off"
            value={values.tenant_slug}
            onChange={handleSlugChange}
            placeholder="your-company"
            aria-invalid={errors.tenant_slug ? true : undefined}
          />
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
            name="display_name"
            type="text"
            autoComplete="name"
            value={values.display_name}
            onChange={handleChange}
            placeholder="Your name"
            className="h-10"
          />
        </Field>

        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={handleChange}
            placeholder="you@example.com"
            aria-invalid={errors.email ? true : undefined}
            className="h-10"
          />
        </Field>

        <Field label="Password" htmlFor="password" error={errors.password}>
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
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={loading}
          className="mt-1 w-full"
        >
          {loading && <Loader2 className="animate-spin" />}
          {loading ? "Creating account…" : "Create account"}
        </Button>

        <p className="text-center text-xs leading-relaxed text-balance text-t3">
          By creating an account, you agree to our Terms of Service and Privacy Policy.
        </p>
      </form>
    </AuthShell>
  );
}

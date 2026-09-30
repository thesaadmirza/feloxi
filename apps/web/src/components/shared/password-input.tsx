"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { CONTROL } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type Props = {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  hasError?: boolean;
  required?: boolean;
  /// Height and other overrides; auth forms use the default 40px field.
  className?: string;
  "aria-describedby"?: string;
};

export function PasswordInput({
  id = "password",
  name = "password",
  value,
  onChange,
  autoComplete = "new-password",
  placeholder = "Min. 8 characters",
  hasError = false,
  required = false,
  className,
  "aria-describedby": describedBy,
}: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        className={cn(CONTROL, "h-10 pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-t3 transition-colors hover:bg-hover hover:text-foreground"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

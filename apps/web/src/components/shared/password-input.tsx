"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type Props = {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  hasError?: boolean;
  required?: boolean;
};

const BASE_CLASS =
  "w-full px-3 py-2.5 pr-10 rounded-lg bg-zinc-800/50 border text-zinc-200 " +
  "placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-1 " +
  "focus:ring-zinc-500 transition-colors";

const NORMAL_BORDER = "border-zinc-800 hover:border-zinc-700";
const ERROR_BORDER = "border-red-500/50 focus:ring-red-500";

export function PasswordInput({
  id = "password",
  name = "password",
  value,
  onChange,
  autoComplete = "new-password",
  placeholder = "Min. 8 characters",
  hasError = false,
  required = false,
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
        className={`${BASE_CLASS} ${hasError ? ERROR_BORDER : NORMAL_BORDER}`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

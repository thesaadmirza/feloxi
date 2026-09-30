"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { cn } from "@/lib/utils";

const COLLAPSE_THRESHOLD = 1500;

/// Token colours from the design system, so code reads the same in Night and
/// Day. Strings stay neutral; only numbers and literals take a hue.
export const CODE_THEME: Record<string, React.CSSProperties> = {
  hljs: { display: "block", color: "var(--t1)", background: "transparent" },
  "hljs-string": { color: "var(--t1)" },
  "hljs-number": { color: "var(--amber-text)" },
  "hljs-literal": { color: "var(--run)" },
  "hljs-built_in": { color: "var(--run)" },
  "hljs-keyword": { color: "var(--run)" },
  "hljs-attr": { color: "var(--t2)" },
  "hljs-name": { color: "var(--t2)" },
  "hljs-punctuation": { color: "var(--t3)" },
  "hljs-comment": { color: "var(--t3)", fontStyle: "italic" },
  "hljs-meta": { color: "var(--t3)" },
};

type JsonViewerProps = {
  value: string | unknown;
  defaultCollapsed?: boolean;
  maxHeight?: number;
  label?: string;
  className?: string;
};

function parseJson(raw: string | unknown): { parsed: unknown; error: string | null } {
  if (typeof raw !== "string") return { parsed: raw, error: null };
  if (!raw || raw.trim() === "") return { parsed: null, error: null };
  try {
    return { parsed: JSON.parse(raw), error: null };
  } catch {
    return { parsed: raw, error: null };
  }
}

function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

/// Celery reports args, kwargs and results as Python reprs; those get Python
/// highlighting, anything else stays plain text.
function looksLikeRepr(text: string): boolean {
  const t = text.trim();
  return /^(\[[\s\S]*\]|\([\s\S]*\)|\{[\s\S]*\}|'[\s\S]*'|"[\s\S]*")$/.test(t);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-t3 transition-colors hover:bg-hover hover:text-foreground"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function JsonViewer({
  value,
  defaultCollapsed,
  maxHeight = 400,
  label,
  className,
}: JsonViewerProps) {
  const { parsed } = useMemo(() => parseJson(value), [value]);
  const formatted = useMemo(() => formatJson(parsed), [parsed]);

  const shouldAutoCollapse = formatted.length > COLLAPSE_THRESHOLD;
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? shouldAutoCollapse);

  if (parsed === null || parsed === undefined || formatted.trim() === "") {
    return <span className="text-xs text-t3 italic">{label ? `${label}: ` : ""}empty</span>;
  }

  const isPlainString = typeof parsed === "string";
  const language = isPlainString ? (looksLikeRepr(formatted) ? "python" : "text") : "json";

  return (
    <div
      className={cn("min-w-0 overflow-hidden rounded-lg border border-border bg-code", className)}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border py-1 pr-1.5 pl-2">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-t2 transition-colors hover:text-foreground"
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" />
          )}
          <span className="label truncate">{label ?? (isPlainString ? "text" : "json")}</span>
          {shouldAutoCollapse && collapsed && (
            <span className="shrink-0 text-t3">({formatted.length.toLocaleString()} chars)</span>
          )}
        </button>
        {!collapsed && <CopyButton text={formatted} />}
      </div>

      {!collapsed && (
        <div className="overflow-auto" style={{ maxHeight }}>
          <SyntaxHighlighter
            language={language}
            style={CODE_THEME}
            customStyle={{
              margin: 0,
              padding: "10px 14px",
              background: "transparent",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              lineHeight: "1.65",
            }}
            codeTagProps={{
              style: { fontFamily: "inherit", whiteSpace: "pre-wrap", wordBreak: "break-word" },
            }}
            wrapLongLines
          >
            {formatted}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}

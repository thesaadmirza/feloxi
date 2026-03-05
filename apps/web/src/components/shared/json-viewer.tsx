"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";

const COLLAPSE_THRESHOLD = 1500;

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

function isLarge(formatted: string): boolean {
  return formatted.length > COLLAPSE_THRESHOLD;
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
      onClick={handleCopy}
      className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-700"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
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

  const shouldAutoCollapse = isLarge(formatted);
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? shouldAutoCollapse);

  const toggleCollapsed = () => setCollapsed((v) => !v);

  if (parsed === null || parsed === undefined || formatted.trim() === "") {
    return (
      <span className="text-xs text-zinc-500 italic">
        {label ? `${label}: ` : ""}empty
      </span>
    );
  }

  const isPlainString = typeof parsed === "string";
  const language = isPlainString ? "text" : "json";

  return (
    <div className={["rounded-lg border border-zinc-700/50 overflow-hidden", className].filter(Boolean).join(" ")}>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-zinc-800 border-b border-zinc-700/50">
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors min-w-0"
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="truncate">{label ?? (isPlainString ? "text" : "json")}</span>
          {shouldAutoCollapse && collapsed && (
            <span className="text-zinc-600 shrink-0">
              ({formatted.length.toLocaleString()} chars)
            </span>
          )}
        </button>
        {!collapsed && <CopyButton text={formatted} />}
      </div>

      {!collapsed && (
        <div className={`overflow-auto max-h-[${maxHeight}px]`} style={{ maxHeight }}>
          <SyntaxHighlighter
            language={language}
            style={atomOneDark}
            customStyle={{
              margin: 0,
              padding: "12px 16px",
              background: "transparent",
              fontSize: "12px",
              lineHeight: "1.6",
            }}
            wrapLongLines={false}
          >
            {formatted}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}

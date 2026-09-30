"use client";

import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";

export type QueryChip = {
  key: string;
  field: string;
  op: string;
  value: React.ReactNode;
  /// Plain text of the value for the remove button's label.
  text: string;
  onRemove: () => void;
};

/// Search box that also shows the active filters as removable chips.
/// "/" focuses it from anywhere on the page; Backspace in an empty box
/// removes the last chip.
export function QueryBar({
  chips,
  value,
  onChange,
  onCommit,
  onClearAll,
  placeholder,
}: {
  chips: QueryChip[];
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onClearAll: () => void;
  placeholder: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="flex min-h-10 min-w-0 flex-1 cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-card py-1.5 pr-2 pl-3 transition-colors focus-within:border-amber focus-within:ring-2 focus-within:ring-ring/30 hover:border-t4"
      onClick={() => inputRef.current?.focus()}
    >
      <Search className="size-4 shrink-0 text-t3" aria-hidden />
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-md border border-line-strong bg-raised pr-0.5 pl-2 text-[12px] whitespace-nowrap"
        >
          <span className="text-t3">{c.field}</span>
          {c.op && <span className="text-t3">{c.op}</span>}
          <span className="min-w-0 truncate font-[550] text-foreground">{c.value}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              c.onRemove();
            }}
            aria-label={`Remove filter: ${[c.field, c.op, c.text].filter(Boolean).join(" ")}`}
            className="grid size-5 shrink-0 place-items-center rounded text-t3 transition-colors hover:bg-hover hover:text-foreground"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        enterKeyHint="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          else if (e.key === "Escape" && value) onChange("");
          else if (e.key === "Backspace" && !value && chips.length > 0)
            chips[chips.length - 1].onRemove();
        }}
        placeholder={chips.length ? "Add search text…" : placeholder}
        aria-label="Search tasks"
        className="h-6 min-w-[12ch] flex-1 bg-transparent text-[13px] text-foreground placeholder:text-t3 focus:outline-none"
      />
      {chips.length > 0 || value ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClearAll();
          }}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-t3 transition-colors hover:bg-hover hover:text-foreground"
        >
          Clear
        </button>
      ) : (
        !value && <Kbd className="hidden sm:inline-flex">/</Kbd>
      )}
    </div>
  );
}

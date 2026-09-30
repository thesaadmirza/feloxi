"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/field";

export type FacetOption = {
  value: string;
  label: React.ReactNode;
  title?: string;
  /// null when the count can't be computed for the current filters.
  count: number | null;
  mono?: boolean;
  dot?: string;
};

/// One group of filter checkboxes with counts. The top `limit` options show
/// by default; a selected option always stays visible.
export function FacetGroup({
  title,
  options,
  isSelected,
  onToggle,
  limit = 6,
  empty = "Nothing in this window",
}: {
  title: string;
  options: FacetOption[];
  isSelected: (value: string) => boolean;
  onToggle: (value: string) => void;
  limit?: number;
  empty?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded
    ? options
    : [...options.slice(0, limit), ...options.slice(limit).filter((o) => isSelected(o.value))];

  return (
    <fieldset className="min-w-0">
      <legend className="label mb-1.5">{title}</legend>
      {options.length === 0 ? (
        <p className="py-1 text-xs text-t4">{empty}</p>
      ) : (
        <ul
          className={cn(
            "-mx-1.5 flex flex-col",
            expanded && options.length > 12 && "max-h-80 overflow-y-auto",
          )}
        >
          {visible.map((o) => (
            <li key={o.value}>
              <label
                className="flex h-[30px] cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-[13px] transition-colors hover:bg-hover"
                title={o.title}
              >
                <Checkbox checked={isSelected(o.value)} onChange={() => onToggle(o.value)} />
                {o.dot && (
                  <span
                    className="size-[7px] shrink-0 rounded-full"
                    style={{ background: o.dot }}
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    o.mono ? "font-mono text-[12px] text-t2" : "text-foreground",
                  )}
                >
                  {o.label}
                </span>
                {o.count != null && (
                  <span className="shrink-0 text-[11.5px] tabular-nums text-t3">
                    {o.count.toLocaleString()}
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
      {options.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-t3 transition-colors hover:text-foreground"
        >
          {expanded ? "Show fewer" : `Show all ${options.length}`}
        </button>
      )}
    </fieldset>
  );
}

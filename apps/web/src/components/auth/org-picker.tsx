"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrgSummary } from "@/types/api";

function initials(text: string) {
  const parts = text.split(/[\s._@-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : text.slice(0, 2)).toUpperCase();
}

/// Selectable rows for choosing which organization to sign in to. `busy`
/// disables every row; the one that was picked shows a spinner.
export function OrgPicker({
  orgs,
  onPick,
  busy = false,
}: {
  orgs: OrgSummary[];
  onPick: (slug: string) => void;
  busy?: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <ul className="flex flex-col gap-2" aria-label="Organizations">
      {orgs.map((org) => {
        const pending = busy && picked === org.slug;
        return (
          <li key={org.slug}>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPicked(org.slug);
                onPick(org.slug);
              }}
              className={cn(
                "group flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-hover disabled:cursor-not-allowed",
                busy && !pending && "opacity-50",
              )}
            >
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line-strong bg-raised font-mono text-[10.5px] font-semibold text-t2"
                aria-hidden
              >
                {initials(org.slug)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13.5px] font-[550] text-foreground">
                  {org.name}
                </span>
                <span className="truncate font-mono text-[11.5px] text-t3">{org.slug}</span>
              </span>
              {pending ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-t3" aria-label="Signing in" />
              ) : (
                <ChevronRight
                  className="size-4 shrink-0 text-t4 transition-colors group-hover:text-t2"
                  aria-hidden
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

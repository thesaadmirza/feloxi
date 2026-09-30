"use client";

import { Ban, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/// Floating bar for acting on selected rows. Sits above the content, clear
/// of the sidebar on desktop.
export function BulkBar({
  count,
  summary,
  canRetry,
  canRevoke,
  progress,
  onRetry,
  onRevoke,
  onClear,
}: {
  count: number;
  summary: string;
  canRetry: boolean;
  canRevoke: boolean;
  progress: string | null;
  onRetry: () => void;
  onRevoke: () => void;
  onClear: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center px-4 lg:pl-[236px]">
      <div
        role="region"
        aria-label="Selected tasks"
        className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-xl border border-line-strong bg-raised py-2 pr-2 pl-4 shadow-float"
      >
        <span className="text-[13px] font-semibold whitespace-nowrap tabular-nums">
          {count} selected
        </span>
        <span className="hidden text-[13px] whitespace-nowrap text-t3 sm:inline">· {summary}</span>
        {progress ? (
          <span className="ml-2 flex items-center gap-2 pr-2 text-[13px] whitespace-nowrap text-t2">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {progress}
          </span>
        ) : (
          <>
            {canRetry && (
              <Button variant="primary" size="sm" onClick={onRetry} className="ml-2">
                <RotateCw />
                Retry {count}
              </Button>
            )}
            {canRevoke && (
              <Button size="sm" onClick={onRevoke}>
                <Ban />
                Revoke
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

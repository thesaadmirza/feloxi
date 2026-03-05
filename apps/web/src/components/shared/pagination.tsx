"use client";

import { useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type PaginationProps = {
  total?: number;
  limit: number;
  hasMore: boolean;
  currentCount: number;
  page: number;
  className?: string;
  onNext: () => void;
  onPrev: () => void;
};

export function Pagination({
  total,
  limit,
  hasMore,
  currentCount,
  page,
  className,
  onNext,
  onPrev,
}: PaginationProps) {
  const canPrev = page > 1;
  const canNext = hasMore;

  const startItem = (page - 1) * limit + 1;
  const endItem = (page - 1) * limit + currentCount;
  const totalPages = total != null ? Math.ceil(total / limit) : undefined;

  const handlePrev = useCallback(() => {
    if (canPrev) onPrev();
  }, [canPrev, onPrev]);

  const handleNext = useCallback(() => {
    if (canNext) onNext();
  }, [canNext, onNext]);

  if (currentCount === 0 && !canPrev) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-between px-4 py-3 border-t border-border text-sm text-muted-foreground",
        className
      )}
    >
      <span>
        {total != null
          ? `Showing ${startItem}–${endItem} of ${total}`
          : `Showing ${currentCount} result${currentCount !== 1 ? "s" : ""}`}
      </span>

      <div className="flex items-center gap-2">
        {totalPages != null && (
          <span className="text-xs">
            Page {page} of {totalPages}
          </span>
        )}

        <button
          onClick={handlePrev}
          disabled={!canPrev}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary text-sm text-foreground hover:bg-secondary/80 transition disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronLeft className="h-4 w-4" />
          Prev
        </button>
        <button
          onClick={handleNext}
          disabled={!canNext}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary text-sm text-foreground hover:bg-secondary/80 transition disabled:opacity-40 disabled:pointer-events-none"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

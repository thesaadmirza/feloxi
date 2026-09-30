"use client";

import { useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
        "flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-t3",
        className,
      )}
    >
      <span className="tabular-nums">
        {total != null
          ? `${startItem.toLocaleString()}–${endItem.toLocaleString()} of ${total.toLocaleString()}`
          : `${currentCount} result${currentCount !== 1 ? "s" : ""}`}
      </span>

      <div className="flex items-center gap-2">
        {totalPages != null && (
          <span className="tabular-nums">
            Page {page} of {totalPages}
          </span>
        )}
        <Button size="icon-sm" onClick={handlePrev} disabled={!canPrev} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <Button size="icon-sm" onClick={handleNext} disabled={!canNext} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

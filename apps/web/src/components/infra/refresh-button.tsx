"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/// Icon button that refetches on click and spins until the refetch settles.
/// Background polling doesn't spin it, so it only moves when you asked.
export function RefreshButton({
  onRefresh,
  label = "Refresh",
}: {
  onRefresh: () => unknown;
  label?: string;
}) {
  const [spinning, setSpinning] = useState(false);

  function refresh() {
    setSpinning(true);
    Promise.resolve(onRefresh()).finally(() => setSpinning(false));
  }

  return (
    <Button size="icon" onClick={refresh} aria-label={label} title={label}>
      <RefreshCw className={cn(spinning && "animate-spin")} aria-hidden />
    </Button>
  );
}

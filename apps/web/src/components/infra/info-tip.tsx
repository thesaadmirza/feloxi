"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";

/// A small (i) button that explains a section on hover or keyboard focus.
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={120}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="size-5 rounded text-t3"
          >
            <Info aria-hidden />
          </Button>
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="z-50 max-w-[320px] rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-xs leading-relaxed text-t2 shadow-float"
          >
            {children}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

"use client";

import * as RadixSwitch from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: RadixSwitch.SwitchProps) {
  return (
    <RadixSwitch.Root
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-raised transition-colors",
        "data-[state=checked]:border-amber data-[state=checked]:bg-amber disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-t3 transition-transform data-[state=checked]:translate-x-[17px] data-[state=checked]:bg-amber-ink" />
    </RadixSwitch.Root>
  );
}

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/// Number input with its unit ("days", "seconds") inside the control.
/// Clicking the unit focuses the input.
export const UnitInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { unit: string; wrapperClassName?: string }
>(function UnitInput({ unit, className, wrapperClassName, type = "number", ...props }, ref) {
  return (
    <label
      className={cn(
        "flex h-9 cursor-text items-center rounded-lg border border-line-strong bg-card transition-colors hover:border-t4",
        "focus-within:border-amber focus-within:ring-2 focus-within:ring-ring/30 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
        wrapperClassName,
      )}
    >
      <input
        ref={ref}
        type={type}
        className={cn(
          "h-full w-full min-w-0 bg-transparent pl-3 text-right text-[13px] text-foreground tabular-nums outline-none placeholder:text-t4",
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          className,
        )}
        {...props}
      />
      <span className="shrink-0 pr-3 pl-1.5 text-[13px] text-t3 select-none">{unit}</span>
    </label>
  );
});

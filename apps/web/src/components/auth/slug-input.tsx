import { forwardRef } from "react";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const PREFIX = "feloxi/";

/// Organization slug with a fixed "feloxi/" prefix drawn inside the field.
/// Both are mono, so the padding is measured in `ch` and the typed slug
/// continues straight on from the prefix.
export const SlugInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function SlugInput({ className, style, ...props }, ref) {
    return (
      <div className="relative">
        <span
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-[13px] text-t3 select-none"
          aria-hidden
        >
          {PREFIX}
        </span>
        <Input
          ref={ref}
          className={cn("h-10 font-mono", className)}
          style={{ paddingLeft: `calc(0.75rem + ${PREFIX.length}ch)`, ...style }}
          {...props}
        />
      </div>
    );
  },
);

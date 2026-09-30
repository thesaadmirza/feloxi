import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const CONTROL =
  "w-full rounded-lg border border-line-strong bg-card px-3 text-[13px] text-foreground placeholder:text-t4 transition-colors hover:border-t4 focus:border-amber focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-fail";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL, "h-9", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select ref={ref} className={cn(CONTROL, "h-9 cursor-pointer pr-8", className)} {...props} />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(CONTROL, "min-h-20 py-2 leading-relaxed", className)}
      {...props}
    />
  );
});

/// Label, control and a hint or error underneath.
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[12.5px] font-[550] text-t2">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-fail">{error}</p>
      ) : hint ? (
        <p className="text-xs text-t3">{hint}</p>
      ) : null}
    </div>
  );
}

export const Checkbox = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(function Checkbox({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn("size-3.5 shrink-0 cursor-pointer accent-amber", className)}
      {...props}
    />
  );
});

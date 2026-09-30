import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-[550]",
    "transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "border-amber bg-amber font-semibold text-amber-ink hover:border-amber-hi hover:bg-amber-hi",
        secondary: "border-line-strong bg-card text-foreground hover:bg-raised",
        ghost: "border-transparent bg-transparent text-t2 hover:bg-hover hover:text-foreground",
        danger: "border-line-strong bg-card text-fail hover:bg-fail-wash",
        "danger-solid": "border-fail bg-fail text-fail-ink hover:opacity-90",
      },
      size: {
        sm: "h-7 px-2.5 text-[12.5px] [&_svg]:size-3.5",
        md: "h-8 px-3 text-[13px] [&_svg]:size-3.5",
        lg: "h-10 px-4 text-sm [&_svg]:size-4",
        icon: "size-8 p-0 [&_svg]:size-4",
        "icon-sm": "size-7 p-0 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /// Render the child element (a Link, an <a>) with button styles.
    asChild?: boolean;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});

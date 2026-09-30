import { cn } from "@/lib/utils";

type Align = { align?: "left" | "right" | "center" };

/// Data table in the house style: mono uppercase headers, hairline rows,
/// numbers right-aligned. Wrap in `overflow-x-auto` when it can get wide.
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full text-[13px]", className)} {...props} />;
}

export function THead({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <thead>
      <tr className={cn("border-b border-border", className)}>{children}</tr>
    </thead>
  );
}

export function Th({
  className,
  align = "left",
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & Align) {
  return (
    <th
      className={cn(
        "label px-3 py-2.5 font-medium whitespace-nowrap first:pl-4 last:pr-4",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function Tr({
  className,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        "border-b border-line-soft last:border-b-0",
        interactive && "cursor-pointer transition-colors hover:bg-hover",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  align = "left",
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & Align) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 first:pl-4 last:pr-4",
        align === "right" ? "text-right tabular-nums" : align === "center" ? "text-center" : "",
        className,
      )}
      {...props}
    />
  );
}

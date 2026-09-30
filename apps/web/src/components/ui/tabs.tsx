"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/// Underline tabs. Each item is a button or, with `href`, a link.
export function Tabs({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex gap-6 overflow-x-auto border-b border-border", className)}
    >
      {children}
    </div>
  );
}

type TabProps = {
  active: boolean;
  children: React.ReactNode;
  count?: React.ReactNode;
  icon?: React.ReactNode;
  href?: string;
  onClick?: () => void;
};

export function Tab({ active, children, count, icon, href, onClick }: TabProps) {
  const cls = cn(
    "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-px pb-2.5 text-[13.5px] font-[550] whitespace-nowrap transition-colors [&_svg]:size-3.5",
    active ? "border-foreground text-foreground" : "border-transparent text-t3 hover:text-t2",
  );
  const inner = (
    <>
      {icon}
      {children}
      {count != null && (
        <span className="text-[11.5px] font-medium tabular-nums text-t3">{count}</span>
      )}
    </>
  );
  if (href) {
    return (
      <Link href={href} role="tab" aria-selected={active} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

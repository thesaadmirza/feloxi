import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Panel({
  className,
  children,
  as: Tag = "section",
  ...props
}: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" }) {
  return (
    <Tag className={cn("rounded-xl border border-border bg-card", className)} {...props}>
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5 px-4 pt-3.5 pb-2.5", className)}>
      <h2 className="shrink-0 text-[13.5px] font-semibold tracking-[-0.005em] text-foreground">
        {title}
      </h2>
      {subtitle && <span className="truncate text-xs text-t3">{subtitle}</span>}
      {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs text-t3 transition-colors hover:text-foreground"
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

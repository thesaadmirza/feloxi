"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { useShellStore } from "@/stores/shell-store";
import { cn } from "@/lib/utils";

export type Crumb = { label: React.ReactNode; href?: string };

/// The bar at the top of every page: title (or breadcrumbs), a short meta
/// line, and the page's own controls. On phones the controls drop to a
/// second row so nothing is squeezed.
export function PageHeader({
  title,
  meta,
  crumbs,
  actions,
  className,
}: {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  className?: string;
}) {
  const setNavOpen = useShellStore((s) => s.setNavOpen);

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background/90 px-4 py-2.5 backdrop-blur-md sm:px-7",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setNavOpen(true)}
        className="-ml-1 flex size-9 items-center justify-center rounded-lg text-t2 transition-colors hover:bg-hover hover:text-foreground lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>

      {crumbs && crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={i} className="flex min-w-0 items-center gap-2">
                {i > 0 && (
                  <span className="text-t4" aria-hidden>
                    /
                  </span>
                )}
                {last || !c.href ? (
                  <span
                    className={cn("truncate", last ? "font-semibold text-foreground" : "text-t3")}
                    aria-current={last ? "page" : undefined}
                  >
                    {c.label}
                  </span>
                ) : (
                  <Link
                    href={c.href}
                    className="shrink-0 text-t3 transition-colors hover:text-foreground"
                  >
                    {c.label}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>
      ) : (
        <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          {title}
        </h1>
      )}

      {meta && <span className="hidden min-w-0 truncate text-xs text-t3 md:inline">{meta}</span>}

      {actions && (
        <div className="order-last flex w-full items-center gap-2 overflow-x-auto sm:order-none sm:ml-auto sm:w-auto sm:overflow-visible">
          {actions}
        </div>
      )}
    </header>
  );
}

export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[1480px] flex-1 flex-col gap-5 px-4 py-6 sm:px-7",
        className,
      )}
    >
      {children}
    </div>
  );
}

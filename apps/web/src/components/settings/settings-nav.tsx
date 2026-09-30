"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useCurrentUser } from "@/hooks/use-current-user";
import { userHasPermission } from "@/lib/auth";
import { cn } from "@/lib/utils";

export type SettingsSection = {
  label: string;
  href: string;
  /// The permission the section's API checks (crates/api/src/routes). The
  /// "admin" role passes every check, as on the backend.
  requires: string;
};

export const SETTINGS_GROUPS: { label: string; items: SettingsSection[] }[] = [
  {
    label: "Organization",
    items: [
      { label: "General", href: "/settings", requires: "settings_read" },
      { label: "Members", href: "/settings/team", requires: "team_manage" },
      { label: "API keys", href: "/settings/api-keys", requires: "api_keys_manage" },
    ],
  },
  {
    label: "Data",
    items: [{ label: "Retention", href: "/settings/retention", requires: "settings_read" }],
  },
  {
    label: "Notifications",
    items: [
      { label: "Email & webhooks", href: "/settings/notifications", requires: "settings_read" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/settings") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function settingsSectionFor(pathname: string): SettingsSection | undefined {
  return SETTINGS_GROUPS.flatMap((g) => g.items).find((s) => isActive(pathname, s.href));
}

const ITEM =
  "flex h-8 shrink-0 items-center rounded-lg px-2.5 text-[13px] whitespace-nowrap transition-colors";

/// Grouped sub-nav on large screens; a single scrollable row of the same
/// links above the content on smaller ones.
export function SettingsNav({ pathname }: { pathname: string }) {
  const user = useCurrentUser();
  const rowRef = useRef<HTMLDivElement>(null);

  const groups = SETTINGS_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((item) => userHasPermission(user, item.requires)),
  })).filter((g) => g.items.length > 0);

  // Keep the current section visible in the phone-width scroller.
  useEffect(() => {
    const row = rowRef.current;
    const active = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !active) return;
    const hidden =
      active.offsetLeft < row.scrollLeft ||
      active.offsetLeft + active.offsetWidth > row.scrollLeft + row.clientWidth;
    if (hidden) row.scrollLeft = Math.max(0, active.offsetLeft - 16);
  }, [pathname, user]);

  const link = (item: SettingsSection) => {
    const active = isActive(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          ITEM,
          active
            ? "bg-raised font-[550] text-foreground"
            : "text-t2 hover:bg-hover hover:text-foreground",
        )}
      >
        {item.label}
      </Link>
    );
  };

  return (
    <nav aria-label="Settings" className="min-w-0 lg:sticky lg:top-20 lg:self-start">
      <div
        ref={rowRef}
        className="relative -mx-4 flex min-h-8 gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-7 sm:px-7 lg:hidden [&::-webkit-scrollbar]:hidden"
      >
        {groups.flatMap((g) => g.items).map(link)}
      </div>
      <div className="hidden flex-col gap-px lg:flex">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-px">
            <div className="label px-2.5 pt-3.5 pb-1.5">{g.label}</div>
            {g.items.map(link)}
          </div>
        ))}
      </div>
    </nav>
  );
}

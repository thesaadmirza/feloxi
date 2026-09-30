"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { MENU_CONTENT, MENU_ITEM } from "@/components/ui/menu";
import { useTheme } from "next-themes";
import {
  Bell,
  Cable,
  CalendarClock,
  Check,
  ChevronsUpDown,
  Ellipsis,
  LayoutDashboard,
  Layers,
  ListChecks,
  LogOut,
  Moon,
  Search,
  Server,
  Settings,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { FeloxiLogo } from "@/components/icons/feloxi-logo";
import { Kbd } from "@/components/ui/kbd";
import { $api, fetchClient, unwrap } from "@/lib/api";
import { saveUser, userHasPermission } from "@/lib/auth";
import { cn, formatNumber } from "@/lib/utils";
import { useShellStore } from "@/stores/shell-store";
import type { OrgSummary, UserInfo } from "@/types/api";

type Counter = "backlog" | "workers" | "firing";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /// Permission the viewer must hold for this item to render. The "admin"
  /// role bypasses the check (matches the backend).
  requires?: string;
  counter?: Counter;
};

type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { label: "Overview", href: "/", icon: LayoutDashboard, requires: "metrics_read" },
      { label: "Tasks", href: "/tasks", icon: ListChecks, requires: "tasks_read" },
      {
        label: "Queues",
        href: "/queues",
        icon: Layers,
        requires: "metrics_read",
        counter: "backlog",
      },
      {
        label: "Workers",
        href: "/workers",
        icon: Server,
        requires: "workers_read",
        counter: "workers",
      },
      { label: "Beat", href: "/beat", icon: CalendarClock, requires: "beat_read" },
    ],
  },
  {
    label: "Respond",
    items: [
      { label: "Alerts", href: "/alerts", icon: Bell, requires: "alerts_read", counter: "firing" },
    ],
  },
  {
    label: "Setup",
    items: [
      { label: "Brokers", href: "/brokers", icon: Cable, requires: "brokers_manage" },
      { label: "Settings", href: "/settings", icon: Settings, requires: "settings_read" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/// Live counts for the nav, shared (by query key) with the pages that show
/// the same data, so the sidebar adds no duplicate requests there.
function useNavCounts(user: UserInfo) {
  const canTasks = userHasPermission(user, "tasks_read");
  const canAlerts = userHasPermission(user, "alerts_read");
  const live = $api.useQuery(
    "get",
    "/api/v1/dashboard/live",
    {},
    { refetchInterval: 15_000, enabled: canTasks },
  );
  const alerts = $api.useQuery(
    "get",
    "/api/v1/alerts/history",
    { params: { query: { limit: 50 } } },
    { refetchInterval: 30_000, enabled: canAlerts },
  );
  const health = $api.useQuery("get", "/api/v1/system/health", {}, { refetchInterval: 60_000 });

  const firing = (alerts.data?.data ?? []).filter((r) => !r.resolved_at).length;
  return {
    backlog: live.data?.queue_depth_total,
    workers: live.data?.online_workers_total,
    firing: canAlerts ? firing : 0,
    health: health.data,
  };
}

function NavLink({
  item,
  pathname,
  counts,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  counts: ReturnType<typeof useNavCounts>;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  let tail: React.ReactNode = null;
  if (item.counter === "firing" && counts.firing > 0) {
    tail = (
      <span className="ml-auto flex items-center gap-1.5 text-[11.5px] font-semibold tabular-nums text-fail">
        <span className="size-[7px] rounded-full bg-fail" aria-hidden />
        {counts.firing} firing
      </span>
    );
  } else if (item.counter === "backlog" && counts.backlog != null && counts.backlog > 0) {
    tail = (
      <span className="ml-auto text-[11.5px] tabular-nums text-t3">
        {formatNumber(counts.backlog)}
      </span>
    );
  } else if (item.counter === "workers" && counts.workers != null) {
    tail = (
      <span className="ml-auto text-[11.5px] tabular-nums text-t3" title="Online workers">
        {counts.workers}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors",
        active
          ? "bg-raised font-[560] text-foreground"
          : "text-t2 hover:bg-hover hover:text-foreground",
      )}
    >
      <Icon
        className={cn("size-4 shrink-0", active ? "text-mark" : "text-t3")}
        strokeWidth={1.7}
        aria-hidden
      />
      <span className="truncate">{item.label}</span>
      {tail}
    </Link>
  );
}

function initials(text: string) {
  const parts = text.split(/[\s._@-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : text.slice(0, 2)).toUpperCase();
}

function OrgSwitcher({ user }: { user: UserInfo }) {
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [switching, setSwitching] = useState(false);

  const load = (open: boolean) => {
    if (open && !orgs) {
      unwrap(fetchClient.GET("/api/v1/auth/orgs"))
        .then(setOrgs)
        .catch(() => setOrgs([]));
    }
  };

  const switchTo = async (slug: string) => {
    if (slug === user.tenant_slug || switching) return;
    setSwitching(true);
    try {
      const result = await unwrap(
        fetchClient.POST("/api/v1/auth/switch-org", { body: { tenant_slug: slug } }),
      );
      saveUser(result.user);
      window.location.href = "/";
    } catch {
      setSwitching(false);
    }
  };

  return (
    <Dropdown.Root onOpenChange={load}>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-raised"
          aria-label={`Organization: ${user.tenant_slug}. Switch organization`}
        >
          <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md border border-line-strong bg-raised font-mono text-[10px] font-semibold text-t2">
            {initials(user.tenant_slug)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] leading-tight font-semibold text-foreground">
              {user.tenant_slug}
            </span>
            <span className="font-mono text-[10.5px] leading-tight text-t3">organization</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-t3" aria-hidden />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="start" sideOffset={6} className={MENU_CONTENT}>
          <Dropdown.Label className="label px-2.5 pt-2 pb-1.5">Organizations</Dropdown.Label>
          {!orgs ? (
            <div className="px-2.5 py-2 text-xs text-t3">Loading…</div>
          ) : orgs.length === 0 ? (
            <div className="px-2.5 py-2 text-xs text-t3">No other organizations</div>
          ) : (
            orgs.map((org) => {
              const current = org.slug === user.tenant_slug;
              return (
                <Dropdown.Item
                  key={org.slug}
                  disabled={switching}
                  onSelect={() => switchTo(org.slug)}
                  className={MENU_ITEM}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{org.name}</span>
                    <span className="truncate font-mono text-[10.5px] text-t3">{org.slug}</span>
                  </span>
                  {current && <Check className="!text-mark" aria-label="Current organization" />}
                </Dropdown.Item>
              );
            })
          )}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

function SystemStatus({ health }: { health: ReturnType<typeof useNavCounts>["health"] }) {
  const down = health?.components.filter((c) => c.status !== "up").length ?? 0;
  const status = health?.status;
  const tone = !health
    ? "bg-t4"
    : status === "healthy"
      ? "bg-ok"
      : status === "degraded"
        ? "bg-warn"
        : "bg-fail";
  const text = !health
    ? "Checking systems…"
    : status === "healthy"
      ? "All systems normal"
      : status === "degraded"
        ? `Degraded · ${down} down`
        : "Systems unhealthy";
  return (
    <Link
      href="/system"
      className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs text-t2 transition-colors hover:bg-hover hover:text-foreground"
    >
      <span className={cn("size-[7px] shrink-0 rounded-full", tone)} aria-hidden />
      <span className="truncate">{text}</span>
    </Link>
  );
}

function UserMenu({ user, onLogout }: { user: UserInfo; onLogout: () => void }) {
  const { resolvedTheme, setTheme } = useTheme();
  const name = user.display_name ?? user.email;
  return (
    <div className="flex items-center gap-2.5 px-1.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line-strong bg-raised text-[11px] font-semibold text-t2">
        {initials(name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12.5px] font-semibold text-foreground">{name}</span>
        {user.display_name && <span className="truncate text-[11.5px] text-t3">{user.email}</span>}
      </span>
      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-t3 transition-colors hover:bg-hover hover:text-foreground"
            aria-label="Account menu"
          >
            <Ellipsis className="size-4" />
          </button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content side="top" align="end" sideOffset={8} className={MENU_CONTENT}>
            <Dropdown.Label className="label px-2.5 pt-2 pb-1.5">Theme</Dropdown.Label>
            <Dropdown.RadioGroup value={resolvedTheme ?? "dark"} onValueChange={setTheme}>
              <Dropdown.RadioItem value="dark" className={MENU_ITEM}>
                <Moon aria-hidden />
                <span className="flex-1">Night</span>
                <Dropdown.ItemIndicator>
                  <Check className="!text-mark" />
                </Dropdown.ItemIndicator>
              </Dropdown.RadioItem>
              <Dropdown.RadioItem value="light" className={MENU_ITEM}>
                <Sun aria-hidden />
                <span className="flex-1">Day</span>
                <Dropdown.ItemIndicator>
                  <Check className="!text-mark" />
                </Dropdown.ItemIndicator>
              </Dropdown.RadioItem>
            </Dropdown.RadioGroup>
            <Dropdown.Separator className="my-1 h-px bg-border" />
            <Dropdown.Item onSelect={onLogout} className={MENU_ITEM}>
              <LogOut aria-hidden />
              Sign out
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  );
}

function SidebarContent({
  user,
  onLogout,
  onNavigate,
}: {
  user: UserInfo;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const counts = useNavCounts(user);
  const setPaletteOpen = useShellStore((s) => s.setPaletteOpen);

  return (
    <div className="flex h-full flex-col px-3 pt-3.5 pb-3">
      <div className="flex items-center gap-2.5 px-1.5 pb-3.5">
        <FeloxiLogo size={20} />
        <span className="text-[15px] font-[650] tracking-[-0.01em] text-foreground">Feloxi</span>
        {onNavigate && (
          <Dialog.Close
            className="ml-auto flex size-8 items-center justify-center rounded-lg text-t3 transition-colors hover:bg-hover hover:text-foreground"
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </Dialog.Close>
        )}
      </div>

      <OrgSwitcher user={user} />

      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          setPaletteOpen(true);
        }}
        className="mt-2 flex h-8 w-full items-center gap-2 rounded-lg border border-border px-2.5 text-left text-[13px] text-t3 transition-colors hover:border-line-strong hover:text-t2"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1 truncate">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <nav aria-label="Main" className="mt-1 flex-1 overflow-y-auto">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter(
            (item) => !item.requires || userHasPermission(user, item.requires),
          );
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="flex flex-col gap-px">
              <div className="label px-2.5 pt-4 pb-1.5">{group.label}</div>
              {items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  counts={counts}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          );
        })}
      </nav>

      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
        <SystemStatus health={counts.health} />
        <UserMenu user={user} onLogout={onLogout} />
      </div>
    </div>
  );
}

export function Sidebar({ user, onLogout }: { user: UserInfo; onLogout: () => void }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 border-r border-border bg-background lg:block">
      <SidebarContent user={user} onLogout={onLogout} />
    </aside>
  );
}

export function MobileSidebar({ user, onLogout }: { user: UserInfo; onLogout: () => void }) {
  const open = useShellStore((s) => s.navOpen);
  const setOpen = useShellStore((s) => s.setNavOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--scrim)] lg:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[272px] max-w-[85vw] border-r border-border bg-background outline-none lg:hidden">
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Description className="sr-only">
            Main navigation and account menu
          </Dialog.Description>
          <SidebarContent user={user} onLogout={onLogout} onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

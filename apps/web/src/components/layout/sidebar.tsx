"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, LayoutDashboard, ListChecks, Server, Cable, Bell, Settings, Layers, Activity } from "lucide-react";
import { FeloxiLogo } from "@/components/icons/feloxi-logo";
import { useCurrentUser } from "@/hooks/use-current-user";
import { userHasPermission } from "@/lib/auth";

type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  /// Permission the viewer must hold for this item to render. `undefined`
  /// means the item is shown to everyone. The "admin" role bypasses the
  /// check (matches the backend).
  requires?: string;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: <LayoutDashboard className="w-4 h-4" />, requires: "metrics_read" },
  { label: "Tasks", href: "/tasks", icon: <ListChecks className="w-4 h-4" />, requires: "tasks_read" },
  { label: "Queues", href: "/queues", icon: <Layers className="w-4 h-4" />, requires: "metrics_read" },
  { label: "Workers", href: "/workers", icon: <Server className="w-4 h-4" />, requires: "workers_read" },
  { label: "Brokers", href: "/brokers", icon: <Cable className="w-4 h-4" />, requires: "brokers_manage" },
  { label: "Alerts", href: "/alerts", icon: <Bell className="w-4 h-4" />, requires: "alerts_read" },
  { label: "System", href: "/system", icon: <Activity className="w-4 h-4" />, requires: "metrics_read" },
  { label: "Settings", href: "/settings", icon: <Settings className="w-4 h-4" />, requires: "settings_read" },
];

function NavLink({ item, pathname, onClick }: { item: NavItem; pathname: string; onClick?: () => void }) {
  const isActive =
    item.href === "/"
      ? pathname === "/"
      : pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={[
        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
        isActive
          ? "bg-white/[0.07] text-white"
          : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]",
      ].join(" ")}
      aria-current={isActive ? "page" : undefined}
    >
      <span className={isActive ? "text-zinc-200" : "text-zinc-600"}>{item.icon}</span>
      {item.label}
    </Link>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useCurrentUser();
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.requires || userHasPermission(user, item.requires)
  );

  return (
    <>
      <div className="flex items-center justify-between px-4 py-5 border-b border-zinc-800/60">
        <div className="flex items-center gap-2.5">
          <FeloxiLogo size={22} className="text-zinc-300 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-200 leading-none tracking-tight">Feloxi</p>
            <p className="text-[11px] text-zinc-600 mt-0.5 truncate">Task monitoring</p>
          </div>
        </div>
        {onNavigate && (
          <button
            onClick={onNavigate}
            className="lg:hidden flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onClick={onNavigate} />
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-zinc-800/60">
        <p className="text-[11px] text-zinc-700 text-center tracking-wide">Feloxi</p>
      </div>
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden lg:flex flex-col w-56 shrink-0 bg-zinc-900 border-r border-zinc-800/60 h-screen sticky top-0">
      <SidebarContent />
    </aside>
  );
}

export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 z-40 lg:hidden"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 left-0 z-50 w-56 bg-zinc-900 border-r border-zinc-800/60 flex flex-col lg:hidden animate-in slide-in-from-left duration-200">
        <SidebarContent onNavigate={onClose} />
      </aside>
    </>
  );
}

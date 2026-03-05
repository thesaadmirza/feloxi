"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut, Building2, ChevronDown, Check, Sun, Moon, Menu } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/hooks/use-auth";
import { fetchClient, unwrap } from "@/lib/api";
import { saveUser } from "@/lib/auth";
import type { UserInfo, OrgSummary } from "@/types/api";

const PATH_LABELS: Record<string, string> = {
  "": "Dashboard",
  dashboard: "Dashboard",
  tasks: "Tasks",
  workers: "Workers",
  workflows: "Workflows",
  beat: "Beat",
  alerts: "Alerts",
  metrics: "Metrics",
  settings: "Settings",
};

function Breadcrumbs({ pathname }: { pathname: string }) {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return <span className="text-sm font-semibold text-white">Dashboard</span>;
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0">
      {segments.map((seg, i) => {
        const decoded = decodeURIComponent(seg);
        const isKnown = seg in PATH_LABELS;
        const label = isKnown ? PATH_LABELS[seg] : decoded.charAt(0).toUpperCase() + decoded.slice(1);
        const isLast = i === segments.length - 1;
        const isDynamic = !isKnown;
        return (
          <span key={i} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <span className="text-zinc-600 text-xs shrink-0">/</span>}
            <span
              className={[
                isLast
                  ? "text-sm font-semibold text-white"
                  : "text-sm text-zinc-500",
                isDynamic ? "truncate max-w-[120px]" : "shrink-0",
              ].join(" ")}
              title={isDynamic ? decoded : undefined}
            >
              {label}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

function UserAvatar({ user }: { user: UserInfo }) {
  const initials = user.display_name
    ? user.display_name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : user.email.slice(0, 2).toUpperCase();

  return (
    <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center shrink-0">
      <span className="text-xs font-semibold text-zinc-200 leading-none">{initials}</span>
    </div>
  );
}

function OrgSwitcher({ user }: { user: UserInfo }) {
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { refreshUser } = useAuth();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleOpen = () => {
    setOpen((v) => !v);
    if (!orgs) {
      unwrap(fetchClient.GET("/api/v1/auth/orgs"))
        .then(setOrgs)
        .catch(() => setOrgs([]));
    }
  };

  const handleSwitch = async (slug: string) => {
    if (slug === user.tenant_slug || switching) return;
    setSwitching(true);
    try {
      const result = await unwrap(fetchClient.POST("/api/v1/auth/switch-org", {
        body: { tenant_slug: slug },
      }));
      saveUser(result.user);
      await refreshUser();
      setOpen(false);
      window.location.href = "/";
    } catch {
      setSwitching(false);
    }
  };

  const hasMultipleOrgs = orgs && orgs.length > 1;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors
          px-2 py-1.5 rounded-md hover:bg-zinc-800"
      >
        <Building2 className="w-3.5 h-3.5 text-zinc-500" />
        <span className="font-medium">{user.tenant_slug}</span>
        <ChevronDown className="w-3 h-3 text-zinc-500" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 py-1">
          {!orgs ? (
            <div className="px-3 py-2 text-xs text-zinc-500">Loading...</div>
          ) : orgs.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-500">No organizations</div>
          ) : (
            <>
              {hasMultipleOrgs && (
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                  Switch organization
                </div>
              )}
              {orgs.map((org) => {
                const isCurrent = org.slug === user.tenant_slug;
                return (
                  <button
                    key={org.slug}
                    onClick={() => handleSwitch(org.slug)}
                    disabled={isCurrent || switching}
                    className={[
                      "w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                      isCurrent
                        ? "text-white bg-zinc-800/50"
                        : "text-zinc-300 hover:bg-zinc-800 hover:text-white",
                      switching ? "opacity-50 cursor-not-allowed" : "",
                    ].join(" ")}
                  >
                    <Building2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{org.name}</p>
                      <p className="truncate text-[10px] text-zinc-500">{org.slug}</p>
                    </div>
                    {isCurrent && <Check className="w-3.5 h-3.5 text-zinc-300 shrink-0" />}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-7 h-7" />;

  const isDark = theme === "dark";
  const toggleTheme = () => setTheme(isDark ? "light" : "dark");

  return (
    <button
      onClick={toggleTheme}
      className="flex items-center justify-center w-7 h-7 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
    </button>
  );
}

type HeaderProps = {
  user: UserInfo;
  onMenuToggle?: () => void;
};

export function Header({ user, onMenuToggle }: HeaderProps) {
  const pathname = usePathname();
  const { logout } = useAuth();

  return (
    <header className="h-14 flex items-center justify-between px-4 sm:px-6 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm sticky top-0 z-10 shrink-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="lg:hidden flex items-center justify-center w-8 h-8 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors shrink-0"
            aria-label="Toggle menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <Breadcrumbs pathname={pathname} />
      </div>

      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        <ThemeToggle />
        <OrgSwitcher user={user} />
        <div className="hidden sm:block w-px h-5 bg-zinc-700" />
        <div className="flex items-center gap-2">
          <UserAvatar user={user} />
          <div className="hidden md:block min-w-0">
            <p className="text-xs font-medium text-white leading-none truncate max-w-[140px]">
              {user.display_name ?? user.email}
            </p>
            {user.display_name && (
              <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-[140px]">{user.email}</p>
            )}
          </div>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors
            px-2 py-1.5 rounded-md hover:bg-zinc-800"
          aria-label="Sign out"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}

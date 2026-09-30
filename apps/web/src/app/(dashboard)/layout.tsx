"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useWsStore } from "@/stores/ws-store";
import { Sidebar, MobileSidebar } from "@/components/layout/sidebar";
import { CommandPalette } from "@/components/layout/command-palette";
import { PulseGlyph } from "@/components/ui/pulse";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  const wsConnect = useWsStore((s) => s.connect);
  const wsDisconnect = useWsStore((s) => s.disconnect);

  useEffect(() => {
    if (!loading && !user) {
      fetch("/api/v1/setup/status", { credentials: "include" })
        .then((r) => r.json())
        .then((data: { needs_setup: boolean }) => {
          router.replace(data.needs_setup ? "/setup" : "/auth/login");
        })
        .catch(() => router.replace("/auth/login"));
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      wsConnect();
      return () => wsDisconnect();
    }
  }, [user, wsConnect, wsDisconnect]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status">
        <div className="flex flex-col items-center gap-3 text-t3">
          <PulseGlyph live className="h-6 w-11 text-mark" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar user={user} onLogout={logout} />
      <MobileSidebar user={user} onLogout={logout} />
      <CommandPalette user={user} onLogout={logout} />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

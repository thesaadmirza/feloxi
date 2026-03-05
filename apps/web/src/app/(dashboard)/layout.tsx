"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useWsStore } from "@/stores/ws-store";
import { Sidebar, MobileSidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-zinc-400">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex">
      <Sidebar />
      <MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      <div className="flex flex-col flex-1 min-w-0">
        <Header user={user} onMenuToggle={() => setMobileMenuOpen((v) => !v)} />

        <main className="flex-1 overflow-auto p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

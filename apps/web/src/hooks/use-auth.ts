"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { UserInfo } from "@/types/api";
import { fetchClient, unwrap } from "@/lib/api";
import { getUser, saveUser, clearUser } from "@/lib/auth";

export function useAuth() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = getUser();
    if (cached) setUser(cached);

    unwrap(fetchClient.GET("/api/v1/auth/me"))
      .then((u) => {
        saveUser(u);
        setUser(u);
      })
      .catch(() => {
        clearUser();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    try {
      await unwrap(fetchClient.POST("/api/v1/auth/logout"));
    } catch {
      /* ignore — clear local state regardless */
    }
    clearUser();
    setUser(null);
    router.push("/auth/login");
  }, [router]);

  const refreshUser = useCallback(async () => {
    try {
      const u = await unwrap(fetchClient.GET("/api/v1/auth/me"));
      saveUser(u);
      setUser(u);
    } catch {
      /* noop */
    }
  }, []);

  const requireAuth = useCallback(() => {
    if (!user && !loading) {
      router.push("/auth/login");
      return false;
    }
    return true;
  }, [user, loading, router]);

  return { user, loading, logout, refreshUser, requireAuth, isAuthenticated: !!user };
}

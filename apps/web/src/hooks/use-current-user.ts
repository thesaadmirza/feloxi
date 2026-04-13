"use client";

import { useEffect, useState } from "react";
import { getUser, userHasPermission } from "@/lib/auth";
import type { UserInfo } from "@/types/api";

/// Returns the signed-in user from session storage. `null` on the initial
/// render (server + first client paint) to avoid hydration mismatches, then
/// resolves to the real user once the effect runs.
export function useCurrentUser(): UserInfo | null {
  const [user, setUser] = useState<UserInfo | null>(null);
  useEffect(() => {
    setUser(getUser());
  }, []);
  return user;
}

export function useHasPermission(perm: string): boolean {
  const user = useCurrentUser();
  return userHasPermission(user, perm);
}

import type { UserInfo } from "@/types/api";

const USER_KEY = "fp_user";

export function saveUser(user: UserInfo): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser(): UserInfo | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearUser(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(USER_KEY);
}

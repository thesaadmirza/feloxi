import { describe, it, expect, beforeEach } from "vitest";
import { saveUser, getUser, clearUser } from "../auth";
import type { UserInfo } from "@/types/api";

const mockUser: UserInfo = {
  id: "user-123",
  email: "test@example.com",
  display_name: "Test User",
  tenant_id: "tenant-1",
  tenant_slug: "test-org",
  roles: ["admin"],
};

describe("Auth utilities (cookie-based)", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  // ─── saveUser / getUser roundtrip ────────────────────────────
  describe("saveUser()", () => {
    it("stores user info as JSON in sessionStorage", () => {
      saveUser(mockUser);
      const stored = sessionStorage.getItem("fp_user");
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(mockUser);
    });
  });

  describe("getUser()", () => {
    it("returns null when no user stored", () => {
      expect(getUser()).toBeNull();
    });

    it("returns the stored user object", () => {
      saveUser(mockUser);
      expect(getUser()).toEqual(mockUser);
    });

    it("returns null for corrupted JSON in storage", () => {
      sessionStorage.setItem("fp_user", "not-valid-json{{{");
      expect(getUser()).toBeNull();
    });

    it("returns null for empty string in storage", () => {
      sessionStorage.setItem("fp_user", "");
      expect(getUser()).toBeNull();
    });
  });

  // ─── clearUser ───────────────────────────────────────────────
  describe("clearUser()", () => {
    it("removes user from sessionStorage", () => {
      saveUser(mockUser);
      expect(sessionStorage.getItem("fp_user")).not.toBeNull();

      clearUser();
      expect(sessionStorage.getItem("fp_user")).toBeNull();
    });

    it("does not throw when called with no user data", () => {
      expect(() => clearUser()).not.toThrow();
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────
  describe("edge cases", () => {
    it("handles saving user twice (overwrite)", () => {
      saveUser(mockUser);

      const updated: UserInfo = { ...mockUser, email: "new@example.com" };
      saveUser(updated);

      expect(getUser()?.email).toBe("new@example.com");
    });

    it("full roundtrip: save -> verify -> clear -> verify empty", () => {
      saveUser(mockUser);
      expect(getUser()).toEqual(mockUser);

      clearUser();
      expect(getUser()).toBeNull();
    });
  });
});

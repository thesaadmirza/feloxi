import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useNotificationStore } from "../notification-store";
import type { Notification } from "../notification-store";

describe("useNotificationStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotificationStore.setState({ notifications: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Adding notifications
  // ─────────────────────────────────────────────────────────────────────────
  describe("add()", () => {
    it("adds a notification to the store", () => {
      useNotificationStore.getState().add({
        type: "info",
        title: "Test notification",
      });

      const { notifications } = useNotificationStore.getState();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe("Test notification");
      expect(notifications[0].type).toBe("info");
    });

    it("assigns an auto-generated id", () => {
      useNotificationStore.getState().add({
        type: "success",
        title: "Success!",
      });

      const { notifications } = useNotificationStore.getState();
      expect(notifications[0].id).toMatch(/^notif-\d+$/);
    });

    it("assigns a timestamp", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      useNotificationStore.getState().add({
        type: "info",
        title: "Time test",
      });

      expect(useNotificationStore.getState().notifications[0].timestamp).toBe(now);
    });

    it("includes optional message field", () => {
      useNotificationStore.getState().add({
        type: "error",
        title: "Error occurred",
        message: "Something went wrong",
      });

      const { notifications } = useNotificationStore.getState();
      expect(notifications[0].message).toBe("Something went wrong");
    });

    it("prepends new notifications (newest first)", () => {
      useNotificationStore.getState().add({
        type: "info",
        title: "First",
      });
      useNotificationStore.getState().add({
        type: "info",
        title: "Second",
      });

      const { notifications } = useNotificationStore.getState();
      expect(notifications[0].title).toBe("Second");
      expect(notifications[1].title).toBe("First");
    });

    it("caps notifications at 50", () => {
      for (let i = 0; i < 60; i++) {
        useNotificationStore.getState().add({
          type: "info",
          title: `Notification ${i}`,
        });
      }

      expect(useNotificationStore.getState().notifications).toHaveLength(50);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Different notification types
  // ─────────────────────────────────────────────────────────────────────────
  describe("notification types", () => {
    it("adds success notifications", () => {
      useNotificationStore.getState().add({
        type: "success",
        title: "Task completed",
      });

      expect(useNotificationStore.getState().notifications[0].type).toBe("success");
    });

    it("adds error notifications", () => {
      useNotificationStore.getState().add({
        type: "error",
        title: "Task failed",
        message: "Connection timeout",
      });

      const notif = useNotificationStore.getState().notifications[0];
      expect(notif.type).toBe("error");
      expect(notif.message).toBe("Connection timeout");
    });

    it("adds warning notifications", () => {
      useNotificationStore.getState().add({
        type: "warning",
        title: "High memory usage",
      });

      expect(useNotificationStore.getState().notifications[0].type).toBe("warning");
    });

    it("adds info notifications", () => {
      useNotificationStore.getState().add({
        type: "info",
        title: "Worker connected",
      });

      expect(useNotificationStore.getState().notifications[0].type).toBe("info");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-dismiss
  // ─────────────────────────────────────────────────────────────────────────
  describe("auto-dismiss", () => {
    it("removes notification after 5 seconds", () => {
      useNotificationStore.getState().add({
        type: "info",
        title: "Ephemeral",
      });

      expect(useNotificationStore.getState().notifications).toHaveLength(1);

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    it("does not remove notification before 5 seconds", () => {
      useNotificationStore.getState().add({
        type: "info",
        title: "Still here",
      });

      vi.advanceTimersByTime(4999);

      expect(useNotificationStore.getState().notifications).toHaveLength(1);
    });

    it("auto-dismisses each notification independently", () => {
      useNotificationStore.getState().add({
        type: "info",
        title: "First",
      });

      vi.advanceTimersByTime(3000);

      useNotificationStore.getState().add({
        type: "info",
        title: "Second",
      });

      // At 5000ms, first should be auto-dismissed
      vi.advanceTimersByTime(2000);

      const { notifications } = useNotificationStore.getState();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe("Second");

      // At 8000ms, second should be auto-dismissed
      vi.advanceTimersByTime(3000);

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Removing (dismissing) notifications
  // ─────────────────────────────────────────────────────────────────────────
  describe("dismiss()", () => {
    it("removes a notification by id", () => {
      useNotificationStore.getState().add({
        type: "info",
        title: "To dismiss",
      });

      const id = useNotificationStore.getState().notifications[0].id;
      useNotificationStore.getState().dismiss(id);

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    it("only removes the specified notification", () => {
      useNotificationStore.getState().add({
        type: "info",
        title: "Keep",
      });
      useNotificationStore.getState().add({
        type: "error",
        title: "Remove",
      });

      const { notifications } = useNotificationStore.getState();
      const toRemoveId = notifications.find(
        (n) => n.title === "Remove"
      )!.id;

      useNotificationStore.getState().dismiss(toRemoveId);

      const remaining = useNotificationStore.getState().notifications;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].title).toBe("Keep");
    });

    it("does not throw when dismissing non-existent id", () => {
      expect(() =>
        useNotificationStore.getState().dismiss("non-existent")
      ).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Clear all
  // ─────────────────────────────────────────────────────────────────────────
  describe("clear()", () => {
    it("clears all notifications", () => {
      useNotificationStore.getState().add({ type: "info", title: "A" });
      useNotificationStore.getState().add({ type: "error", title: "B" });
      useNotificationStore.getState().add({ type: "warning", title: "C" });

      useNotificationStore.getState().clear();

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    it("allows adding new notifications after clear", () => {
      useNotificationStore.getState().add({ type: "info", title: "Before" });
      useNotificationStore.getState().clear();
      useNotificationStore.getState().add({ type: "info", title: "After" });

      const { notifications } = useNotificationStore.getState();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe("After");
    });
  });
});

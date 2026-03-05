import { create } from "zustand";

export type Notification = {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
  timestamp: number;
};

type NotificationStore = {
  notifications: Notification[];
  add: (notification: Omit<Notification, "id" | "timestamp">) => void;
  dismiss: (id: string) => void;
  clear: () => void;
};

let notifId = 0;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],

  add: (notification) => {
    const id = `notif-${++notifId}`;
    const entry: Notification = {
      ...notification,
      id,
      timestamp: Date.now(),
    };

    set((state) => ({
      notifications: [entry, ...state.notifications].slice(0, 50),
    }));

    setTimeout(() => {
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
      }));
    }, 5000);
  },

  dismiss: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clear: () => set({ notifications: [] }),
}));

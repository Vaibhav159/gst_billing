import { useState, useEffect, useCallback } from "react";

export interface AppNotification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

const STORE_KEY = "gst_notifications";

function loadNotifications(): AppNotification[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
  } catch { return []; }
}

function saveNotifications(notifications: AppNotification[]) {
  localStorage.setItem(STORE_KEY, JSON.stringify(notifications));
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>(loadNotifications);

  const add = useCallback((n: Omit<AppNotification, "id" | "timestamp" | "read">) => {
    const newNotification: AppNotification = {
      ...n,
      id: crypto.randomUUID().slice(0, 8),
      timestamp: Date.now(),
      read: false,
    };
    setNotifications((prev) => {
      const updated = [newNotification, ...prev].slice(0, 50);
      saveNotifications(updated);
      return updated;
    });
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const updated = prev.map((n) => n.id === id ? { ...n, read: true } : n);
      saveNotifications(updated);
      return updated;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      saveNotifications(updated);
      return updated;
    });
  }, []);

  const clear = useCallback(() => {
    setNotifications([]);
    saveNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Listen for cross-component notifications
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) add(detail);
    };
    window.addEventListener("app-notification", handler);
    return () => window.removeEventListener("app-notification", handler);
  }, [add]);

  return { notifications, unreadCount, add, markRead, markAllRead, clear };
}

// Helper to dispatch notification from anywhere
export function pushNotification(n: Omit<AppNotification, "id" | "timestamp" | "read">) {
  window.dispatchEvent(new CustomEvent("app-notification", { detail: n }));
}

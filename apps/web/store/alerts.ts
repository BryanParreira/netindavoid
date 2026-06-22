import { create } from "zustand";

interface Alert {
  id: string;
  title: string;
  severity: string;
  triggered_at: string;
  status: string;
  category: string;
  ai_explanation?: string;
}

interface AlertsState {
  liveAlerts: Alert[];
  unreadCount: number;
  pushAlert: (alert: Alert) => void;
  markAllRead: () => void;
}

export const useAlertsStore = create<AlertsState>((set) => ({
  liveAlerts: [],
  unreadCount: 0,
  pushAlert: (alert) =>
    set((s) => ({
      liveAlerts: [alert, ...s.liveAlerts].slice(0, 50),
      unreadCount: s.unreadCount + 1,
    })),
  markAllRead: () => set({ unreadCount: 0 }),
}));

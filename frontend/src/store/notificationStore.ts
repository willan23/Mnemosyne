import { create } from 'zustand';

export type NotificationType = 'success' | 'error' | 'info' | 'received' | 'sent';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  timestamp: number;
  isRead: boolean;
  memoryId?: string;
  senderUid?: string;
  senderName?: string;
  isPulsing?: boolean;
  /** Account-bound events must not render in another account, including before Auth callbacks. */
  ownerUid?: string;
}

interface NotificationActions {
  addNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'isRead'>) => void;
  dismissNotification: (id: string) => void;
  markAsRead: (id: string) => void;
  clearAll: () => void;
}

export const useNotificationStore = create<{ notifications: Notification[] } & NotificationActions>((set) => ({
  notifications: [],

  addNotification: (n) =>
    set((state) => ({
      notifications: [
        {
          ...n,
          id: `notif_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          timestamp: Date.now(),
          isRead: false,
        },
        ...state.notifications,
      ].slice(0, 50), // max 50 notifications
    })),

  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  markAsRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, isRead: true, isPulsing: false } : n
      ),
    })),

  clearAll: () => set({ notifications: [] }),
}));

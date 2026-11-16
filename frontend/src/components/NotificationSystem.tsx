import React, { useEffect, useRef } from 'react';
import { useNotificationStore, type Notification } from '../store/notificationStore';
import { X, CheckCircle2, AlertCircle, Info, Inbox, SendHorizonal } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import {
  markCapsuleNoticeRead,
  watchCapsuleImportNotices,
} from '../services/capsuleNoticeService';

const ICONS: Record<string, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
  error: <AlertCircle className="w-4 h-4 text-rose-400" />,
  info: <Info className="w-4 h-4 text-blue-400" />,
  received: <Inbox className="w-4 h-4 text-cyan-400" />,
  sent: <SendHorizonal className="w-4 h-4 text-violet-400" />,
};

const BORDER_COLORS: Record<string, string> = {
  success: 'border-emerald-500/40',
  error: 'border-rose-500/40',
  info: 'border-blue-500/40',
  received: 'border-cyan-500/40',
  sent: 'border-violet-500/40',
};

const GLOW_COLORS: Record<string, string> = {
  success: 'shadow-emerald-500/20',
  error: 'shadow-rose-500/20',
  info: 'shadow-blue-500/20',
  received: 'shadow-cyan-500/20',
  sent: 'shadow-violet-500/20',
};

const AUTO_DISMISS_MS = 5000;

const ToastItem: React.FC<{ notif: Notification }> = ({ notif }) => {
  const { dismissNotification, markAsRead } = useNotificationStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (notif.type !== 'received' || !notif.isPulsing) {
      timerRef.current = setTimeout(() => {
        dismissNotification(notif.id);
      }, AUTO_DISMISS_MS);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [notif.id, notif.type, notif.isPulsing, dismissNotification]);

  const handleClick = () => {
    markAsRead(notif.id);
    dismissNotification(notif.id);
  };

  return (
    <div
      className={`
        flex items-start gap-3 px-4 py-3 rounded-xl
        border ${BORDER_COLORS[notif.type]}
        bg-[#0b1120]/80 backdrop-blur-xl
        shadow-lg ${GLOW_COLORS[notif.type]}
        cursor-pointer select-none
        transition-all duration-300
        ${notif.isPulsing ? 'animate-notification-pulse' : ''}
        notification-toast
      `}
      onClick={handleClick}
      role="alert"
    >
      <div className="mt-0.5 flex-shrink-0">{ICONS[notif.type]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#e2e8f0] leading-tight">{notif.title}</p>
        {notif.message && (
          <p className="text-xs text-[#94a3b8] mt-0.5 leading-snug truncate max-w-[200px]">
            {notif.message}
          </p>
        )}
      </div>
      <button
        className="flex-shrink-0 text-white/30 hover:text-white/70 transition-colors mt-0.5"
        onClick={(e) => { e.stopPropagation(); dismissNotification(notif.id); }}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export const NotificationSystem: React.FC = () => {
  const { notifications, addNotification, clearAll } = useNotificationStore();
  const visible = notifications.filter(notice => notice.ownerUid === undefined || notice.ownerUid === auth.currentUser?.uid).slice(0, 5);

  // Escuta assimilações de cápsulas que tu criaste
  useEffect(() => {
    let active = true;
    let generation = 0;
    let lastUid = auth.currentUser?.uid ?? null;
    let unsubNotices: (() => void) | undefined;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!active) return;
      const epoch = ++generation;
      unsubNotices?.();
      unsubNotices = undefined;
      if ((user?.uid ?? null) !== lastUid) clearAll();
      lastUid = user?.uid ?? null;
      if (!user) return;
      const current = () => active && epoch === generation && auth.currentUser?.uid === user.uid;
      unsubNotices = watchCapsuleImportNotices(user.uid, (notice) => {
        if (!current() || notice.ownerUid !== user.uid) return;
        const label = notice.titleHint?.trim() || 'a tua cápsula';
        const count = notice.itemCount > 1 ? ` (${notice.itemCount} memórias)` : '';
        addNotification({
          ownerUid: user.uid,
          type: 'received',
          title: 'Cápsula assimilada',
          message: `Alguém importou “${label}”${count}`,
          isPulsing: true,
        });
        // Failure leaves the server notice unread; a new subscription can retry.
        void markCapsuleNoticeRead(notice, current).catch(() => undefined);
      });
    });
    return () => {
      active = false;
      generation++;
      unsubAuth();
      unsubNotices?.();
    };
  }, [addNotification, clearAll]);

  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 w-72 pointer-events-none">
      {visible.map((n) => (
        <div key={n.id} className="pointer-events-auto notification-slide-in">
          <ToastItem notif={n} />
        </div>
      ))}
    </div>
  );
};

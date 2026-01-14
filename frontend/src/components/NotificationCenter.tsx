import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Eye, UserPlus, Trash2 } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, doc, deleteDoc, orderBy } from 'firebase/firestore';

interface Notification {
    id: string;
    type: 'share' | 'mention' | 'comment';
    title: string;
    message: string;
    read: boolean;
    timestamp: number;
    sessionId?: string;
    fromUser?: {
        uid: string;
        email: string;
    };
}

export const NotificationCenter: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        if (!auth.currentUser) return;

        // Subscribe to notifications
        const notificationsRef = collection(db, 'notifications');
        const q = query(
            notificationsRef,
            where('uid', '==', auth.currentUser.uid),
            orderBy('timestamp', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const notifs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Notification[];

            setNotifications(notifs);
            setUnreadCount(notifs.filter(n => !n.read).length);
        });

        return () => unsubscribe();
    }, []);

    const handleMarkAsRead = async (notificationId: string) => {
        try {
            await updateDoc(doc(db, 'notifications', notificationId), {
                read: true
            });
        } catch (error) {
            console.error('Error marking as read:', error);
        }
    };

    const handleMarkAllAsRead = async () => {
        try {
            const unreadNotifs = notifications.filter(n => !n.read);
            await Promise.all(
                unreadNotifs.map(n =>
                    updateDoc(doc(db, 'notifications', n.id), { read: true })
                )
            );
        } catch (error) {
            console.error('Error marking all as read:', error);
        }
    };

    const handleDelete = async (notificationId: string) => {
        try {
            await deleteDoc(doc(db, 'notifications', notificationId));
        } catch (error) {
            console.error('Error deleting notification:', error);
        }
    };

    const getNotificationIcon = (type: string) => {
        switch (type) {
            case 'share':
                return <UserPlus className="w-4 h-4 text-indigo-400" />;
            case 'mention':
                return <Bell className="w-4 h-4 text-yellow-400" />;
            case 'comment':
                return <Eye className="w-4 h-4 text-green-400" />;
            default:
                return <Bell className="w-4 h-4 text-gray-400" />;
        }
    };

    const formatTimestamp = (timestamp: number) => {
        const now = Date.now();
        const diff = now - timestamp;

        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Agora';
        if (minutes < 60) return `${minutes}m atrás`;
        if (hours < 24) return `${hours}h atrás`;
        if (days < 7) return `${days}d atrás`;
        return new Date(timestamp).toLocaleDateString();
    };

    return (
        <div className="relative">
            {/* Bell Icon */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 glass-button"
            >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        {/* Backdrop */}
                        <div
                            className="fixed inset-0 z-40"
                            onClick={() => setIsOpen(false)}
                        />

                        {/* Panel */}
                        <motion.div
                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                            className="absolute right-0 top-full mt-2 w-96 glass-card overflow-hidden z-50 max-h-[600px] flex flex-col"
                        >
                            {/* Header */}
                            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
                                <div>
                                    <h3 className="font-bold">Notificações</h3>
                                    {unreadCount > 0 && (
                                        <p className="text-xs text-gray-400">{unreadCount} não lidas</p>
                                    )}
                                </div>
                                {unreadCount > 0 && (
                                    <button
                                        onClick={handleMarkAllAsRead}
                                        className="text-xs text-indigo-400 hover:text-indigo-300 font-bold"
                                    >
                                        Marcar todas como lidas
                                    </button>
                                )}
                            </div>

                            {/* Notifications List */}
                            <div className="overflow-y-auto custom-scrollbar flex-1">
                                {notifications.length === 0 ? (
                                    <div className="p-8 text-center text-gray-500">
                                        <Bell className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                        <p>Nenhuma notificação</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-white/5">
                                        {notifications.map(notification => (
                                            <div
                                                key={notification.id}
                                                className={`p-4 hover:bg-white/5 transition-colors ${!notification.read ? 'bg-indigo-500/5' : ''
                                                    }`}
                                            >
                                                <div className="flex gap-3">
                                                    <div className="flex-shrink-0 mt-1">
                                                        {getNotificationIcon(notification.type)}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="flex-1">
                                                                <p className="font-medium text-sm">{notification.title}</p>
                                                                <p className="text-xs text-gray-400 mt-1">{notification.message}</p>
                                                                {notification.fromUser && (
                                                                    <p className="text-xs text-gray-500 mt-1">
                                                                        De: {notification.fromUser.email}
                                                                    </p>
                                                                )}
                                                            </div>
                                                            {!notification.read && (
                                                                <div className="w-2 h-2 bg-indigo-500 rounded-full flex-shrink-0 mt-1" />
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-3 mt-2">
                                                            <span className="text-xs text-gray-500">
                                                                {formatTimestamp(notification.timestamp)}
                                                            </span>
                                                            {!notification.read && (
                                                                <button
                                                                    onClick={() => handleMarkAsRead(notification.id)}
                                                                    className="text-xs text-indigo-400 hover:text-indigo-300 font-bold"
                                                                >
                                                                    Marcar como lida
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => handleDelete(notification.id)}
                                                                className="text-xs text-red-400 hover:text-red-300 ml-auto"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};

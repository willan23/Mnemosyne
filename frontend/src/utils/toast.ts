/**
 * Toast Notification Utilities
 * Wrapper around react-hot-toast for consistent notifications
 */

import toast from 'react-hot-toast';

export const showToast = {
    /**
     * Show success message
     */
    success: (message: string) => {
        toast.success(message);
    },

    /**
     * Show error message
     */
    error: (message: string) => {
        toast.error(message);
    },

    /**
     * Show info message
     */
    info: (message: string) => {
        toast(message, {
            icon: 'ℹ️',
        });
    },

    /**
     * Show loading message
     */
    loading: (message: string) => {
        return toast.loading(message);
    },

    /**
     * Dismiss a specific toast
     */
    dismiss: (toastId?: string) => {
        toast.dismiss(toastId);
    },

    /**
     * Promise-based toast for async operations
     */
    promise: <T,>(
        promise: Promise<T>,
        messages: {
            loading: string;
            success: string;
            error: string;
        }
    ) => {
        return toast.promise(promise, messages);
    },
};

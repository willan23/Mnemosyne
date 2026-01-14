import { useState, useEffect } from 'react';
import { auth, db, default as app } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

export type SubscriptionTier = 'free' | 'pro' | 'business';

export interface SubscriptionLimits {
    memoriesPerMonth: number;
    storageGB: number;
    canUploadAttachments: boolean;
    canSharePrivately: boolean;
    hasNotifications: boolean;
    hasAdvancedAnalytics: boolean;
    hasAPIAccess?: boolean;
    maxTeamMembers?: number;
}

export interface SubscriptionStatus {
    tier: SubscriptionTier;
    status: string;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
    limits: SubscriptionLimits;
    usage: {
        memoriesThisMonth: number;
        storageUsedMB: number;
    };
}

const getSubscriptionLimits = (tier: string): SubscriptionLimits => {
    const limits = {
        free: {
            memoriesPerMonth: 30,
            storageGB: 1,
            canUploadAttachments: false,
            canSharePrivately: false,
            hasNotifications: false,
            hasAdvancedAnalytics: false
        },
        pro: {
            memoriesPerMonth: -1, // unlimited
            storageGB: 50,
            canUploadAttachments: true,
            canSharePrivately: true,
            hasNotifications: true,
            hasAdvancedAnalytics: true
        },
        business: {
            memoriesPerMonth: -1, // unlimited
            storageGB: 500,
            canUploadAttachments: true,
            canSharePrivately: true,
            hasNotifications: true,
            hasAdvancedAnalytics: true,
            hasAPIAccess: true,
            maxTeamMembers: 10
        }
    };
    return limits[tier as keyof typeof limits] || limits.free;
};

/**
 * Hook to manage subscription state and limits
 */
export function useSubscription() {
    const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let unsubscribeAuth: (() => void) | undefined;
        let unsubscribeDoc: (() => void) | undefined;

        console.log('🚀 [useSubscription] Configurando listener');

        unsubscribeAuth = auth.onAuthStateChanged((user) => {
            console.log('👤 [useSubscription] Auth state changed:', user?.uid);

            if (!user) {
                setSubscription(null);
                setIsLoading(false);
                if (unsubscribeDoc) unsubscribeDoc();
                return;
            }

            // Listen to user document in real-time
            const userRef = doc(db, 'users', user.uid);

            unsubscribeDoc = onSnapshot(userRef, (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    const subData = data.subscription || {};
                    const usageData = data.usage || {};
                    const tier = subData.tier || 'free';

                    console.log('🔄 [useSubscription] Atualização recebida:', tier);

                    setSubscription({
                        tier,
                        status: subData.status || 'active',
                        currentPeriodEnd: subData.currentPeriodEnd ? subData.currentPeriodEnd.toMillis() : null,
                        cancelAtPeriodEnd: subData.cancelAtPeriodEnd || false,
                        limits: getSubscriptionLimits(tier),
                        usage: {
                            memoriesThisMonth: usageData.memoriesThisMonth || 0,
                            storageUsedMB: usageData.storageUsedMB || 0
                        }
                    });
                } else {
                    // Document doesn't exist yet, default to free
                    setSubscription({
                        tier: 'free',
                        status: 'active',
                        currentPeriodEnd: null,
                        cancelAtPeriodEnd: false,
                        limits: getSubscriptionLimits('free'),
                        usage: {
                            memoriesThisMonth: 0,
                            storageUsedMB: 0
                        }
                    });
                }
                setIsLoading(false);
            }, (error) => {
                console.error('❌ [useSubscription] Listen error:', error);
                setIsLoading(false);
            });

            // Force sync with Stripe (background check)
            try {
                const functions = getFunctions(app, 'europe-west1');
                const getStatus = httpsCallable(functions, 'getSubscriptionStatus');
                getStatus().catch((e) => console.error('⚠️ [useSubscription] Sync check failed:', e));
            } catch (error) {
                console.error('⚠️ [useSubscription] Sync check initiation failed:', error);
            }
        });

        return () => {
            if (unsubscribeAuth) unsubscribeAuth();
            if (unsubscribeDoc) unsubscribeDoc();
        };
    }, []);

    /**
     * Check if user can create a new memory
     */
    const canCreateMemory = (): boolean => {
        if (!subscription) return false;

        const { limits, usage } = subscription;

        // Unlimited for pro/business
        if (limits.memoriesPerMonth === -1) return true;

        // Check limit for free tier
        return usage.memoriesThisMonth < limits.memoriesPerMonth;
    };

    /**
     * Check if user can upload attachments
     */
    const canUploadAttachment = (): boolean => {
        return subscription?.limits.canUploadAttachments || false;
    };

    /**
     * Check if user has storage space
     */
    const hasStorageSpace = (fileSizeMB: number): boolean => {
        if (!subscription) return false;

        const { limits, usage } = subscription;
        const availableGB = limits.storageGB - (usage.storageUsedMB / 1024);

        return (fileSizeMB / 1024) <= availableGB;
    };

    /**
     * Get remaining memories for this month
     */
    const getRemainingMemories = (): number => {
        if (!subscription) return 0;

        const { limits, usage } = subscription;

        if (limits.memoriesPerMonth === -1) return -1; // unlimited

        return Math.max(0, limits.memoriesPerMonth - usage.memoriesThisMonth);
    };

    /**
     * Get storage usage percentage
     */
    const getStorageUsagePercent = (): number => {
        if (!subscription) return 0;

        const { limits, usage } = subscription;
        const usageGB = usage.storageUsedMB / 1024;

        return Math.min(100, (usageGB / limits.storageGB) * 100);
    };

    return {
        subscription,
        isLoading,
        tier: subscription?.tier || 'free',
        isPro: subscription?.tier === 'pro',
        isBusiness: subscription?.tier === 'business',
        canCreateMemory,
        canUploadAttachment,
        hasStorageSpace,
        getRemainingMemories,
        getStorageUsagePercent
    };
}

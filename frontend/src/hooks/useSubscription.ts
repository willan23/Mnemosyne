import { useState, useEffect } from 'react';
import { auth, db, default as app } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getEffectivePlanLimits, normalizePlanName } from '../config/planLimits';
import { isFreeFirstMode } from '../config/monetization';

export type SubscriptionTier = 'free' | 'pro' | 'sovereign';
export type SubscriptionState = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'paused' | 'unpaid' | string;

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
    status: SubscriptionState;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
    limits: SubscriptionLimits;
    usage: {
        memoriesThisMonth: number;
        storageUsedMB: number;
    };
}

const getSubscriptionLimits = (tier: string): SubscriptionLimits => {
    const plan = getEffectivePlanLimits(tier);
    return {
        memoriesPerMonth: plan.memories.monthly,
        storageGB: plan.storage.maxGB,
        canUploadAttachments: Object.values(plan.attachments).some((attachment) => attachment.enabled),
        canSharePrivately: plan.features.privateSharing,
        hasNotifications: plan.features.notifications,
        hasAdvancedAnalytics: plan.features.advancedAnalytics,
        hasAPIAccess: plan.features.apiAccess,
        maxTeamMembers: plan.features.teamMembers,
    };
};

/**
 * Hook to manage subscription state and limits
 */
export function useSubscription() {
    const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let unsubscribeDoc: (() => void) | undefined;

        console.log('🚀 [useSubscription] Configurando listener');

        const unsubscribeAuth = auth.onAuthStateChanged((user) => {
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
                    const tier = normalizePlanName(subData.tier || 'free');

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

            // Stripe remains installed but dormant during the Free-first phase.
            if (!isFreeFirstMode) {
                try {
                    const functions = getFunctions(app, 'europe-west1');
                    const getStatus = httpsCallable(functions, 'getSubscriptionStatus');
                    getStatus().catch((e) => console.error('⚠️ [useSubscription] Sync check failed:', e));
                } catch (error) {
                    console.error('⚠️ [useSubscription] Sync check initiation failed:', error);
                }
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

        // Unlimited for paid tiers
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
        if (limits.storageGB === -1) return true;
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
        if (limits.storageGB === -1) return 0;
        const usageGB = usage.storageUsedMB / 1024;

        return Math.min(100, (usageGB / limits.storageGB) * 100);
    };

    return {
        subscription,
        isLoading,
        tier: subscription?.tier || 'free',
        isPro: subscription?.tier === 'pro',
        isSovereign: subscription?.tier === 'sovereign',
        isBusiness: subscription?.tier === 'sovereign',
        canCreateMemory,
        canUploadAttachment,
        hasStorageSpace,
        getRemainingMemories,
        getStorageUsagePercent
    };
}

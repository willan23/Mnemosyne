import { useState, useEffect } from 'react';
import { auth, db, default as app } from '../firebase';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
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
        let unsubscribeDoc: Unsubscribe | undefined;

        const unsubscribeAuth = auth.onAuthStateChanged((user) => {
            if (unsubscribeDoc) {
                unsubscribeDoc();
                unsubscribeDoc = undefined;
            }

            if (!user) {
                setSubscription(null);
                setIsLoading(false);
                return;
            }

            const userRef = doc(db, 'users', user.uid);

            unsubscribeDoc = onSnapshot(userRef, (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    const subData = data.subscription || {};
                    const usageData = data.usage || {};
                    const tier = normalizePlanName(subData.tier || 'free');

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
            }, () => {
                setIsLoading(false);
            });

            if (!isFreeFirstMode) {
                try {
                    const functions = getFunctions(app, 'europe-west1');
                    const getStatus = httpsCallable(functions, 'getSubscriptionStatus');
                    getStatus().catch(() => undefined);
                } catch {
                    // Sync check is optional during Free-first.
                }
            }
        });

        return () => {
            unsubscribeAuth();
            unsubscribeDoc?.();
        };
    }, []);

    const canCreateMemory = (): boolean => {
        if (!subscription) return false;

        const { limits, usage } = subscription;

        if (limits.memoriesPerMonth === -1) return true;

        return usage.memoriesThisMonth < limits.memoriesPerMonth;
    };

    const canUploadAttachment = (): boolean => {
        return subscription?.limits.canUploadAttachments || false;
    };

    const hasStorageSpace = (fileSizeMB: number): boolean => {
        if (!subscription) return false;

        const { limits, usage } = subscription;
        if (limits.storageGB === -1) return true;
        const availableGB = limits.storageGB - (usage.storageUsedMB / 1024);

        return (fileSizeMB / 1024) <= availableGB;
    };

    const getRemainingMemories = (): number => {
        if (!subscription) return 0;

        const { limits, usage } = subscription;

        if (limits.memoriesPerMonth === -1) return -1;

        return Math.max(0, limits.memoriesPerMonth - usage.memoriesThisMonth);
    };

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

import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getEffectivePlanLimits, hasReachedLimit, type PlanLimits } from '../config/planLimits';

export interface UsageStats {
    memories: {
        thisMonth: number;
        limit: number;
        canCreate: boolean;
    };
    attachments: {
        images: {
            thisMonth: number;
            limit: number;
            canUpload: boolean;
        };
        audio: {
            thisMonth: number;
            limit: number;
            canUpload: boolean;
        };
        pdfs: {
            thisMonth: number;
            limit: number;
            canUpload: boolean;
        };
    };
    storage: {
        usedGB: number;
        limitGB: number;
        canUpload: boolean;
    };
}

export const useSubscriptionLimits = (userPlan: string = 'free') => {
    const [limits, setLimits] = useState<PlanLimits>(getEffectivePlanLimits(userPlan));
    const [usage, setUsage] = useState<UsageStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        setLimits(getEffectivePlanLimits(userPlan));
    }, [userPlan]);

    useEffect(() => {
        const loadUsage = async () => {
            if (!auth.currentUser) {
                setIsLoading(false);
                return;
            }

            try {
                // Calcular início do mês atual
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

                // Query para memórias deste mês
                const sessionsRef = collection(db, 'sessions');
                const q = query(
                    sessionsRef,
                    where('uid', '==', auth.currentUser.uid),
                    where('teamId', '==', null),
                    where('timestamp', '>=', startOfMonth)
                );
                const snapshot = await getDocs(q);
                const allSessionsSnapshot = await getDocs(query(sessionsRef, where('uid', '==', auth.currentUser.uid), where('teamId', '==', null)));

                // Contar anexos
                let imagesCount = 0;
                let audioCount = 0;
                let pdfsCount = 0;

                snapshot.docs.forEach(doc => {
                    const data = doc.data();
                    const attachments = Array.isArray(data.attachments) ? data.attachments : [];
                    for (const attachment of attachments) {
                        if (attachment.type === 'image') imagesCount += 1;
                        if (attachment.type === 'audio') audioCount += 1;
                        if (attachment.type === 'pdf' || attachment.type === 'document') pdfsCount += 1;
                    }
                });

                const memoriesThisMonth = snapshot.size;

                const storageUsedBytes = allSessionsSnapshot.docs.reduce((total, doc) => {
                    const data = doc.data();
                    const attachments = Array.isArray(data.attachments) ? data.attachments : [];
                    return total + attachments.reduce((attachmentTotal: number, attachment: any) => {
                        return attachmentTotal + (typeof attachment.size === 'number' ? attachment.size : 0);
                    }, 0);
                }, 0);
                const storageUsedGB = storageUsedBytes / (1024 ** 3);

                setUsage({
                    memories: {
                        thisMonth: memoriesThisMonth,
                        limit: limits.memories.monthly,
                        canCreate: !hasReachedLimit(memoriesThisMonth, limits.memories.monthly),
                    },
                    attachments: {
                        images: {
                            thisMonth: imagesCount,
                            limit: limits.attachments.images.monthlyLimit,
                            canUpload: limits.attachments.images.enabled &&
                                !hasReachedLimit(imagesCount, limits.attachments.images.monthlyLimit),
                        },
                        audio: {
                            thisMonth: audioCount,
                            limit: limits.attachments.audio.monthlyLimit,
                            canUpload: limits.attachments.audio.enabled &&
                                !hasReachedLimit(audioCount, limits.attachments.audio.monthlyLimit),
                        },
                        pdfs: {
                            thisMonth: pdfsCount,
                            limit: limits.attachments.pdfs.monthlyLimit,
                            canUpload: limits.attachments.pdfs.enabled &&
                                !hasReachedLimit(pdfsCount, limits.attachments.pdfs.monthlyLimit),
                        },
                    },
                    storage: {
                        usedGB: storageUsedGB,
                        limitGB: limits.storage.maxGB,
                        canUpload: limits.storage.maxGB === -1 || storageUsedGB < limits.storage.maxGB,
                    },
                });
            } catch (error) {
                console.error('Error loading usage stats:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadUsage();
    }, [auth.currentUser, limits]);

    return {
        limits,
        usage,
        isLoading,
    };
};

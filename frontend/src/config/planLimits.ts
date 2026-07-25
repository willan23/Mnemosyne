// Configuração de limites por plano de assinatura

export interface PlanLimits {
    name: string;
    memories: {
        monthly: number; // -1 = ilimitado
    };
    storage: {
        maxGB: number;
    };
    attachments: {
        images: {
            enabled: boolean;
            monthlyLimit: number; // -1 = ilimitado
        };
        audio: {
            enabled: boolean;
            monthlyLimit: number; // -1 = ilimitado
        };
        pdfs: {
            enabled: boolean;
            monthlyLimit: number; // -1 = ilimitado
        };
    };
    features: {
        privateSharing: boolean;
        notifications: boolean;
        advancedAnalytics: boolean;
        apiAccess: boolean;
        teamMembers: number;
        prioritySupport: boolean;
    };
}

export type PlanName = 'free' | 'pro' | 'sovereign';

export const PLAN_LIMITS: Record<PlanName, PlanLimits> = {
    free: {
        name: 'Free',
        memories: {
            monthly: 30,
        },
        storage: {
            maxGB: 1,
        },
        attachments: {
            images: {
                enabled: false,
                monthlyLimit: 0,
            },
            audio: {
                enabled: false,
                monthlyLimit: 0,
            },
            pdfs: {
                enabled: false,
                monthlyLimit: 0,
            },
        },
        features: {
            privateSharing: false,
            notifications: false,
            advancedAnalytics: false,
            apiAccess: false,
            teamMembers: 1,
            prioritySupport: false,
        },
    },
    pro: {
        name: 'Pro',
        memories: {
            monthly: -1, // Ilimitado
        },
        storage: {
            maxGB: 50,
        },
        attachments: {
            images: {
                enabled: true,
                monthlyLimit: -1, // Ilimitado
            },
            audio: {
                enabled: true,
                monthlyLimit: -1, // Ilimitado
            },
            pdfs: {
                enabled: false,
                monthlyLimit: 0,
            },
        },
        features: {
            privateSharing: true,
            notifications: true,
            advancedAnalytics: true,
            apiAccess: false,
            teamMembers: 1,
            prioritySupport: false,
        },
    },
    sovereign: {
        name: 'Sovereign',
        memories: {
            monthly: -1, // Ilimitado
        },
        storage: {
            maxGB: 500,
        },
        attachments: {
            images: {
                enabled: true,
                monthlyLimit: -1, // Ilimitado
            },
            audio: {
                enabled: true,
                monthlyLimit: -1, // Ilimitado
            },
            pdfs: {
                enabled: true,
                monthlyLimit: -1, // Ilimitado
            },
        },
        features: {
            privateSharing: true,
            notifications: true,
            advancedAnalytics: true,
            apiAccess: true,
            teamMembers: 10,
            prioritySupport: true,
        },
    },
};

export const normalizePlanName = (planName: string = 'free'): PlanName => {
    const normalizedPlan = planName.toLowerCase();
    if (normalizedPlan === 'business') return 'sovereign';
    if (normalizedPlan === 'pro' || normalizedPlan === 'sovereign') return normalizedPlan;
    return 'free';
};

// Helper para obter limites do plano atual
export const getPlanLimits = (planName: string = 'free'): PlanLimits => {
    return PLAN_LIMITS[normalizePlanName(planName)];
};

// Helper para verificar se atingiu o limite
export const hasReachedLimit = (current: number, limit: number): boolean => {
    if (limit === -1) return false; // Ilimitado
    return current >= limit;
};

// Helper para calcular porcentagem de uso
export const getUsagePercentage = (current: number, limit: number): number => {
    if (limit === -1) return 0; // Ilimitado
    return Math.min(100, (current / limit) * 100);
};

import React from 'react';
import { motion } from 'framer-motion';
import { Crown, Database, TrendingUp, Settings } from 'lucide-react';
import { useSubscription } from '../hooks/useSubscription';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebase';
import { showToast } from '../utils/toast';

/**
 * Subscription Status Component
 * Shows current tier, usage, and manage subscription button
 */
export const SubscriptionStatus: React.FC = () => {
    console.log('📊 [SubscriptionStatus] Component renderizando');

    const {
        subscription,
        isLoading,
        tier,
        isPro,
        isBusiness,
        getRemainingMemories,
        getStorageUsagePercent
    } = useSubscription();

    console.log('📊 [SubscriptionStatus] Hook retornou:', { subscription, isLoading, tier });

    const handleManageSubscription = async () => {
        try {
            const functions = getFunctions(app, 'europe-west1');
            const createPortal = httpsCallable(functions, 'createBillingPortalSession');

            const result = await createPortal({
                returnUrl: window.location.href
            });

            const { url } = result.data as { url: string };
            window.location.href = url;
        } catch (error) {
            console.error('Error opening billing portal:', error);
            showToast.error('Erro ao abrir portal de assinatura');
        }
    };

    if (isLoading) {
        return (
            <div className="glass-card p-4 animate-pulse">
                <div className="h-4 bg-white/10 rounded w-1/2 mb-2" />
                <div className="h-3 bg-white/10 rounded w-3/4" />
            </div>
        );
    }

    if (!subscription) return null;

    const tierColors = {
        free: 'gray',
        pro: 'indigo',
        business: 'purple'
    };

    const tierIcons = {
        free: Database,
        pro: Crown,
        business: TrendingUp
    };

    const color = tierColors[tier];
    const Icon = tierIcons[tier];
    const remainingMemories = getRemainingMemories();
    const storagePercent = getStorageUsagePercent();

    return (
        <div className="glass-card p-6 space-y-4">
            {/* Header */}
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg bg-${color}-500/20 flex items-center justify-center`}>
                        <Icon className={`w-5 h-5 text-${color}-400`} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold capitalize">{tier}</h3>
                            {subscription.status === 'active' && (
                                <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
                                    Ativo
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-500">
                            {tier === 'free' ? 'Plano Gratuito' : 'Assinatura Ativa'}
                        </p>
                    </div>
                </div>

                {(isPro || isBusiness) && (
                    <button
                        onClick={handleManageSubscription}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        title="Gerenciar Assinatura"
                    >
                        <Settings className="w-4 h-4 text-gray-400" />
                    </button>
                )}
            </div>

            {/* Usage Stats */}
            <div className="space-y-3">
                {/* Memories */}
                <div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400">Memórias este mês</span>
                        <span className={`font-bold ${remainingMemories === 0 ? 'text-red-400' : 'text-gray-300'}`}>
                            {remainingMemories === -1
                                ? `${subscription.usage.memoriesThisMonth} (Ilimitado)`
                                : `${subscription.usage.memoriesThisMonth} / ${subscription.limits.memoriesPerMonth}`
                            }
                        </span>
                    </div>
                    {remainingMemories !== -1 && (
                        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{
                                    width: `${Math.min(100, (subscription.usage.memoriesThisMonth / subscription.limits.memoriesPerMonth) * 100)}%`
                                }}
                                className={`h-full ${remainingMemories === 0 ? 'bg-red-500' :
                                    remainingMemories < 10 ? 'bg-yellow-500' :
                                        'bg-indigo-500'
                                    }`}
                            />
                        </div>
                    )}
                </div>

                {/* Storage */}
                <div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400">Armazenamento</span>
                        <span className="text-gray-300 font-bold">
                            {(subscription.usage.storageUsedMB / 1024).toFixed(2)} GB / {subscription.limits.storageGB} GB
                        </span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${storagePercent}%` }}
                            className={`h-full ${storagePercent > 90 ? 'bg-red-500' :
                                storagePercent > 75 ? 'bg-yellow-500' :
                                    'bg-purple-500'
                                }`}
                        />
                    </div>
                </div>
            </div>

            {/* Upgrade CTA (only for free tier) */}
            {tier === 'free' && remainingMemories < 10 && (
                <div className="pt-3 border-t border-white/5">
                    <p className="text-xs text-yellow-400 mb-2">
                        ⚠️ Você está perto do limite mensal
                    </p>
                    <button
                        onClick={() => window.location.href = '/pricing'}
                        className="w-full py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 rounded-lg text-sm font-bold uppercase tracking-tighter transition-all"
                    >
                        Upgrade para Ilimitado
                    </button>
                </div>
            )}

            {/* Cancel warning */}
            {subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
                <div className="pt-3 border-t border-white/5">
                    <p className="text-xs text-yellow-400">
                        ⚠️ Assinatura será cancelada em{' '}
                        {new Date(subscription.currentPeriodEnd).toLocaleDateString('pt-PT')}
                    </p>
                </div>
            )}
        </div>
    );
};

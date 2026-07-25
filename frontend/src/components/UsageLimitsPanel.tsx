import React from 'react';
import { motion } from 'framer-motion';
import { Brain, Image, Mic, FileText, HardDrive, Crown } from 'lucide-react';
import { useSubscriptionLimits } from '../hooks/useSubscriptionLimits';
import { useNavigate } from 'react-router-dom';
import { isFreeFirstMode } from '../config/monetization';

interface UsageLimitsPanelProps {
    userPlan?: string;
}

const colorClasses: Record<string, { icon: string; bar: string }> = {
    indigo: { icon: 'text-indigo-400', bar: 'bg-indigo-500' },
    blue: { icon: 'text-blue-400', bar: 'bg-blue-500' },
    green: { icon: 'text-green-400', bar: 'bg-green-500' },
    purple: { icon: 'text-purple-400', bar: 'bg-purple-500' },
    orange: { icon: 'text-orange-400', bar: 'bg-orange-500' },
};

const UsageBar: React.FC<{
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    current: number;
    limit: number;
    color: string;
}> = ({ icon: Icon, label, current, limit, color }) => {
    const percentage = limit === -1 ? 0 : Math.min(100, (current / limit) * 100);
    const isUnlimited = limit === -1;
    const isNearLimit = percentage >= 80 && !isUnlimited;
    const isAtLimit = percentage >= 100;
    const palette = colorClasses[color] || colorClasses.indigo;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${palette.icon}`} />
                    <span className="text-gray-300">{label}</span>
                </div>
                <span className={`font-bold ${isAtLimit ? 'text-red-400' : isNearLimit ? 'text-yellow-400' : 'text-gray-400'}`}>
                    {current} / {isUnlimited ? '∞' : limit}
                </span>
            </div>
            {!isUnlimited && (
                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${percentage}%` }}
                        className={`h-full ${isAtLimit ? 'bg-red-500' : isNearLimit ? 'bg-yellow-500' : palette.bar}`}
                    />
                </div>
            )}
        </div>
    );
};

export const UsageLimitsPanel: React.FC<UsageLimitsPanelProps> = ({ userPlan = 'free' }) => {
    const { limits, usage, isLoading } = useSubscriptionLimits(userPlan);
    const navigate = useNavigate();

    if (isLoading || !usage) {
        return (
            <div className="glass-card p-4">
                <div className="animate-pulse space-y-3">
                    <div className="h-4 bg-white/10 rounded w-3/4"></div>
                    <div className="h-4 bg-white/10 rounded w-1/2"></div>
                </div>
            </div>
        );
    }

    const isPro = userPlan.toLowerCase() !== 'free';

    return (
        <div className="glass-card p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-bold text-lg flex items-center gap-2">
                        {isPro && <Crown className="w-5 h-5 text-yellow-400" />}
                        Plano {limits.name}
                    </h3>
                    <p className="text-xs text-gray-500">
                        {isFreeFirstMode ? 'Founder Preview gratuito' : 'Uso este mês'}
                    </p>
                </div>
                {!isPro && !isFreeFirstMode && (
                    <button
                        onClick={() => navigate('/pricing')}
                        className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded-lg font-bold transition-all"
                    >
                        Upgrade
                    </button>
                )}
            </div>

            {/* Usage Stats */}
            <div className="space-y-4">
                <UsageBar
                    icon={Brain}
                    label="Memórias"
                    current={usage.memories.thisMonth}
                    limit={usage.memories.limit}
                    color="indigo"
                />

                {limits.attachments.images.enabled && (
                    <UsageBar
                        icon={Image}
                        label="Imagens"
                        current={usage.attachments.images.thisMonth}
                        limit={usage.attachments.images.limit}
                        color="blue"
                    />
                )}

                {limits.attachments.audio.enabled && (
                    <UsageBar
                        icon={Mic}
                        label="Áudios"
                        current={usage.attachments.audio.thisMonth}
                        limit={usage.attachments.audio.limit}
                        color="green"
                    />
                )}

                {limits.attachments.pdfs.enabled && (
                    <UsageBar
                        icon={FileText}
                        label="PDFs"
                        current={usage.attachments.pdfs.thisMonth}
                        limit={usage.attachments.pdfs.limit}
                        color="purple"
                    />
                )}

                <UsageBar
                    icon={HardDrive}
                    label="Armazenamento"
                    current={Math.round(usage.storage.usedGB * 100) / 100}
                    limit={usage.storage.limitGB}
                    color="orange"
                />
            </div>

            {/* Warnings */}
            {!usage.memories.canCreate && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                    {isFreeFirstMode
                        ? 'Limite técnico temporário atingido. Tenta novamente mais tarde.'
                        : '⚠️ Limite de memórias atingido. Faça upgrade para continuar criando.'}
                </div>
            )}

            {!usage.attachments.images.canUpload && limits.attachments.images.enabled && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs text-yellow-400">
                    ⚠️ Limite de imagens atingido este mês.
                </div>
            )}

            {!usage.attachments.audio.canUpload && limits.attachments.audio.enabled && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs text-yellow-400">
                    ⚠️ Limite de áudios atingido este mês.
                </div>
            )}
        </div>
    );
};

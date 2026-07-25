import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, Building2, Check, Crown, ExternalLink, X, Zap } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth, default as app } from '../firebase';
import { useSubscription } from '../hooks/useSubscription';
import type { SubscriptionTier } from '../hooks/useSubscription';
import { showToast } from '../utils/toast';
import { checkoutEnabled, isFreeFirstMode } from '../config/monetization';

type BillingInterval = 'monthly' | 'yearly';
type PaidPlanId = 'pro' | 'sovereign';
type TierId = SubscriptionTier;

interface PricingTier {
    id: TierId;
    planId?: PaidPlanId;
    name: string;
    price: string;
    period: string;
    yearlyPrice?: string;
    icon: React.ComponentType<{ className?: string }>;
    color: 'gray' | 'indigo' | 'cyan';
    recommended?: boolean;
    features: Array<{ text: string; included: boolean }>;
    cta: string;
}

const tiers: PricingTier[] = [
    {
        id: 'free',
        name: 'Free',
        price: '€0',
        period: '/mês',
        icon: Zap,
        color: 'gray',
        features: [
            { text: '30 memórias por mês', included: true },
            { text: 'Armazenamento privado inicial', included: true },
            { text: 'Knowledge Graph básico', included: true },
            { text: 'Compartilhamento público', included: true },
            { text: 'Anexos (áudio/imagens)', included: false },
            { text: 'Compartilhamento privado', included: false },
            { text: 'Notificações', included: false },
        ],
        cta: 'Plano Atual'
    },
    {
        id: 'pro',
        planId: 'pro',
        name: 'Pro',
        price: '€9.99',
        period: '/mês',
        yearlyPrice: '€99/ano',
        icon: Crown,
        color: 'indigo',
        recommended: true,
        features: [
            { text: 'Memórias ilimitadas', included: true },
            { text: 'Armazenamento ampliado', included: true },
            { text: 'Knowledge Graph avançado', included: true },
            { text: 'Anexos (áudio + imagens)', included: true },
            { text: 'Compartilhamento privado', included: true },
            { text: 'Notificações em tempo real', included: true },
            { text: 'Analytics avançado', included: true },
            { text: 'Suporte por email', included: true },
        ],
        cta: 'Upgrade para Pro'
    },
    {
        id: 'sovereign',
        planId: 'sovereign',
        name: 'Sovereign',
        price: '€29.99',
        period: '/mês',
        yearlyPrice: '€299/ano',
        icon: Building2,
        color: 'cyan',
        features: [
            { text: 'Tudo do Pro, mais:', included: true },
            { text: 'Armazenamento soberano', included: true },
            { text: 'Anexos completos (+ PDFs)', included: true },
            { text: 'Compartilhamento colaborativo', included: true },
            { text: 'API Access', included: true },
            { text: 'Até 10 membros na equipe', included: true },
            { text: 'Exportação completa + Backup', included: true },
            { text: 'Suporte prioritário', included: true },
        ],
        cta: 'Upgrade para Sovereign'
    }
];

const iconClasses: Record<PricingTier['color'], { shell: string; icon: string; primaryButton: string }> = {
    gray: {
        shell: 'bg-gray-500/20',
        icon: 'text-gray-400',
        primaryButton: 'glass-button',
    },
    indigo: {
        shell: 'bg-indigo-500/20',
        icon: 'text-indigo-400',
        primaryButton: 'bg-indigo-600 hover:bg-indigo-500 text-white',
    },
    cyan: {
        shell: 'bg-cyan-500/20',
        icon: 'text-cyan-400',
        primaryButton: 'bg-cyan-600 hover:bg-cyan-500 text-white',
    },
};

const founderPreviewFeatures: PricingTier['features'] = [
    { text: 'Memórias ilimitadas no Founder Preview', included: true },
    { text: 'Universe 3D, Insights e autolink semântico', included: true },
    { text: 'IA local (Ollama) e embeddings no browser', included: true },
    { text: 'Comms E2E e cápsulas cifradas (sem link em claro)', included: true },
    { text: 'Anexos com limites técnicos de fair-use', included: true },
    { text: 'Desktop (Tauri) e mobile pairing', included: true },
    { text: 'Planos pagos futuros: equipas, cloud alto, suporte', included: true },
];

const statusLabel: Record<string, string> = {
    active: 'Ativa',
    trialing: 'Trial',
    past_due: 'Pagamento pendente',
    canceled: 'Cancelada',
    incomplete: 'Incompleta',
    incomplete_expired: 'Expirada',
    paused: 'Pausada',
    unpaid: 'Em dívida',
};

export const PricingPage: React.FC = () => {
    const navigate = useNavigate();
    const { subscription, tier } = useSubscription();
    const [isYearly, setIsYearly] = useState(false);
    const [loading, setLoading] = useState<string | null>(null);

    const billingInterval: BillingInterval = isYearly ? 'yearly' : 'monthly';

    const handleUpgrade = async (planId: PaidPlanId | undefined, tierName: string) => {
        if (!planId) return;

        if (!checkoutEnabled) {
            showToast.info('O Mnemosyne está gratuito nesta fase. Planos pagos ficam preparados para uma fase futura.');
            return;
        }

        if (!auth.currentUser) {
            navigate('/login');
            return;
        }

        setLoading(tierName);

        try {
            const functions = getFunctions(app, 'europe-west1');
            const createCheckout = httpsCallable(functions, 'createCheckoutSession');

            const result = await createCheckout({
                planId,
                billingInterval,
                successUrl: `${window.location.origin}/checkout/success`,
                cancelUrl: `${window.location.origin}/pricing`
            });

            const { url } = result.data as { url: string };
            window.location.href = url;
        } catch (error) {
            console.error('Error creating checkout:', error);
            showToast.error('Erro ao iniciar checkout. Verifica a configuração do Stripe.');
            setLoading(null);
        }
    };

    const handleManageBilling = async () => {
        if (!auth.currentUser) {
            navigate('/login');
            return;
        }

        setLoading('portal');

        try {
            const functions = getFunctions(app, 'europe-west1');
            const createPortal = httpsCallable(functions, 'createBillingPortalSession');
            const result = await createPortal({
                returnUrl: `${window.location.origin}/pricing`,
            });

            const { url } = result.data as { url: string };
            window.location.href = url;
        } catch (error) {
            console.error('Error creating billing portal:', error);
            showToast.error('Não foi possível abrir a gestão da assinatura.');
            setLoading(null);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] py-16 px-4">
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-[10%] left-[20%] w-[40vw] h-[40vw] bg-indigo-600/5 rounded-full blur-[120px]" />
                <div className="absolute bottom-[20%] right-[10%] w-[30vw] h-[30vw] bg-cyan-600/5 rounded-full blur-[100px]" />
            </div>

            <div className="relative z-10 max-w-7xl mx-auto">
                <div className="mb-8">
                    <button
                        onClick={() => navigate('/')}
                        className="p-2 glass-card hover:bg-white/10 transition-all inline-flex items-center gap-2"
                        title="Voltar"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span className="text-sm">Voltar</span>
                    </button>
                </div>

                <div className="text-center mb-12">
                    <h1 className="text-5xl font-bold mb-4 glow-text">
                        {isFreeFirstMode ? 'Founder Preview' : 'Escolha Seu Plano'}
                    </h1>
                    {isFreeFirstMode ? (
                        <p className="mx-auto mb-8 max-w-2xl text-lg text-slate-400">
                            O núcleo cognitivo está gratuito enquanto construímos mercado.
                            Planos pagos ficam latentes para equipas, cloud intensivo e suporte.
                        </p>
                    ) : (
                        <p className="mb-8 text-xl text-gray-400">
                            Desbloqueie todo o potencial do Mnemosyne
                        </p>
                    )}

                    {!isFreeFirstMode && (
                    <div className="inline-flex items-center gap-4 glass-card p-2">
                        <button
                            onClick={() => setIsYearly(false)}
                            className={`px-6 py-2 rounded-lg transition-all ${!isYearly ? 'bg-indigo-600 text-white' : 'text-gray-400'}`}
                        >
                            Mensal
                        </button>
                        <button
                            onClick={() => setIsYearly(true)}
                            className={`px-6 py-2 rounded-lg transition-all ${isYearly ? 'bg-indigo-600 text-white' : 'text-gray-400'}`}
                        >
                            Anual
                            <span className="ml-2 text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">
                                -20%
                            </span>
                        </button>
                    </div>
                    )}
                </div>

                {subscription && !isFreeFirstMode && (
                    <div className="glass-card p-4 mb-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div className="flex items-start gap-3">
                            {subscription.status === 'past_due' ? (
                                <AlertTriangle className="w-5 h-5 text-yellow-400 mt-1" />
                            ) : (
                                <Crown className="w-5 h-5 text-indigo-400 mt-1" />
                            )}
                            <div>
                                <p className="font-bold">
                                    Plano atual: {isFreeFirstMode ? 'Gratuito' : tiers.find((pricingTier) => pricingTier.id === tier)?.name || 'Free'}
                                </p>
                                <p className="text-sm text-gray-400">
                                    Estado: {statusLabel[subscription.status] || subscription.status}
                                    {subscription.currentPeriodEnd && (
                                        <> · Renova em {new Date(subscription.currentPeriodEnd).toLocaleDateString('pt-PT')}</>
                                    )}
                                </p>
                            </div>
                        </div>

                        {tier !== 'free' && (
                            <button
                                onClick={handleManageBilling}
                                disabled={loading === 'portal'}
                                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg glass-button disabled:opacity-50"
                            >
                                <ExternalLink className="w-4 h-4" />
                                {loading === 'portal' ? 'A abrir...' : 'Gerir assinatura'}
                            </button>
                        )}
                    </div>
                )}

                <div className="grid md:grid-cols-3 gap-8">
                    {tiers.map((pricingTier, index) => {
                        const palette = iconClasses[pricingTier.color];
                        const isCurrentTier = pricingTier.id === tier;
                        const ctaLabel = isFreeFirstMode
                            ? (pricingTier.id === 'free' ? 'Ativo agora' : 'Futuro')
                            : isCurrentTier ? 'Plano Atual' : pricingTier.cta;
                        const TierIcon = pricingTier.icon;
                        const displayPrice = isFreeFirstMode && pricingTier.id !== 'free' ? 'Futuro' : pricingTier.price;
                        const displayPeriod = isFreeFirstMode && pricingTier.id !== 'free' ? '' : pricingTier.period;
                        const displayName = isFreeFirstMode && pricingTier.id === 'free' ? 'Gratuito' : pricingTier.name;
                        const displayFeatures = isFreeFirstMode && pricingTier.id === 'free' ? founderPreviewFeatures : pricingTier.features;

                        return (
                            <motion.div
                                key={pricingTier.name}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.1 }}
                                className={`glass-card p-8 relative ${pricingTier.recommended ? 'border-2 border-indigo-500/50' : ''}`}
                            >
                                {pricingTier.recommended && (
                                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-4 py-1 rounded-full text-sm font-bold">
                                        Recomendado
                                    </div>
                                )}

                                <div className={`w-12 h-12 rounded-lg ${palette.shell} flex items-center justify-center mb-4`}>
                                    <TierIcon className={`w-6 h-6 ${palette.icon}`} />
                                </div>

                                <h3 className="text-2xl font-bold mb-2">{displayName}</h3>
                                <div className="mb-6">
                                    <span className="text-4xl font-bold">{displayPrice}</span>
                                    <span className="text-gray-400">{displayPeriod}</span>
                                    {!isFreeFirstMode && isYearly && pricingTier.yearlyPrice && (
                                        <div className="text-sm text-green-400 mt-1">
                                            ou {pricingTier.yearlyPrice}
                                        </div>
                                    )}
                                </div>

                                <ul className="space-y-3 mb-8">
                                    {displayFeatures.map((feature) => (
                                        <li key={feature.text} className="flex items-start gap-2 text-sm">
                                            {feature.included ? (
                                                <Check className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                                            ) : (
                                                <X className="w-5 h-5 text-gray-600 shrink-0 mt-0.5" />
                                            )}
                                            <span className={feature.included ? 'text-gray-300' : 'text-gray-600'}>
                                                {feature.text}
                                            </span>
                                        </li>
                                    ))}
                                </ul>

                                <button
                                    onClick={() => handleUpgrade(pricingTier.planId, pricingTier.name)}
                                    disabled={!pricingTier.planId || isCurrentTier || loading === pricingTier.name || (isFreeFirstMode && pricingTier.id !== 'free')}
                                    className={`w-full py-3 rounded-lg font-bold uppercase tracking-tighter transition-all ${pricingTier.recommended || pricingTier.id === 'sovereign' ? palette.primaryButton : 'glass-button'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    {loading === pricingTier.name ? 'Processando...' : ctaLabel}
                                </button>
                            </motion.div>
                        );
                    })}
                </div>

                <div className="mt-24 text-center">
                    <h2 className="text-3xl font-bold mb-8">Perguntas Frequentes</h2>
                    <div className="grid md:grid-cols-2 gap-6 text-left">
                        <div className="glass-card p-6">
                            <h3 className="font-bold mb-2">Posso cancelar a qualquer momento?</h3>
                            <p className="text-sm text-gray-400">
                                {isFreeFirstMode
                                    ? 'Nesta fase não há cobrança ativa. Quando planos pagos forem introduzidos, a gestão será feita pelo portal Stripe.'
                                    : 'Sim. O portal de faturação da Stripe gere cancelamentos, métodos de pagamento e alterações de plano.'}
                            </p>
                        </div>
                        <div className="glass-card p-6">
                            <h3 className="font-bold mb-2">{isFreeFirstMode ? 'O que será pago no futuro?' : 'Como funciona o plano anual?'}</h3>
                            <p className="text-sm text-gray-400">
                                {isFreeFirstMode
                                    ? 'Valor empresarial e custo real: equipas, cloud gerida, retenção ampliada, suporte e compliance.'
                                    : 'O checkout usa Price IDs anuais configurados no backend, sem placeholders no frontend.'}
                            </p>
                        </div>
                        <div className="glass-card p-6">
                            <h3 className="font-bold mb-2">{isFreeFirstMode ? 'Quando aparece cobrança?' : 'O que acontece se o pagamento falhar?'}</h3>
                            <p className="text-sm text-gray-400">
                                {isFreeFirstMode
                                    ? 'Não aparece cobrança nesta fase. Antes de qualquer plano pago, o produto deve anunciar a mudança e ativar billing de forma explícita.'
                                    : 'A assinatura aparece como pagamento pendente e a gestão abre diretamente no portal da Stripe.'}
                            </p>
                        </div>
                        <div className="glass-card p-6">
                            <h3 className="font-bold mb-2">Meus dados estão seguros?</h3>
                            <p className="text-sm text-gray-400">
                                As memórias continuam E2EE; a Stripe só trata faturação, plano e estado da assinatura.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

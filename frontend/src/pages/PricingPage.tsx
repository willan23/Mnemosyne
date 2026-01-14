import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, X, Zap, Crown, Building2 } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebase';
import { showToast } from '../utils/toast';

const tiers = [
    {
        name: 'Free',
        price: '€0',
        period: '/mês',
        icon: Zap,
        color: 'gray',
        features: [
            { text: '50 memórias por mês', included: true },
            { text: '1GB de armazenamento', included: true },
            { text: 'Knowledge Graph básico', included: true },
            { text: 'Compartilhamento público', included: true },
            { text: 'Analytics básico', included: true },
            { text: 'Anexos (áudio/imagens)', included: false },
            { text: 'Compartilhamento privado', included: false },
            { text: 'Notificações', included: false },
        ],
        cta: 'Plano Atual',
        priceId: null
    },
    {
        name: 'Pro',
        price: '€9.99',
        period: '/mês',
        yearlyPrice: '€99/ano',
        icon: Crown,
        color: 'indigo',
        recommended: true,
        features: [
            { text: 'Memórias ilimitadas', included: true },
            { text: '50GB de armazenamento', included: true },
            { text: 'Knowledge Graph avançado', included: true },
            { text: 'Anexos (áudio + imagens)', included: true },
            { text: 'Compartilhamento privado', included: true },
            { text: 'Notificações em tempo real', included: true },
            { text: 'Analytics avançado', included: true },
            { text: 'Suporte por email', included: true },
        ],
        cta: 'Upgrade para Pro',
        priceId: import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY || 'price_pro_monthly'
    },
    {
        name: 'Business',
        price: '€29.99',
        period: '/mês',
        yearlyPrice: '€299/ano',
        icon: Building2,
        color: 'purple',
        features: [
            { text: 'Tudo do Pro, mais:', included: true },
            { text: '500GB de armazenamento', included: true },
            { text: 'Anexos completos (+ PDFs)', included: true },
            { text: 'Compartilhamento colaborativo', included: true },
            { text: 'API Access', included: true },
            { text: 'Até 10 membros na equipe', included: true },
            { text: 'Exportação completa + Backup', included: true },
            { text: 'Suporte prioritário', included: true },
        ],
        cta: 'Upgrade para Business',
        priceId: import.meta.env.VITE_STRIPE_PRICE_BUSINESS_MONTHLY || 'price_business_monthly'
    }
];

export const PricingPage: React.FC = () => {
    const [isYearly, setIsYearly] = useState(false);
    const [loading, setLoading] = useState<string | null>(null);

    const handleUpgrade = async (priceId: string | null, tierName: string) => {
        if (!priceId) return;

        setLoading(tierName);

        try {
            const functions = getFunctions(app, 'europe-west1');
            const createCheckout = httpsCallable(functions, 'createCheckoutSession');

            const result = await createCheckout({
                priceId,
                successUrl: `${window.location.origin}/checkout/success`,
                cancelUrl: `${window.location.origin}/pricing`
            });

            const { url } = result.data as { url: string };
            window.location.href = url;
        } catch (error) {
            console.error('Error creating checkout:', error);
            showToast.error('Erro ao iniciar checkout. Tente novamente.');
            setLoading(null);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] py-16 px-4">
            {/* Background decoration */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-[10%] left-[20%] w-[40vw] h-[40vw] bg-indigo-600/5 rounded-full blur-[120px]" />
                <div className="absolute bottom-[20%] right-[10%] w-[30vw] h-[30vw] bg-purple-600/5 rounded-full blur-[100px]" />
            </div>

            <div className="relative z-10 max-w-7xl mx-auto">
                {/* Header */}
                <div className="text-center mb-16">
                    <h1 className="text-5xl font-bold mb-4 glow-text">
                        Escolha Seu Plano
                    </h1>
                    <p className="text-xl text-gray-400 mb-8">
                        Desbloqueie todo o potencial do Mnemosyne
                    </p>

                    {/* Billing Toggle */}
                    <div className="inline-flex items-center gap-4 glass-card p-2">
                        <button
                            onClick={() => setIsYearly(false)}
                            className={`px-6 py-2 rounded-lg transition-all ${!isYearly ? 'bg-indigo-600 text-white' : 'text-gray-400'
                                }`}
                        >
                            Mensal
                        </button>
                        <button
                            onClick={() => setIsYearly(true)}
                            className={`px-6 py-2 rounded-lg transition-all ${isYearly ? 'bg-indigo-600 text-white' : 'text-gray-400'
                                }`}
                        >
                            Anual
                            <span className="ml-2 text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">
                                -20%
                            </span>
                        </button>
                    </div>
                </div>

                {/* Pricing Cards */}
                <div className="grid md:grid-cols-3 gap-8">
                    {tiers.map((tier, index) => (
                        <motion.div
                            key={tier.name}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className={`glass-card p-8 relative ${tier.recommended ? 'border-2 border-indigo-500/50' : ''
                                }`}
                        >
                            {tier.recommended && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-4 py-1 rounded-full text-sm font-bold">
                                    Recomendado
                                </div>
                            )}

                            {/* Icon */}
                            <div className={`w-12 h-12 rounded-lg bg-${tier.color}-500/20 flex items-center justify-center mb-4`}>
                                <tier.icon className={`w-6 h-6 text-${tier.color}-400`} />
                            </div>

                            {/* Name & Price */}
                            <h3 className="text-2xl font-bold mb-2">{tier.name}</h3>
                            <div className="mb-6">
                                <span className="text-4xl font-bold">{tier.price}</span>
                                <span className="text-gray-400">{tier.period}</span>
                                {isYearly && tier.yearlyPrice && (
                                    <div className="text-sm text-green-400 mt-1">
                                        ou {tier.yearlyPrice}
                                    </div>
                                )}
                            </div>

                            {/* Features */}
                            <ul className="space-y-3 mb-8">
                                {tier.features.map((feature, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm">
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

                            {/* CTA */}
                            <button
                                onClick={() => handleUpgrade(tier.priceId, tier.name)}
                                disabled={!tier.priceId || loading === tier.name}
                                className={`w-full py-3 rounded-lg font-bold uppercase tracking-tighter transition-all ${tier.recommended
                                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                                    : 'glass-button'
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                {loading === tier.name ? 'Processando...' : tier.cta}
                            </button>
                        </motion.div>
                    ))}
                </div>

                {/* FAQ */}
                <div className="mt-24 text-center">
                    <h2 className="text-3xl font-bold mb-8">Perguntas Frequentes</h2>
                    <div className="grid md:grid-cols-2 gap-6 text-left">
                        <div className="glass-card p-6">
                            <h3 className="font-bold mb-2">Posso cancelar a qualquer momento?</h3>
                            <p className="text-sm text-gray-400">
                                Sim! Você pode cancelar sua assinatura a qualquer momento. Você continuará tendo acesso até o final do período pago.
                            </p>
                        </div>
                        <div className="glass-card p-6">
                            <h3 className="font-bold mb-2">Como funciona o plano anual?</h3>
                            <p className="text-sm text-gray-400">
                                O plano anual oferece 20% de desconto. Você paga uma vez por ano e economiza €24 (Pro) ou €72 (Business).
                            </p>
                        </div>
                        <div className="glass-card p-6">
                            <h3 className="font-bold mb-2">Posso fazer upgrade depois?</h3>
                            <p className="text-sm text-gray-400">
                                Sim! Você pode fazer upgrade a qualquer momento e será cobrado proporcionalmente.
                            </p>
                        </div>
                        <div className="glass-card p-6">
                            <h3 className="font-bold mb-2">Meus dados estão seguros?</h3>
                            <p className="text-sm text-gray-400">
                                Absolutamente! Usamos criptografia end-to-end (E2EE). Nem nós conseguimos acessar suas memórias.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

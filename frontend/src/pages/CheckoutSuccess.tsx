import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { isFreeFirstMode } from '../config/monetization';

export const CheckoutSuccess: React.FC = () => {
    const navigate = useNavigate();

    useEffect(() => {
        // Redirect to home after 5 seconds
        const timer = setTimeout(() => {
            navigate('/');
        }, 5000);

        return () => clearTimeout(timer);
    }, [navigate]);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] flex items-center justify-center p-8">
            {/* Background decoration */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-[10%] left-[20%] w-[40vw] h-[40vw] bg-green-600/5 rounded-full blur-[120px]" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative z-10 max-w-2xl w-full text-center"
            >
                <div className="glass-card p-12">
                    {/* Success Icon */}
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.2, type: 'spring' }}
                        className="w-24 h-24 mx-auto mb-6 rounded-full bg-green-500/20 flex items-center justify-center"
                    >
                        <CheckCircle className="w-12 h-12 text-green-400" />
                    </motion.div>

                    {/* Title */}
                    <h1 className="text-4xl font-bold mb-4 glow-text">
                        {isFreeFirstMode ? 'Founder Preview Ativo' : 'Pagamento Confirmado!'}
                    </h1>

                    {/* Description */}
                    <p className="text-xl text-gray-400 mb-8">
                        {isFreeFirstMode
                            ? 'O core gratuito está aberto durante a fase de construção de mercado.'
                            : 'Bem-vindo ao Mnemosyne Premium!'}
                    </p>

                    <div className="glass-card p-6 mb-8 text-left">
                        <h2 className="font-bold mb-4">O que acontece agora?</h2>
                        <ul className="space-y-3 text-sm text-gray-400">
                            <li className="flex items-start gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-2" />
                                <span>{isFreeFirstMode ? 'Não há cobrança ativa nesta fase' : 'Sua assinatura está ativa imediatamente'}</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-2" />
                                <span>{isFreeFirstMode ? 'Memórias, Universe e IA local estão abertos' : 'Todas as features Pro foram desbloqueadas'}</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-2" />
                                <span>{isFreeFirstMode ? 'Planos pagos serão comunicados antes de qualquer ativação' : 'Você receberá um email de confirmação'}</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-2" />
                                <span>Gerencie sua assinatura a qualquer momento nas configurações</span>
                            </li>
                        </ul>
                    </div>

                    {/* CTA */}
                    <button
                        onClick={() => navigate('/')}
                        className="inline-flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 rounded-lg font-bold uppercase tracking-tighter transition-all shadow-lg shadow-indigo-500/20"
                    >
                        Começar a Usar
                        <ArrowRight className="w-5 h-5" />
                    </button>

                    <p className="text-xs text-gray-600 mt-6">
                        Redirecionando automaticamente em 5 segundos...
                    </p>
                </div>
            </motion.div>
        </div>
    );
};

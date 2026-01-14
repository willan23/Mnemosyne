import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { XCircle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const CheckoutCancel: React.FC = () => {
    const navigate = useNavigate();

    useEffect(() => {
        // Redirect to pricing after 5 seconds
        const timer = setTimeout(() => {
            navigate('/pricing');
        }, 5000);

        return () => clearTimeout(timer);
    }, [navigate]);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] flex items-center justify-center p-8">
            {/* Background decoration */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-[10%] left-[20%] w-[40vw] h-[40vw] bg-red-600/5 rounded-full blur-[120px]" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative z-10 max-w-2xl w-full text-center"
            >
                <div className="glass-card p-12">
                    {/* Cancel Icon */}
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.2, type: 'spring' }}
                        className="w-24 h-24 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center"
                    >
                        <XCircle className="w-12 h-12 text-red-400" />
                    </motion.div>

                    {/* Title */}
                    <h1 className="text-4xl font-bold mb-4">
                        Checkout Cancelado
                    </h1>

                    {/* Description */}
                    <p className="text-xl text-gray-400 mb-8">
                        Nenhuma cobrança foi realizada
                    </p>

                    <div className="glass-card p-6 mb-8 text-left">
                        <h2 className="font-bold mb-4">Mudou de ideia?</h2>
                        <p className="text-sm text-gray-400 mb-4">
                            Não se preocupe! Você pode fazer upgrade a qualquer momento.
                        </p>
                        <ul className="space-y-2 text-sm text-gray-400">
                            <li className="flex items-start gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2" />
                                <span>Continue usando o plano Free sem limitações</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2" />
                                <span>Faça upgrade quando estiver pronto</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2" />
                                <span>Sem compromisso, cancele a qualquer momento</span>
                            </li>
                        </ul>
                    </div>

                    {/* CTAs */}
                    <div className="flex gap-4 justify-center">
                        <button
                            onClick={() => navigate('/')}
                            className="inline-flex items-center gap-2 px-6 py-3 glass-button"
                        >
                            <ArrowLeft className="w-5 h-5" />
                            Voltar ao App
                        </button>
                        <button
                            onClick={() => navigate('/pricing')}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold uppercase tracking-tighter transition-all"
                        >
                            Ver Planos
                        </button>
                    </div>

                    <p className="text-xs text-gray-600 mt-6">
                        Redirecionando para pricing em 5 segundos...
                    </p>
                </div>
            </motion.div>
        </div>
    );
};

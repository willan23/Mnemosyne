import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface PaywallProps {
    isOpen: boolean;
    onClose: () => void;
    feature: string;
    description: string;
}

/**
 * Paywall Modal Component
 * Blocks access to Pro/Business features for Free tier users
 */
export const Paywall: React.FC<PaywallProps> = ({
    isOpen,
    onClose,
    feature,
    description
}) => {
    const navigate = useNavigate();

    const handleUpgrade = () => {
        navigate('/pricing');
        onClose();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/80 backdrop-blur-md"
                    />

                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        className="relative w-full max-w-md glass-card overflow-hidden"
                    >
                        {/* Header */}
                        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-indigo-500/10 to-purple-500/10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                                    <Lock className="w-5 h-5 text-indigo-400" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold glow-text">
                                        Feature Pro
                                    </h2>
                                    <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                                        Upgrade Necessário
                                    </p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-6">
                            {/* Feature Info */}
                            <div className="text-center">
                                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center">
                                    <Zap className="w-8 h-8 text-indigo-400" />
                                </div>
                                <h3 className="text-lg font-bold mb-2">{feature}</h3>
                                <p className="text-sm text-gray-400">
                                    {description}
                                </p>
                            </div>

                            {/* Benefits */}
                            <div className="glass-card p-4 space-y-2">
                                <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">
                                    Com o Plano Pro você também ganha:
                                </p>
                                <ul className="space-y-2 text-sm">
                                    <li className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                                        <span>Memórias ilimitadas</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                                        <span>50GB de armazenamento</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                                        <span>Compartilhamento privado</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                                        <span>Notificações em tempo real</span>
                                    </li>
                                </ul>
                            </div>

                            {/* CTA */}
                            <div className="space-y-3">
                                <button
                                    onClick={handleUpgrade}
                                    className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 rounded-lg font-bold uppercase tracking-tighter transition-all shadow-lg shadow-indigo-500/20"
                                >
                                    Upgrade para Pro - €9.99/mês
                                </button>
                                <button
                                    onClick={onClose}
                                    className="w-full py-2 text-gray-400 hover:text-white transition-colors text-sm"
                                >
                                    Continuar com Free
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

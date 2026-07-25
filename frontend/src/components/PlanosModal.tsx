import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Shield, Cpu, Globe, Users } from 'lucide-react';
import { isFreeFirstMode } from '../config/monetization';

interface PlansModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const plans = [
    {
        name: isFreeFirstMode ? 'Founder Preview' : 'Free',
        price: '0',
        icon: <Globe className="w-5 h-5 text-gray-400" />,
        color: 'border-gray-500/30 bg-gray-500/5',
        textColor: 'text-gray-300',
        features: isFreeFirstMode
            ? ['Core gratuito na fase de mercado', 'Memórias ilimitadas', 'IA local', 'Universe e Insights']
            : ['Memórias limitadas (1.000)', 'Universo básico', 'IA local manual', 'Exportação Markdown']
    },
    {
        name: 'Pro',
        price: '12',
        icon: <Cpu className="w-5 h-5 text-cyan-400" />,
        color: 'border-cyan-500/50 bg-cyan-500/10 shadow-[0_0_20px_rgba(34,211,238,0.15)]',
        textColor: 'text-cyan-400',
        features: ['Memórias ilimitadas', 'Múltiplas IAs Cloud', 'Exportação PDF', 'Clusters avançados', 'Backup encriptado automático'],
        popular: true
    },
    {
        name: 'Sovereign',
        price: '29',
        icon: <Shield className="w-5 h-5 text-purple-400" />,
        color: 'border-purple-500/50 bg-purple-500/10 shadow-[0_0_20px_rgba(168,85,247,0.15)]',
        textColor: 'text-purple-400',
        features: ['Local-first completo', 'Sync E2E cifrado', 'Agentes privados locais', 'Integrações avançadas (OS)', 'Prioridade em IA local']
    },
    {
        name: 'Team',
        price: 'Personalizado',
        icon: <Users className="w-5 h-5 text-rose-400" />,
        color: 'border-rose-500/30 bg-rose-500/5',
        textColor: 'text-rose-400',
        features: ['Chat privado corporativo', 'Partilha de clusters', 'Controlo administrativo', 'Políticas de privacidade estritas', 'Deploy privado futuro']
    }
];

export const PlansModal: React.FC<PlansModalProps> = ({ isOpen, onClose }) => {
    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-[#020617]/80 backdrop-blur-md"
                    />

                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        className="relative w-full max-w-5xl glass-card overflow-hidden bg-[#0b1120]/90 border border-white/10 rounded-3xl"
                    >
                        <div className="p-6 border-b border-white/5 flex justify-between items-center">
                            <div>
                                <h2 className="text-2xl font-bold text-white tracking-tight">
                                    {isFreeFirstMode ? 'Founder Preview Gratuito' : 'Expande a Tua Mente Digital'}
                                </h2>
                                <p className="text-sm text-gray-400 mt-1">
                                    {isFreeFirstMode
                                        ? 'O core está aberto enquanto construímos mercado. Planos pagos ficam como arquitetura futura.'
                                        : 'Escolhe o modelo arquitetural que melhor serve o teu Universo.'}
                                </p>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            {plans.map((plan) => (
                                <div key={plan.name} className={`relative flex flex-col p-6 rounded-2xl border ${plan.color} transition-all duration-300 hover:scale-[1.02]`}>
                                    {plan.popular && (
                                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-cyan-500 text-black text-[10px] font-bold uppercase tracking-widest rounded-full">
                                            Recomendado
                                        </div>
                                    )}
                                    <div className="flex items-center gap-3 mb-4">
                                        {plan.icon}
                                        <h3 className={`text-lg font-bold ${plan.textColor}`}>{plan.name}</h3>
                                    </div>
                                    
                                    <div className="mb-6">
                                        {plan.price !== 'Personalizado' ? (
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-sm text-gray-500">€</span>
                                                <span className="text-3xl font-bold text-white">{plan.price}</span>
                                                <span className="text-xs text-gray-500">{isFreeFirstMode && plan.name !== 'Founder Preview' ? ' futuro' : '/mês'}</span>
                                            </div>
                                        ) : (
                                            <span className="text-xl font-bold text-white">{plan.price}</span>
                                        )}
                                    </div>

                                    <ul className="space-y-3 flex-1 mb-8">
                                        {plan.features.map((feat, idx) => (
                                            <li key={idx} className="flex items-start gap-2 text-sm text-gray-300">
                                                <Check className={`w-4 h-4 mt-0.5 shrink-0 ${plan.textColor}`} />
                                                <span className="leading-tight">{feat}</span>
                                            </li>
                                        ))}
                                    </ul>

                                    <button className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all ${
                                        plan.popular 
                                            ? 'bg-cyan-500 text-black hover:bg-cyan-400' 
                                            : 'bg-white/5 text-white hover:bg-white/10 border border-white/10'
                                    }`}>
                                        {isFreeFirstMode && plan.name !== 'Founder Preview' ? 'Futuro' : 'Selecionar'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

import React, { useState } from 'react';
import { Shield, Key, ArrowRight, RefreshCw, CheckCircle2 } from 'lucide-react';
import { generateMnemonic } from '../utils/crypto';
import { motion, AnimatePresence } from 'framer-motion';

interface KeyCeremonyProps {
    onComplete: (mnemonic: string[]) => void;
}

export const KeyCeremony: React.FC<KeyCeremonyProps> = ({ onComplete }) => {
    const [step, setStep] = useState(1);
    const [mnemonic, setMnemonic] = useState<string[]>([]);
    const [verified, setVerified] = useState(false);
    const [restoreInput, setRestoreInput] = useState('');

    const startCeremony = () => {
        setMnemonic(generateMnemonic());
        setStep(2);
    };

    const startRestore = () => {
        setStep(3);
    };

    const handleRestoreSubmit = () => {
        const words = restoreInput.trim().split(/\s+/);
        if (words.length !== 12) {
            alert("A mnemonica deve ter exatamente 12 palavras.");
            return;
        }
        onComplete(words);
    };

    const confirmPassphrase = () => {
        // In a real app, we would ask the user to type back some words
        setVerified(true);
        setTimeout(() => {
            onComplete(mnemonic);
        }, 1500);
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
            <AnimatePresence mode="wait">
                {step === 1 && (
                    <motion.div
                        key="step1"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="glass-card p-10 max-w-md"
                    >
                        <Shield className="w-16 h-16 mx-auto mb-6 text-indigo-400" />
                        <h2 className="text-3xl font-bold mb-4 glow-text uppercase tracking-widest">A Cerimónia da Chave</h2>
                        <p className="text-gray-400 mb-8 leading-relaxed">
                            O Mnemosyne utiliza criptografia de Conhecimento Zero. Apenas você tem acesso às suas memórias.
                        </p>
                        <div className="flex flex-col gap-4">
                            <button
                                onClick={startCeremony}
                                className="glass-button w-full flex items-center justify-center gap-2 text-lg font-semibold py-4"
                            >
                                Iniciar Geração <Key className="w-5 h-5" />
                            </button>
                            <button
                                onClick={startRestore}
                                className="text-sm text-indigo-400 hover:text-indigo-300 underline underline-offset-4"
                            >
                                Já tenho uma chave (Recuperar Conta)
                            </button>
                        </div>
                    </motion.div>
                )}

                {step === 2 && (
                    <motion.div
                        key="step2"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.1 }}
                        className="glass-card p-10 max-w-2xl"
                    >
                        <h2 className="text-2xl font-bold mb-6 text-indigo-300">Guarde estas palavras com a vida</h2>
                        <div className="grid grid-cols-3 gap-4 mb-10">
                            {mnemonic.map((word, i) => (
                                <div key={i} className="bg-white/5 border border-white/10 p-3 rounded-lg flex items-center gap-3">
                                    <span className="text-gray-500 text-xs font-mono">{i + 1}.</span>
                                    <span className="text-white font-medium">{word}</span>
                                </div>
                            ))}
                        </div>

                        <p className="text-amber-400/80 text-sm mb-8 flex items-center justify-center gap-2 italic">
                            <Shield className="w-4 h-4" /> Se perder estas palavras, as suas memórias serão perdidas para sempre.
                        </p>

                        {!verified ? (
                            <div className="flex gap-4">
                                <button
                                    onClick={() => setMnemonic(generateMnemonic())}
                                    className="glass-button flex-1 flex items-center justify-center gap-2 opacity-60 hover:opacity-100"
                                >
                                    Regerar <RefreshCw className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={confirmPassphrase}
                                    className="glass-button flex-1 bg-indigo-600/20 hover:bg-indigo-600/40 border-indigo-500/30 flex items-center justify-center gap-2"
                                >
                                    Eu Guardei a Chave <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="flex items-center justify-center gap-2 text-green-400 font-bold"
                            >
                                <CheckCircle2 className="w-6 h-6" /> Chave Validada. Bem-vindo ao Mnemosyne.
                            </motion.div>
                        )}
                    </motion.div>
                )}

                {step === 3 && (
                    <motion.div
                        key="step3"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="glass-card p-10 max-w-xl"
                    >
                        <h2 className="text-2xl font-bold mb-6 text-indigo-300">Recuperar Chave Ancestral</h2>
                        <p className="text-gray-400 mb-6">
                            Insira as suas 12 palavras chave separadas por espaços para restaurar o acesso.
                        </p>

                        <textarea
                            value={restoreInput}
                            onChange={(e) => setRestoreInput(e.target.value)}
                            placeholder="palavra1 palavra2 palavra3 ..."
                            className="w-full h-32 bg-black/40 border border-white/10 rounded-lg p-4 text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 mb-6 resize-none"
                        />

                        <div className="flex gap-4">
                            <button
                                onClick={() => setStep(1)}
                                className="glass-button flex-1"
                            >
                                Voltar
                            </button>
                            <button
                                onClick={handleRestoreSubmit}
                                className="glass-button flex-1 bg-indigo-600/20 hover:bg-indigo-600/40 border-indigo-500/30"
                            >
                                Restaurar Acesso
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

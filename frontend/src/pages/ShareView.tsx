import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Brain, Clock, AlertCircle, Download } from 'lucide-react';
import { db } from '../firebase';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';

export const ShareView: React.FC = () => {
    const { shareId } = useParams<{ shareId: string }>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [share, setShare] = useState<any | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadShare = async () => {
            if (!shareId) {
                setError("Link inválido");
                setLoading(false);
                return;
            }

            try {
                const shareDoc = await getDoc(doc(db, "shares", shareId));

                if (!shareDoc.exists()) {
                    setError("Esta memória não existe ou foi removida.");
                    setLoading(false);
                    return;
                }

                const data = shareDoc.data();

                // Verificar expiração
                if (data.expiresAt && data.expiresAt < Date.now()) {
                    setError("Este link expirou.");
                    setLoading(false);
                    return;
                }

                // Incrementar visualizações
                await updateDoc(doc(db, "shares", shareId), {
                    views: increment(1)
                });

                setShare(data);
            } catch (e) {
                console.error("Erro ao carregar memória:", e);
                setError("Erro ao carregar a memória.");
            } finally {
                setLoading(false);
            }
        };

        loadShare();
    }, [shareId]);

    const downloadAsFile = () => {
        if (!share) return;

        const blob = new Blob([share.text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `memoria-compartilhada.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
                <motion.div
                    animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="w-12 h-12 rounded-full bg-indigo-500/20"
                />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] flex items-center justify-center p-4">
                <div className="fixed inset-0 pointer-events-none">
                    <div className="absolute top-[10%] left-[20%] w-[40vw] h-[40vw] bg-indigo-600/5 rounded-full blur-[120px]" />
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative z-10 glass-card p-8 max-w-md text-center"
                >
                    <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold mb-2">{error}</h1>
                    <p className="text-gray-500 text-sm mb-6">
                        O link pode ter expirado ou a memória foi removida.
                    </p>
                    <button
                        onClick={() => navigate('/')}
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-bold uppercase tracking-tighter transition-all"
                    >
                        Ir para Mnemosyne
                    </button>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-[#ededed]">
            {/* Background decoration */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-[10%] left-[20%] w-[40vw] h-[40vw] bg-indigo-600/5 rounded-full blur-[120px]" />
                <div className="absolute bottom-[20%] right-[10%] w-[30vw] h-[30vw] bg-purple-600/5 rounded-full blur-[100px]" />
            </div>

            <div className="relative z-10 p-8 max-w-4xl mx-auto">
                {/* Header */}
                <motion.header
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex justify-between items-center mb-12"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 glass-card flex items-center justify-center">
                            <Brain className="w-6 h-6 text-indigo-400" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tighter glow-text">MNEMOSYNE</h1>
                    </div>
                    <button
                        onClick={() => navigate('/')}
                        className="glass-button text-sm"
                    >
                        Criar Minha Conta
                    </button>
                </motion.header>

                {/* Content */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="glass-card p-8"
                >
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <h2 className="text-xl font-bold text-indigo-300 mb-2">Memória Compartilhada</h2>
                            <div className="flex items-center gap-4 text-xs text-gray-500">
                                <div className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {new Date(share.createdAt).toLocaleDateString('pt-PT', {
                                        day: '2-digit',
                                        month: 'long',
                                        year: 'numeric'
                                    })}
                                </div>
                                {share.expiresAt && (
                                    <span>
                                        Expira: {new Date(share.expiresAt).toLocaleDateString('pt-PT')}
                                    </span>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={downloadAsFile}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600/20 hover:bg-green-600/30 text-green-300 rounded-lg text-xs font-bold uppercase tracking-tighter transition-all"
                        >
                            <Download className="w-4 h-4" /> Baixar
                        </button>
                    </div>

                    <div className="prose prose-invert max-w-none">
                        <p className="text-lg leading-relaxed text-indigo-100 whitespace-pre-wrap">
                            {share.text}
                        </p>
                    </div>

                    <div className="mt-8 pt-6 border-t border-white/5">
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-600">
                                Compartilhado via <span className="text-indigo-400 font-bold">Mnemosyne</span>
                            </p>
                            <p className="text-[10px] text-gray-700">
                                {share.views} visualizações
                            </p>
                        </div>
                    </div>
                </motion.div>

                {/* CTA */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="mt-8 text-center"
                >
                    <p className="text-gray-500 text-sm mb-4">
                        Gostou? Crie suas próprias memórias com criptografia E2EE
                    </p>
                    <button
                        onClick={() => navigate('/')}
                        className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-bold uppercase tracking-tighter shadow-lg shadow-indigo-500/20 transition-all"
                    >
                        Começar Gratuitamente
                    </button>
                </motion.div>
            </div>
        </div>
    );
};

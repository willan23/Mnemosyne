import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Link as LinkIcon, Download, Copy, Check, Clock } from 'lucide-react';
import { db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { downloadMemory } from '../utils/export';

interface ShareModalProps {
    session: any | null;
    onClose: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({ session, onClose }) => {
    const [shareLink, setShareLink] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [copied, setCopied] = useState(false);
    const [expirationDays, setExpirationDays] = useState<number>(7);

    const generateShareLink = async () => {
        if (!session) return;
        setIsGenerating(true);

        try {
            const expiresAt = expirationDays > 0
                ? Date.now() + (expirationDays * 24 * 60 * 60 * 1000)
                : null;

            const shareDoc = await addDoc(collection(db, "shares"), {
                sessionId: session.id,
                text: session.text,
                createdAt: Date.now(),
                expiresAt,
                views: 0
            });

            const link = `${window.location.origin}/share/${shareDoc.id}`;
            setShareLink(link);
        } catch (e) {
            console.error("Erro ao gerar link:", e);
            alert("Erro ao gerar link de compartilhamento.");
        } finally {
            setIsGenerating(false);
        }
    };

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            console.error("Erro ao copiar:", e);
        }
    };

    return (
        <AnimatePresence>
            {session && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
                        className="relative w-full max-w-lg glass-card overflow-hidden"
                    >
                        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                                    <LinkIcon className="w-5 h-5 text-indigo-400" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold glow-text">Compartilhar Memória</h2>
                                    <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                                        Escolha como deseja compartilhar
                                    </p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            {/* Opção 1: Link Público */}
                            <div className="glass-card p-4 space-y-3">
                                <div className="flex items-center gap-3">
                                    <LinkIcon className="w-5 h-5 text-indigo-400" />
                                    <div className="flex-1">
                                        <h3 className="text-sm font-bold text-indigo-300">Link Público</h3>
                                        <p className="text-[10px] text-gray-500">Qualquer pessoa com o link pode ver</p>
                                    </div>
                                </div>

                                {!shareLink ? (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <Clock className="w-4 h-4 text-gray-500" />
                                            <span className="text-xs text-gray-400">Expira em:</span>
                                            <select
                                                value={expirationDays}
                                                onChange={(e) => setExpirationDays(Number(e.target.value))}
                                                className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-indigo-200 focus:ring-1 focus:ring-indigo-500"
                                            >
                                                <option value={1}>1 dia</option>
                                                <option value={7}>7 dias</option>
                                                <option value={30}>30 dias</option>
                                                <option value={0}>Nunca</option>
                                            </select>
                                        </div>
                                        <button
                                            onClick={generateShareLink}
                                            disabled={isGenerating}
                                            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-bold uppercase tracking-tighter transition-all"
                                        >
                                            {isGenerating ? "Gerando..." : "Gerar Link"}
                                        </button>
                                    </>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 p-2 bg-black/40 rounded border border-white/10">
                                            <input
                                                type="text"
                                                value={shareLink}
                                                readOnly
                                                className="flex-1 bg-transparent border-none text-xs text-indigo-200 focus:ring-0"
                                            />
                                            <button
                                                onClick={() => copyToClipboard(shareLink)}
                                                className="p-2 hover:bg-white/10 rounded transition-colors"
                                            >
                                                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
                                            </button>
                                        </div>
                                        <p className="text-[10px] text-gray-500 italic">
                                            {expirationDays > 0 ? `Link expira em ${expirationDays} dia(s)` : "Link permanente"}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Opção 2: Copiar Texto */}
                            <div className="glass-card p-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Copy className="w-5 h-5 text-purple-400" />
                                        <div>
                                            <h3 className="text-sm font-bold text-purple-300">Copiar Texto</h3>
                                            <p className="text-[10px] text-gray-500">Copiar para área de transferência</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => copyToClipboard(session.text)}
                                        className="px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded-lg text-xs font-bold uppercase tracking-tighter transition-all"
                                    >
                                        {copied ? "Copiado!" : "Copiar"}
                                    </button>
                                </div>
                            </div>

                            {/* Opção 3: Exportar Arquivo */}
                            <div className="glass-card p-4">
                                <div className="flex items-center gap-3 mb-3">
                                    <Download className="w-5 h-5 text-green-400" />
                                    <div>
                                        <h3 className="text-sm font-bold text-green-300">Exportar Arquivo</h3>
                                        <p className="text-[10px] text-gray-500">Baixar em diferentes formatos</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <button
                                        onClick={() => downloadMemory(session, 'txt')}
                                        className="px-3 py-2 bg-green-600/20 hover:bg-green-600/30 text-green-300 rounded-lg text-xs font-bold uppercase tracking-tighter transition-all"
                                    >
                                        TXT
                                    </button>
                                    <button
                                        onClick={() => downloadMemory(session, 'md')}
                                        className="px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded-lg text-xs font-bold uppercase tracking-tighter transition-all"
                                    >
                                        MD
                                    </button>
                                    <button
                                        onClick={() => downloadMemory(session, 'json')}
                                        className="px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded-lg text-xs font-bold uppercase tracking-tighter transition-all"
                                    >
                                        JSON
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 bg-black/40 border-t border-white/5">
                            <p className="text-[10px] text-gray-600 text-center">
                                💡 Dica: Compartilhe memórias para convidar amigos a usar o Mnemosyne
                            </p>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, Trash2, BookOpen, Share2 } from 'lucide-react';
import { db } from '../firebase';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ShareModal } from './ShareModal';
import { TagManager } from './TagManager';
import { AttachmentUploader } from './AttachmentUploader';
import type { Attachment } from './AttachmentUploader';

interface MemoryEditorModalProps {
    session: any | null;
    onClose: () => void;
}

export const MemoryEditorModal: React.FC<MemoryEditorModalProps> = ({ session, onClose }) => {
    const [text, setText] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [category, setCategory] = useState('');
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);

    useEffect(() => {
        if (session) {
            setText(session.text || '');
            setTags(session.tags || []);
            setCategory(session.category || '');
            setAttachments(session.attachments || []);
        }
    }, [session]);

    const handleSave = async () => {
        if (!session || !text.trim()) return;
        setIsSaving(true);
        try {
            await updateDoc(doc(db, "sessions", session.id), {
                text: text.trim(),
                tags,
                category: category.trim() || null,
                attachments,
                updatedAt: Date.now()
            });
            onClose();
        } catch (e) {
            console.error("Erro ao atualizar sessão:", e);
            alert("Erro ao guardar as alterações.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!session) return;
        if (!confirm("Tem certeza que deseja eliminar esta memória?")) return;

        try {
            // Check if user is authenticated
            const { auth } = await import('../firebase');
            if (!auth.currentUser) {
                alert("Erro: Você precisa estar autenticado para eliminar memórias.");
                return;
            }

            // Check if user owns this memory
            if (session.uid && session.uid !== auth.currentUser.uid && session.uid !== "anon") {
                alert("Erro: Você não tem permissão para eliminar esta memória.");
                return;
            }

            await deleteDoc(doc(db, "sessions", session.id));
            onClose();
        } catch (e: any) {
            console.error("Erro ao eliminar sessão:", e);

            // More specific error messages
            if (e.code === 'permission-denied') {
                alert("Erro de permissão: Você não tem autorização para eliminar esta memória.");
            } else if (e.code === 'not-found') {
                alert("Erro: Memória não encontrada. Pode já ter sido eliminada.");
            } else {
                alert(`Erro ao eliminar a memória: ${e.message || 'Erro desconhecido'}`);
            }
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
                        className="relative w-full max-w-3xl glass-card overflow-hidden flex flex-col max-h-[85vh]"
                    >
                        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                                    <BookOpen className="w-5 h-5 text-indigo-400" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold glow-text">Editar Crónica</h2>
                                    <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                                        {new Date(session.timestamp).toLocaleString()}
                                    </p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
                            {/* Text Editor */}
                            <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                                    Texto da Memória
                                </label>
                                <textarea
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    className="w-full h-48 bg-white/5 text-indigo-100 placeholder-gray-700 border border-white/10 rounded-lg p-4 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-base leading-relaxed font-light"
                                    placeholder="A sua memória está vazia..."
                                />
                            </div>

                            {/* Category */}
                            <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                                    Categoria
                                </label>
                                <input
                                    type="text"
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value)}
                                    className="w-full bg-white/5 text-indigo-100 placeholder-gray-700 border border-white/10 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                    placeholder="Ex: Trabalho, Pessoal, Estudos..."
                                />
                            </div>

                            {/* Tags */}
                            <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                                    Tags
                                </label>
                                <TagManager
                                    tags={tags}
                                    onChange={setTags}
                                    suggestions={[]}
                                />
                            </div>

                            {/* Attachments */}
                            <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                                    Anexos
                                </label>
                                <AttachmentUploader
                                    attachments={attachments}
                                    onChange={setAttachments}
                                />
                            </div>
                        </div>

                        <div className="p-4 bg-black/40 border-t border-white/5 flex justify-between items-center">
                            <button
                                onClick={() => setIsShareOpen(true)}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg text-indigo-500 hover:bg-indigo-500/10 transition-colors text-sm font-bold uppercase tracking-tighter"
                            >
                                <Share2 className="w-4 h-4" /> Compartilhar
                            </button>

                            <div className="flex gap-3">
                                <button
                                    onClick={handleDelete}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors text-sm font-bold uppercase tracking-tighter"
                                >
                                    <Trash2 className="w-4 h-4" /> Eliminar
                                </button>
                                <button
                                    onClick={onClose}
                                    className="px-6 py-2 rounded-lg text-gray-400 hover:text-white transition-colors text-sm font-bold uppercase tracking-tighter"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={isSaving || !text.trim()}
                                    className="flex items-center gap-2 px-8 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-bold uppercase tracking-tighter shadow-lg shadow-indigo-500/20"
                                >
                                    <Save className="w-4 h-4" /> {isSaving ? "Guardando..." : "Guardar"}
                                </button>
                            </div>
                        </div>
                    </motion.div>

                    {isShareOpen && (
                        <ShareModal
                            session={session}
                            onClose={() => setIsShareOpen(false)}
                        />
                    )}
                </div>
            )}
        </AnimatePresence>
    );
};

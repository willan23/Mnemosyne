import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, Trash2, BookOpen, Share2, Cpu, History, RotateCcw } from 'lucide-react';
import { auth, db } from '../firebase';
import { addDoc, arrayRemove, arrayUnion, collection, doc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore';
import { ShareModal } from './ShareModal';
import { TagManager } from './TagManager';
import { AttachmentUploader } from './AttachmentUploader';
import type { Attachment } from './AttachmentUploader';
import { RelatedMemories } from './RelatedMemories';
import { getLocalAiConfig } from '../services/localAiConfig';
import { resolveAiFailureDecision } from '../services/aiSavePolicy';
import { markMemoryDeleted } from '../services/memoryDeletion';
import { cognitiveEngine } from '../engines/CognitiveEngine';
import type { MemoryObject } from '../types/universe';
import type { SessionData } from '../hooks/useSessions';

interface MemoryEditorModalProps {
    session: SessionData | null;
    allMemories?: SessionData[]; // Todas as memórias para encontrar relacionadas
    onClose: () => void;
    onMemoryClick?: (memory: SessionData) => void; // Callback para navegar para memória relacionada
}

interface MemoryVersion {
    id: string;
    text: string;
    tags: string[];
    category: string | null;
    attachments: Attachment[];
    title?: string | null;
    embedding?: number[] | null;
    connections?: string[];
    semanticClusterId?: string | null;
    position?: [number, number, number] | null;
    importance?: number;
    celestialType?: string | null;
    processingMethod?: string | null;
    createdAt: number;
    previousUpdatedAt: number;
    editorUid: string;
}

export const MemoryEditorModal: React.FC<MemoryEditorModalProps> = ({
    session,
    allMemories = [],
    onClose,
    onMemoryClick
}) => {
    const [text, setText] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [category, setCategory] = useState('');
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [versions, setVersions] = useState<MemoryVersion[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [extractionStatus, setExtractionStatus] = useState<string | null>(null);
    const extractionAbortRef = useRef<AbortController | null>(null);

    const toMemoryObject = (memory: any): MemoryObject => ({
        id: memory.id,
        text: memory.text || '',
        title: memory.title,
        celestialType: memory.celestialType || 'planet',
        position: Array.isArray(memory.position) && memory.position.length === 3 ? memory.position : [0, 0, 0],
        embedding: Array.isArray(memory.embedding) ? memory.embedding : [],
        connections: Array.isArray(memory.connections) ? memory.connections : [],
        semanticClusterId: typeof memory.semanticClusterId === 'string' ? memory.semanticClusterId : undefined,
        importance: typeof memory.importance === 'number' ? memory.importance : 0.5,
        timestamp: memory.timestamp || 0,
        updatedAt: memory.updatedAt || memory.timestamp || 0,
        uid: memory.uid || session?.uid || '',
        tags: memory.tags,
        category: memory.category,
    });

    const handleExtract = async () => {
        if (isExtracting) return;
        const abortController = new AbortController();
        extractionAbortRef.current = abortController;
        setIsExtracting(true);
        setExtractionStatus('A ligar ao Ollama local...');
        const slowModelTimer = window.setTimeout(() => {
            setExtractionStatus('Modelo local ainda a responder. Podes continuar a aguardar ou cancelar.');
        }, 8000);

        try {
            const localAi = getLocalAiConfig();
            if (localAi.primaryProvider !== 'ollama') {
                throw new Error('A extração inline deste editor usa Ollama local. Seleciona Ollama no AI Hub ou usa o backend dedicado do Flow.');
            }
            if (!localAi.model) {
                throw new Error('Configura primeiro o modelo local em Definições > Inteligências.');
            }

            let ollamaRes: Response;
            try {
                ollamaRes = await fetch(`${localAi.host}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: localAi.model,
                        prompt: `Como um motor cognitivo avançado, analisa o seguinte documento ou fragmento e extrai um resumo denso e os 3 conceitos-chave. Responde em português claro e conciso.\n\nConteúdo:\n${text}`,
                        stream: true
                    }),
                    signal: abortController.signal,
                });
            } catch {
                if (abortController.signal.aborted) {
                    throw new DOMException('Extração cancelada.', 'AbortError');
                }
                throw new Error(`Não foi possível conectar ao Ollama em ${localAi.host}. Verifica o host nas definições.`);
            }

            if (!ollamaRes.ok) {
                throw new Error(`Ollama rejeitou o pedido para o modelo "${localAi.model}". Erro: ${ollamaRes.statusText}`);
            }

            const prefix = `\n\n---\n[EXTRAÇÃO OLLAMA (${localAi.model})]\n`;
            setText((prev) => prev + prefix);
            setExtractionStatus('A receber stream do modelo local...');

            if (!ollamaRes.body) {
                const data = await ollamaRes.json();
                setText((prev) => prev + (data.response || ''));
            } else {
                const reader = ollamaRes.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const parsed = JSON.parse(line) as { response?: string; done?: boolean };
                            if (parsed.response) {
                                setText((prev) => prev + parsed.response);
                            }
                            if (parsed.done) {
                                setExtractionStatus('Extração concluída.');
                            }
                        } catch (parseError) {
                            console.warn('Fragmento de stream Ollama ignorado:', parseError);
                        }
                    }
                }
            }

            setTags((prev) => [...new Set([...prev, 'extraido-ia'])]);
        } catch (error: any) {
            if (error?.name === 'AbortError') {
                setExtractionStatus('Extração cancelada.');
                return;
            }
            console.error('Erro de Extração Ollama:', error);
            const message = error instanceof Error ? error.message : 'Erro desconhecido.';
            setExtractionStatus(`Falha: ${message}`);
        } finally {
            window.clearTimeout(slowModelTimer);
            if (extractionAbortRef.current === abortController) {
                extractionAbortRef.current = null;
            }
            setIsExtracting(false);
        }
    };

    const cancelExtraction = () => {
        extractionAbortRef.current?.abort();
    };

    useEffect(() => {
        if (session) {
            extractionAbortRef.current?.abort();
            setText(session.text || '');
            setTags(session.tags || []);
            setCategory(session.category || '');
            setAttachments(session.attachments || []);
            setShowHistory(false);
            setVersions([]);
            setExtractionStatus(null);
        }
    }, [session]);

    useEffect(() => () => {
        extractionAbortRef.current?.abort();
    }, []);

    const loadHistory = async () => {
        if (!session) return;
        setIsLoadingHistory(true);
        try {
            const snapshot = await getDocs(query(
                collection(db, 'sessions', session.id, 'versions'),
                orderBy('createdAt', 'desc')
            ));
            setVersions(snapshot.docs.map((versionDoc) => ({
                id: versionDoc.id,
                ...versionDoc.data(),
            } as MemoryVersion)));
        } catch (error) {
            console.error('Erro ao carregar histórico:', error);
            alert('Não foi possível carregar o histórico desta memória.');
        } finally {
            setIsLoadingHistory(false);
        }
    };

    const toggleHistory = async () => {
        const next = !showHistory;
        setShowHistory(next);
        if (next && versions.length === 0) {
            await loadHistory();
        }
    };

    const restoreVersionToEditor = (version: MemoryVersion) => {
        setText(version.text || '');
        setTags(version.tags || []);
        setCategory(version.category || '');
        setAttachments(version.attachments || []);
        setShowHistory(false);
    };

    const createHistoryVersion = async () => {
        if (!session || !auth.currentUser) return;
        await addDoc(collection(db, 'sessions', session.id, 'versions'), {
            text: session.text || '',
            tags: session.tags || [],
            category: session.category || null,
            attachments: session.attachments || [],
            title: session.title || null,
            embedding: session.embedding || null,
            connections: Array.isArray(session.connections) ? session.connections : [],
            semanticClusterId: session.semanticClusterId || null,
            position: session.position || null,
            importance: session.importance || 0.5,
            celestialType: session.celestialType || null,
            processingMethod: session.processingMethod || null,
            previousUpdatedAt: session.updatedAt || session.timestamp || Date.now(),
            createdAt: Date.now(),
            editorUid: auth.currentUser.uid,
        });
    };

    const handleSave = async () => {
        if (!session || !text.trim()) return;
        setIsSaving(true);
        try {
            const localAi = getLocalAiConfig();
            const aiErrors: string[] = [];
            let cognitive: Awaited<ReturnType<typeof cognitiveEngine.processMemory>> | null = null;
            const previousConnections = Array.isArray(session.connections) ? session.connections : [];

            try {
                const existingMemories = allMemories
                    .filter((memory) => memory.id !== session.id)
                    .map(toMemoryObject);
                cognitive = await cognitiveEngine.processMemory(text.trim(), existingMemories);
            } catch (error) {
                console.warn('Unable to refresh semantic links for edited memory:', error);
                aiErrors.push(error instanceof Error ? `Embeddings locais: ${error.message}` : 'Embeddings locais indisponíveis.');
            }

            if (aiErrors.length > 0) {
                const summary = aiErrors.join('\n');
                const failureDecision = resolveAiFailureDecision(
                    localAi,
                    aiErrors,
                    () => confirm(`A IA configurada falhou:\n\n${summary}\n\nGuardar a edição sem atualizar ligações semânticas?`)
                );
                if (failureDecision === 'block-save') {
                    alert(`A política atual bloqueia guardar quando a IA configurada falha.\n\n${summary}`);
                    return;
                }
                if (failureDecision === 'skip-save') return;
            }

            await createHistoryVersion();

            await updateDoc(doc(db, "sessions", session.id), {
                text: text.trim(),
                title: cognitive ? cognitiveEngine.generateTitle(text.trim()) : (session.title || null),
                tags,
                category: category.trim() || null,
                attachments,
                updatedAt: Date.now(),
                embedding: cognitive?.embedding || session.embedding || null,
                connections: cognitive?.connections || previousConnections,
                semanticClusterId: cognitive?.semanticClusterId || session.semanticClusterId || null,
                position: cognitive?.position || session.position || null,
                importance: cognitive?.importance || session.importance || 0.5,
                celestialType: cognitive?.celestialType || session.celestialType || null,
                processingMethod: cognitive ? 'edited+local-embedding' : (session.processingMethod || 'edited')
            });

            if (cognitive) {
                const nextConnections = cognitive.connections;
                const added = nextConnections.filter((id) => !previousConnections.includes(id));
                const removed = previousConnections.filter((id: string) => !nextConnections.includes(id));

                await Promise.all([
                    ...added.map((memoryId) => updateDoc(doc(db, 'sessions', memoryId), {
                        connections: arrayUnion(session.id),
                        updatedAt: Date.now(),
                    }).catch((error) => console.warn('Unable to add semantic backlink', memoryId, error))),
                    ...removed.map((memoryId: string) => updateDoc(doc(db, 'sessions', memoryId), {
                        connections: arrayRemove(session.id),
                        updatedAt: Date.now(),
                    }).catch((error) => console.warn('Unable to remove stale semantic backlink', memoryId, error))),
                ]);
            }
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
            if (!auth.currentUser) {
                alert("Erro: Você precisa estar autenticado para eliminar memórias.");
                return;
            }

            // Check if user owns this memory
            if (session.uid && session.uid !== auth.currentUser.uid && session.uid !== "anon") {
                alert("Erro: Você não tem permissão para eliminar esta memória.");
                return;
            }

            await markMemoryDeleted(session.id);
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

                            {/* Related Memories - AI-powered semantic linking */}
                            {allMemories.length > 0 && session && (
                                <RelatedMemories
                                    currentMemory={toMemoryObject(session)}
                                    allMemories={allMemories.map(toMemoryObject)}
                                    onMemoryClick={(memory) => {
                                        if (onMemoryClick) {
                                            onMemoryClick(memory);
                                        }
                                    }}
                                />
                            )}
                        </div>

                        <div className="p-4 bg-black/40 border-t border-white/5 flex justify-between items-center">
                            <button
                                onClick={() => setIsShareOpen(true)}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg text-indigo-500 hover:bg-indigo-500/10 transition-colors text-sm font-bold uppercase tracking-tighter"
                            >
                                <Share2 className="w-4 h-4" /> Compartilhar
                            </button>

                            <button
                                onClick={toggleHistory}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg text-violet-400 hover:bg-violet-500/10 transition-colors text-sm font-bold uppercase tracking-tighter border border-violet-500/20"
                            >
                                <History className="w-4 h-4" /> Histórico
                            </button>

                            {text.trim().length > 0 && (
                                <div className="flex flex-col items-start gap-1">
                                    <button
                                        onClick={isExtracting ? cancelExtraction : handleExtract}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm font-bold uppercase tracking-tighter border ${
                                            isExtracting
                                                ? 'text-amber-300 hover:bg-amber-400/10 border-amber-400/20'
                                                : 'text-cyan-400 hover:bg-cyan-400/10 border-cyan-400/20'
                                        }`}
                                    >
                                        {isExtracting ? (
                                            <div className="w-4 h-4 border-2 border-amber-400/30 border-t-amber-300 rounded-full animate-spin" />
                                        ) : (
                                            <Cpu className="w-4 h-4" />
                                        )}
                                        {isExtracting ? 'Cancelar IA' : 'Extrair (Ollama Local)'}
                                    </button>
                                    {extractionStatus && (
                                        <span className="max-w-[220px] text-[10px] text-cyan-200/60">
                                            {extractionStatus}
                                        </span>
                                    )}
                                </div>
                            )}

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

                        <AnimatePresence>
                            {showHistory && (
                                <motion.div
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 12 }}
                                    className="absolute inset-x-4 bottom-20 max-h-[45vh] overflow-hidden rounded-2xl border border-violet-500/20 bg-[#050816]/95 shadow-[0_0_40px_rgba(139,92,246,0.2)] backdrop-blur-xl"
                                >
                                    <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                                        <div>
                                            <h3 className="text-sm font-bold uppercase tracking-widest text-violet-200">Time Travel</h3>
                                            <p className="text-[11px] text-violet-300/60">Snapshots guardados antes de cada edição.</p>
                                        </div>
                                        <button
                                            onClick={() => setShowHistory(false)}
                                            className="rounded-full p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>

                                    <div className="max-h-[34vh] space-y-3 overflow-y-auto p-4 custom-scrollbar">
                                        {isLoadingHistory ? (
                                            <div className="py-10 text-center text-xs uppercase tracking-widest text-violet-300/70">
                                                A carregar versões...
                                            </div>
                                        ) : versions.length === 0 ? (
                                            <div className="py-10 text-center text-sm text-gray-400">
                                                Ainda não há versões antigas para esta memória.
                                            </div>
                                        ) : (
                                            versions.map((version) => (
                                                <div key={version.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                                    <div className="mb-3 flex items-center justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-xs font-bold uppercase tracking-widest text-violet-200">
                                                                {new Date(version.createdAt).toLocaleString()}
                                                            </p>
                                                            <p className="text-[10px] text-gray-500">
                                                                Editor: {version.editorUid.slice(0, 10)}...
                                                            </p>
                                                        </div>
                                                        <button
                                                            onClick={() => restoreVersionToEditor(version)}
                                                            className="flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-cyan-200 transition-colors hover:bg-cyan-500/20"
                                                        >
                                                            <RotateCcw className="h-3.5 w-3.5" />
                                                            Restaurar
                                                        </button>
                                                    </div>
                                                    <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-indigo-100/80">
                                                        {version.text}
                                                    </p>
                                                    {version.tags?.length > 0 && (
                                                        <div className="mt-3 flex flex-wrap gap-2">
                                                            {version.tags.slice(0, 6).map((tag) => (
                                                                <span key={tag} className="rounded-full bg-violet-500/10 px-2 py-1 text-[10px] text-violet-200">
                                                                    {tag}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
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

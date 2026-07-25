import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link2, Sparkles, Loader2 } from 'lucide-react';
import { embeddingService } from '../services/embeddingService';
import type { MemoryObject } from '../types/universe';

interface RelatedMemoriesProps {
    currentMemory: MemoryObject;
    allMemories: MemoryObject[];
    onMemoryClick: (memory: MemoryObject) => void;
}

/**
 * Componente que exibe memórias relacionadas semanticamente
 * Usa AI local para encontrar conexões sem enviar dados para cloud
 */
export const RelatedMemories: React.FC<RelatedMemoriesProps> = ({
    currentMemory,
    allMemories,
    onMemoryClick
}) => {
    const [relatedMemories, setRelatedMemories] = useState<Array<{ memory: MemoryObject; similarity: number }>>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (currentMemory && currentMemory.text) {
            findRelated();
        }
    }, [currentMemory.id]);

    const findRelated = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const similar = await embeddingService.findSimilarMemories(
                currentMemory,
                allMemories,
                0.6, // Threshold de similaridade
                5    // Máximo de resultados
            );
            setRelatedMemories(similar);
        } catch (err) {
            console.error('Erro ao encontrar memórias relacionadas:', err);
            setError('Erro ao analisar conexões');
        } finally {
            setIsLoading(false);
        }
    };

    // Não mostrar se não houver memórias relacionadas
    if (relatedMemories.length === 0 && !isLoading && !error) {
        return null;
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-4 mt-4 border-indigo-500/20"
        >
            <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">
                    Memórias Relacionadas
                </h3>
                {isLoading && (
                    <Loader2 className="w-4 h-4 text-indigo-400 animate-spin ml-auto" />
                )}
            </div>

            {error && (
                <div className="text-xs text-red-400 italic mb-2">
                    {error}
                </div>
            )}

            {isLoading && relatedMemories.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 italic py-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Analisando conexões semânticas...
                </div>
            ) : (
                <AnimatePresence mode="popLayout">
                    <div className="space-y-2">
                        {relatedMemories.map(({ memory, similarity }, index) => (
                            <motion.div
                                key={memory.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 10 }}
                                transition={{ delay: index * 0.05 }}
                                onClick={() => onMemoryClick(memory)}
                                className="p-3 bg-white/5 rounded-lg border border-white/5 hover:border-indigo-500/30 hover:bg-white/10 transition-all cursor-pointer group"
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Link2 className="w-3 h-3 text-indigo-400 shrink-0" />
                                        <div className="flex items-center gap-2">
                                            {/* Barra de similaridade visual */}
                                            <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                <motion.div
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${similarity * 100}%` }}
                                                    transition={{ duration: 0.5, delay: index * 0.05 }}
                                                    className={`h-full ${similarity > 0.8 ? 'bg-green-500' :
                                                            similarity > 0.7 ? 'bg-indigo-500' :
                                                                'bg-purple-500'
                                                        }`}
                                                />
                                            </div>
                                            <span className="text-xs font-medium text-indigo-300 group-hover:text-indigo-200">
                                                {Math.round(similarity * 100)}%
                                            </span>
                                        </div>
                                    </div>
                                    <span className="text-[10px] text-gray-500">
                                        {new Date(memory.timestamp).toLocaleDateString('pt-PT', {
                                            day: '2-digit',
                                            month: 'short'
                                        })}
                                    </span>
                                </div>

                                <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
                                    {memory.text}
                                </p>

                                {/* Tags da memória relacionada */}
                                {memory.tags && memory.tags.length > 0 && (
                                    <div className="flex gap-1 mt-2 flex-wrap">
                                        {memory.tags.slice(0, 3).map((tag: string) => (
                                            <span
                                                key={tag}
                                                className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        ))}
                    </div>
                </AnimatePresence>
            )}

            {/* Info sobre a tecnologia */}
            <div className="mt-3 pt-3 border-t border-white/5">
                <p className="text-[10px] text-gray-600 italic flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Análise semântica 100% local com AI - seus dados nunca saem do navegador
                </p>
            </div>
        </motion.div>
    );
};

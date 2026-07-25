import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Loader2, Send, X, Sparkles } from 'lucide-react';
import { useUniverseStore } from '../../store/universeStore';
import { cognitiveEngine } from '../../engines/CognitiveEngine';
import type { MemoryObject } from '../../types/universe';
import { v4 as uuidv4 } from 'uuid';
import { auth } from '../../firebase';
import toast from 'react-hot-toast';

const PLACEHOLDERS = [
  'No que estás a pensar?',
  'Captura um conceito, ideia ou memória…',
  'Que insight te surgiu hoje?',
  'O que queres lembrar no universo?',
  'Escreve um pensamento e lança-o no espaço…',
];

interface MemoryInputPanelProps {
  onSave?: (memory: MemoryObject) => void | Promise<void>;
}

export const MemoryInputPanel: React.FC<MemoryInputPanelProps> = ({ onSave }) => {
  const [text, setText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const placeholderIndex = useRef(Math.floor(Math.random() * PLACEHOLDERS.length));

  const { addMemory, memories, embeddingReady, setIsLoading, selectMemory } = useUniverseStore();

  useEffect(() => {
    if (!isOpen) return;
    const id = window.setTimeout(() => textareaRef.current?.focus(), 100);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  const handleSubmit = useCallback(async () => {
    const content = text.trim();
    if (!content || isProcessing) return;

    setIsProcessing(true);
    setIsLoading(true);

    try {
      const result = await cognitiveEngine.processMemory(content, memories);
      const title = cognitiveEngine.generateTitle(content);
      const uid = auth.currentUser?.uid ?? 'anonymous';

      const newMemory: MemoryObject = {
        id: uuidv4(),
        text: content,
        title,
        celestialType: result.celestialType,
        position: result.position,
        embedding: result.embedding,
        connections: result.connections,
        semanticClusterId: result.semanticClusterId,
        importance: result.importance,
        timestamp: Date.now(),
        updatedAt: Date.now(),
        uid,
        scale: 1,
      };

      addMemory(newMemory);
      await onSave?.(newMemory);
      selectMemory(newMemory.id);
      setText('');
      setIsOpen(false);

      const links = result.connections.length;
      toast.success(
        links > 0
          ? `Memória lançada · ${links} ligação${links === 1 ? '' : 'ões'}`
          : 'Memória lançada no universo',
        { icon: '✦', duration: 3200 }
      );
    } catch (err) {
      console.error('Failed to process memory:', err);
      toast.error('Não foi possível processar a memória. Tenta de novo.');
    } finally {
      setIsProcessing(false);
      setIsLoading(false);
    }
  }, [text, isProcessing, memories, addMemory, setIsLoading, onSave, selectMemory]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleSubmit();
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    },
    [handleSubmit]
  );

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="pointer-events-auto absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
      <AnimatePresence mode="wait">
        {!isOpen ? (
          <motion.button
            key="open-btn"
            type="button"
            initial={{ opacity: 0, scale: 0.9, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 8 }}
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 rounded-full border border-white/12 bg-[#07101f]/80 px-5 py-3 text-white/85 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl transition hover:border-violet-400/35 hover:bg-violet-500/15 hover:text-white active:scale-95"
          >
            <Plus size={18} />
            <span className="text-sm font-medium">Nova memória</span>
            <span className="hidden text-[10px] uppercase tracking-wider text-white/35 sm:inline">
              no universo
            </span>
          </motion.button>
        ) : (
          <motion.div
            key="input-panel"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.22 }}
            className="w-[min(520px,92vw)] overflow-hidden rounded-2xl border border-white/10 bg-[#07101f]/92 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg border border-violet-400/25 bg-violet-500/15 p-1.5">
                  <Sparkles size={14} className="text-violet-200" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Manifestar memória</p>
                  <p className="text-[10px] uppercase tracking-wider text-white/35">
                    {embeddingReady ? 'IA local pronta' : 'A carregar embeddings…'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!embeddingReady && (
                  <span className="flex items-center gap-1 text-xs text-amber-300/70">
                    <Loader2 size={10} className="animate-spin" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-full p-1.5 text-white/35 transition hover:bg-white/10 hover:text-white/70"
                  aria-label="Fechar"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="p-4">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={PLACEHOLDERS[placeholderIndex.current]}
                rows={4}
                className="w-full resize-none bg-transparent text-sm leading-relaxed text-white/90 outline-none placeholder:text-white/25"
                disabled={isProcessing}
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-white/5 px-4 py-3">
              <span className="text-xs text-white/30">
                {wordCount > 0 ? `${wordCount} palavras` : 'Ctrl+Enter para lançar'}
              </span>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!text.trim() || isProcessing}
                className="flex items-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-35"
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>A orbitar…</span>
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    <span>Lançar</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

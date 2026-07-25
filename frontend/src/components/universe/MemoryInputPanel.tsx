import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Loader2, Send, X } from 'lucide-react';
import { useUniverseStore } from '../../store/universeStore';
import { cognitiveEngine } from '../../engines/CognitiveEngine';
import type { MemoryObject } from '../../types/universe';
import { v4 as uuidv4 } from 'uuid';
import { auth } from '../../firebase';

const PLACEHOLDER_TEXTS = [
  'What are you thinking about?',
  'Capture a concept, idea, or memory...',
  'What insight came to you today?',
  'What do you want to remember?',
  'Type a thought to place in your universe...',
];

interface MemoryInputPanelProps {
  onSave?: (memory: MemoryObject) => void;
}

export const MemoryInputPanel: React.FC<MemoryInputPanelProps> = ({ onSave }) => {
  const [text, setText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const placeholderIndex = useRef(Math.floor(Math.random() * PLACEHOLDER_TEXTS.length));

  const { addMemory, memories, embeddingReady, setIsLoading } = useUniverseStore();

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
      onSave?.(newMemory);
      setText('');
      setIsOpen(false);
    } catch (err) {
      console.error('Failed to process memory:', err);
    } finally {
      setIsProcessing(false);
      setIsLoading(false);
    }
  }, [text, isProcessing, memories, addMemory, setIsLoading, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    },
    [handleSubmit]
  );

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
      <AnimatePresence mode="wait">
        {!isOpen ? (
          <motion.button
            key="open-btn"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => {
              setIsOpen(true);
              setTimeout(() => textareaRef.current?.focus(), 100);
            }}
            className="flex items-center gap-2 px-5 py-3 rounded-full glass-card text-white/80 hover:text-white hover:bg-white/10 transition-all active:scale-95"
            style={{ border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <Plus size={18} />
            <span className="text-sm font-medium">Add Memory</span>
          </motion.button>
        ) : (
          <motion.div
            key="input-panel"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            className="glass-card p-4 w-[480px] max-w-[90vw]"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-white/50 text-xs uppercase tracking-wider">
                New Memory
              </span>
              <div className="flex items-center gap-2">
                {!embeddingReady && (
                  <span className="text-amber-400/60 text-xs flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" />
                    Loading AI...
                  </span>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-white/30 hover:text-white/60 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={PLACEHOLDER_TEXTS[placeholderIndex.current]}
              rows={4}
              className="w-full bg-transparent text-white/90 text-sm placeholder-white/20 resize-none outline-none leading-relaxed"
              disabled={isProcessing}
            />

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
              <span className="text-white/20 text-xs">
                {text.length > 0 ? `${text.length} chars` : '⌘+Enter to save'}
              </span>
              <button
                onClick={handleSubmit}
                disabled={!text.trim() || isProcessing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: text.trim() && !isProcessing
                    ? 'rgba(100, 130, 255, 0.3)'
                    : 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(100,130,255,0.3)',
                  color: 'white',
                }}
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    <span>Launch</span>
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

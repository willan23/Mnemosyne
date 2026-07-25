import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Sparkles } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { auth, db } from '../firebase';
import { arrayUnion, collection, addDoc, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { nvidiaApiService } from '../services/nvidiaApiService';
import { getLocalAiConfig } from '../services/localAiConfig';
import { resolveAiFailureDecision, shouldUseNvidiaBackend } from '../services/aiSavePolicy';
import { cognitiveEngine } from '../engines/CognitiveEngine';
import type { MemoryObject } from '../types/universe';
import { useSubscription } from '../hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

export const CognitiveInput: React.FC = () => {
  const [text, setText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showSerendipity, setShowSerendipity] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const { canCreateMemory, getRemainingMemories, isLoading: isSubscriptionLoading } = useSubscription();

  const { isCommandPaletteOpen } = useUI();

  const loadExistingMemories = async (uid: string): Promise<MemoryObject[]> => {
    const snapshot = await getDocs(query(collection(db, 'sessions'), where('uid', '==', uid)));
    return snapshot.docs.map((sessionDoc) => {
      const data = sessionDoc.data();
      const embedding = Array.isArray(data.embedding) ? data.embedding : [];
      const position = Array.isArray(data.position) && data.position.length === 3 ? data.position : [0, 0, 0];
      return {
        id: sessionDoc.id,
        text: data.text || '',
        title: data.title,
        celestialType: data.celestialType || 'planet',
        position,
        embedding,
        connections: Array.isArray(data.connections) ? data.connections : [],
        semanticClusterId: typeof data.semanticClusterId === 'string' ? data.semanticClusterId : undefined,
        importance: typeof data.importance === 'number' ? data.importance : 0.5,
        timestamp: data.timestamp || 0,
        updatedAt: data.updatedAt || data.timestamp || 0,
        uid: data.uid,
        tags: data.tags,
        category: data.category,
      } as MemoryObject;
    });
  };

  // Heurística de digitação
  useEffect(() => {
    const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount > 3) setShowSerendipity(true);
    else setShowSerendipity(false);

    // Auto-resize
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [text]);

  const handleSave = async () => {
    if (!text.trim() || !auth.currentUser) return;
    if (isSubscriptionLoading) return;
    if (!canCreateMemory()) {
      const remaining = getRemainingMemories();
      toast.error(
        remaining === 0
          ? 'Limite mensal de memórias atingido. Faz upgrade para continuar.'
          : 'O teu plano atual não permite criar esta memória.'
      );
      navigate('/pricing');
      return;
    }

    setIsSaving(true);
    try {
      let extraction = { nodes: [] as any[], links: [] as any[] };
      let processingMethod = 'manual';
      const aiConfig = getLocalAiConfig();
      const aiErrors: string[] = [];
      let cognitive: Awaited<ReturnType<typeof cognitiveEngine.processMemory>> | null = null;
      const existingMemories = await loadExistingMemories(auth.currentUser.uid);

      try {
        cognitive = await cognitiveEngine.processMemory(text.trim(), existingMemories);
        processingMethod = 'local-embedding';
      } catch (error) {
        console.warn('Embedding/autolink unavailable:', error);
        aiErrors.push(error instanceof Error ? `Embeddings locais: ${error.message}` : 'Embeddings locais indisponíveis.');
        toast('Embedding local indisponível. A memória será guardada sem ligações semânticas.', {
          icon: '!',
          style: {
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)'
          }
        });
      }

      if (shouldUseNvidiaBackend(
        aiConfig,
        () => confirm('Usar o backend NVIDIA NIM para processar esta memória? O texto será enviado ao teu backend configurado.')
      )) {
          try {
            extraction = await nvidiaApiService.extract(text.trim());
            processingMethod = cognitive ? 'local-embedding+nvidia-nim' : 'nvidia-nim';
          } catch (error) {
            aiErrors.push(error instanceof Error ? `NVIDIA NIM: ${error.message}` : 'Backend NVIDIA NIM indisponível.');
            toast('Backend de IA indisponível. A memória será guardada sem grafo extraído.', {
              icon: '!',
              style: {
                background: 'rgba(0,0,0,0.8)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.1)'
              }
            });
          }
      }

      if (aiErrors.length > 0) {
        const summary = aiErrors.join('\n');
        const failureDecision = resolveAiFailureDecision(
          aiConfig,
          aiErrors,
          () => confirm(`A IA configurada falhou:\n\n${summary}\n\nGuardar a memória sem este enriquecimento?`)
        );
        if (failureDecision === 'block-save') {
          toast.error('A política atual bloqueia guardar quando a IA configurada falha.');
          throw new Error(`IA configurada falhou:\n${summary}`);
        }
        if (failureDecision === 'skip-save') return;
      }
      
      // Mapear para o formato esperado pelo Firestore (links precisam ser simples)
      const nodes = extraction.nodes;
      const links = extraction.links;

      const memoryRef = await addDoc(collection(db, "sessions"), {
        text: text.trim(),
        title: cognitive ? cognitiveEngine.generateTitle(text.trim()) : null,
        timestamp: Date.now(),
        updatedAt: Date.now(),
        uid: auth.currentUser.uid,
        nodes: nodes.length > 0 ? nodes : null,
        links: links.length > 0 ? links : null,
        embedding: cognitive?.embedding || null,
        connections: cognitive?.connections || [],
        semanticClusterId: cognitive?.semanticClusterId || null,
        position: cognitive?.position || null,
        importance: cognitive?.importance || 0.5,
        celestialType: cognitive?.celestialType || null,
        processingMethod
      });

      if (cognitive?.connections.length) {
        await Promise.all(cognitive.connections.map((memoryId) => (
          updateDoc(doc(db, 'sessions', memoryId), {
            connections: arrayUnion(memoryRef.id),
            updatedAt: Date.now(),
          }).catch((error) => console.warn('Unable to back-link memory', memoryId, error))
        )));
      }
      
      setText('');
      setShowSerendipity(false);
      setIsFocused(false);
      textareaRef.current?.blur();
      toast.success('Pensamento cristalizado.', {
          icon: '✨',
          style: {
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)'
          }
      });
    } catch {
      toast.error('Erro ao formar memória.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
        setIsFocused(false);
        textareaRef.current?.blur();
    }
  };

  const isFlowModeActive = isFocused || text.length > 0;

  return (
    <>
      {/* Background Dimmer when active */}
      <AnimatePresence>
        {isFlowModeActive && (
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.5, ease: 'easeOut' }}
                className="fixed inset-0 bg-gradient-to-b from-[#020617]/40 to-[#0b1120]/60 backdrop-blur-sm pointer-events-none z-10"
            />
        )}
      </AnimatePresence>

      <div className={`fixed inset-0 z-20 flex flex-col items-center justify-center pointer-events-none transition-all duration-700 ${isFlowModeActive ? '-mt-10' : 'mt-0'}`}>
        
        {/* Central Input Core */}
        <div className="relative w-full max-w-4xl px-8 pointer-events-auto flex flex-col items-center">
            <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => !text && setIsFocused(false)}
                onKeyDown={handleKeyDown}
                disabled={isCommandPaletteOpen || isSaving || isSubscriptionLoading}
                placeholder="O que estás a pensar agora?"
                className={`w-full bg-transparent border-none font-serif text-center transition-all duration-700 ease-out text-gray-200 placeholder-white/20 resize-none focus:ring-0 custom-scrollbar-hidden ${isFlowModeActive ? 'text-3xl md:text-5xl leading-[1.4] opacity-100' : 'text-xl md:text-3xl opacity-60 hover:opacity-90'}`}
                rows={1}
            />

            {/* Hint Fade */}
            <AnimatePresence>
                {isFlowModeActive && (
                    <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 0.5, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="mt-8 text-xs font-mono uppercase tracking-[0.3em] flex gap-4 text-white/50"
                    >
                        <span>Ctrl+Enter para cristalizar</span>
                        <span>Esc para esquecer</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Serendipity Live Insights (Floating Shards) */}
            <AnimatePresence>
                {showSerendipity && (
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 10 }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                        className="absolute top-full mt-16 flex flex-wrap justify-center gap-4 w-full max-w-3xl"
                    >
                        <div className="glass-card bg-white/5 border-white/10 px-6 py-4 rounded-2xl flex items-start gap-4 hover:bg-white/10 transition-all cursor-pointer shadow-[0_0_30px_rgba(255,255,255,0.02)]">
                            <Sparkles className="w-4 h-4 text-white/40 mt-1 shrink-0" />
                            <div className="flex flex-col text-left">
                                <span className="text-white/80 text-sm font-medium mb-1">Intenção possível</span>
                                <span className="text-white/40 text-xs line-clamp-2">Guardar isto como memória e extrair ligações quando o backend estiver disponível.</span>
                            </div>
                        </div>

                        <div className="glass-card bg-indigo-500/5 border-indigo-500/20 px-6 py-4 rounded-2xl flex items-start gap-4 hover:bg-indigo-500/10 transition-all cursor-pointer shadow-[0_0_30px_rgba(99,102,241,0.03)]">
                            <Brain className="w-4 h-4 text-indigo-400 mt-1 shrink-0" />
                            <div className="flex flex-col text-left">
                                <span className="text-indigo-200 text-sm font-medium mb-1">Comando disponível</span>
                                <span className="text-indigo-400/50 text-xs line-clamp-2">Usa Ctrl+Enter para criar a memória agora.</span>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
      </div>
    </>
  );
};

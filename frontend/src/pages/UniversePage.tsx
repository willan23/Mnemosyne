import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { motion } from 'framer-motion';
import { Brain, LogOut, Orbit, Shield, Search, Sparkles, Layers } from 'lucide-react';
import { auth } from '../firebase';
import { Universe3D } from '../components/universe/Universe3D';
import { UniverseHUD } from '../components/universe/UniverseHUD';
import { MemoryInputPanel } from '../components/universe/MemoryInputPanel';
import { MemoryDetail } from '../components/universe/MemoryDetail';
import { useUniverseStore } from '../store/universeStore';
import { useUniverseMemories } from '../hooks/useUniverseMemories';
import { cognitiveEngine } from '../engines/CognitiveEngine';

const UNIVERSE_LABELS = {
  stellar: 'Stellar', quantum: 'Quantum', mythic: 'Mythic',
  oceanic: 'Oceanic', crystalline: 'Crystalline', void: 'Void', garden: 'Garden',
} as const;

/* ─── Loading screen ─────────────────────────────────────── */
const CosmicLoader: React.FC = () => (
  <div className="w-full h-screen flex items-center justify-center" style={{ background: '#03030d' }}>
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center gap-5"
    >
      <div className="relative">
        <div className="w-14 h-14 rounded-full border border-indigo-500/20 animate-spin" />
        <div
          className="absolute inset-2 rounded-full border-t-2 border-indigo-400 animate-spin"
          style={{ animationDuration: '0.8s' }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <Brain className="w-5 h-5 text-indigo-400" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-white mb-1">A abrir o teu universo cognitivo</p>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          A preparar memória viva e navegação espacial…
        </p>
      </div>
    </motion.div>
  </div>
);

/* ─── Minimal HUD header ─────────────────────────────────── */
const UniverseHeader: React.FC<{
  memoriesCount: number;
  connections: number;
  universeType: keyof typeof UNIVERSE_LABELS;
  embeddingReady: boolean;
}> = ({ memoriesCount, connections, universeType, embeddingReady }) => (
  <div className="absolute top-0 inset-x-0 z-40 pointer-events-none">
    <div className="flex items-center justify-between px-5 pt-5 pb-20"
      style={{ background: 'linear-gradient(180deg, rgba(3,3,13,0.85) 0%, rgba(3,3,13,0) 100%)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 pointer-events-auto">
        <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
          <Brain className="w-4 h-4 text-indigo-400" />
        </div>
        <span className="text-sm font-semibold text-white/90">Mnemosyne</span>
        <span
          className="hidden sm:block px-2.5 py-1 rounded-full text-[10px] uppercase tracking-widest font-medium"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          {UNIVERSE_LABELS[universeType]}
        </span>
      </div>

      {/* Status pills */}
      <div className="flex items-center gap-2 pointer-events-auto">
        {/* AI status */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
          style={{
            background: embeddingReady ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.1)',
            border: `1px solid ${embeddingReady ? 'rgba(52,211,153,0.25)' : 'rgba(251,191,36,0.25)'}`,
            color: embeddingReady ? '#34d399' : '#fbbf24',
          }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: embeddingReady ? '#34d399' : '#fbbf24' }}
          />
          {embeddingReady ? 'IA pronta' : 'IA a carregar'}
        </div>

        {/* Stats */}
        <div
          className="hidden md:flex items-center gap-3 px-3 py-1.5 rounded-full text-xs"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'var(--text-secondary)',
          }}
        >
          <span className="flex items-center gap-1">
            <Layers className="w-3 h-3" />
            {memoriesCount} memórias
          </span>
          <span className="w-px h-3" style={{ background: 'rgba(255,255,255,0.12)' }} />
          <span>{Math.floor(connections)} ligações</span>
        </div>

        {/* Return to Dashboard */}
        <button
          onClick={() => window.location.href = '/'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(240,240,255,0.5)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(240,240,255,0.9)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(240,240,255,0.5)'; }}
        >
          <LogOut className="w-3.5 h-3.5" style={{ transform: 'rotate(180deg)' }} />
          <span className="hidden sm:block">Voltar</span>
        </button>
      </div>
    </div>
  </div>
);

/* ─── Keyboard hint ──────────────────────────────────────── */
const KeyboardHint: React.FC = () => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ delay: 2, duration: 1 }}
    className="absolute bottom-32 right-5 z-30 pointer-events-none"
  >
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
      style={{
        background: 'rgba(5,5,20,0.7)',
        border: '1px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(12px)',
        color: 'var(--text-muted)',
      }}
    >
      <Search className="w-3 h-3" />
      <span>Pesquisar memórias</span>
      <div className="flex gap-1">
        {['⌘', 'K'].map(k => (
          <kbd
            key={k}
            className="px-1.5 py-0.5 rounded text-[9px] font-mono"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            {k}
          </kbd>
        ))}
      </div>
    </div>
  </motion.div>
);

/* ─── Navigation tips panel ──────────────────────────────── */
const NavTipsPanel: React.FC<{ selected: { title?: string; text: string } | null }> = ({ selected }) => (
  <motion.div
    initial={{ opacity: 0, x: -20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay: 0.8, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    className="absolute left-5 bottom-28 z-30 w-[300px] max-w-[calc(100vw-2.5rem)] pointer-events-none"
  >
    <div
      className="rounded-2xl p-4"
      style={{
        background: 'rgba(5,5,20,0.65)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: 'var(--text-muted)' }}>
        <Sparkles className="w-3.5 h-3.5" />
        Navegação cognitiva
      </div>
      <div className="space-y-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <div className="flex items-start gap-2.5">
          <Orbit className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-indigo-300" />
          <p>Pesquisa para isolar memórias e orbitar relações específicas.</p>
        </div>
        <div className="flex items-start gap-2.5">
          <Shield className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-emerald-300" />
          <p>Cria uma memória no compositor central — aparece no universo em tempo real.</p>
        </div>
      </div>
      {selected && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 px-3 py-2.5 rounded-xl text-xs"
          style={{
            background: 'rgba(99,102,241,0.12)',
            border: '1px solid rgba(99,102,241,0.22)',
            color: '#a5b4fc',
          }}
        >
          Selecionada:{' '}
          <span className="font-medium">
            {selected.title || selected.text.slice(0, 48)}
          </span>
        </motion.div>
      )}
    </div>
  </motion.div>
);

/* ─── UniversePage ────────────────────────────────────────── */
export const UniversePage: React.FC = () => {
  const { setEmbeddingReady } = useUniverseStore();
  const { memories, selectedMemoryId, embeddingReady, universeType } = useUniverseStore();
  const { saveMemory, deleteMemory } = useUniverseMemories();
  const [authReady, setAuthReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setIsAuthed(!!user);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    cognitiveEngine.initialize()
      .then(() => setEmbeddingReady(true))
      .catch(err => console.error('CognitiveEngine init failed:', err));
  }, [setEmbeddingReady]);

  const selected = useMemo(() => memories.find(m => m.id === selectedMemoryId) ?? null, [memories, selectedMemoryId]);
  const connections = useMemo(() => memories.reduce((acc, m) => acc + m.connections.length, 0) / 2, [memories]);

  if (!authReady) return <CosmicLoader />;
  if (!isAuthed) return <Navigate to="/login" replace />;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      className="relative w-full h-screen overflow-hidden text-white"
      style={{ background: '#03030d' }}
    >
      {/* 3D Universe */}
      <Universe3D />

      {/* Atmospheric gradient overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(180deg, rgba(3,3,13,0.75) 0%, rgba(3,3,13,0.08) 25%, rgba(3,3,13,0.08) 75%, rgba(3,3,13,0.80) 100%)',
        }}
      />

      {/* HUD */}
      <UniverseHUD />

      {/* Minimal top header (replaces old card) */}
      <UniverseHeader
        memoriesCount={memories.length}
        connections={connections}
        universeType={universeType}
        embeddingReady={embeddingReady}
      />

      {/* Memory detail on selection */}
      <MemoryDetail onDelete={deleteMemory} />

      {/* Central input */}
      <MemoryInputPanel onSave={saveMemory} />

      {/* Navigation tips (bottom-left)  */}
      <NavTipsPanel selected={selected} />

      {/* Keyboard shortcut hint (bottom-right) */}
      <KeyboardHint />
    </motion.div>
  );
};

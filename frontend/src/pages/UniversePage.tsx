import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { motion } from 'framer-motion';
import { Brain, LogOut, Orbit, Shield, Search, Sparkles, Layers } from 'lucide-react';
import { auth } from '../firebase';
import { Universe3D } from '../components/universe/Universe3D';
import { UniverseHUD } from '../components/universe/UniverseHUD';
import { MemoryInputPanel } from '../components/universe/MemoryInputPanel';
import { MemoryDetail } from '../components/universe/MemoryDetail';
import { TransmissionPanel, type TransmissionDraft } from '../components/TransmissionPanel';
import { useUniverseStore } from '../store/universeStore';
import { useUniverseMemories } from '../hooks/useUniverseMemories';
import { cognitiveEngine } from '../engines/CognitiveEngine';
import type { MemoryObject } from '../types/universe';

const UNIVERSE_LABELS = {
  stellar: 'Galáxia', solar: 'Sistema Solar', quantum: 'Quantum', mythic: 'Nebulosa',
  oceanic: 'Oceanic', crystalline: 'Crystalline', void: 'Void', garden: 'Garden',
} as const;

import { readSessionMnemonic } from '../utils/sessionMnemonic';
import { readMemoryIdFromSearch, stripMemoryFromUrl } from '../utils/deepLinks';

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
  onBack: () => void;
}> = ({ memoriesCount, connections, universeType, embeddingReady, onBack }) => (
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
          onClick={onBack}
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

function applyUniverseSearch(
  value: string,
  memories: MemoryObject[],
  setSearchQuery: (query: string) => void,
  setFilteredIds: (ids: string[] | null) => void
): string[] {
  setSearchQuery(value);
  const queryText = value.trim().toLowerCase();
  if (!queryText) {
    setFilteredIds(null);
    return [];
  }

  const matched = memories
    .filter((memory) => (
      memory.text.toLowerCase().includes(queryText) ||
      memory.title?.toLowerCase().includes(queryText) ||
      memory.category?.toLowerCase().includes(queryText) ||
      memory.tags?.some((tag) => tag.toLowerCase().includes(queryText))
    ))
    .map((memory) => memory.id);
  setFilteredIds(matched);
  return matched;
}

/* ─── Search dock ────────────────────────────────────────── */
const UniverseSearchDock: React.FC = () => {
  const {
    memories,
    searchQuery,
    setSearchQuery,
    setFilteredIds,
    selectMemory,
  } = useUniverseStore();
  const [isExpanded, setIsExpanded] = useState(searchQuery.trim().length > 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasSearchQuery = searchQuery.trim().length > 0;
  const isSearchOpen = isExpanded || hasSearchQuery;

  const matchedMemories = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const lower = searchQuery.toLowerCase();
    return memories
      .filter((memory) => (
        memory.text.toLowerCase().includes(lower) ||
        memory.title?.toLowerCase().includes(lower) ||
        memory.category?.toLowerCase().includes(lower) ||
        memory.tags?.some((tag) => tag.toLowerCase().includes(lower))
      ))
      .slice(0, 8);
  }, [memories, searchQuery]);

  const matchedIds = matchedMemories.map((m) => m.id);

  const handleChange = useCallback((value: string) => {
    applyUniverseSearch(value, memories, setSearchQuery, setFilteredIds);
  }, [memories, setFilteredIds, setSearchQuery]);

  const openSearch = useCallback(() => {
    setIsExpanded(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSearch();
      }

      if (event.key === 'Escape' && isSearchOpen) {
        if (searchQuery.trim()) handleChange('');
        setIsExpanded(false);
        inputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleChange, isSearchOpen, openSearch, searchQuery]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const firstMatch = matchedIds[0];
    if (firstMatch) {
      event.preventDefault();
      selectMemory(firstMatch);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.45, duration: 0.4 }}
      className="pointer-events-none absolute bottom-24 right-4 z-30 max-w-[calc(100vw-2rem)] sm:right-5"
    >
      {isSearchOpen ? (
        <div className="pointer-events-auto w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-[#050514]/88 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-2 border-b border-white/5 px-3 py-3">
            <Search className="h-4 w-4 shrink-0 text-white/40" />
            <input
              ref={inputRef}
              value={searchQuery}
              onChange={(event) => handleChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pesquisar memórias… (Ctrl+K)"
              className="min-w-0 flex-1 bg-transparent text-sm text-white/85 outline-none placeholder:text-white/30"
            />
            <button
              type="button"
              onClick={() => {
                if (searchQuery.trim()) {
                  handleChange('');
                  inputRef.current?.focus();
                  return;
                }
                setIsExpanded(false);
              }}
              className="rounded-full px-2 py-1 text-white/40 transition hover:bg-white/10 hover:text-white/75"
              aria-label={searchQuery.trim() ? 'Limpar pesquisa' : 'Recolher pesquisa'}
            >
              ×
            </button>
          </div>
          {hasSearchQuery && (
            <div className="mnem-scroll max-h-56 overflow-y-auto p-2">
              {matchedMemories.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-white/40">Sem resultados</p>
              ) : (
                matchedMemories.map((memory) => (
                  <button
                    key={memory.id}
                    type="button"
                    onClick={() => selectMemory(memory.id)}
                    className="flex w-full flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/8"
                  >
                    <span className="truncate text-sm font-medium text-white/90">
                      {memory.title || memory.text.slice(0, 48)}
                    </span>
                    <span className="truncate text-[11px] text-white/40">
                      {memory.text.replace(/\s+/g, ' ').slice(0, 72)}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
          {hasSearchQuery && matchedMemories.length > 0 && (
            <p className="border-t border-white/5 px-3 py-2 text-[10px] uppercase tracking-widest text-white/30">
              {matchedMemories.length} resultado(s) · Enter foca o primeiro
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={openSearch}
          className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-[#050514]/75 text-white/55 shadow-lg backdrop-blur-xl transition hover:bg-white/10 hover:text-white"
          aria-label="Abrir pesquisa de memórias"
          title="Pesquisar (Ctrl+K)"
        >
          <Search className="h-4 w-4" />
        </button>
      )}
    </motion.div>
  );
};

/* ─── Navigation tips panel ──────────────────────────────── */
const NavTipsPanel: React.FC<{ selected: { title?: string; text: string } | null }> = ({ selected }) => {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('mnemosyne.universe.tips.dismissed') === '1';
    } catch {
      return false;
    }
  });

  if (dismissed && !selected) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.5, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none absolute bottom-28 left-3 z-30 w-[min(300px,calc(100vw-1.5rem))] sm:left-5"
    >
      <div className="pointer-events-auto rounded-2xl border border-white/10 bg-[#050514]/78 p-4 shadow-xl backdrop-blur-xl">
        {!dismissed && (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                <Sparkles className="h-3.5 w-3.5 text-violet-300" />
                Navegação
              </div>
              <button
                type="button"
                onClick={() => {
                  setDismissed(true);
                  try {
                    sessionStorage.setItem('mnemosyne.universe.tips.dismissed', '1');
                  } catch { /* ignore */ }
                }}
                className="text-[10px] uppercase tracking-wider text-white/30 transition hover:text-white/60"
              >
                Ocultar
              </button>
            </div>
            <div className="space-y-2.5 text-xs leading-relaxed text-white/55">
              <div className="flex items-start gap-2.5">
                <Orbit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-300" />
                <p>Arrasta para orbitar · scroll para zoom · clique num corpo para focar.</p>
              </div>
              <div className="flex items-start gap-2.5">
                <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                <p>Usa <strong className="text-white/75">Nova memória</strong> no centro ou Ctrl+K para pesquisar.</p>
              </div>
            </div>
          </>
        )}
        {selected && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-xl border border-indigo-400/25 bg-indigo-500/15 px-3 py-2.5 text-xs text-indigo-100 ${dismissed ? '' : 'mt-3'}`}
          >
            Em foco:{' '}
            <span className="font-medium">
              {selected.title || selected.text.slice(0, 48)}
            </span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

/* ─── UniversePage ────────────────────────────────────────── */
export const UniversePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setEmbeddingReady, selectMemory } = useUniverseStore();
  const { memories, selectedMemoryId, embeddingReady, universeType } = useUniverseStore();
  const { saveMemory, deleteMemory } = useUniverseMemories();
  const [authReady, setAuthReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [mnemonic] = useState<string[] | null>(() => readSessionMnemonic());
  const [isTransmissionOpen, setIsTransmissionOpen] = useState(false);
  const [transmissionDraft, setTransmissionDraft] = useState<TransmissionDraft | null>(null);

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setIsAuthed(!!user);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    cognitiveEngine.initialize()
      .then(() => setEmbeddingReady(true))
      .catch(err => console.error('CognitiveEngine init failed:', err));
  }, [setEmbeddingReady]);

  // Deep-link: /universe?memory=<id>
  useEffect(() => {
    const memoryId = readMemoryIdFromSearch(location.search);
    if (!memoryId || memories.length === 0) return;
    const exists = memories.some((m) => m.id === memoryId);
    if (!exists) return;
    selectMemory(memoryId);
    const t = window.setTimeout(() => stripMemoryFromUrl(), 600);
    return () => window.clearTimeout(t);
  }, [location.search, memories, selectMemory]);

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

      {/* Atmospheric vignette + film depth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 70% 55% at 50% 45%, transparent 30%, rgba(3,3,13,0.55) 100%),
            linear-gradient(180deg, rgba(3,3,13,0.72) 0%, rgba(3,3,13,0.04) 22%, rgba(3,3,13,0.04) 72%, rgba(3,3,13,0.82) 100%)
          `,
        }}
      />
      <div className="mnem-universe-grain pointer-events-none absolute inset-0 opacity-[0.035]" />

      {/* Empty universe — CTA sobre proto-estrelas */}
      {memories.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-6">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="max-w-sm rounded-3xl border border-violet-400/20 bg-[#050514]/72 px-7 py-8 text-center shadow-[0_0_60px_rgba(99,102,241,0.18)] backdrop-blur-xl"
          >
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-400/30 bg-violet-500/15">
              <Sparkles className="h-5 w-5 text-violet-200" />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-200/70">
              Universo nascente
            </p>
            <h2 className="mt-2 text-lg font-semibold text-white">Ainda não há corpos celestes</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/50">
              Lança a primeira memória no painel central. Ela aparece como estrela, liga-se sozinha e
              o teu grafo cognitivo ganha gravidade.
            </p>
          </motion.div>
        </div>
      )}

      <UniverseHeader
        memoriesCount={memories.length}
        connections={connections}
        universeType={universeType}
        embeddingReady={embeddingReady}
        onBack={() => navigate('/')}
      />
      {/* Type + observatory — top right under header */}
      <div className="pointer-events-none absolute right-3 top-[4.25rem] z-40 sm:right-5 sm:top-[4.75rem]">
        <div className="pointer-events-auto">
          <UniverseHUD />
        </div>
      </div>

      {/* Memory detail on selection */}
      <MemoryDetail
        onDelete={deleteMemory}
        onSave={saveMemory}
        onTransmit={(memory) => {
          setTransmissionDraft({
            memoryId: memory.id,
            title: memory.title,
            text: memory.text,
          });
          setIsTransmissionOpen(true);
        }}
      />

      {/* Central input */}
      <MemoryInputPanel onSave={saveMemory} />

      {/* Navigation tips (bottom-left)  */}
      <NavTipsPanel selected={selected} />

      {/* Search dock (bottom-right) */}
      <UniverseSearchDock />

      <TransmissionPanel
        isOpen={isTransmissionOpen}
        onClose={() => {
          setIsTransmissionOpen(false);
          setTransmissionDraft(null);
        }}
        mnemonic={mnemonic}
        initialDraft={transmissionDraft}
      />
    </motion.div>
  );
};

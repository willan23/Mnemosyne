import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUI } from '../contexts/UIContext';
import {
  Search, Settings, BarChart3, Crown, Sun, Globe2, Orbit, Compass, Sparkles, Radio,
  X, Clock, Hash, Activity, Shield, Cpu, Key, Loader2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import type { SessionData } from '../hooks/useSessions';
import { isFreeFirstMode } from '../config/monetization';
import { parseAiCommand } from '../services/aiCommandParser';
import {
  clearRecentSearches,
  parseSearchQuery,
  pushRecentSearch,
  readRecentSearches,
  searchMemories,
  type MemorySearchHit,
} from '../utils/searchMemories';

interface CommandPaletteProps {
  memories?: SessionData[];
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onMemorySelect?: (memory: SessionData) => void;
  onWebResearch?: (query: string) => void;
  /** Abrir definições numa secção específica */
  onOpenSettings?: (section?: string) => void;
  /** Abrir Cognitive Pulse */
  onOpenPulse?: () => void;
  /** Abrir modo Insights */
  onOpenInsights?: () => void;
  isSemanticLoading?: boolean;
}

type CommandItem = {
  id: string;
  name: string;
  hint: string;
  icon: React.ReactNode;
  action: () => void;
  keywords?: string[];
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  memories = [],
  searchQuery = '',
  onSearchQueryChange,
  onMemorySelect,
  onWebResearch,
  onOpenSettings,
  onOpenPulse,
  onOpenInsights,
  isSemanticLoading = false,
}) => {
  const { isCommandPaletteOpen, setIsCommandPaletteOpen, setIsSettingsOpen } = useUI();
  const { toggleTheme } = useTheme();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => readRecentSearches());
  const query = searchQuery;
  const parsed = useMemo(() => parseSearchQuery(query), [query]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsCommandPaletteOpen(!isCommandPaletteOpen);
      }
      if (e.key === 'Escape' && isCommandPaletteOpen) {
        setIsCommandPaletteOpen(false);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [isCommandPaletteOpen, setIsCommandPaletteOpen]);

  useEffect(() => {
    if (isCommandPaletteOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 80);
      setActiveIndex(0);
      setRecent(readRecentSearches());
    }
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const updateQuery = (nextQuery: string) => {
    onSearchQueryChange?.(nextQuery);
  };

  const runCommand = useCallback((cmd: () => void) => {
    if (query.trim().length >= 2) {
      pushRecentSearch(query.trim());
      setRecent(readRecentSearches());
    }
    setIsCommandPaletteOpen(false);
    setTimeout(cmd, 100);
  }, [query, setIsCommandPaletteOpen]);

  const openSettings = useCallback((section?: string) => {
    runCommand(() => {
      if (onOpenSettings) onOpenSettings(section);
      else setIsSettingsOpen(true);
    });
  }, [onOpenSettings, runCommand, setIsSettingsOpen]);

  const parsedCommand = parseAiCommand(query.trim());
  const webResearchQuery = parsedCommand.type === 'web-research' ? parsedCommand.query : '';
  const runWebResearchCommand = () => runCommand(() => onWebResearch?.(webResearchQuery || query.trim()));

  const commands: CommandItem[] = useMemo(() => [
    {
      id: 'web-research',
      name: parsedCommand.type === 'web-research' ? 'Pesquisar na web agora' : 'Pesquisar na web',
      hint: 'pesquisa pública · /web tema',
      icon: <Globe2 className="h-4 w-4" />,
      action: runWebResearchCommand,
      keywords: ['web', 'internet', 'pesquisar', 'google'],
    },
    {
      id: 'universe',
      name: 'Abrir Universo 3D',
      hint: 'navegação espacial',
      icon: <Orbit className="h-4 w-4" />,
      action: () => runCommand(() => navigate('/universe')),
      keywords: ['3d', 'espaço', 'galáxia', 'cosmos'],
    },
    {
      id: 'pulse',
      name: 'Cognitive Pulse',
      hint: 'ritual diário do grafo',
      icon: <Activity className="h-4 w-4" />,
      action: () => runCommand(() => onOpenPulse?.()),
      keywords: ['pulso', 'insights', 'dia'],
    },
    {
      id: 'insights',
      name: 'Abrir Insights',
      hint: 'tensões, ecos, órfãs',
      icon: <Sparkles className="h-4 w-4" />,
      action: () => runCommand(() => onOpenInsights?.()),
      keywords: ['padrão', 'contradição'],
    },
    {
      id: 'comms',
      name: 'Comms · transmissão',
      hint: 'enviar memórias E2E',
      icon: <Radio className="h-4 w-4" />,
      action: () => runCommand(() => {
        if (window.location.pathname !== '/') navigate('/');
      }),
      keywords: ['enviar', 'p2p', 'mensagem'],
    },
    {
      id: 'settings',
      name: 'Definições',
      hint: 'centro de controlo',
      icon: <Settings className="h-4 w-4" />,
      action: () => openSettings(),
      keywords: ['config', 'opções', 'settings'],
    },
    {
      id: 'settings-ai',
      name: 'Definições · IA',
      hint: 'modelos, Ollama, cloud',
      icon: <Cpu className="h-4 w-4" />,
      action: () => openSettings('ai'),
      keywords: ['ollama', 'openai', 'modelo', 'llm'],
    },
    {
      id: 'settings-privacy',
      name: 'Definições · Privacidade',
      hint: 'PIN, Zero-Knowledge',
      icon: <Shield className="h-4 w-4" />,
      action: () => openSettings('privacy'),
      keywords: ['pin', 'segurança', 'zk'],
    },
    {
      id: 'settings-identity',
      name: 'Definições · Identidade',
      hint: 'mnemónica e chave',
      icon: <Key className="h-4 w-4" />,
      action: () => openSettings('identity'),
      keywords: ['chave', 'seed', 'mnemónica'],
    },
    {
      id: 'analytics',
      name: 'Analytics',
      hint: 'padrões de uso',
      icon: <BarChart3 className="h-4 w-4" />,
      action: () => runCommand(() => navigate('/analytics')),
    },
    {
      id: 'upgrade',
      name: isFreeFirstMode ? 'Founder Preview' : 'Planos',
      hint: isFreeFirstMode ? 'fase gratuita' : 'upgrade',
      icon: <Crown className="h-4 w-4" />,
      action: () => runCommand(() => navigate('/pricing')),
    },
    {
      id: 'theme',
      name: 'Alternar tema',
      hint: 'claro / escuro',
      icon: <Sun className="h-4 w-4" />,
      action: () => runCommand(() => toggleTheme()),
      keywords: ['dark', 'light', 'tema'],
    },
  ], [parsedCommand.type, navigate, openSettings, onOpenPulse, onOpenInsights, runCommand, toggleTheme]);

  const filteredCommands = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return commands.slice(0, 6);
    return commands.filter((command) => {
      const hay = `${command.name} ${command.hint} ${(command.keywords || []).join(' ')}`.toLowerCase();
      return hay.includes(q)
        || command.name.toLowerCase().includes(q)
        || (command.id === 'web-research' && parsedCommand.type === 'web-research');
    });
  }, [commands, query, parsedCommand.type]);

  // Prefer parent-filtered list (already semantic); fallback to local engine
  const memoryHits: MemorySearchHit[] = useMemo(() => {
    if (!query.trim()) return [];
    const hasParentScores = memories.some((m) => typeof m.semanticScore === 'number' && m.semanticScore > 0);
    if (hasParentScores) {
      return memories.slice(0, 10).map((memory) => ({
        memory,
        score: memory.semanticScore || 0.5,
        matchKind: (memory.semanticScore || 0) >= 0.5 ? 'mixed' as const : 'text' as const,
        snippet: (memory.text || '').replace(/\s+/g, ' ').slice(0, 110),
        matchedTags: memory.tags || [],
      }));
    }
    return searchMemories(memories, query, { limit: 10, semanticFloor: 0.38 });
  }, [memories, query]);

  type ListItem =
    | { kind: 'memory'; hit: MemorySearchHit }
    | { kind: 'command'; command: CommandItem }
    | { kind: 'recent'; value: string };

  const showRecent = !query.trim() && recent.length > 0;

  const listItems: ListItem[] = useMemo(() => {
    if (showRecent) {
      return [
        ...recent.map((value) => ({ kind: 'recent' as const, value })),
        ...filteredCommands.map((command) => ({ kind: 'command' as const, command })),
      ];
    }
    return [
      ...memoryHits.map((hit) => ({ kind: 'memory' as const, hit })),
      ...filteredCommands.map((command) => ({ kind: 'command' as const, command })),
    ];
  }, [showRecent, recent, memoryHits, filteredCommands]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const selectMemory = (memory: SessionData) => {
    if (query.trim().length >= 2) {
      pushRecentSearch(query.trim());
      setRecent(readRecentSearches());
    }
    setIsCommandPaletteOpen(false);
    onMemorySelect?.(memory);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, listItems.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      runWebResearchCommand();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = listItems[activeIndex];
      if (!item) {
        if (parsedCommand.type === 'web-research') runWebResearchCommand();
        return;
      }
      if (item.kind === 'memory') selectMemory(item.hit.memory as SessionData);
      else if (item.kind === 'command') item.command.action();
      else updateQuery(item.value);
    }
  };

  const kindLabel: Record<MemorySearchHit['matchKind'], string> = {
    exact: 'título',
    title: 'título',
    text: 'texto',
    tag: 'tag',
    semantic: 'semântica',
    mixed: 'misto',
  };

  const popularTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of memories) {
      for (const tag of m.tags || []) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag]) => tag);
  }, [memories]);

  return (
    <AnimatePresence>
      {isCommandPaletteOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsCommandPaletteOpen(false)}
            className="fixed inset-0 z-[99] bg-black/65 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -12 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Pesquisa Mnemosyne"
            className="fixed left-1/2 top-[12%] z-[100] w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-white/12 bg-[#07101f]/96 shadow-[0_32px_100px_rgba(0,0,0,0.65)] backdrop-blur-2xl focus-within:ring-1 focus-within:ring-violet-400/40"
          >
            <div className="flex items-center gap-3 border-b border-white/8 bg-black/30 px-4 py-3.5">
              {isSemanticLoading ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-cyan-300/80" />
              ) : (
                <Search className="h-5 w-5 shrink-0 text-violet-300/70" />
              )}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => updateQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Memórias, #tags, tag:trabalho, /web tema, definições…"
                className="w-full border-none bg-transparent font-sans text-base text-white outline-none placeholder:text-slate-500"
                aria-autocomplete="list"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => updateQuery('')}
                  className="rounded-lg p-1 text-slate-500 transition hover:bg-white/10 hover:text-white"
                  aria-label="Limpar pesquisa"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <kbd className="hidden shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-400 sm:inline">
                esc
              </kbd>
            </div>

            {/* Chips de ajuda / tags */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-white/5 px-3 py-2">
              {parsed.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border border-violet-400/25 bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-100"
                >
                  <Hash className="h-3 w-3" />
                  {tag}
                </span>
              ))}
              {!query.trim() && popularTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => updateQuery(`#${tag} `)}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400 transition hover:border-violet-400/30 hover:text-violet-100"
                >
                  #{tag}
                </button>
              ))}
              {!query.trim() && (
                <span className="ml-auto text-[10px] text-slate-600">
                  Ctrl+Enter · web · tag:x · #y
                </span>
              )}
              {query.trim() && memoryHits.length > 0 && (
                <span className="ml-auto text-[10px] text-cyan-200/60">
                  {memoryHits.length} memória(s)
                  {isSemanticLoading ? ' · a calcular semântica…' : ''}
                </span>
              )}
            </div>

            <div ref={listRef} className="mnem-scroll max-h-[min(24rem,50vh)] overflow-y-auto p-2">
              {showRecent && (
                <div className="mb-1">
                  <div className="flex items-center justify-between px-3 py-2">
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      <Clock className="h-3 w-3" /> Recentes
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        clearRecentSearches();
                        setRecent([]);
                      }}
                      className="text-[10px] text-slate-600 transition hover:text-slate-300"
                    >
                      limpar
                    </button>
                  </div>
                  {recent.map((value, idx) => {
                    const active = activeIndex === idx;
                    return (
                      <button
                        key={value}
                        type="button"
                        data-idx={idx}
                        onClick={() => updateQuery(value)}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left transition-colors ${
                          active ? 'bg-white/10' : 'hover:bg-white/5'
                        }`}
                      >
                        <Clock className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                        <span className="truncate text-sm text-slate-200">{value}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {memoryHits.length > 0 && (
                <div className="mb-1">
                  <p className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-violet-300/50">
                    <Sparkles className="h-3 w-3" /> Memórias
                  </p>
                  {memoryHits.map((hit, idx) => {
                    const itemIndex = showRecent ? recent.length + idx : idx;
                    const active = activeIndex === itemIndex;
                    const memory = hit.memory;
                    return (
                      <button
                        key={memory.id}
                        type="button"
                        data-idx={itemIndex}
                        onClick={() => selectMemory(memory as SessionData)}
                        onMouseEnter={() => setActiveIndex(itemIndex)}
                        className={`w-full rounded-xl px-4 py-3 text-left transition-colors ${
                          active ? 'bg-violet-500/15 ring-1 ring-violet-400/20' : 'hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="line-clamp-1 text-sm font-medium text-slate-100">
                            {memory.title || memory.text || 'Memória sem título'}
                          </span>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-slate-400">
                              {kindLabel[hit.matchKind]}
                            </span>
                            <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 font-mono text-[10px] text-cyan-200">
                              {Math.round(hit.score * 100)}%
                            </span>
                          </div>
                        </div>
                        {hit.snippet && (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                            {hit.snippet}
                          </p>
                        )}
                        {(memory.tags?.length || hit.matchedTags.length) ? (
                          <p className="mt-1.5 truncate text-[10px] text-violet-300/45">
                            {(hit.matchedTags.length ? hit.matchedTags : memory.tags || [])
                              .slice(0, 4)
                              .map((tag) => `#${tag}`)
                              .join(' ')}
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}

              {filteredCommands.length > 0 && (
                <>
                  <p className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    <Compass className="h-3 w-3" /> Comandos
                  </p>
                  {filteredCommands.map((cmd, idx) => {
                    const itemIndex = showRecent
                      ? recent.length + idx
                      : memoryHits.length + idx;
                    const active = activeIndex === itemIndex;
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        data-idx={itemIndex}
                        onClick={cmd.action}
                        onMouseEnter={() => setActiveIndex(itemIndex)}
                        className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
                          active ? 'bg-white/10' : 'hover:bg-white/5'
                        }`}
                      >
                        <div className={`rounded-lg border p-1.5 ${
                          active
                            ? 'border-violet-400/30 bg-violet-500/15 text-violet-200'
                            : 'border-white/8 bg-white/5 text-slate-400'
                        }`}>
                          {cmd.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="text-sm text-slate-100">{cmd.name}</span>
                          <p className="truncate text-[11px] text-slate-500">{cmd.hint}</p>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}

              {listItems.length === 0 && (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-slate-400">Nada encontrado.</p>
                  <p className="mt-2 text-xs text-slate-600">
                    Experimenta outra palavra, <code className="text-slate-500">#tag</code>,{' '}
                    <code className="text-slate-500">tag:trabalho</code> ou Ctrl+Enter para web.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-white/6 px-4 py-2 text-[10px] text-slate-500">
              <span>↑↓ · Enter · Ctrl+Enter web · Ctrl+K</span>
              <span className="text-violet-300/50">Mnemosyne Search</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

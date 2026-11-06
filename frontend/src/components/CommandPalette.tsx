import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUI } from '../contexts/UIContext';
import {
  Search, Settings, BarChart3, Crown, Sun, Globe2, Orbit, Compass, Sparkles, Radio,
  X, Clock, Hash, Activity, Shield, Cpu, Key, Loader2, Crosshair, Archive,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { dispatchOpenCapture } from '../utils/desktopCapture';
import { useTheme } from '../contexts/ThemeContext';
import type { SessionData, SessionSearchResults } from '../hooks/useSessions';
import { isFreeFirstMode } from '../config/monetization';
import { parseAiCommand } from '../services/aiCommandParser';
import { useTranslation } from '../utils/translations';
import {
  parseSearchQuery,
  searchMemories,
  filterSearchCandidates,
  type MemorySearchHit,
} from '../utils/searchMemories';
import { clearRecentSearches, pushRecentSearch, readRecentSearches } from '../services/recentSearches';
import { onMemoryCryptoChanged } from '../services/memoryCrypto';

interface CommandPaletteProps {
  uid?: string | null;
  vaultUnlocked?: boolean;
  memories?: SessionData[];
  searchQuery?: string;
  searchResults?: SessionSearchResults;
  onSearchQueryChange?: (query: string) => void;
  onMemorySelect?: (memory: SessionData) => void;
  onWebResearch?: (query: string) => void;
  /** Abrir definições numa secção específica */
  onOpenSettings?: (section?: string) => void;
  /** Abrir Cognitive Pulse */
  onOpenPulse?: () => void;
  /** Abrir modo Insights */
  onOpenInsights?: () => void;
  /** Export soberano (ZIP local) */
  onOpenExport?: () => void;
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
  uid = null,
  vaultUnlocked = false,
  memories = [],
  searchQuery = '',
  searchResults,
  onSearchQueryChange,
  onMemorySelect,
  onWebResearch,
  onOpenSettings,
  onOpenPulse,
  onOpenInsights,
  onOpenExport,
  isSemanticLoading = false,
}) => {
  const { t } = useTranslation();
  const { isCommandPaletteOpen, setIsCommandPaletteOpen, setIsSettingsOpen } = useUI();
  const { toggleTheme } = useTheme();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const recentReadEpoch = useRef(0);
  const query = searchQuery;
  const currentSearchResults = searchResults?.uid === uid && searchResults.query === query.trim() ? searchResults : undefined;
  const semanticLoading = searchResults ? Boolean(currentSearchResults?.loading) : isSemanticLoading;
  const searchUnavailable = vaultUnlocked && Boolean(currentSearchResults?.error);
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
      setRecent([]);
      if (uid && vaultUnlocked) {
        let active = true;
        const epoch = ++recentReadEpoch.current;
        void readRecentSearches(uid).then((items) => {
          if (active && epoch === recentReadEpoch.current) setRecent(items);
        }).catch(() => {
          if (active && epoch === recentReadEpoch.current) setRecent([]);
        });
        return () => { active = false; };
      }
    }
  }, [isCommandPaletteOpen, uid, vaultUnlocked]);

  useEffect(() => onMemoryCryptoChanged(() => {
    recentReadEpoch.current += 1;
    setRecent([]);
  }), []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const updateQuery = (nextQuery: string) => {
    onSearchQueryChange?.(nextQuery);
  };

  const recordRecent = useCallback((value: string) => {
    if (!uid || !vaultUnlocked || value.trim().length < 2) return;
    // Reload on the next opening; a completed write must not repopulate UI after lock/account change.
    void pushRecentSearch(uid, value).catch(() => undefined);
  }, [uid, vaultUnlocked]);

  const runCommand = useCallback((cmd: () => void) => {
    recordRecent(query);
    setIsCommandPaletteOpen(false);
    setTimeout(cmd, 100);
  }, [query, recordRecent, setIsCommandPaletteOpen]);

  const openSettings = useCallback((section?: string) => {
    runCommand(() => {
      if (onOpenSettings) onOpenSettings(section);
      else setIsSettingsOpen(true);
    });
  }, [onOpenSettings, runCommand, setIsSettingsOpen]);

  const parsedCommand = parseAiCommand(query.trim());
  const webResearchQuery = parsedCommand.type === 'web-research' ? parsedCommand.query : '';
  const runWebResearchCommand = useCallback(() => {
    runCommand(() => onWebResearch?.(webResearchQuery || query.trim()));
  }, [runCommand, onWebResearch, webResearchQuery, query]);

  const commands: CommandItem[] = useMemo(() => [
    {
      id: 'web-research',
      name: parsedCommand.type === 'web-research' ? t('cmdWebNow') : t('cmdWeb'),
      hint: t('cmdWebHint'),
      icon: <Globe2 className="h-4 w-4" />,
      action: runWebResearchCommand,
      keywords: ['web', 'internet', 'pesquisar', 'google'],
    },
    {
      id: 'capture',
      name: t('cmdCapture'),
      hint: t('cmdCaptureHint'),
      icon: <Crosshair className="h-4 w-4" />,
      action: () => runCommand(() => dispatchOpenCapture()),
      keywords: ['captura', 'escrever', 'memória', 'flow'],
    },
    {
      id: 'universe',
      name: t('cmdUniverse'),
      hint: t('cmdUniverseHint'),
      icon: <Orbit className="h-4 w-4" />,
      action: () => runCommand(() => navigate('/')),
      keywords: ['3d', 'espaço', 'galáxia', 'cosmos'],
    },
    {
      id: 'pulse',
      name: t('cmdPulse'),
      hint: t('cmdPulseHint'),
      icon: <Activity className="h-4 w-4" />,
      action: () => runCommand(() => onOpenPulse?.()),
      keywords: ['pulso', 'insights', 'dia'],
    },
    {
      id: 'insights',
      name: t('cmdInsights'),
      hint: t('cmdInsightsHint'),
      icon: <Sparkles className="h-4 w-4" />,
      action: () => runCommand(() => onOpenInsights?.()),
      keywords: ['padrão', 'contradição'],
    },
    {
      id: 'comms',
      name: t('cmdComms'),
      hint: t('cmdCommsHint'),
      icon: <Radio className="h-4 w-4" />,
      action: () => runCommand(() => {
        if (window.location.pathname !== '/') navigate('/');
      }),
      keywords: ['enviar', 'p2p', 'mensagem'],
    },
    {
      id: 'export',
      name: t('exportTitle'),
      hint: t('cmdExportHint'),
      icon: <Archive className="h-4 w-4" />,
      action: () => runCommand(() => onOpenExport?.()),
      keywords: ['export', 'backup', 'zip', 'soberano', 'download'],
    },
    {
      id: 'settings',
      name: t('settings'),
      hint: t('cmdSettingsHint'),
      icon: <Settings className="h-4 w-4" />,
      action: () => openSettings(),
      keywords: ['config', 'opções', 'settings'],
    },
    {
      id: 'settings-ai',
      name: t('cmdSettingsAi'),
      hint: t('cmdSettingsAiHint'),
      icon: <Cpu className="h-4 w-4" />,
      action: () => openSettings('ai'),
      keywords: ['ollama', 'openai', 'modelo', 'llm'],
    },
    {
      id: 'settings-privacy',
      name: t('cmdSettingsPrivacy'),
      hint: t('cmdSettingsPrivacyHint'),
      icon: <Shield className="h-4 w-4" />,
      action: () => openSettings('privacy'),
      keywords: ['pin', 'segurança', 'zk'],
    },
    {
      id: 'settings-identity',
      name: t('cmdSettingsIdentity'),
      hint: t('cmdSettingsIdentityHint'),
      icon: <Key className="h-4 w-4" />,
      action: () => openSettings('identity'),
      keywords: ['chave', 'seed', 'mnemónica'],
    },
    {
      id: 'settings-capture',
      name: t('cmdSettingsCapture'),
      hint: t('cmdSettingsCaptureHint'),
      icon: <Crosshair className="h-4 w-4" />,
      action: () => openSettings('capture'),
      keywords: ['clipper', 'atalho', 'hotkey', 'extensão', 'chrome'],
    },
    {
      id: 'analytics',
      name: t('cmdAnalytics'),
      hint: t('cmdAnalyticsHint'),
      icon: <BarChart3 className="h-4 w-4" />,
      action: () => runCommand(() => navigate('/analytics')),
    },
    {
      id: 'upgrade',
      name: isFreeFirstMode ? t('cmdFounderPreview') : t('plans'),
      hint: isFreeFirstMode ? t('cmdFounderHint') : t('cmdUpgradeHint'),
      icon: <Crown className="h-4 w-4" />,
      action: () => runCommand(() => navigate('/pricing')),
    },
    {
      id: 'theme',
      name: t('cmdTheme'),
      hint: t('cmdThemeHint'),
      icon: <Sun className="h-4 w-4" />,
      action: () => runCommand(() => toggleTheme()),
      keywords: ['dark', 'light', 'tema'],
    },
  ], [parsedCommand.type, navigate, openSettings, onOpenPulse, onOpenInsights, onOpenExport, runCommand, toggleTheme, runWebResearchCommand, t]);

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

  // An explicit empty/current result must not reopen the general memory list.
  const memoryHits: MemorySearchHit[] = useMemo(() => {
    if (!query.trim() || !uid || !vaultUnlocked) return [];
    if (searchResults) {
      if (!currentSearchResults) return [];
      const readable = new Set(filterSearchCandidates(currentSearchResults.hits.map(hit => hit.memory), query).map(memory => memory.id));
      return currentSearchResults.hits.filter(hit => readable.has(hit.memory.id)).slice(0, 10);
    }
    return searchMemories(memories, query, { limit: 10, semanticFloor: 0.38, semanticScores: new Map() });
  }, [memories, query, uid, vaultUnlocked, searchResults, currentSearchResults]);

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
    recordRecent(query);
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
    exact: t('cmdKindTitle'),
    title: t('cmdKindTitle'),
    text: t('cmdKindText'),
    tag: t('cmdKindTag'),
    semantic: t('cmdKindSemantic'),
    mixed: t('cmdKindMixed'),
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
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -16 }}
            transition={{ type: 'spring', damping: 28, stiffness: 380 }}
            role="dialog"
            aria-modal="true"
            aria-label={t('cmdAria')}
            className="fixed left-1/2 top-[12%] z-[100] w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-violet-400/20 bg-[#07101f]/95 shadow-[0_32px_100px_rgba(0,0,0,0.7),0_0_40px_rgba(139,92,246,0.15)] backdrop-blur-2xl focus-within:border-violet-400/40 focus-within:ring-2 focus-within:ring-violet-400/15"
          >
            <div className="flex items-center gap-3 border-b border-white/[0.08] bg-black/40 px-4 py-3.5">
              {semanticLoading ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-cyan-300" />
              ) : (
                <Search className="h-5 w-5 shrink-0 text-violet-300" />
              )}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => updateQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={t('cmdPlaceholder')}
                className="w-full border-none bg-transparent font-sans text-base text-white outline-none placeholder:text-slate-500"
                aria-autocomplete="list"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => updateQuery('')}
                  className="rounded-lg p-1 text-slate-500 transition hover:bg-white/10 hover:text-white"
                  aria-label={t('cmdClear')}
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
              <p className="w-full text-xs text-slate-400">{t('cmdFilterHelp')}</p>
              {parsed.invalidFilter && <p role="status" className="w-full text-xs text-amber-200">{t('cmdInvalidFilter')}</p>}
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
                  {t('cmdHintKeys')}
                </span>
              )}
              {query.trim() && memoryHits.length > 0 && (
                <span className="ml-auto text-[10px] text-cyan-200/60">
                  {t('cmdHits', { count: memoryHits.length })}
                  {semanticLoading ? t(searchResults ? 'cmdSearching' : 'cmdSemantic') : ''}
                </span>
              )}
            </div>

            <div ref={listRef} className="mnem-scroll max-h-[min(24rem,50vh)] overflow-y-auto p-2">
              {searchUnavailable && <p role="status" className="px-4 py-3 text-sm text-amber-200">{t('cmdSearchUnavailable')}</p>}
              {vaultUnlocked && semanticLoading && memoryHits.length === 0 && (
                <p role="status" className="px-4 py-3 text-sm text-slate-400">{t('cmdSearching')}</p>
              )}
              {showRecent && (
                <div className="mb-1">
                  <div className="flex items-center justify-between px-3 py-2">
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      <Clock className="h-3 w-3" /> {t('cmdRecent')}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        recentReadEpoch.current += 1;
                        if (uid) {
                          try { clearRecentSearches(uid); } catch { /* private storage unavailable */ }
                        }
                        setRecent([]);
                      }}
                      className="text-[10px] text-slate-600 transition hover:text-slate-300"
                    >
                      {t('cmdClearRecent')}
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
                    <Sparkles className="h-3 w-3" /> {t('pulseMemories')}
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
                            {memory.title || memory.text || t('cmdUntitled')}
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
                    <Compass className="h-3 w-3" /> {t('cmdCommands')}
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

              {listItems.length === 0 && !searchUnavailable && !semanticLoading && (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-slate-400">{t('cmdNothing')}</p>
                  <p className="mt-2 text-xs text-slate-600">
                    {t('cmdNothingHint')}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-white/[0.08] bg-black/20 px-4 py-2.5 text-[10px] text-slate-400">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px] text-slate-300">↑</kbd>
                  <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px] text-slate-300">↓</kbd>
                  <span className="ml-0.5">{t('cmdNavigate')}</span>
                </span>
                <span className="text-slate-600">·</span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-slate-300">↵</kbd>
                  <span className="ml-0.5">{t('cmdSelect')}</span>
                </span>
                <span className="text-slate-600">·</span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-slate-300">Ctrl + K</kbd>
                  <span className="ml-0.5">{t('cmdToggle')}</span>
                </span>
              </div>
              <span className="font-medium text-violet-300/70">Mnemosyne Spotlight</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

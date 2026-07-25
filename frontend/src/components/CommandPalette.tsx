import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUI } from '../contexts/UIContext';
import { Search, Settings, BarChart3, Crown, Sun } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import type { SessionData } from '../hooks/useSessions';

interface CommandPaletteProps {
  memories?: SessionData[];
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onMemorySelect?: (memory: SessionData) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  memories = [],
  searchQuery = '',
  onSearchQueryChange,
  onMemorySelect,
}) => {
  const { isCommandPaletteOpen, setIsCommandPaletteOpen, setIsSettingsOpen } = useUI();
  const { toggleTheme } = useTheme();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const query = searchQuery;

  // Focus and keyboard logic
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
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    if (isCommandPaletteOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isCommandPaletteOpen]);

  const updateQuery = (nextQuery: string) => {
    onSearchQueryChange?.(nextQuery);
  };

  const runCommand = (cmd: () => void) => {
    setIsCommandPaletteOpen(false);
    setTimeout(() => {
      cmd();
    }, 150);
  };

  const commands = [
    { id: 'settings', name: 'Open Settings', icon: <Settings className="w-5 h-5" />, action: () => runCommand(() => setIsSettingsOpen(true)) },
    { id: 'analytics', name: 'Go to Analytics', icon: <BarChart3 className="w-5 h-5" />, action: () => runCommand(() => navigate('/analytics')) },
    { id: 'upgrade', name: 'Upgrade Plan', icon: <Crown className="w-5 h-5" />, action: () => runCommand(() => navigate('/pricing')) },
    { id: 'theme', name: 'Toggle Theme', icon: <Sun className="w-5 h-5" />, action: () => runCommand(() => toggleTheme()) },
  ];

  const filteredCommands = commands.filter((command) =>
    command.name.toLowerCase().includes(query.toLowerCase())
  );
  const memoryResults = query.trim()
    ? memories.slice(0, 8)
    : [];

  const selectMemory = (memory: SessionData) => {
    setIsCommandPaletteOpen(false);
    onMemorySelect?.(memory);
  };

  return (
    <AnimatePresence>
      {isCommandPaletteOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsCommandPaletteOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[99]"
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-xl z-[100] shadow-2xl glass-card border border-white/10 rounded-2xl overflow-hidden focus-within:ring-1 focus-within:ring-indigo-500/50"
          >
            <div className="flex items-center px-4 py-4 border-b border-white/10 bg-black/40">
              <Search className="w-5 h-5 text-gray-400 mr-3" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => updateQuery(e.target.value)}
                placeholder="Pesquisar memórias ou executar comando..."
                className="w-full bg-transparent text-white border-none focus:outline-none focus:ring-0 placeholder-gray-500 font-sans text-lg"
              />
              <div className="flex gap-1 ml-3 shrink-0">
                <kbd className="px-2 py-1 rounded-md bg-white/10 text-xs text-gray-400 font-sans border border-white/10">esc</kbd>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto p-2 bg-black/80">
              {memoryResults.length > 0 && (
                <div className="mb-2">
                  <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-indigo-300/60">
                    Memórias encontradas
                  </p>
                  {memoryResults.map((memory) => (
                    <button
                      key={memory.id}
                      onClick={() => selectMemory(memory)}
                      className="w-full px-4 py-3 rounded-xl hover:bg-indigo-500/10 text-left transition-colors duration-150 focus:bg-indigo-500/10 focus:outline-none"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="line-clamp-2 text-sm text-indigo-100">
                          {memory.title || memory.text || 'Memória sem título'}
                        </span>
                        {memory.semanticScore ? (
                          <span className="shrink-0 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-mono text-cyan-200">
                            {Math.round(memory.semanticScore * 100)}%
                          </span>
                        ) : null}
                      </div>
                      {memory.tags?.length ? (
                        <p className="mt-1 truncate text-[10px] text-indigo-300/45">
                          {memory.tags.slice(0, 4).map((tag) => `#${tag}`).join(' ')}
                        </p>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}

              {filteredCommands.length === 0 && memoryResults.length === 0 ? (
                <div className="py-6 text-center text-sm text-gray-500">
                  Nenhuma memória ou comando encontrado.
                </div>
              ) : (
                <>
                  {filteredCommands.length > 0 && (
                    <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                      Comandos
                    </p>
                  )}
                  {filteredCommands.map((cmd, idx) => (
                    <button
                      key={cmd.id}
                      onClick={cmd.action}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10 text-left transition-colors duration-150 focus:bg-white/10 focus:outline-none"
                      autoFocus={idx === 0 && memoryResults.length === 0}
                    >
                      <div className="text-gray-400">{cmd.icon}</div>
                      <span className="text-gray-200">{cmd.name}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

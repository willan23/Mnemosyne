import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, Search, Layers, X } from 'lucide-react';
import { useUniverseStore } from '../../store/universeStore';
import type { UniverseType } from '../../types/universe';

const UNIVERSE_TYPES: { value: UniverseType; label: string }[] = [
  { value: 'stellar', label: 'Stellar' },
  { value: 'quantum', label: 'Quantum' },
  { value: 'mythic', label: 'Mythic' },
  { value: 'oceanic', label: 'Oceanic' },
  { value: 'crystalline', label: 'Crystal' },
  { value: 'void', label: 'Void' },
  { value: 'garden', label: 'Garden' },
];

export const UniverseHUD: React.FC = () => {
  const {
    memories,
    universeType,
    setUniverseType,
    embeddingReady,
    isLoading,
    searchQuery,
    setSearchQuery,
    setFilteredIds,
  } = useUniverseStore();

  const [showUniverseSelector, setShowUniverseSelector] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setFilteredIds(null);
      return;
    }
    const lower = q.toLowerCase();
    const matched = memories
      .filter(
        (m) =>
          m.text.toLowerCase().includes(lower) ||
          (m.title && m.title.toLowerCase().includes(lower)) ||
          (m.tags && m.tags.some((t) => t.toLowerCase().includes(lower)))
      )
      .map((m) => m.id);
    setFilteredIds(matched.length > 0 ? matched : []);
  };

  return (
    <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
      <div className="flex items-center justify-between px-4 py-3 pointer-events-auto">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Brain size={18} className={embeddingReady ? 'text-indigo-400' : 'text-white/30'} />
            <span className="text-white font-semibold text-sm tracking-wide">Mnemosyne</span>
            {isLoading && (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-3 h-3 border border-indigo-400 border-t-transparent rounded-full"
              />
            )}
          </div>

          <div className="text-white/20 text-xs">|</div>

          <div className="flex items-center gap-3 text-white/40 text-xs">
            <span>{memories.length} memories</span>
            {memories.length > 0 && (
              <>
                <span>·</span>
                <span>
                  {memories.reduce((acc, m) => acc + m.connections.length, 0) / 2 | 0} connections
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {showSearch ? (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 200, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <Search size={12} className="text-white/40 flex-shrink-0" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search memories..."
                className="bg-transparent text-white/80 text-xs outline-none w-full placeholder-white/20"
              />
              <button
                onClick={() => {
                  setShowSearch(false);
                  handleSearchChange('');
                }}
                className="text-white/30 hover:text-white/60 flex-shrink-0"
              >
                <X size={12} />
              </button>
            </motion.div>
          ) : (
            <button
              onClick={() => setShowSearch(true)}
              className="p-2 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-all"
            >
              <Search size={14} />
            </button>
          )}

          <div className="relative">
            <button
              onClick={() => setShowUniverseSelector(!showUniverseSelector)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white/60 hover:text-white text-xs transition-all hover:bg-white/10"
              style={{ border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <Layers size={12} />
              <span>{UNIVERSE_TYPES.find((t) => t.value === universeType)?.label}</span>
            </button>

            {showUniverseSelector && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute right-0 top-10 rounded-xl overflow-hidden z-30"
                style={{ background: 'rgba(0,0,10,0.95)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                {UNIVERSE_TYPES.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => {
                      setUniverseType(type.value);
                      setShowUniverseSelector(false);
                    }}
                    className={`block w-full text-left px-4 py-2 text-xs transition-colors hover:bg-white/10 ${
                      universeType === type.value ? 'text-indigo-400' : 'text-white/60'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

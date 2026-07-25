import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star, Sun, Circle, Orbit, Zap, Infinity as InfinityIcon, Cloud } from 'lucide-react';
import { useUniverseStore } from '../../store/universeStore';
import type { CelestialType } from '../../types/universe';

const TYPE_ICONS: Record<CelestialType, React.ReactNode> = {
  star: <Star size={16} />,
  sun: <Sun size={16} />,
  planet: <Circle size={16} />,
  moon: <Orbit size={16} />,
  comet: <Zap size={16} />,
  black_hole: <InfinityIcon size={16} />,
  nebula: <Cloud size={16} />,
};

const TYPE_LABELS: Record<CelestialType, string> = {
  star: 'Star Memory',
  sun: 'Core Memory',
  planet: 'Deep Memory',
  moon: 'Orbital Memory',
  comet: 'Transient Thought',
  black_hole: 'Singularity',
  nebula: 'Knowledge Cloud',
};

const TYPE_COLORS: Record<CelestialType, string> = {
  star: '#aaccff',
  sun: '#ffdd44',
  planet: '#4488ff',
  moon: '#aaaaaa',
  comet: '#44ddff',
  black_hole: '#aa44ff',
  nebula: '#ff44aa',
};

interface MemoryDetailProps {
  onDelete?: (id: string) => void;
}

export const MemoryDetail: React.FC<MemoryDetailProps> = ({ onDelete }) => {
  const { memories, selectedMemoryId, selectMemory, startDeletion, removeMemory } = useUniverseStore();
  const selected = memories.find((m) => m.id === selectedMemoryId);

  const connectedMemories = selected
    ? memories.filter((m) => selected.connections.includes(m.id)).slice(0, 5)
    : [];

  const handleDelete = () => {
    if (selected) {
      startDeletion(selected.id, 'supernova');
      onDelete?.(selected.id);
      setTimeout(() => {
        removeMemory(selected.id);
        selectMemory(null);
      }, 800);
    }
  };

  return (
    <AnimatePresence>
      {selected && (
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="absolute right-4 top-20 bottom-4 w-80 flex flex-col gap-3 z-20 pointer-events-auto"
        >
          <div className="glass-card p-5 flex flex-col gap-4 flex-1 overflow-hidden">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2" style={{ color: TYPE_COLORS[selected.celestialType] }}>
                {TYPE_ICONS[selected.celestialType]}
                <span className="text-xs font-medium uppercase tracking-wider">
                  {TYPE_LABELS[selected.celestialType]}
                </span>
              </div>
              <button
                onClick={() => selectMemory(null)}
                className="text-white/40 hover:text-white transition-colors p-1"
              >
                <X size={16} />
              </button>
            </div>

            {selected.title && (
              <h3 className="text-white font-semibold text-base leading-snug">
                {selected.title}
              </h3>
            )}

            <p className="text-white/70 text-sm leading-relaxed flex-1 overflow-y-auto custom-scrollbar">
              {selected.text}
            </p>

            {selected.tags && selected.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selected.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs rounded-full bg-white/10 text-white/60"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {connectedMemories.length > 0 && (
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider mb-2">
                  Connected ({selected.connections.length})
                </p>
                <div className="flex flex-col gap-1">
                  {connectedMemories.map((mem) => (
                    <button
                      key={mem.id}
                      onClick={() => selectMemory(mem.id)}
                      className="text-left text-xs text-white/60 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/10 transition-all flex items-center gap-2"
                    >
                      <span style={{ color: TYPE_COLORS[mem.celestialType] }}>
                        {TYPE_ICONS[mem.celestialType]}
                      </span>
                      <span className="truncate">{mem.title || mem.text.substring(0, 35)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2 border-t border-white/5">
              <span className="text-white/30 text-xs">
                {new Date(selected.timestamp).toLocaleDateString()}
              </span>
              <span className="text-white/20 text-xs ml-auto">
                Importance: {(selected.importance * 100).toFixed(0)}%
              </span>
            </div>

            <button
              onClick={handleDelete}
              className="text-xs text-red-400/60 hover:text-red-400 transition-colors text-right"
            >
              Supernova delete
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

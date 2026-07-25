import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Layers, Compass, Loader2 } from 'lucide-react';
import { useUniverseStore } from '../../store/universeStore';
import type { UniverseType } from '../../types/universe';

const UNIVERSE_TYPES: { value: UniverseType; label: string }[] = [
  { value: 'stellar', label: 'Galáxia' },
  { value: 'solar', label: 'Sistema Solar' },
  { value: 'quantum', label: 'Quantum' },
  { value: 'mythic', label: 'Nebulosa' },
  { value: 'oceanic', label: 'Oceânico' },
  { value: 'crystalline', label: 'Cristal' },
  { value: 'void', label: 'Vazio' },
  { value: 'garden', label: 'Jardim' },
];

/** Compact controls for universe type + observatory mode (sits under page header). */
export const UniverseHUD: React.FC = () => {
  const {
    universeType,
    setUniverseType,
    embeddingReady,
    isLoading,
    isGalaxyView,
    setGalaxyView,
  } = useUniverseStore();

  const [showUniverseSelector, setShowUniverseSelector] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#050514]/72 p-1 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <button
        type="button"
        onClick={() => setGalaxyView(!isGalaxyView)}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all ${
          isGalaxyView
            ? 'border-indigo-400/50 bg-indigo-500/25 font-semibold text-indigo-200 shadow-[0_0_12px_rgba(99,102,241,0.35)]'
            : 'border-transparent bg-transparent text-white/60 hover:bg-white/10 hover:text-white'
        }`}
        title="Vista de observatório (zoom-out)"
      >
        <Compass
          size={12}
          className={isGalaxyView ? 'text-indigo-300' : ''}
          style={{ animation: isGalaxyView ? 'spin 10s linear infinite' : 'none' }}
        />
        <span className="hidden sm:inline">Observatório</span>
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowUniverseSelector(!showUniverseSelector)}
          className="flex items-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <Layers size={12} className="text-violet-300/80" />
          <span>{UNIVERSE_TYPES.find((t) => t.value === universeType)?.label}</span>
          {(isLoading || !embeddingReady) && (
            <Loader2 size={10} className="animate-spin text-amber-300/80" />
          )}
        </button>

        {showUniverseSelector && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute right-0 top-10 z-40 min-w-[11rem] overflow-hidden rounded-2xl border border-white/10 bg-[#050514]/96 shadow-2xl backdrop-blur-xl"
          >
            <p className="border-b border-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">
              Tipo de universo
            </p>
            {UNIVERSE_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => {
                  setUniverseType(type.value);
                  setShowUniverseSelector(false);
                }}
                className={`block w-full px-4 py-2.5 text-left text-xs transition-colors hover:bg-white/10 ${
                  universeType === type.value ? 'bg-violet-500/15 text-violet-200' : 'text-white/60'
                }`}
              >
                {type.label}
              </button>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Layers, Compass, Loader2 } from 'lucide-react';
import { useUniverseStore } from '../../store/universeStore';
import type { UniverseType } from '../../types/universe';
import { useTranslation } from '../../utils/translations';
import {
  TAXONOMY_COLORS,
  TAXONOMY_LABELS,
  TAXONOMY_LANES,
  type TaxonomyLane,
} from '../../utils/taxonomy';
import { getUniverseTheme, SETTINGS_UNIVERSE_TYPES } from '../../engines/universeThemes';

const LANE_SHORT: Record<TaxonomyLane, string> = {
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  E: 'E',
};

/** Compact controls: observatory + A–E taxonomy + universe skin. */
export const UniverseHUD: React.FC = () => {
  const { t, language } = useTranslation();
  const {
    universeType,
    setUniverseType,
    embeddingReady,
    isLoading,
    isGalaxyView,
    setGalaxyView,
    taxonomyFilter,
    setTaxonomyFilter,
    memories,
  } = useUniverseStore();

  const [showUniverseSelector, setShowUniverseSelector] = useState(false);
  const langKey = language.startsWith('en') || language.startsWith('fr') ? 'en' : 'pt';
  const activeTheme = getUniverseTheme(universeType);

  const laneCounts = TAXONOMY_LANES.reduce(
    (acc, lane) => {
      acc[lane] = memories.filter((m) => m.taxonomyLane === lane).length;
      return acc;
    },
    {} as Record<TaxonomyLane, number>,
  );

  const themeOptions = SETTINGS_UNIVERSE_TYPES.map((id) => getUniverseTheme(id));

  return (
    <div className="flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-2 rounded-full border border-white/10 bg-[#050514]/72 p-1 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <button
        type="button"
        onClick={() => setGalaxyView(!isGalaxyView)}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all ${
          isGalaxyView
            ? 'border-indigo-400/50 bg-indigo-500/25 font-semibold text-indigo-200 shadow-[0_0_12px_rgba(99,102,241,0.35)]'
            : 'border-transparent bg-transparent text-white/60 hover:bg-white/10 hover:text-white'
        }`}
        title={t('hudObservatoryTitle')}
      >
        <Compass
          size={12}
          className={isGalaxyView ? 'text-indigo-300' : ''}
          style={{ animation: isGalaxyView ? 'spin 10s linear infinite' : 'none' }}
        />
        <span className="hidden sm:inline">{t('hudObservatory')}</span>
      </button>

      <div className="flex items-center gap-0.5 rounded-full border border-white/5 bg-black/20 p-0.5">
        <button
          type="button"
          onClick={() => setTaxonomyFilter(null)}
          className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition ${
            taxonomyFilter === null
              ? 'bg-white/15 text-white'
              : 'text-white/40 hover:text-white/70'
          }`}
          title={t('hudTaxonomyAll')}
        >
          {t('hudTaxonomyAll')}
        </button>
        {TAXONOMY_LANES.map((lane) => {
          const active = taxonomyFilter === lane;
          const label = TAXONOMY_LABELS[lane][langKey === 'en' ? 'en' : 'pt'];
          return (
            <button
              key={lane}
              type="button"
              onClick={() => setTaxonomyFilter(active ? null : lane)}
              className="rounded-full px-2 py-1 text-[10px] font-semibold transition"
              style={{
                color: active ? '#050514' : TAXONOMY_COLORS[lane],
                background: active ? TAXONOMY_COLORS[lane] : 'transparent',
                opacity: laneCounts[lane] === 0 && !active ? 0.35 : 1,
              }}
              title={`${LANE_SHORT[lane]} · ${label}${laneCounts[lane] ? ` (${laneCounts[lane]})` : ''}`}
            >
              {LANE_SHORT[lane]}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowUniverseSelector(!showUniverseSelector)}
          className="flex items-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{
              background: `radial-gradient(circle, ${activeTheme.preview.glow} 0%, ${activeTheme.preview.accent} 70%)`,
              boxShadow: `0 0 8px ${activeTheme.preview.accent}88`,
            }}
          />
          <Layers size={12} className="text-white/50" />
          <span>{langKey === 'en' ? activeTheme.labelEn : activeTheme.labelPt}</span>
          {(isLoading || !embeddingReady) && (
            <Loader2 size={10} className="animate-spin text-amber-300/80" />
          )}
        </button>

        {showUniverseSelector && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute right-0 top-10 z-40 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#050514]/96 shadow-2xl backdrop-blur-xl"
          >
            <p className="border-b border-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">
              {t('hudUniverseType')}
            </p>
            {themeOptions.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => {
                  setUniverseType(theme.id as UniverseType);
                  setShowUniverseSelector(false);
                }}
                className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/10 ${
                  universeType === theme.id ? 'bg-white/[0.07]' : ''
                }`}
              >
                <span
                  className="mt-0.5 h-6 w-6 shrink-0 rounded-full"
                  style={{
                    background: `radial-gradient(circle at 40% 35%, ${theme.preview.glow}, ${theme.preview.mid} 55%, ${theme.preview.sky})`,
                  }}
                />
                <span className="min-w-0">
                  <span className={`block text-xs ${universeType === theme.id ? 'text-white' : 'text-white/70'}`}>
                    {langKey === 'en' ? theme.labelEn : theme.labelPt}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-white/40">
                    {langKey === 'en' ? theme.blurbEn : theme.blurbPt}
                  </span>
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
};

import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Compass,
  GitBranch,
  Link2,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import type { SessionData } from '../hooks/useSessions';
import {
  buildCognitivePulse,
  markPulseSeen,
  type CognitivePulseHighlight,
} from '../services/cognitivePulse';
import type { InsightKind } from '../services/insightEngine';
import { useTranslation } from '../utils/translations';

interface CognitivePulsePanelProps {
  isOpen: boolean;
  sessions: readonly SessionData[];
  uid: string;
  onClose: () => void;
  onOpenMemory: (memoryId: string) => void;
  onOpenInsights: () => void;
}

const KIND_TONE: Record<InsightKind, { icon: React.ReactNode; tone: string }> = {
  contradiction: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    tone: 'border-amber-400/25 bg-amber-500/10 text-amber-100',
  },
  resurface: {
    icon: <Sparkles className="h-3.5 w-3.5" />,
    tone: 'border-violet-400/25 bg-violet-500/10 text-violet-100',
  },
  pattern: {
    icon: <GitBranch className="h-3.5 w-3.5" />,
    tone: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-100',
  },
  orphan: {
    icon: <Link2 className="h-3.5 w-3.5" />,
    tone: 'border-rose-400/25 bg-rose-500/10 text-rose-100',
  },
};

const KIND_LABEL_KEY: Record<InsightKind, 'pulseKindTension' | 'pulseKindEcho' | 'pulseKindPattern' | 'pulseKindOrphan'> = {
  contradiction: 'pulseKindTension',
  resurface: 'pulseKindEcho',
  pattern: 'pulseKindPattern',
  orphan: 'pulseKindOrphan',
};

const HighlightCard: React.FC<{
  item: CognitivePulseHighlight;
  onOpen: (memoryId: string) => void;
}> = ({ item, onOpen }) => {
  const { t } = useTranslation();
  const meta = KIND_TONE[item.kind];
  const primaryId = item.memoryIds[0];

  return (
    <button
      type="button"
      onClick={() => primaryId && onOpen(primaryId)}
      className="group w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-violet-400/30 hover:bg-violet-500/[0.06]"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${meta.tone}`}
        >
          {meta.icon}
          {t(KIND_LABEL_KEY[item.kind])}
        </span>
        <span className="text-[10px] text-slate-500">
          {t('pulseSignal', { pct: Math.round(item.score * 100) })}
        </span>
      </div>
      <p className="text-sm font-semibold text-white group-hover:text-violet-50">{item.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{item.summary}</p>
      {item.evidence[0] && (
        <p className="mt-2 line-clamp-2 text-[11px] italic text-slate-500">
          “{item.evidence[0]}”
        </p>
      )}
    </button>
  );
};

export const CognitivePulsePanel: React.FC<CognitivePulsePanelProps> = ({
  isOpen,
  sessions,
  uid,
  onClose,
  onOpenMemory,
  onOpenInsights,
}) => {
  const { t } = useTranslation();
  const pulse = useMemo(() => buildCognitivePulse(sessions), [sessions]);

  const dismiss = () => {
    markPulseSeen(uid);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-[#020617]/75 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={dismiss}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cognitive-pulse-title"
            className="relative flex max-h-[min(92vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-violet-400/20 bg-[#0b1224]/96 shadow-[0_0_80px_rgba(139,92,246,0.18)]"
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
          >
            <div className="border-b border-white/5 px-5 pb-4 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl border border-violet-400/25 bg-violet-500/15 p-3">
                    <Activity className="h-5 w-5 text-violet-200" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-200/80">
                      {t('pulseEyebrow')}
                    </p>
                    <h2
                      id="cognitive-pulse-title"
                      className="mt-1 text-lg font-semibold tracking-tight text-white"
                    >
                      {pulse.title}
                    </h2>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{pulse.subtitle}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
                  aria-label={t('pulseClose')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: t('pulseMemories'), value: pulse.stats.memories, icon: Star },
                  { label: t('pulseLinks'), value: pulse.stats.connections, icon: Link2 },
                  { label: t('pulseEchos'), value: pulse.stats.resurfacing, icon: Sparkles },
                  { label: t('pulseTensions'), value: pulse.stats.contradictions, icon: AlertTriangle },
                ].map(({ label, value, icon: Icon }) => (
                  <div
                    key={label}
                    className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
                      <Icon className="h-3 w-3" />
                      {label}
                    </div>
                    <p className="mt-1 text-lg font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 mnem-scroll">
              {pulse.highlights.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
                  <Compass className="mx-auto h-8 w-8 text-slate-600" />
                  <p className="mt-3 text-sm font-medium text-slate-300">{t('pulseEmptyTitle')}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {t('pulseEmptyBody')}
                  </p>
                </div>
              ) : (
                pulse.highlights.map((item) => (
                  <HighlightCard
                    key={item.id}
                    item={item}
                    onOpen={(id) => {
                      markPulseSeen(uid);
                      onOpenMemory(id);
                      onClose();
                    }}
                  />
                ))
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-white/5 px-5 py-4 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  markPulseSeen(uid);
                  onOpenInsights();
                  onClose();
                }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/15 py-2.5 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/25"
              >
                <Activity className="h-4 w-4" />
                {t('pulseOpenInsights')}
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
              >
                {t('onbEnterUniverse')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

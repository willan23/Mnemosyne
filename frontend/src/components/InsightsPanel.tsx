import React, { useMemo } from 'react';
import { AlertTriangle, GitBranch, Link2Off, RotateCcw, Sparkles, X } from 'lucide-react';
import type { SessionData } from '../hooks/useSessions';
import { generateCognitiveInsights, type CognitiveInsight, type InsightKind } from '../services/insightEngine';

interface Props {
  sessions: SessionData[];
  onMemoryClick: (session: SessionData) => void;
  onClose?: () => void;
}

const ICONS: Record<InsightKind, React.ComponentType<{ className?: string }>> = {
  contradiction: AlertTriangle,
  orphan: Link2Off,
  resurface: RotateCcw,
  pattern: GitBranch,
};

const KIND_LABELS: Record<InsightKind, string> = {
  contradiction: 'Tensão provável',
  orphan: 'Órfã',
  resurface: 'Regresso',
  pattern: 'Padrão',
};

const memoryLabel = (memory: SessionData, index: number) => {
  const title = memory.title?.trim();
  if (title) return title.length > 36 ? `${title.slice(0, 35)}…` : title;
  const text = memory.text?.replace(/\s+/g, ' ').trim() || '';
  if (text) return text.length > 36 ? `${text.slice(0, 35)}…` : text;
  return `Memória ${index + 1}`;
};

const findMemory = (sessions: SessionData[], id: string) => sessions.find((session) => session.id === id);

const InsightCard: React.FC<{
  insight: CognitiveInsight;
  sessions: SessionData[];
  onMemoryClick: (session: SessionData) => void;
}> = ({ insight, sessions, onMemoryClick }) => {
  const Icon = ICONS[insight.kind];
  const severityClass = insight.severity === 'high'
    ? 'border-rose-400/35 bg-rose-500/10 text-rose-200'
    : insight.severity === 'medium'
      ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
      : 'border-white/10 bg-white/5 text-white/75';

  const related = insight.memoryIds
    .map((id) => findMemory(sessions, id))
    .filter((memory): memory is SessionData => Boolean(memory))
    .slice(0, 4);

  return (
    <article className={`rounded-xl border p-4 transition hover:border-white/20 ${severityClass}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg border border-white/10 bg-black/20 p-2">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-white/45">
              {KIND_LABELS[insight.kind]}
            </span>
            <span className="h-1 w-1 rounded-full bg-white/25" />
            <span className="text-[10px] uppercase tracking-widest text-white/35">
              {Math.round(insight.score * 100)}%
            </span>
          </div>
          <h3 className="text-sm font-semibold leading-snug text-white">{insight.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/55">{insight.summary}</p>
        </div>
      </div>

      {insight.evidence.length > 0 && (
        <div className="mt-3 space-y-2">
          {insight.evidence.slice(0, 3).map((item, index) => (
            <p
              key={`${insight.id}-ev-${index}`}
              className="rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-xs leading-relaxed text-white/55"
            >
              {item}
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {related.map((memory, index) => (
          <button
            key={`${insight.id}-${memory.id}`}
            type="button"
            onClick={() => onMemoryClick(memory)}
            title={memory.title || memory.text?.slice(0, 80)}
            className="max-w-full truncate rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white/70 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
          >
            {memoryLabel(memory, index)}
          </button>
        ))}
      </div>

      {related.length >= 2 && insight.kind === 'orphan' && (
        <p className="mt-3 text-[11px] leading-relaxed text-white/40">
          Abre a memória e associa tags ou edita o texto para o autolink criar ligações.
        </p>
      )}
      {related.length >= 2 && insight.kind === 'contradiction' && (
        <p className="mt-3 text-[11px] leading-relaxed text-white/40">
          Compara as duas memórias e sintetiza uma nova versão se a tensão for real.
        </p>
      )}
    </article>
  );
};

export const InsightsPanel: React.FC<Props> = ({ sessions, onMemoryClick, onClose }) => {
  const insights = useMemo(() => generateCognitiveInsights(sessions), [sessions]);
  const counts = useMemo(() => ({
    total: sessions.length,
    linked: sessions.filter((session) => (session.connections?.length || 0) > 0).length,
    contradictions: insights.filter((insight) => insight.kind === 'contradiction').length,
    orphans: insights.filter((insight) => insight.kind === 'orphan').length,
  }), [insights, sessions]);

  return (
    <aside className="absolute bottom-28 right-3 top-20 z-40 flex w-[min(420px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#020617]/90 text-white shadow-2xl shadow-cyan-950/25 backdrop-blur-2xl md:right-6 md:top-24">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan-200/50">Insights</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Motor cognitivo</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-2 text-cyan-200">
              <Sparkles className="h-5 w-5" />
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/10 p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
                aria-label="Fechar insights"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Memórias', value: counts.total },
            { label: 'Ligadas', value: counts.linked },
            { label: 'Tensões', value: counts.contradictions },
            { label: 'Órfãs', value: counts.orphans },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border border-white/5 bg-white/[0.03] px-2 py-2">
              <p className="text-[9px] uppercase tracking-widest text-white/35">{stat.label}</p>
              <p className="text-base font-semibold text-white sm:text-lg">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mnem-scroll min-h-0 flex-1 overflow-y-auto p-4">
        {insights.length > 0 ? (
          <div className="space-y-3">
            {insights.map((insight) => (
              <InsightCard
                key={insight.id}
                insight={insight}
                sessions={sessions}
                onMemoryClick={onMemoryClick}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
            <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3 text-white/45">
              <GitBranch className="h-6 w-6" />
            </div>
            <p className="max-w-64 text-sm font-medium text-white/75">
              Ainda não há massa crítica para gerar insights.
            </p>
            <p className="mt-2 max-w-72 text-xs leading-relaxed text-white/40">
              Cria memórias na captura do Universo — o motor sugere tensões prováveis, memórias isoladas, regressos e padrões.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
};

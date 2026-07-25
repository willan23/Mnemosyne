import React, { useMemo } from 'react';
import { AlertTriangle, GitBranch, Link2Off, RotateCcw, Sparkles } from 'lucide-react';
import type { SessionData } from '../hooks/useSessions';
import { generateCognitiveInsights, type CognitiveInsight, type InsightKind } from '../services/insightEngine';

interface Props {
  sessions: SessionData[];
  onMemoryClick: (session: SessionData) => void;
}

const ICONS: Record<InsightKind, React.ComponentType<{ className?: string }>> = {
  contradiction: AlertTriangle,
  orphan: Link2Off,
  resurface: RotateCcw,
  pattern: GitBranch,
};

const KIND_LABELS: Record<InsightKind, string> = {
  contradiction: 'Contradicao',
  orphan: 'Orfa',
  resurface: 'Regresso',
  pattern: 'Padrao',
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

  return (
    <article className={`rounded-lg border p-4 ${severityClass}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md border border-white/10 bg-black/20 p-2">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
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
          {insight.evidence.map((item, index) => (
            <p key={`${insight.id}-ev-${index}`} className="rounded-md border border-white/5 bg-black/20 px-3 py-2 text-xs leading-relaxed text-white/55">
              {item}
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {insight.memoryIds
          .map((id) => findMemory(sessions, id))
          .filter((memory): memory is SessionData => Boolean(memory))
          .slice(0, 4)
          .map((memory, index) => (
            <button
              key={`${insight.id}-${memory.id}`}
              onClick={() => onMemoryClick(memory)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white/60 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
            >
              Memoria {index + 1}
            </button>
          ))}
      </div>
    </article>
  );
};

export const InsightsPanel: React.FC<Props> = ({ sessions, onMemoryClick }) => {
  const insights = useMemo(() => generateCognitiveInsights(sessions), [sessions]);
  const counts = useMemo(() => ({
    total: sessions.length,
    linked: sessions.filter((session) => (session.connections?.length || 0) > 0).length,
    contradictions: insights.filter((insight) => insight.kind === 'contradiction').length,
  }), [insights, sessions]);

  return (
    <aside className="absolute bottom-28 right-4 top-24 z-40 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-white/10 bg-[#020617]/88 text-white shadow-2xl shadow-cyan-950/20 backdrop-blur-2xl md:right-8">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan-200/50">Insights</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Motor cognitivo</h2>
          </div>
          <div className="rounded-md border border-cyan-300/20 bg-cyan-300/10 p-2 text-cyan-200">
            <Sparkles className="h-5 w-5" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2">
            <p className="text-[10px] uppercase tracking-widest text-white/35">Memorias</p>
            <p className="text-lg font-semibold text-white">{counts.total}</p>
          </div>
          <div className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2">
            <p className="text-[10px] uppercase tracking-widest text-white/35">Ligadas</p>
            <p className="text-lg font-semibold text-white">{counts.linked}</p>
          </div>
          <div className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2">
            <p className="text-[10px] uppercase tracking-widest text-white/35">Tensoes</p>
            <p className="text-lg font-semibold text-white">{counts.contradictions}</p>
          </div>
        </div>
      </div>

      <div className="h-[calc(100%-156px)] overflow-y-auto p-4">
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
            <div className="mb-4 rounded-md border border-white/10 bg-white/5 p-3 text-white/45">
              <GitBranch className="h-6 w-6" />
            </div>
            <p className="max-w-64 text-sm font-medium text-white/75">Ainda nao ha massa critica para gerar insights.</p>
            <p className="mt-2 max-w-72 text-xs leading-relaxed text-white/40">
              O painel ganha sinal quando existem memorias com texto, tempo, etiquetas ou embeddings guardados.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
};

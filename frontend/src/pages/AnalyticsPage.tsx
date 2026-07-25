import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { ArrowLeft, BarChart3, Brain, CalendarDays, Clock, Flame, Tags } from 'lucide-react';
import { auth } from '../firebase';
import { useSessions, type FilterOptions } from '../hooks/useSessions';
import { calculateAnalytics } from '../services/analyticsService';

const filters: FilterOptions = {
  dateRange: 'all',
  tags: [],
  category: undefined,
};

const Metric: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint?: string;
}> = ({ icon: Icon, label, value, hint }) => (
  <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
    <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/45">
      <Icon className="h-4 w-4 text-cyan-300" />
      {label}
    </div>
    <div className="text-3xl font-semibold text-white">{value}</div>
    {hint && <p className="mt-1 text-xs text-white/40">{hint}</p>}
  </div>
);

export const AnalyticsPage: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [authReady, setAuthReady] = useState(Boolean(auth.currentUser));
  const { sessions, isLoading } = useSessions(user, '', filters);
  const analytics = useMemo(() => calculateAnalytics(sessions), [sessions]);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
  }, []);

  const maxActivity = Math.max(1, ...analytics.recentActivity.map((item) => item.count));

  return (
    <div className="min-h-screen bg-[#050816] px-4 py-8 text-white">
      <div className="mx-auto max-w-6xl">
        <button
          onClick={() => navigate('/')}
          className="mb-8 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao Mnemosyne
        </button>

        <header className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-cyan-100">
            <BarChart3 className="h-3.5 w-3.5" />
            Analytics
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">Painel de atividade cognitiva</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/50">
            Métricas locais das tuas memórias, ligações e ritmo de criação. No Founder Preview, esta área fica aberta.
          </p>
        </header>

        {!authReady || isLoading ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-8 text-sm text-white/50">
            A calcular analytics...
          </div>
        ) : !user ? (
          <div className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-8 text-sm text-amber-100">
            Entra na tua conta para ver analytics.
          </div>
        ) : (
          <div className="space-y-8">
            <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Metric icon={Brain} label="Memórias" value={analytics.totalMemories} hint={`${analytics.totalWords} palavras no total`} />
              <Metric icon={CalendarDays} label="Este mês" value={analytics.memoriesThisMonth} hint={`${analytics.memoriesThisWeek} esta semana`} />
              <Metric icon={Flame} label="Streak" value={`${analytics.currentStreak}d`} hint={`Recorde: ${analytics.longestStreak}d`} />
              <Metric icon={Clock} label="Hora ativa" value={`${analytics.mostActiveHour}:00`} hint={analytics.mostActiveDay} />
            </section>

            <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-white/45">Últimos 30 dias</h2>
              <div className="flex h-44 items-end gap-1">
                {analytics.recentActivity.map((item) => (
                  <div key={item.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <div
                      className="w-full rounded-t bg-cyan-400/70"
                      style={{ height: `${Math.max(4, (item.count / maxActivity) * 150)}px` }}
                      title={`${item.date}: ${item.count}`}
                    />
                    <span className="hidden text-[9px] text-white/35 sm:block">{item.date}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/45">
                  <Tags className="h-4 w-4 text-violet-300" />
                  Tags principais
                </h2>
                {analytics.topTags.length === 0 ? (
                  <p className="text-sm text-white/40">Ainda não há tags suficientes.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {analytics.topTags.map((tag) => (
                      <span key={tag.name} className="rounded-full border border-violet-300/20 bg-violet-300/10 px-3 py-1 text-xs text-violet-100">
                        #{tag.name} · {tag.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-white/45">Memórias esquecidas</h2>
                {analytics.forgottenMemories.length === 0 ? (
                  <p className="text-sm text-white/40">Nada crítico por agora.</p>
                ) : (
                  <div className="space-y-2">
                    {analytics.forgottenMemories.map((memory) => (
                      <p key={memory.id} className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">
                        {memory.text} · {memory.daysSinceLastView}d
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};

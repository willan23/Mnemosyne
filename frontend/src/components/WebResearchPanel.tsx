import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, BookmarkPlus, Check, ExternalLink, Globe2, Link2, Lock, Search, Shield, X } from 'lucide-react';
import { addDoc, arrayUnion, collection, doc, updateDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { auth, db } from '../firebase';
import { cognitiveEngine } from '../engines/CognitiveEngine';
import type { CelestialType, MemoryObject } from '../types/universe';
import type { SessionData } from '../hooks/useSessions';
import { runWebResearch, type WebResearchMode, type WebResearchResult } from '../services/webResearchService';

interface WebResearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: SessionData[];
  initialQuery?: string;
  onMemoryCreated?: (memoryId: string) => void;
}

const STOPWORDS = new Set([
  'ainda', 'algo', 'aqui', 'cada', 'como', 'com', 'das', 'dos', 'este', 'esta', 'mais',
  'para', 'pela', 'pelo', 'porque', 'sobre', 'that', 'this', 'with', 'from', 'have',
  'were', 'they', 'their', 'what', 'when', 'where', 'which',
]);

const toTerms = (value: string): Set<string> => new Set(
  (value.toLowerCase().match(/[a-zà-ÿ0-9]{4,}/g) || [])
    .filter((token) => !STOPWORDS.has(token))
);

const toMemoryObject = (session: SessionData): MemoryObject => ({
  id: session.id,
  text: session.text || '',
  title: session.title,
  celestialType: (session.celestialType || 'planet') as CelestialType,
  position: session.position || [0, 0, 0],
  embedding: session.embedding || [],
  connections: session.connections || [],
  semanticClusterId: session.semanticClusterId,
  importance: session.importance || 0.5,
  timestamp: session.timestamp || 0,
  updatedAt: session.updatedAt || session.timestamp || 0,
  uid: session.uid,
  tags: session.tags,
  category: session.category,
});

const formatResearchAsMemory = (result: WebResearchResult): string => [
  `[Pesquisa web] ${result.query}`,
  '',
  'Resumo',
  result.summary,
  '',
  'Ideias principais',
  ...result.main_ideas.map((idea, index) => `${index + 1}. ${idea}`),
  '',
  'Conceitos-chave',
  result.key_concepts.map((concept) => `#${concept}`).join(' '),
  '',
  'Fontes',
  ...result.sources.map((source, index) => `${index + 1}. ${source.title} - ${source.url}`),
].join('\n');

const buildPrivateLocalComparisons = (result: WebResearchResult, memories: SessionData[]): string[] => {
  const researchTerms = toTerms([
    result.summary,
    ...result.main_ideas,
    ...result.key_concepts,
  ].join(' '));

  return memories
    .map((memory) => {
      const memoryTerms = toTerms(`${memory.title || ''} ${memory.text || ''}`);
      const overlap = [...memoryTerms].filter((term) => researchTerms.has(term));
      const score = overlap.length / Math.max(memoryTerms.size, 1);
      const webNegated = /\b(nao|não|not|never|sem|without)\b/i.test(result.summary);
      const memoryNegated = /\b(nao|não|not|never|sem|without)\b/i.test(memory.text || '');
      return {
        memory,
        overlap: overlap.slice(0, 8),
        score,
        tension: score > 0.08 && webNegated !== memoryNegated,
      };
    })
    .filter((item) => item.score > 0.04 && item.overlap.length >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((item) => {
      const label = item.memory.title || item.memory.text.slice(0, 56) || 'Memória local';
      const prefix = item.tension ? 'Possível tensão local' : 'Ligação local provável';
      return `${prefix}: "${label}" cruza com ${item.overlap.join(', ')}. A comparação ficou só neste dispositivo.`;
    });
};

export const WebResearchPanel: React.FC<WebResearchPanelProps> = ({
  isOpen,
  onClose,
  sessions,
  initialQuery = '',
  onMemoryCreated,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useState<WebResearchMode>('public');
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<WebResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectableMemories = useMemo(() => sessions.slice(0, 12), [sessions]);
  const selectedMemories = useMemo(
    () => sessions.filter((session) => selectedMemoryIds.includes(session.id)),
    [sessions, selectedMemoryIds]
  );
  const privateComparisons = useMemo(() => {
    if (!result || mode !== 'private-local') return [];
    const comparisonSet = selectedMemories.length > 0 ? selectedMemories : sessions.slice(0, 20);
    return buildPrivateLocalComparisons(result, comparisonSet);
  }, [mode, result, selectedMemories, sessions]);

  React.useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery);
      setError(null);
      setResult(null);
    }
  }, [initialQuery, isOpen]);

  const toggleMemory = (id: string) => {
    setSelectedMemoryIds((current) => (
      current.includes(id)
        ? current.filter((memoryId) => memoryId !== id)
        : [...current, id].slice(-8)
    ));
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setError(null);
    setResult(null);

    try {
      let context: string[] = [];
      if (mode === 'contextual') {
        if (selectedMemories.length === 0) {
          throw new Error('Seleciona pelo menos uma memória para a pesquisa contextual.');
        }
        const allowed = confirm('Queres usar as tuas memórias locais para melhorar esta pesquisa? O texto selecionado será enviado ao backend configurado.');
        if (!allowed) return;
        context = selectedMemories.map((memory) => `${memory.title || ''}\n${memory.text || ''}`.slice(0, 1800));
      }

      const nextResult = await runWebResearch({
        query: query.trim(),
        mode,
        context,
        max_sources: 8,
      });
      setResult(nextResult);
    } catch (researchError) {
      const message = researchError instanceof Error ? researchError.message : 'Pesquisa web indisponível.';
      setError(message);
      toast.error(message);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSaveConstellation = async () => {
    if (!result || !auth.currentUser) return;
    setIsSaving(true);
    try {
      const text = formatResearchAsMemory(result);
      let cognitive: Awaited<ReturnType<typeof cognitiveEngine.processMemory>> | null = null;
      try {
        cognitive = await cognitiveEngine.processMemory(text, sessions.map(toMemoryObject));
      } catch (cognitiveError) {
        console.warn('Web research memory saved without embeddings:', cognitiveError);
      }

      const memoryRef = await addDoc(collection(db, 'sessions'), {
        text,
        title: `Pesquisa web: ${result.query}`.slice(0, 90),
        timestamp: Date.now(),
        updatedAt: Date.now(),
        uid: auth.currentUser.uid,
        tags: ['web-research', 'fonte-externa', ...result.key_concepts.slice(0, 6)],
        category: 'Pesquisa web',
        nodes: null,
        links: null,
        embedding: cognitive?.embedding || null,
        connections: cognitive?.connections || [],
        semanticClusterId: cognitive?.semanticClusterId || null,
        position: cognitive?.position || null,
        importance: cognitive?.importance || 0.7,
        celestialType: cognitive?.celestialType || 'nebula',
        processingMethod: cognitive ? 'web-research+local-embedding' : 'web-research',
        webResearch: {
          query: result.query,
          mode: result.mode,
          sources: result.sources,
          keyConcepts: result.key_concepts,
          savedAt: Date.now(),
        },
      });

      if (cognitive?.connections.length) {
        await Promise.all(cognitive.connections.map((memoryId) => (
          updateDoc(doc(db, 'sessions', memoryId), {
            connections: arrayUnion(memoryRef.id),
            updatedAt: Date.now(),
          }).catch((updateError) => console.warn('Unable to back-link web research memory', updateError))
        )));
      }

      toast.success('Constelação de pesquisa guardada.');
      onMemoryCreated?.(memoryRef.id);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Não foi possível guardar a constelação.';
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const modeButton = (value: WebResearchMode, label: string, description: string, Icon: React.ComponentType<{ className?: string }>) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`rounded-lg border p-3 text-left transition-colors ${
        mode === value
          ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100'
          : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06]'
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-bold uppercase tracking-widest">{label}</span>
      </div>
      <p className="text-[11px] leading-relaxed opacity-70">{description}</p>
    </button>
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[190] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-[#020617]/75 backdrop-blur-md"
          />

          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            className="relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-white/10 bg-[#06101f]/95 text-white shadow-2xl shadow-cyan-950/30"
          >
            <header className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-2 text-cyan-200">
                  <Globe2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Pesquisar na web</h2>
                  <p className="text-xs text-white/45">Fontes públicas, citações reais e contexto privado sob consentimento.</p>
                </div>
              </div>
              <button onClick={onClose} className="rounded-full p-2 text-white/45 transition hover:bg-white/10 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[360px_1fr]">
              <aside className="space-y-5 overflow-y-auto border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
                <label className="block space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">Tema</span>
                  <textarea
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="/web pesquisar melhores modelos locais de IA em 2026"
                    rows={4}
                    className="w-full resize-none rounded-lg border border-white/10 bg-black/25 px-3 py-3 text-sm leading-relaxed text-white outline-none transition focus:border-cyan-300/50"
                  />
                </label>

                <div className="grid gap-2">
                  {modeButton('public', 'Pública', 'Usa apenas a query. Nenhuma memória local é enviada.', Globe2)}
                  {modeButton('contextual', 'Contextual', 'Envia só as memórias escolhidas depois de confirmação explícita.', Link2)}
                  {modeButton('private-local', 'Privada local', 'Pesquisa publicamente e compara com memórias apenas no cliente.', Shield)}
                </div>

                {mode !== 'public' && (
                  <div className="space-y-3 rounded-lg border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/45">
                      <Lock className="h-3.5 w-3.5" />
                      Memórias locais
                    </div>
                    <div className="max-h-48 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                      {selectableMemories.length === 0 ? (
                        <p className="text-xs text-white/40">Ainda não há memórias para cruzar.</p>
                      ) : selectableMemories.map((memory) => {
                        const selected = selectedMemoryIds.includes(memory.id);
                        return (
                          <button
                            key={memory.id}
                            type="button"
                            onClick={() => toggleMemory(memory.id)}
                            className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                              selected
                                ? 'border-cyan-300/35 bg-cyan-300/10 text-cyan-100'
                                : 'border-white/5 bg-white/[0.03] text-white/55 hover:border-white/15'
                            }`}
                          >
                            <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded border border-current">
                              {selected && <Check className="h-3 w-3" />}
                            </span>
                            <span className="line-clamp-2">{memory.title || memory.text || 'Memória sem título'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleSearch}
                  disabled={isSearching || !query.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-3 text-sm font-bold uppercase tracking-widest text-[#03111f] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isSearching ? (
                    <span className="h-4 w-4 rounded-full border-2 border-[#03111f]/30 border-t-[#03111f] animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  Pesquisar
                </button>
              </aside>

              <main className="min-h-0 overflow-y-auto p-6 custom-scrollbar">
                {error && (
                  <div className="mb-5 rounded-lg border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                    <div className="mb-1 flex items-center gap-2 font-semibold">
                      <AlertTriangle className="h-4 w-4" />
                      Pesquisa falhou
                    </div>
                    {error}
                  </div>
                )}

                {!result && !error && (
                  <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                    <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-4 text-white/45">
                      <Globe2 className="h-8 w-8" />
                    </div>
                    <p className="max-w-md text-sm text-white/65">
                      Pesquisa pública por defeito. As memórias só entram no pedido quando escolheres o modo contextual e confirmares.
                    </p>
                  </div>
                )}

                {result && (
                  <div className="space-y-6">
                    <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-200/50">Resultado vindo da web</p>
                          <h3 className="mt-1 text-xl font-semibold text-white">{result.query}</h3>
                        </div>
                        <button
                          onClick={handleSaveConstellation}
                          disabled={isSaving}
                          className="flex items-center gap-2 rounded-lg border border-violet-300/25 bg-violet-400/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-violet-100 transition hover:bg-violet-400/20 disabled:opacity-45"
                        >
                          <BookmarkPlus className="h-4 w-4" />
                          {isSaving ? 'A guardar...' : 'Guardar como constelação'}
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/72">{result.summary}</p>
                    </section>

                    <section>
                      <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/45">Ideias principais</h3>
                      <div className="space-y-2">
                        {result.main_ideas.map((idea, index) => (
                          <p key={`${idea}-${index}`} className="rounded-md border border-white/10 bg-black/20 px-4 py-3 text-sm leading-relaxed text-white/65">
                            {idea}
                          </p>
                        ))}
                      </div>
                    </section>

                    <section>
                      <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/45">Conceitos-chave</h3>
                      <div className="flex flex-wrap gap-2">
                        {result.key_concepts.map((concept) => (
                          <span key={concept} className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">
                            {concept}
                          </span>
                        ))}
                      </div>
                    </section>

                    {(result.local_comparisons.length > 0 || privateComparisons.length > 0) && (
                      <section>
                        <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/45">Comparação com memórias</h3>
                        <div className="space-y-2">
                          {[...result.local_comparisons, ...privateComparisons].map((comparison, index) => (
                            <p key={`${comparison}-${index}`} className="rounded-md border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm leading-relaxed text-amber-100/80">
                              {comparison}
                            </p>
                          ))}
                        </div>
                      </section>
                    )}

                    <section>
                      <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/45">Fontes</h3>
                      <div className="space-y-3">
                        {result.sources.map((source) => (
                          <article key={source.url} className="rounded-lg border border-white/10 bg-black/20 p-4">
                            <div className="mb-2 flex items-start justify-between gap-3">
                              <div>
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-100 hover:text-cyan-50"
                                >
                                  {source.title}
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                                <p className="mt-1 break-all text-[10px] text-white/35">{source.url}</p>
                              </div>
                              <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-widest text-white/40">
                                {source.status === 'read' ? 'lida' : source.status === 'snippet-only' ? 'snippet' : 'falhou'}
                              </span>
                            </div>
                            <p className="text-xs leading-relaxed text-white/58">{source.summary || source.snippet}</p>
                          </article>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </main>
            </div>
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
};

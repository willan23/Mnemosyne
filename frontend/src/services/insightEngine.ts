import type { SessionData } from '../hooks/useSessions';
import { sameEmbeddingSpace } from './embeddingModel';

export type InsightKind = 'contradiction' | 'orphan' | 'resurface' | 'pattern';
export type InsightSeverity = 'low' | 'medium' | 'high';

export interface CognitiveInsight {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  summary: string;
  memoryIds: string[];
  evidence: string[];
  score: number;
}

interface MemorySignal {
  memory: SessionData;
  normalizedText: string;
  concepts: string[];
  hasNegation: boolean;
  hasCommitment: boolean;
}

const STOPWORDS = new Set([
  'ainda', 'agora', 'alguma', 'algumas', 'algum', 'alguns', 'aquilo', 'assim', 'cada',
  'como', 'com', 'contra', 'depois', 'dessa', 'desse', 'deste', 'desde', 'deve', 'devo',
  'dizer', 'dizem', 'elas', 'eles', 'entre', 'essa', 'esse', 'esta', 'este', 'isto',
  'mais', 'mas', 'mesmo', 'muito', 'muita', 'nada', 'nessa', 'nesse', 'nesta', 'neste',
  'onde', 'outra', 'outro', 'para', 'pela', 'pelo', 'pode', 'posso', 'porque', 'quando',
  'quase', 'sobre', 'tambem', 'tenho', 'todos', 'tudo', 'uma', 'umas', 'isso',
  'that', 'this', 'with', 'from', 'have', 'will', 'would', 'there', 'their', 'about',
  'after', 'before', 'because', 'could', 'should', 'thing', 'things', 'today'
]);

const NEGATION_RE = /\b(nao|nunca|jamais|sem|impossivel|impossivel|incapaz|bloqueado|not|never|no|cannot|can't|wont|won't|without|impossible)\b/;
const COMMITMENT_RE = /\b(sempre|preciso|devo|vou|consigo|posso|funciona|verdade|obrigatorio|must|should|will|always|works|true|need)\b/;

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ');

const words = (text: string) =>
  normalize(text)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));

const snippet = (text: string, max = 136) => {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1).trim()}...` : compact;
};

const cosineSimilarity = (a?: number[], b?: number[]) => {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
};

const topConcepts = (text: string, limit = 8) => {
  const counts = new Map<string, number>();
  for (const word of words(text)) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
};

const overlap = (a: string[], b: string[]) => {
  const bSet = new Set(b);
  return a.filter((word) => bSet.has(word));
};

const relationScore = (a: MemorySignal, b: MemorySignal) => {
  const semantic = sameEmbeddingSpace(a.memory.embeddingModel, b.memory.embeddingModel)
    ? cosineSimilarity(a.memory.embedding, b.memory.embedding)
    : 0;
  const shared = overlap(a.concepts, b.concepts);
  const lexical = shared.length / Math.max(1, Math.min(a.concepts.length, b.concepts.length));
  return Math.max(semantic, lexical);
};

const makeSignals = (sessions: SessionData[]): MemorySignal[] =>
  sessions
    .filter((memory) => memory.text?.trim())
    .map((memory) => {
      const normalizedText = normalize(memory.text);
      return {
        memory,
        normalizedText,
        concepts: topConcepts(memory.text),
        hasNegation: NEGATION_RE.test(normalizedText),
        hasCommitment: COMMITMENT_RE.test(normalizedText),
      };
    });

const contradictionInsights = (signals: MemorySignal[]): CognitiveInsight[] => {
  const insights: CognitiveInsight[] = [];
  const ordered = [...signals]
    .sort((a, b) => (b.memory.updatedAt || b.memory.timestamp) - (a.memory.updatedAt || a.memory.timestamp))
    .slice(0, 160);

  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const a = ordered[i];
      const b = ordered[j];
      const shared = overlap(a.concepts, b.concepts);
      if (shared.length < 2) continue;

      const polarityShift = a.hasNegation !== b.hasNegation && (a.hasCommitment || b.hasCommitment);
      if (!polarityShift) continue;

      const score = relationScore(a, b);
      if (score < 0.38) continue;

      insights.push({
        id: `contradiction-${a.memory.id}-${b.memory.id}`,
        kind: 'contradiction',
        severity: score > 0.68 ? 'high' : 'medium',
        title: `Tensao em ${shared.slice(0, 2).join(' / ')}`,
        summary: 'Duas memorias parecem falar do mesmo tema com polaridades diferentes.',
        memoryIds: [a.memory.id, b.memory.id],
        evidence: [snippet(a.memory.text), snippet(b.memory.text)],
        score,
      });
    }
  }

  return insights
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
};

const orphanInsights = (sessions: SessionData[], now: number): CognitiveInsight[] => {
  const day = 24 * 60 * 60 * 1000;
  const orphans = sessions
    .filter((memory) => (memory.connections?.length || 0) === 0)
    .map((memory) => ({
      memory,
      ageDays: Math.floor((now - (memory.updatedAt || memory.timestamp || now)) / day),
    }))
    .filter(({ ageDays }) => ageDays >= 2)
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 8);

  if (!orphans.length) return [];

  return [{
    id: 'orphan-cluster',
    kind: 'orphan',
    severity: orphans.length >= 5 ? 'medium' : 'low',
    title: `${orphans.length} memorias sem ligacoes`,
    summary: 'Estas memorias existem no grafo, mas ainda nao foram conectadas semanticamente.',
    memoryIds: orphans.map(({ memory }) => memory.id),
    evidence: orphans.slice(0, 3).map(({ memory, ageDays }) => `${ageDays}d - ${snippet(memory.text, 96)}`),
    score: Math.min(1, orphans.length / 8),
  }];
};

const resurfaceInsights = (signals: MemorySignal[], now: number): CognitiveInsight[] => {
  const day = 24 * 60 * 60 * 1000;
  const recent = signals.filter(({ memory }) => now - (memory.updatedAt || memory.timestamp) <= 14 * day);
  const old = signals.filter(({ memory }) => now - (memory.updatedAt || memory.timestamp) >= 30 * day);
  const insights: CognitiveInsight[] = [];

  for (const oldSignal of old.slice(0, 80)) {
    for (const recentSignal of recent.slice(0, 60)) {
      if (oldSignal.memory.id === recentSignal.memory.id) continue;
      if (oldSignal.memory.connections?.includes(recentSignal.memory.id)) continue;

      const score = relationScore(oldSignal, recentSignal);
      if (score < 0.54) continue;

      const shared = overlap(oldSignal.concepts, recentSignal.concepts).slice(0, 3);
      insights.push({
        id: `resurface-${oldSignal.memory.id}-${recentSignal.memory.id}`,
        kind: 'resurface',
        severity: score > 0.72 ? 'high' : 'medium',
        title: shared.length ? `Tema regressou: ${shared.join(', ')}` : 'Tema antigo regressou',
        summary: 'Uma memoria antiga voltou a rimar com algo recente.',
        memoryIds: [oldSignal.memory.id, recentSignal.memory.id],
        evidence: [snippet(oldSignal.memory.text), snippet(recentSignal.memory.text)],
        score,
      });
    }
  }

  return insights
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
};

const patternInsights = (sessions: SessionData[], signals: MemorySignal[]): CognitiveInsight[] => {
  const tagCounts = new Map<string, SessionData[]>();
  for (const memory of sessions) {
    for (const tag of memory.tags || []) {
      const normalizedTag = normalize(tag).trim();
      if (!normalizedTag) continue;
      tagCounts.set(normalizedTag, [...(tagCounts.get(normalizedTag) || []), memory]);
    }
  }

  const topTag = Array.from(tagCounts.entries())
    .filter(([, memories]) => memories.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)[0];

  if (topTag) {
    const [tag, memories] = topTag;
    return [{
      id: `pattern-tag-${tag}`,
      kind: 'pattern',
      severity: memories.length >= 6 ? 'medium' : 'low',
      title: `Padrao recorrente: #${tag}`,
      summary: `${memories.length} memorias convergem nesta etiqueta.`,
      memoryIds: memories.slice(0, 8).map((memory) => memory.id),
      evidence: memories.slice(0, 3).map((memory) => snippet(memory.text, 96)),
      score: Math.min(1, memories.length / 10),
    }];
  }

  const conceptCounts = new Map<string, SessionData[]>();
  for (const signal of signals) {
    for (const concept of signal.concepts.slice(0, 5)) {
      conceptCounts.set(concept, [...(conceptCounts.get(concept) || []), signal.memory]);
    }
  }

  const topConcept = Array.from(conceptCounts.entries())
    .filter(([, memories]) => memories.length >= 4)
    .sort((a, b) => b[1].length - a[1].length)[0];

  if (!topConcept) return [];

  const [concept, memories] = topConcept;
  return [{
    id: `pattern-concept-${concept}`,
    kind: 'pattern',
    severity: memories.length >= 7 ? 'medium' : 'low',
    title: `Conceito insistente: ${concept}`,
    summary: `${memories.length} memorias mencionam este nucleo sem depender de IA externa.`,
    memoryIds: memories.slice(0, 8).map((memory) => memory.id),
    evidence: memories.slice(0, 3).map((memory) => snippet(memory.text, 96)),
    score: Math.min(1, memories.length / 12),
  }];
};

export const generateCognitiveInsights = (sessions: SessionData[], now = Date.now()): CognitiveInsight[] => {
  if (!sessions.length) return [];

  const signals = makeSignals(sessions);
  return [
    ...contradictionInsights(signals),
    ...resurfaceInsights(signals, now),
    ...orphanInsights(sessions, now),
    ...patternInsights(sessions, signals),
  ].sort((a, b) => {
    const severityWeight: Record<InsightSeverity, number> = { high: 3, medium: 2, low: 1 };
    return severityWeight[b.severity] - severityWeight[a.severity] || b.score - a.score;
  });
};

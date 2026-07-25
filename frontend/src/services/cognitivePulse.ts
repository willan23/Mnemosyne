/**
 * Cognitive Pulse — ritual diário do Mnemosyne.
 * Transforma o grafo em algo vivo: cada dia, o sistema apresenta
 * resurfacing, tensões e órfãs como um "pulso" do teu pensamento.
 */

import type { SessionData } from '../hooks/useSessions';
import {
  generateCognitiveInsights,
  type CognitiveInsight,
  type InsightKind,
} from './insightEngine';

export interface CognitivePulseHighlight {
  id: string;
  kind: InsightKind;
  title: string;
  summary: string;
  memoryIds: string[];
  evidence: string[];
  score: number;
}

export interface CognitivePulse {
  dateKey: string;
  title: string;
  subtitle: string;
  highlights: CognitivePulseHighlight[];
  stats: {
    memories: number;
    connections: number;
    orphans: number;
    resurfacing: number;
    contradictions: number;
  };
  constellationLabel: string;
}

const dayKey = (now: number): string => {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const seenStorageKey = (uid: string) => `mnemosyne.pulse.seen.${uid}`;

export function shouldShowPulseToday(uid: string, now = Date.now()): boolean {
  if (!uid) return false;
  try {
    const seen = localStorage.getItem(seenStorageKey(uid));
    return seen !== dayKey(now);
  } catch {
    return true;
  }
}

export function markPulseSeen(uid: string, now = Date.now()): void {
  if (!uid) return;
  try {
    localStorage.setItem(seenStorageKey(uid), dayKey(now));
  } catch {
    // ignore
  }
}

export function resetPulseSeen(uid: string): void {
  if (!uid) return;
  try {
    localStorage.removeItem(seenStorageKey(uid));
  } catch {
    // ignore
  }
}

const kindPriority: Record<InsightKind, number> = {
  contradiction: 4,
  resurface: 3,
  pattern: 2,
  orphan: 1,
};

const constellationFromInsights = (insights: CognitiveInsight[], memoryCount: number): string => {
  if (!memoryCount) return 'Vazio fértil';
  const kinds = new Set(insights.map((i) => i.kind));
  if (kinds.has('contradiction') && kinds.has('resurface')) return 'Constelação em tensão';
  if (kinds.has('contradiction')) return 'Constelação de polaridades';
  if (kinds.has('resurface')) return 'Constelação de ecos';
  if (kinds.has('orphan')) return 'Constelação por ligar';
  if (kinds.has('pattern')) return 'Constelação de padrões';
  if (memoryCount < 5) return 'Nebulosa nascente';
  if (memoryCount < 30) return 'Galáxia em expansão';
  return 'Universo consolidado';
};

const titleFromPulse = (label: string, dateKeyValue: string): string => {
  const [, month, day] = dateKeyValue.split('-');
  return `Pulso · ${day}/${month} · ${label}`;
};

export function buildCognitivePulse(sessions: SessionData[], now = Date.now()): CognitivePulse {
  const active = sessions.filter((s) => !s.deletedAt && (s.text?.trim() || s.title?.trim()));
  const insights = generateCognitiveInsights(active, now);

  const connectionSet = new Set<string>();
  let orphans = 0;
  for (const memory of active) {
    const links = memory.connections || [];
    if (links.length === 0) orphans += 1;
    for (const target of links) {
      const a = memory.id < target ? memory.id : target;
      const b = memory.id < target ? target : memory.id;
      connectionSet.add(`${a}::${b}`);
    }
  }

  const highlights = [...insights]
    .sort((a, b) => {
      const byKind = kindPriority[b.kind] - kindPriority[a.kind];
      if (byKind !== 0) return byKind;
      return b.score - a.score;
    })
    .slice(0, 5)
    .map((insight) => ({
      id: insight.id,
      kind: insight.kind,
      title: insight.title,
      summary: insight.summary,
      memoryIds: insight.memoryIds,
      evidence: insight.evidence,
      score: insight.score,
    }));

  const resurfacing = insights.filter((i) => i.kind === 'resurface').length;
  const contradictions = insights.filter((i) => i.kind === 'contradiction').length;
  const constellationLabel = constellationFromInsights(insights, active.length);
  const dateKeyValue = dayKey(now);

  let subtitle: string;
  if (!active.length) {
    subtitle = 'Ainda não há memórias. Escreve o primeiro pensamento e o universo ganha forma.';
  } else if (highlights.length === 0) {
    subtitle = 'O teu grafo está estável hoje. Boa altura para explorar o universo ou capturar algo novo.';
  } else if (contradictions > 0) {
    subtitle = 'Há tensões produtivas no teu pensamento. Revê-as antes de cristalizar novas decisões.';
  } else if (resurfacing > 0) {
    subtitle = 'Ideias antigas rimam com o presente. O sistema encontrou ecos para resurfacing.';
  } else {
    subtitle = 'Um mapa vivo do teu conhecimento — escolhe um destaque e aterra no grafo.';
  }

  return {
    dateKey: dateKeyValue,
    title: titleFromPulse(constellationLabel, dateKeyValue),
    subtitle,
    highlights,
    stats: {
      memories: active.length,
      connections: connectionSet.size,
      orphans,
      resurfacing,
      contradictions,
    },
    constellationLabel,
  };
}

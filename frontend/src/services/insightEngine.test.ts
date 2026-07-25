import { describe, expect, it } from 'vitest';
import type { SessionData } from '../hooks/useSessions';
import { generateCognitiveInsights } from './insightEngine';

const now = new Date('2026-05-11T12:00:00Z').getTime();
const day = 24 * 60 * 60 * 1000;

const memory = (overrides: Partial<SessionData> & Pick<SessionData, 'id' | 'text'>): SessionData => ({
  timestamp: now,
  updatedAt: now,
  uid: 'user-1',
  connections: [],
  ...overrides,
});

describe('generateCognitiveInsights', () => {
  it('returns no insights for an empty memory set', () => {
    expect(generateCognitiveInsights([], now)).toEqual([]);
  });

  it('detects contradiction candidates with shared concepts and polarity shift', () => {
    const insights = generateCognitiveInsights([
      memory({
        id: 'recent',
        text: 'O produto Mnemosyne funciona sempre com sincronizacao soberana e privada.',
        embedding: [1, 0, 0],
      }),
      memory({
        id: 'older',
        text: 'O produto Mnemosyne nao funciona com sincronizacao soberana privada.',
        updatedAt: now - day,
        embedding: [0.95, 0.05, 0],
      }),
    ], now);

    const contradiction = insights.find((insight) => insight.kind === 'contradiction');
    expect(contradiction?.memoryIds).toEqual(['recent', 'older']);
    expect(contradiction?.severity).toBe('high');
    expect(contradiction?.evidence).toHaveLength(2);
  });

  it('groups old unconnected memories as orphan insight', () => {
    const insights = generateCognitiveInsights([
      memory({ id: 'a', text: 'Memoria isolada sobre pesquisa local.', updatedAt: now - 5 * day }),
      memory({ id: 'b', text: 'Outra memoria isolada sobre escrita privada.', updatedAt: now - 3 * day }),
    ], now);

    const orphan = insights.find((insight) => insight.kind === 'orphan');
    expect(orphan?.id).toBe('orphan-cluster');
    expect(orphan?.memoryIds).toEqual(['a', 'b']);
    expect(orphan?.severity).toBe('low');
  });

  it('surfaces old memories that strongly relate to recent ones', () => {
    const insights = generateCognitiveInsights([
      memory({
        id: 'old',
        text: 'Investigacao de memoria contextual soberana com grafo cognitivo.',
        updatedAt: now - 45 * day,
        connections: ['already-linked'],
        embedding: [0.8, 0.2, 0],
      }),
      memory({
        id: 'recent',
        text: 'Hoje regressou a memoria contextual soberana no grafo cognitivo.',
        updatedAt: now - day,
        embedding: [0.82, 0.18, 0],
      }),
    ], now);

    const resurface = insights.find((insight) => insight.kind === 'resurface');
    expect(resurface?.memoryIds).toEqual(['old', 'recent']);
    expect(resurface?.severity).toBe('high');
  });

  it('detects recurring tag patterns before concept patterns', () => {
    const insights = generateCognitiveInsights([
      memory({ id: 'a', text: 'Primeira nota de produto.', tags: ['produto'] }),
      memory({ id: 'b', text: 'Segunda nota de roadmap.', tags: ['produto'] }),
      memory({ id: 'c', text: 'Terceira nota de mercado.', tags: ['produto'] }),
      memory({ id: 'd', text: 'Quarta nota com outro tema.', tags: ['outro'] }),
    ], now);

    const pattern = insights.find((insight) => insight.kind === 'pattern');
    expect(pattern?.id).toBe('pattern-tag-produto');
    expect(pattern?.memoryIds).toEqual(['a', 'b', 'c']);
  });

  it('falls back to recurring concept patterns when tags are absent', () => {
    const insights = generateCognitiveInsights([
      memory({ id: 'a', text: 'Soberania cognitiva e produto privado.' }),
      memory({ id: 'b', text: 'Soberania local para conhecimento privado.' }),
      memory({ id: 'c', text: 'Soberania em pesquisa pessoal cifrada.' }),
      memory({ id: 'd', text: 'Soberania como principio do grafo.' }),
    ], now);

    const pattern = insights.find((insight) => insight.kind === 'pattern');
    expect(pattern?.id).toBe('pattern-concept-soberania');
    expect(pattern?.memoryIds).toEqual(['a', 'b', 'c', 'd']);
  });
});

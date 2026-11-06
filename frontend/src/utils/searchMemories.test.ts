import { describe, expect, it } from 'vitest';
import { parseSearchQuery, searchMemories, type SearchableMemory } from './searchMemories';

const mem = (partial: Partial<SearchableMemory> & { id: string; text: string }): SearchableMemory => ({
  title: partial.title,
  tags: partial.tags || [],
  category: partial.category,
  timestamp: partial.timestamp ?? 1,
  ...partial,
});

describe('searchMemories', () => {
  it('treats an explicit score map as authoritative and does not revive scores rejected for this query', () => {
    const memories = [mem({ id: 'stale', text: 'Synthetic orchard evidence', semanticScore: .99 })];
    expect(searchMemories(memories, 'quantum satellites', { semanticScores: new Map() })).toEqual([]);
    const lexical = searchMemories(memories, 'orchard', { semanticScores: new Map() });
    expect(lexical[0].matchKind).toBe('text');
    expect(lexical[0].memory.semanticScore).toBe(0);
    expect(searchMemories(memories, 'quantum satellites', { semanticScores: new Map([['stale', .8]]) })[0].matchKind).toBe('semantic');
  });
  it('abstains from lexical matches caused only by function words across the supported languages', () => {
    for (const [text, query] of [
      ['O livro está no armário.', 'Qual é a altitude da estação lunar Zefiro?'],
      ['Esta pasta fica no armário.', 'Qual a altitude da estação lunar Zefiro?'],
      ['The express train departs at eight in the morning.', 'What is the altitude of the Zephyr lunar station?'],
      ['Le café est prêt.', 'Quelle est l’altitude de la station lunaire Zéphyr ?'],
      ['The stationery invoice includes three notebooks and two pens.', 'What is the altitude of the Zephyr lunar station?'],
    ]) expect(searchMemories([mem({ id: 'unrelated', text })], query)).toEqual([]);
    expect(searchMemories([mem({ id: 'literal', text: 'unrelated', title: 'Como' })], 'Como')[0].memory.id).toBe('literal');
    expect(searchMemories([mem({ id: 'prefix', text: 'quantum physics' })], 'quant')[0].memory.id).toBe('prefix');
    expect(searchMemories([mem({ id: 'plural', text: 'Memórias cifradas' })], 'memória cifrada')[0].memory.id).toBe('plural');
    expect(searchMemories([mem({ id: 'semantic', text: 'unrelated' })], 'Where is the observatory?', { semanticScores: new Map([['semantic', .91]]) })[0].memory.id).toBe('semantic');
  });
  it('combines entity and UTC creation-date bounds before semantic ranking', () => {
    const date = Date.parse('2026-09-01T00:00:00Z');
    const node = { id: 'n1', label: 'São Paulo', type: 'place' };
    const memories = [
      mem({ id: 'old', text: 'plan', timestamp: date - 1, nodes: [node], semanticScore: 1 }),
      mem({ id: 'match', text: 'plan', timestamp: date, nodes: [node] }),
      mem({ id: 'upper', text: 'plan', timestamp: Date.parse('2026-10-01T00:00:00Z'), nodes: [node] }),
      mem({ id: 'wrong-entity', text: 'São Paulo plan', timestamp: date, nodes: [] }),
      mem({ id: 'locked', text: 'plan', timestamp: date, nodes: [node], encLocked: true }),
    ];
    const query = 'entity:"Sao Paulo" after:2026-09-01 before:2026-10-01';
    expect(parseSearchQuery(query).text).toBe('');
    expect(searchMemories(memories, query).map(hit => hit.memory.id)).toEqual(['match']);
    expect(searchMemories(memories, `${query} plan`).map(hit => hit.memory.id)).toEqual(['match']);
  });

  it('rejects invalid dates and contradictory bounds instead of silently broadening scope', () => {
    const memories = [mem({ id: 'a', text: 'anything', semanticScore: 1 })];
    for (const query of ['after:2026-02-30', 'before:tomorrow', 'after:2026-10-01 before:2026-09-01', 'entity:""']) {
      expect(parseSearchQuery(query).invalidFilter).toBe(true);
      expect(searchMemories(memories, query)).toEqual([]);
    }
  });
  it('excludes locked content even with matching metadata or a high semantic score', () => {
    expect(searchMemories([
      mem({ id: 'locked', text: 'private phrase', title: 'private phrase', encLocked: true }),
    ], 'private phrase', { semanticScores: new Map([['locked', 1]]) })).toEqual([]);
  });
  it('parses tag and category operators', () => {
    const parsed = parseSearchQuery('tag:trabalho #ideia cat:nota quantum');
    expect(parsed.tags).toEqual(expect.arrayContaining(['trabalho', 'ideia']));
    expect(parsed.category).toBe('nota');
    expect(parsed.text).toBe('quantum');
  });

  it('ranks exact title above body match', () => {
    const hits = searchMemories(
      [
        mem({ id: '1', title: 'Quantum', text: 'outras coisas' }),
        mem({ id: '2', title: 'Outro', text: 'estudo de quantum profundo' }),
      ],
      'quantum'
    );
    expect(hits[0].memory.id).toBe('1');
    expect(hits[0].matchKind).toBe('exact');
  });

  it('includes semantic-only hits when score is high', () => {
    const scores = new Map([['sem', 0.81]]);
    const hits = searchMemories(
      [
        mem({ id: 'sem', title: 'Relacionado', text: 'conteúdo sem a palavra-chave' }),
        mem({ id: 'no', title: 'Irrelevante', text: 'nada a ver' }),
      ],
      'arquitetura cognitiva',
      { semanticScores: scores }
    );
    expect(hits.some((h) => h.memory.id === 'sem')).toBe(true);
    expect(hits.find((h) => h.memory.id === 'sem')?.matchKind).toBe('semantic');
  });

  it('filters by required tags', () => {
    const hits = searchMemories(
      [
        mem({ id: 'a', text: 'plano de produto', tags: ['produto'] }),
        mem({ id: 'b', text: 'plano de produto', tags: ['pessoal'] }),
      ],
      'tag:produto plano'
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].memory.id).toBe('a');
  });
});

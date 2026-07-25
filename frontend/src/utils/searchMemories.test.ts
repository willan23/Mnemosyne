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

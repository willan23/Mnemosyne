import { describe, expect, it } from 'vitest';
import { prepareSearchMemory } from '../utils/searchMemories';
import { type HybridSearchDocument } from './hybridSearchProtocol';
import { prepareSearchContextTerms } from './searchContextKeys';

const prepare = (document: HybridSearchDocument) =>
  prepareSearchContextTerms(document, prepareSearchMemory(document).corpusTokens);

describe('prepareSearchContextTerms', () => {
  it('normalizes Unicode uppercase letters and accents across punctuation and hyphens', () => {
    const document = { id: 'unicode', title: 'Évora—Açores; São-Pedro, İzmir.', text: 'München' };

    expect(prepare(document)).toEqual(['evora', 'acores', 'sao', 'pedro', 'izmir', 'munchen']);
  });

  it('uses the real corpus tokens to exclude Portuguese, English and French stop words', () => {
    const document = {
      id: 'stop-words', title: 'Para Quem The And Avec Dans',
      text: 'Desde Esta Quando Which Cette Qual Brisa',
    };
    const allowedTerms = prepareSearchMemory(document).corpusTokens;

    expect([...allowedTerms]).toEqual(['brisa']);
    expect(prepareSearchContextTerms(document, allowedTerms)).toEqual(['brisa']);
  });

  it('requires an allowed corpus term even when a surface word is capitalized', () => {
    const document = { id: 'allowed-terms', title: 'Brisa Álamo', text: 'Nácar' };
    const allowedTerms = new Set([...prepareSearchMemory(document).corpusTokens]
      .filter(term => term !== 'brisa'));

    expect(prepareSearchContextTerms(document, allowedTerms)).toEqual(['alamo', 'nacar']);
    expect(prepareSearchContextTerms(document, new Set())).toEqual([]);
  });

  it('deduplicates normalized surface forms, including repeated compound parts', () => {
    const document = {
      id: 'deduplicated', title: 'Évora Evora ÉVORA São-Pedro',
      text: 'Évora Sao Pedro São-Pedro',
    };

    expect(prepare(document)).toEqual(['evora', 'sao', 'pedro']);
  });

  it('collects title terms before body terms in their first occurrence order', () => {
    const document = { id: 'field-order', title: 'Leste Norte', text: 'Sul Oeste Norte' };

    expect(prepare(document)).toEqual(['leste', 'norte', 'sul', 'oeste']);
  });

  it.each([
    { id: 'title-only', title: 'Pórtico', expected: ['portico'] },
    { id: 'body-only', text: 'Válvula', expected: ['valvula'] },
    { id: 'empty-fields', title: '', text: '', expected: [] },
    { id: 'missing-fields', expected: [] },
  ])('handles optional title and text fields: $id', ({ expected, ...document }) => {
    expect(prepare(document)).toEqual(expected);
  });

  it('does not promote lowercase prose or words shorter than three characters', () => {
    const document = { id: 'surface-only', title: 'vento Al Se', text: 'Brisa sol nuvem' };

    expect(prepare(document)).toEqual(['brisa']);
  });

  it('leaves explicit entity labels outside the surface-term cache', () => {
    const document = {
      id: 'entity-only', title: 'Brisa', text: 'vento',
      nodes: [{ id: 'person-1', type: 'person', label: 'Leonor Arantes' }],
    };
    // Even an allowed label is not a title/body surface occurrence.
    const allowedTerms = new Set([
      ...prepareSearchMemory(document).corpusTokens, 'leonor', 'arantes', 'leonor arantes',
    ]);

    expect(prepareSearchContextTerms(document, allowedTerms)).toEqual(['brisa']);
    expect(document.nodes).toEqual([{ id: 'person-1', type: 'person', label: 'Leonor Arantes' }]);
  });

  it('does not duplicate surface terms when matching explicit entities already exist', () => {
    const document = {
      id: 'entity-and-surface', title: 'Leonor Arantes', text: 'Leonor Arantes',
      nodes: [
        { id: 'person-1', type: 'person', label: 'Leonor Arantes' },
        { id: 'person-2', type: 'person', label: 'Leonor Arantes' },
      ],
    };

    expect(prepare(document)).toEqual(['leonor', 'arantes']);
    expect(document.nodes).toHaveLength(2);
  });

  it('does not collect terms from tags, category, type, document ID or entity metadata', () => {
    const document = {
      id: 'Mural', tags: ['Turbina'], category: 'Máquina', celestialType: 'Planeta',
      nodes: [{ id: 'Farol', type: 'Pessoa', label: 'Pórtico' }],
    };
    const allowedTerms = new Set([
      ...prepareSearchMemory(document).corpusTokens,
      'mural', 'maquina', 'planeta', 'farol', 'pessoa', 'portico',
    ]);

    expect(prepareSearchContextTerms(document, allowedTerms)).toEqual([]);
  });

  it('caps the cache at 64 unique keys without letting duplicates consume the budget', () => {
    const terms = Array.from({ length: 80 }, (_, index) => `Termo${String(index).padStart(3, '0')}`);
    const document = {
      id: 'key-budget', title: terms.slice(0, 40).join(' '),
      text: [...terms.slice(0, 20), ...terms.slice(40)].join(' '),
    };
    const result = prepare(document);

    expect(result).toHaveLength(64);
    expect(result).toEqual(terms.slice(0, 64).map(term => term.toLowerCase()));
    expect(new Set(result).size).toBe(64);
  });

  it('accepts a 128-character surface word and rejects a 129-character word without truncating it', () => {
    const atLimit = `A${'x'.repeat(127)}`;
    const overLimit = `B${'y'.repeat(128)}`;
    const document = { id: 'word-length', title: atLimit, text: `${overLimit} Válido` };
    const allowedTerms = prepareSearchMemory(document).corpusTokens;

    expect(allowedTerms.has(overLimit.toLowerCase())).toBe(true);
    expect(prepareSearchContextTerms(document, allowedTerms)).toEqual([atLimit.toLowerCase(), 'valido']);
  });

  it('applies the 128-character bound before splitting hyphenated surface words', () => {
    const atLimit = `${'A'.repeat(63)}-${'B'.repeat(64)}`;
    const overLimit = `${'C'.repeat(64)}-${'D'.repeat(64)}`;
    const document = { id: 'compound-length', title: atLimit, text: `${overLimit} Curto` };
    const allowedTerms = prepareSearchMemory(document).corpusTokens;

    expect(allowedTerms.has('c'.repeat(64))).toBe(true);
    expect(allowedTerms.has('d'.repeat(64))).toBe(true);
    expect(prepareSearchContextTerms(document, allowedTerms)).toEqual([
      'a'.repeat(63), 'b'.repeat(64), 'curto',
    ]);
  });

  it('does not mutate a frozen document, its nested metadata or the supplied allowed terms', () => {
    const document: HybridSearchDocument = {
      id: 'immutable', title: 'Évora', text: 'São-Pedro Évora', tags: ['Mapa'],
      category: 'note', timestamp: 123, updatedAt: 456,
      nodes: [{ id: 'person-1', type: 'person', label: 'Leonor Arantes' }],
    };
    const before = structuredClone(document);
    const allowedTerms = prepareSearchMemory(document).corpusTokens;
    const allowedBefore = [...allowedTerms];
    Object.freeze(document.tags);
    document.nodes!.forEach(node => Object.freeze(node));
    Object.freeze(document.nodes);
    Object.freeze(document);

    const result = prepareSearchContextTerms(document, allowedTerms);
    expect(result).toEqual(['evora', 'sao', 'pedro']);
    result.push('output-only');
    expect(prepareSearchContextTerms(document, allowedTerms)).toEqual(['evora', 'sao', 'pedro']);
    expect(document).toEqual(before);
    expect([...allowedTerms]).toEqual(allowedBefore);
  });
});

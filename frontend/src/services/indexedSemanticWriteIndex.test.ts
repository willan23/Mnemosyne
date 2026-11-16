import { expect, it } from 'vitest';
import { IndexedSemanticWriteIndex } from './indexedSemanticWriteIndex';
import type { IndexedSemanticWriteMessage, IndexedSemanticDocument } from './indexedSemanticWriteProtocol';
import { CURRENT_EMBEDDING_SPACE } from './embeddingModel';

const document = (id: string): IndexedSemanticDocument => ({ id, timestamp: 1, scope: 'scope', embedding: [1, 0], embeddingModel: CURRENT_EMBEDDING_SPACE });
it.each([
  { type: 'init', direction: 'invalid' }, { type: 'init', sourceBase: Infinity },
  { type: 'exclude', source: 's', changes: [['a', 'true']] }, { type: 'exclude', source: 's', changes: [['a', true], ['a', false]] },
  { type: 'exclude', source: 's', changes: Array.from({ length: 129 }, (_, i) => ['m' + i, true]) },
  { type: 'query', source: '', query: [1, 0], space: CURRENT_EMBEDDING_SPACE, scope: 'scope' },
  { type: 'patch-start', source: 's', changed: 0, removed: [], order: { changes: [] }, priority: NaN },
  { type: 'exclude', source: 's', changes: [['a', false, { ...document('a'), text: 'Synthetic private field' }]] },
  { type: 'patch-start', source: 's', changed: 0, removed: [], order: { reset: [], changes: [] }, orderedReset: false },
  { type: 'patch-start', source: 's', changed: 0, removed: ['a'], order: { reset: [], changes: [] }, orderedReset: true },
  { type: 'patch-start', source: 's', changed: 1, removed: [], order: { reset: ['a'], changes: [] }, orderedReset: true },
  { type: 'patch-start', source: 's', changed: 1, removed: [], order: { changes: [] }, orderedReset: true },
  { type: 'patch-start', source: 's', changed: 0, removed: [], order: { changes: [] }, metadata: { removed: -1, changes: 0 } },
  { type: 'patch-start', source: 's', changed: 0, removed: [], order: { changes: [] }, metadata: { removed: 0, changes: 0, reset: 1 } },
  { type: 'patch-start', source: 's', changed: 0, removed: [], order: { reset: [], changes: [] }, orderedReset: true, metadata: { removed: 0, changes: 0 } },
  { type: 'patch-start', source: 's', changed: 0, removed: [], order: { changes: [] }, metadata: { removed: 0, changes: 0, text: 'private' } },
  { type: 'patch-metadata', removed: ['a'] },
])('refuses malformed source ordering or exclusion messages %#', input => {
  const index = new IndexedSemanticWriteIndex(), init = input.type === 'init'; if (!init) index.handle({ v: 1, seq: 1, type: 'init' });
  expect(() => index.handle({ ...input, v: 1, seq: init ? 1 : 2 } as IndexedSemanticWriteMessage)).toThrow('semantic_write_unavailable');
  expect(index.handle({ v: 1, seq: 1, type: 'init' })).toEqual({ indexed: 0 });
});
it('streams normal removals and order resets independently of vectors while preserving the existing values', () => {
  const f = fixture();
  f.send({ type: 'patch-start', source: 'p', changed: 2, removed: [], order: { reset: ['a', 'b'], changes: [] } } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
  f.send({ type: 'patch-chunk', changed: [{ id: 'a', value: document('a') }, { id: 'b', value: document('b') }] } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>); f.send({ type: 'patch-end' });
  f.send({ type: 'patch-start', source: 'p', changed: 0, removed: [], order: { changes: [] }, metadata: { removed: 1, changes: 1 } } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
  f.send({ type: 'patch-metadata', removed: ['a'], changes: [{ id: 'a', type: 'removed', oldIndex: 0, newIndex: -1 }] } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>); f.send({ type: 'patch-end' });
  expect(f.query()).toEqual({ indexed: 1, count: 1, neighbors: [['b', 1, 0]] });
  f.send({ type: 'patch-start', source: 'p', changed: 0, removed: [], order: { reset: [], changes: [] }, metadata: { removed: 0, changes: 0, reset: 1 } } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
  expect(f.send({ type: 'patch-metadata', resetIds: ['b'] } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>)).toEqual({ indexed: 1, removed: 0, orderChanges: 0, resetIds: 1 }); f.send({ type: 'patch-end' });
  expect(f.query()).toEqual({ indexed: 1, count: 1, neighbors: [['b', 1, 0]] });
});
it.each(['incomplete', 'early-vector', 'oversized', 'undeclared-reset'] as const)('rejects %s metadata chunks and withdraws the replica', kind => {
  const f = fixture();
  f.send({ type: 'patch-start', source: 'p', changed: 1, removed: [], order: { changes: [] }, metadata: { removed: 129, changes: 0 } } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
  const bad = () => {
    if (kind === 'incomplete') return f.send({ type: 'patch-end' });
    if (kind === 'early-vector') return f.send({ type: 'patch-chunk', changed: [{ id: 'a', value: document('a') }] } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
    if (kind === 'oversized') return f.send({ type: 'patch-metadata', removed: Array.from({ length: 129 }, (_, index) => 'm' + index) } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
    return f.send({ type: 'patch-metadata', resetIds: ['a'] } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
  };
  expect(bad).toThrow('semantic_write_unavailable'); expect(f.index.handle({ v: 1, seq: 1, type: 'init' })).toEqual({ indexed: 0 });
});
it('builds recovery order from bounded row chunks, including null variants and later self/source selection', () => {
  const f = fixture();
  f.send({ type: 'patch-start', source: 'personal', changed: 3, removed: [], order: { reset: [], changes: [] }, orderedReset: true } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
  f.send({ type: 'patch-chunk', changed: [{ id: 'b', value: document('b') }, { id: 'hidden', value: null }] } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
  f.send({ type: 'patch-chunk', changed: [{ id: 'a', value: document('a') }] } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
  expect(f.send({ type: 'patch-end' })).toEqual({ indexed: 2, changed: 3, removed: 0 }); expect(f.query()).toEqual({ indexed: 2, count: 2, neighbors: [['b', 1, 0], ['a', 1, 1]] });
});
function fixture() {
  const index = new IndexedSemanticWriteIndex(); let seq = 0;
  const send = (message: Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>) => index.handle({ v: 1, seq: ++seq, ...message } as IndexedSemanticWriteMessage);
  send({ type: 'init' });
  return { index, send, query: () => index.handle({ v: 1, seq: ++seq, type: 'query', query: [1, 0], space: CURRENT_EMBEDDING_SPACE, scope: 'scope' }) };
}
it('commits a complete patch before queries and accounts for legacy vectors separately', () => {
  const f = fixture();
  f.send({ type: 'patch-start', source: 'personal', changed: 2, removed: [], order: { reset: ['a', 'legacy'], changes: [] } } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
  f.send({ type: 'patch-chunk', changed: [{ id: 'a', value: document('a') }, { id: 'legacy', value: { ...document('legacy'), embedding: null, embeddingModel: undefined } }] } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
  expect(f.send({ type: 'patch-end' }).indexed).toBe(2); expect(f.query()).toEqual({ indexed: 2, count: 2, neighbors: [['a', 1, 0]] });
});
it.each(['early-query', 'incomplete', 'oversized-chunk', 'private-field', 'unscoped-vector'] as const)('refuses %s and clears the entire index after a protocol violation', kind => {
  const f = fixture();
  f.send({ type: 'patch-start', source: 'personal', changed: 2, removed: [], order: { reset: ['a', 'b'], changes: [] } } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
  const bad = () => {
    if (kind === 'early-query') return f.query();
    if (kind === 'incomplete') { f.send({ type: 'patch-chunk', changed: [{ id: 'a', value: document('a') }] } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>); return f.send({ type: 'patch-end' }); }
    const changed = kind === 'oversized-chunk' ? Array.from({ length: 129 }, (_, i) => ({ id: 'x' + i, value: document('x' + i) })) : [{ id: 'a', value: kind === 'private-field' ? { ...document('a'), text: 'Synthetic private sentinel' } : { ...document('a'), scope: null } }];
    return f.send({ type: 'patch-chunk', changed } as Omit<IndexedSemanticWriteMessage, 'v' | 'seq'>);
  };
  expect(bad).toThrow('semantic_write_unavailable'); expect(f.query).toThrow('semantic_write_unavailable');
  expect(f.index.handle({ v: 1, seq: 1, type: 'init' })).toEqual({ indexed: 0 });
});

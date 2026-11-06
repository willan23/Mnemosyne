import { expect, it } from 'vitest';
import { IndexedSemanticWriteIndex } from './indexedSemanticWriteIndex';
import type { IndexedSemanticWriteMessage, IndexedSemanticDocument } from './indexedSemanticWriteProtocol';
import { CURRENT_EMBEDDING_SPACE } from './embeddingModel';

const document = (id: string): IndexedSemanticDocument => ({ id, timestamp: 1, scope: 'scope', embedding: [1, 0], embeddingModel: CURRENT_EMBEDDING_SPACE });
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

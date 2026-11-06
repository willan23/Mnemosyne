import { describe, expect, it } from 'vitest';
import { SemanticWriteIndex } from './semanticWriteIndex';
import { CURRENT_EMBEDDING_SPACE } from './embeddingModel';
import type { SemanticWriteMessage } from './semanticWriteProtocol';
import { cosineSimilarity } from './semanticConnectionBackfill';
const begin = { v: 1, seq: 0, type: 'begin', query: [1, 0], space: CURRENT_EMBEDDING_SPACE } as const;
const candidate = (id: string, embedding = [1, 0], embeddingModel: string | undefined = CURRENT_EMBEDDING_SPACE) => ({ id, embedding, embeddingModel });
describe('streaming semantic write selection', () => {
  it('matches full cosine sorting while retaining at most seven results after every batch', () => {
    const index = new SemanticWriteIndex(), query = [1, 0]; index.handle({ ...begin, query });
    let seed = 9243; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed / 0x100000000) * 2 - 1; };
    const rows = Array.from({ length: 10000 }, (_, i) => candidate('m' + i, [random(), random()]));
    let last: Array<[string, number]> = [];
    for (let offset = 0, seq = 1; offset < rows.length; offset += 128, seq++) {
      last = index.handle({ v: 1, seq, type: 'chunk', candidates: rows.slice(offset, offset + 128) }); expect(last.length).toBeLessThanOrEqual(7);
    }
    const expected = rows.map(row => [row.id, cosineSimilarity(query, row.embedding)] as [string, number]).filter(row => row[1] >= .55).sort((a, b) => b[1] - a[1]).slice(0, 7);
    expect(last).toEqual(expected);
  });
  it('preserves stable ties across batches and excludes wrong spaces, dimensions and nonfinite vectors', () => {
    const index = new SemanticWriteIndex(); index.handle({ ...begin, query: [1, 0] });
    index.handle({ v: 1, seq: 1, type: 'chunk', candidates: [candidate('a'), candidate('b'), { ...candidate('legacy'), embeddingModel: undefined }, candidate('bad', [NaN, 0]), candidate('short', [1])] });
    expect(index.handle({ v: 1, seq: 2, type: 'chunk', candidates: [candidate('c'), candidate('future', [1, 0], 'future@v1')] })).toEqual([['a', 1], ['b', 1], ['c', 1]]);
  });
  it.each([
    { v: 2, seq: 1, type: 'chunk', candidates: [] },
    { v: 1, seq: 2, type: 'chunk', candidates: [] },
    { v: 1, seq: 1, type: 'chunk', candidates: [candidate('same'), candidate('same')] },
    { v: 1, seq: 1, type: 'chunk', candidates: Array.from({ length: 129 }, (_, i) => candidate('m' + i)) },
    { v: 1, seq: 0, type: 'begin', query: [NaN], space: CURRENT_EMBEDDING_SPACE },
    { v: 1, seq: 0, type: 'begin', query: [1], space: 'legacy' },
  ])('clears its state after invalid protocol input %#', message => {
    const index = new SemanticWriteIndex(); index.handle({ ...begin, query: [1, 0] });
    expect(() => index.handle(message as SemanticWriteMessage)).toThrow('semantic_write_unavailable');
    expect(() => index.handle({ v: 1, seq: 1, type: 'chunk', candidates: [] })).toThrow();
    expect(index.handle({ ...begin, query: [1, 0] })).toEqual([]);
  });
});

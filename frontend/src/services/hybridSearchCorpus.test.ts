import { expect, it } from 'vitest';
import { HybridSearchCorpus, HYBRID_CORPUS_JOURNAL_LIMITS } from './hybridSearchCorpus';

const a = { id: 'a', text: 'Synthetic first memory', timestamp: 1 };
const b = { id: 'b', text: 'Synthetic second memory', timestamp: 2 };

it('collapses skipped revisions to current changes and removals without retaining old documents', () => {
  const corpus = new HybridSearchCorpus(); corpus.update([a, b], []);
  const first = corpus.capture();
  corpus.update([{ ...a, text: 'intermediate' }], []);
  const latest = { ...a, text: 'latest' }; corpus.update([latest], ['b']);
  const snapshot = corpus.capture(), patch = HybridSearchCorpus.read(snapshot, first);
  expect(patch.changed).toEqual([latest]); expect(patch.removed).toEqual(['b']);
  expect(patch.rebuild).toBe(false); expect(patch.size).toBe(1); expect(patch.has('a')).toBe(true); expect(patch.has('b')).toBe(false);
  expect(HybridSearchCorpus.read(snapshot, snapshot)).toMatchObject({ changed: [], removed: [], rebuild: false });
});

it('does not visit unchanged document properties to prepare a one-document delta', () => {
  let reads = 0;
  const rows = Array.from({ length: 10_000 }, (_, i) => new Proxy({ id: 'synthetic-' + i, text: 'synthetic' }, {
    get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver); },
  }));
  const corpus = new HybridSearchCorpus(); corpus.update(rows, []); const first = corpus.capture(); reads = 0;
  const edited = { id: 'synthetic-5000', text: 'edited' }; corpus.update([edited], []);
  const next = corpus.capture(), patch = HybridSearchCorpus.read(next, first);
  expect(patch.changed).toEqual([edited]); expect(patch.removed).toEqual([]); expect(patch.size).toBe(10_000); expect(reads).toBe(0);
});

it('refuses stale/forged snapshots and invalidates existing readers immediately after an update', () => {
  const corpus = new HybridSearchCorpus(); corpus.update([a], []); const first = corpus.capture();
  const patch = HybridSearchCorpus.read(first, null); expect(patch.isCurrent()).toBe(true);
  corpus.update([], ['a']); expect(patch.isCurrent()).toBe(false); expect(patch.has('a')).toBe(false);
  expect(() => HybridSearchCorpus.read(first, null)).toThrow();
  expect(() => HybridSearchCorpus.read({ revision: 1, size: 1 }, null)).toThrow();
});

it('requests a full rebuild after bounded journal eviction and when changing corpus owners', () => {
  const corpus = new HybridSearchCorpus(); corpus.update([a, b], []); const first = corpus.capture();
  corpus.update([], ['b']);
  for (let n = 0; n < HYBRID_CORPUS_JOURNAL_LIMITS.batches; n++) corpus.update([{ ...a, text: String(n) }], []);
  const current = corpus.capture(), patch = HybridSearchCorpus.read(current, first);
  expect(patch.rebuild).toBe(true); expect(patch.changed).toHaveLength(1); expect(patch.changed[0].id).toBe('a'); expect(patch.size).toBe(1);
  const other = new HybridSearchCorpus(); other.update([b], []);
  expect(HybridSearchCorpus.read(other.capture(), current)).toMatchObject({ changed: [b], rebuild: true });
});

it('does not project locked/deleted values and records transitions as removals', () => {
  const corpus = new HybridSearchCorpus(); corpus.update([a, b, { id: 'locked', encLocked: true, text: 'private' }], []);
  const first = corpus.capture(); expect(first.size).toBe(2);
  corpus.update([{ ...a, encLocked: true }, { ...b, deletedAt: 1 }], []);
  expect(HybridSearchCorpus.read(corpus.capture(), first)).toMatchObject({ changed: [], removed: ['a', 'b'], size: 0 });
});

it('validates the whole update before committing and leaves the last snapshot usable on invalid input', () => {
  const corpus = new HybridSearchCorpus(); corpus.update([a], []); const first = corpus.capture();
  expect(() => corpus.update([b, { id: 'bad/id' }], [])).toThrow();
  expect(() => corpus.update([a, a], [])).toThrow();
  expect(HybridSearchCorpus.read(first, null)).toMatchObject({ changed: [a], size: 1 });
  corpus.update([a], []); expect(corpus.capture().revision).toBe(first.revision);
});

it('drops all source references and invalidates old captures when its vault scope is cleared', () => {
  const corpus = new HybridSearchCorpus(); corpus.update([a], []); const first = corpus.capture();
  const pending = HybridSearchCorpus.read(first, null); corpus.clear();
  expect(pending.isCurrent()).toBe(false); expect(pending.has('a')).toBe(false);
  expect(() => HybridSearchCorpus.read(first, null)).toThrow();
  expect(HybridSearchCorpus.read(corpus.capture(), first)).toMatchObject({ changed: [], removed: [], size: 0, rebuild: true });
});

it('refuses a late listener callback after its vault scope was cleared', () => {
  const corpus = new HybridSearchCorpus(); corpus.update([a], []); corpus.clear();
  expect(() => corpus.update([b], [])).toThrow('hybrid_corpus_unavailable');
  expect(HybridSearchCorpus.read(corpus.capture(), null).size).toBe(0);
});

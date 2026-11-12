import { afterEach, expect, it, vi } from 'vitest';
import type { MemoryObject } from '../types/universe';
import { useUniverseStore } from '../store/universeStore';
import { IncrementalMemoryPublication, type MemoryPublicationPatch } from './incrementalMemoryPublication';
import { UniverseMemoryPublication, type UniverseAuthorityValue, type UniverseDeletionRecord } from './universeMemoryPublication';
import { IndexedSemanticWriteCorpus } from './indexedSemanticWriteCorpus';
import { IndexedSemanticWriteIndex } from './indexedSemanticWriteIndex';
import type { IndexedSemanticWriteMessage } from './indexedSemanticWriteProtocol';
import { selectSemanticWriteNeighbors } from './semanticWriteClient';
import { semanticCandidateEligibility } from './semanticWriteScope';
import { CURRENT_EMBEDDING_SPACE } from './embeddingModel';
import { memorySnapshotDelta } from './memorySnapshot';

class IndexWorker extends EventTarget {
  index = new IndexedSemanticWriteIndex();
  terminate = vi.fn(() => this.index.clear());
  postMessage = vi.fn((message: IndexedSemanticWriteMessage) => {
    const data = { v: 1, seq: message.seq, ok: true, ...this.index.handle(structuredClone(message)) };
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data })));
  });
}
const row = (id: string, extra: Partial<MemoryObject> = {}): MemoryObject => ({ id, uid: 'alice', text: 'Synthetic ' + id,
  timestamp: 1, updatedAt: 10, persistedUpdatedAt: 10, persistedStateDigest: 'a'.repeat(64), persistedTitle: null,
  celestialType: 'planet', position: [0, 0, 0], importance: .5, connections: [], embedding: [1, 0], embeddingModel: CURRENT_EMBEDDING_SPACE, ...extra });
const live: Array<() => void> = [];
afterEach(() => { useUniverseStore.getState().loadMemories([]); for (const clear of live.splice(0)) clear(); localStorage.clear(); vi.restoreAllMocks(); });
function fixture(deletions = new Map<string, UniverseDeletionRecord>()) {
  let current = true, sequence = 0;
  const teams = new Set(['crew', 'other']), tombstones = new Set<string>(), changed = vi.fn();
  const publication = new IncrementalMemoryPublication<MemoryObject>('asc', { sourceBase: 2 }), worker = new IndexWorker();
  const semantic = new IndexedSemanticWriteCorpus<MemoryObject>({ uid: 'alice', teamIds: teams }, id => publication.get(id), () => worker as unknown as Worker, { direction: 'asc', sourceBase: 2 });
  const owner = new UniverseMemoryPublication({ uid: 'alice', publication, semantic, isCurrent: () => current, teams: () => teams, changed, tombstones, deletions });
  live.push(() => { owner.clear(); publication.clear(); semantic.clear(); });
  const publish = () => { const value = owner.snapshot(); useUniverseStore.getState().loadMemories(value); return value; };
  const apply = (key: string, patch: MemoryPublicationPatch<MemoryObject>, values?: ReadonlyMap<string, UniverseAuthorityValue>) => {
    owner.observedSnapshot(key, ++sequence);
    owner.apply(key, patch, values ?? new Map(patch.changed.map(({ id, value }) => [id, { memory: value, tombstone: !value, revision: value?.persistedUpdatedAt ?? 20 }])), sequence);
    return publish();
  };
  const put = (key: string, rows: MemoryObject[]) => apply(key, { changed: rows.map(value => ({ id: value.id, value })), removed: [], order: { reset: rows.map(value => value.id), changes: [] } });
  const query = (teamId?: string) => selectSemanticWriteNeighbors([1, 0], useUniverseStore.getState().memories, { eligible: semanticCandidateEligibility('alice', teamId) });
  publish();
  return { owner, publication, semantic, worker, teams, tombstones, changed, deletions, publish, apply, put, query, retire: () => { current = false; } };
}
it('requires genuine scope confirmations and uses their captured creation rather than a supplied DTO', async () => {
  const f = fixture(), value = row('new'), token = f.owner.created(value, 'confirmed')!;
  expect(Array.isArray(useUniverseStore.getState().memories)).toBe(false);
  useUniverseStore.getState().addMemory(value); expect(useUniverseStore.getState().memories).toHaveLength(0);
  useUniverseStore.getState().addMemory(row('confirmed', { text: 'Changed caller DTO' }), token);
  expect(useUniverseStore.getState().memories[0].text).toBe(value.text);
  expect((await f.query()).count).toBe(1);
  const before = f.changed.mock.calls.length; useUniverseStore.getState().addMemory(row('confirmed'), token); expect(f.changed).toHaveBeenCalledTimes(before);
  expect(localStorage.getItem('mnemosyne-universe-preferences')).not.toContain('Synthetic');
});
it('reconciles SDK before and after the creation acknowledgement without duplicate IDs or lost bindings', async () => {
  const f = fixture(), captured = row('placeholder'), authoritative = row('actual', { text: 'Authoritative', persistedStateDigest: 'b'.repeat(64) });
  f.put('personal', [authoritative]); const token = f.owner.created(captured, 'actual')!;
  useUniverseStore.getState().addMemory(row('actual'), token);
  expect(useUniverseStore.getState().memories).toHaveLength(1); expect(useUniverseStore.getState().memories[0]).toBe(authoritative);
  expect((await f.query()).count).toBe(1);
  const token2 = f.owner.created(row('placeholder2'), 'second')!; useUniverseStore.getState().addMemory(row('second'), token2);
  expect((await f.query()).count).toBe(2);
  f.put('personal', [authoritative, row('second', { text: 'SDK second' })]);
  expect(useUniverseStore.getState().memories.map(value => value.id)).toEqual(['actual', 'second']);
  expect((await f.query()).count).toBe(2);
});
it('stages animation after the delete receipt, excludes semantics, then resists a stale active SDK row', async () => {
  const f = fixture(), value = row('deleted'); f.put('personal', [value]); expect((await f.query()).count).toBe(1);
  const token = f.owner.deleted(value, 20)!;
  expect(useUniverseStore.getState().startDeletion(value.id, 'supernova', token)).toBe(true);
  expect(useUniverseStore.getState().memories[0]).toMatchObject({ pendingDeletion: true, deletedAt: 20 }); expect((await f.query()).count).toBe(0);
  useUniverseStore.getState().removeMemory(value.id, token); expect(useUniverseStore.getState().memories).toHaveLength(0);
  f.put('personal', [row('deleted', { updatedAt: 19, persistedUpdatedAt: 19 })]);
  expect(useUniverseStore.getState().memories).toHaveLength(0); expect((await f.query()).count).toBe(0);
  expect(useUniverseStore.getState().startDeletion(value.id, 'supernova', token)).toBe(false);
});
it('accepts a newer same-scope restore and rejects an old receipt even when its digest matches', async () => {
  const f = fixture(), value = row('restored'); f.put('personal', [value]); const token = f.owner.deleted(value, 20)!;
  useUniverseStore.getState().startDeletion(value.id, 'supernova', token);
  f.put('personal', [row('restored', { updatedAt: 21, persistedUpdatedAt: 21 })]);
  expect(useUniverseStore.getState().memories[0].pendingDeletion).toBeUndefined(); expect((await f.query()).count).toBe(1);
  useUniverseStore.getState().removeMemory(value.id, token); expect(useUniverseStore.getState().memories).toHaveLength(1);
  expect(f.owner.deleted(value, 20)).toBeUndefined();
});
it('scopes deletion suppression to the team and leaves a personal variant with the same ID visible', async () => {
  const f = fixture(), personal = row('same'), team = row('same', { teamId: 'crew', uid: 'bob' });
  f.put('personal', [personal]); f.put('team:crew', [team]); const token = f.owner.deleted(team, 20)!;
  useUniverseStore.getState().startDeletion(team.id, 'supernova', token); useUniverseStore.getState().removeMemory(team.id, token);
  expect(useUniverseStore.getState().memories[0]).toBe(personal);
  expect((await f.query('crew')).count).toBe(0); expect((await f.query()).count).toBe(1);
  f.put('team:other', [row('same', { teamId: 'other', uid: 'bob' })]); expect(useUniverseStore.getState().memories[0].teamId).toBe('other');
});
it('cannot use a creation receipt after a tombstone, source denial, scope retirement or another publication', () => {
  const f = fixture(), value = row('new'), token = f.owner.created(value, value.id)!;
  f.apply('personal', { changed: [{ id: value.id, value: null }], removed: [], order: { reset: [value.id], changes: [] } });
  useUniverseStore.getState().addMemory(value, token); expect(useUniverseStore.getState().memories).toHaveLength(0);
  const denied = f.owner.created(row('denied'), 'denied')!; f.owner.removeSource('personal'); f.publish();
  useUniverseStore.getState().addMemory(row('denied'), denied); expect(useUniverseStore.getState().memories).toHaveLength(0);
  const other = fixture(); useUniverseStore.getState().addMemory(value, token); expect(useUniverseStore.getState().memories).toHaveLength(0);
  other.retire(); expect(other.owner.created(row('retired'), 'retired')).toBeUndefined();
});
it('does not discard a confirmed personal creation when the legacy listener fails', async () => {
  const f = fixture(), token = f.owner.created(row('pending'), 'pending')!;
  useUniverseStore.getState().addMemory(row('pending'), token); f.owner.removeSource('legacy'); f.publish();
  expect(useUniverseStore.getState().memories).toHaveLength(1); expect((await f.query()).count).toBe(1);
});
it('suppresses a legacy shadow when the SDK removes the root before the deletion acknowledgement', () => {
  const f = fixture(), value = row('shadow'); f.put('legacy', [row(value.id, { persistedStateDigest: 'b'.repeat(64) })]); f.put('personal', [value]);
  f.apply('personal', { changed: [], removed: [value.id], order: { changes: [{ id: value.id, type: 'removed', oldIndex: 0, newIndex: -1 }] } });
  expect(useUniverseStore.getState().memories).toHaveLength(1);
  const token = f.owner.deleted(value, 20)!;
  expect(useUniverseStore.getState().startDeletion(value.id, 'supernova', token)).toBe(false);
  expect(useUniverseStore.getState().memories).toHaveLength(0);
});
it('does not animate or deselect another namespace when a team deletion is acknowledged after its SDK removal', () => {
  const f = fixture(), personal = row('collision'), team = row(personal.id, { teamId: 'crew', uid: 'bob' });
  f.put('personal', [personal]); f.put('team:crew', [team]); f.put('team:crew', []); useUniverseStore.getState().selectMemory(personal.id);
  const token = f.owner.deleted(team, 20)!;
  expect(useUniverseStore.getState().startDeletion(team.id, 'supernova', token)).toBe(false);
  expect(useUniverseStore.getState().memories[0]).toBe(personal); expect(useUniverseStore.getState().deletingMemoryId).toBeNull();
  expect(useUniverseStore.getState().selectedMemoryId).toBe(personal.id);
});
it('retains deletion metadata across a fresh crypto scope without retaining the animation plaintext', () => {
  const first = fixture(), value = row('hidden'); first.put('personal', [value]); const token = first.owner.deleted(value, 20)!;
  useUniverseStore.getState().startDeletion(value.id, 'supernova', token); first.owner.clear(); first.publication.clear(); first.semantic.clear();
  const next = fixture(first.deletions); next.put('legacy', [value]); next.put('personal', [value]);
  expect(useUniverseStore.getState().memories).toHaveLength(0);
  useUniverseStore.getState().removeMemory(value.id, token); expect(useUniverseStore.getState().memories).toHaveLength(0);
});
it('publishes 10000 roots and a single changed row without dense publication or historical vector reads', async () => {
  const f = fixture(); let projections = 0;
  const vectorRow = (id: string) => Object.defineProperty(row(id), 'embedding', { get() { projections++; return [1, 0]; } });
  const values = Array.from({ length: 10000 }, (_, i) => vectorRow('id' + i));
  const dense = vi.spyOn(f.publication, 'publish'), ordered = vi.spyOn(f.publication, 'orderedValues');
  const before = f.put('personal', values); expect((await f.query()).count).toBe(10000); expect(projections).toBe(10000);
  const changed = vectorRow('id0'), after = f.apply('personal', { changed: [{ id: changed.id, value: changed }], removed: [], order: { changes: [] } });
  expect(memorySnapshotDelta(before, after)?.changed).toEqual([changed]);
  expect((await f.query()).count).toBe(10000); expect(projections).toBe(10001); expect(dense).not.toHaveBeenCalled(); expect(ordered).not.toHaveBeenCalled();
}, 15000);

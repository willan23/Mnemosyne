import { describe, expect, it, vi } from 'vitest';
vi.mock('../firebase', () => ({ auth: { currentUser: null }, db: {}, default: {} }));
import { appendLocalMemoryActivity, loadLocalMemoryActivity, clearLocalMemoryActivity, exportLocalMemoryActivity,
  LOCAL_ACTIVITY_RETENTION_MS, type LocalMemoryActivity, type LocalMemoryActivityDeps } from './localMemoryActivity';
import type { StoredMemoryActivity } from './localMemoryActivityStore';

const uuid = (n: number) => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const event = (n: number, at = 1000): LocalMemoryActivity => ({ id: uuid(n), kind: 'retrieve', operation: 'search', at, resultCount: n % 100 });
function fixture() {
  const records = new Map<string, StoredMemoryActivity>(), observers = new Set<() => void>();
  let actor = 'alice', ready = true, now = 1000, nonce = 1000;
  const deps: LocalMemoryActivityDeps = {
    mutation: { uid: () => actor, ready: () => ready, subscribe: callback => { observers.add(callback); return () => { observers.delete(callback); }; } },
    store: {
      get: vi.fn(async uid => structuredClone(records.get(uid))),
      compareExchange: vi.fn(async (uid, expected, next, guard) => { guard();
        if ((records.has(uid) ? JSON.stringify(records.get(uid)) : null) !== expected) return false;
        records.set(uid, structuredClone(next)); return true;
      }), remove: vi.fn(async (uid, guard) => { guard(); records.delete(uid); }),
    },
    encrypt: vi.fn(async value => ({ v: 1 as const, iv: 'synthetic', ct: btoa(JSON.stringify(value)) })),
    decrypt: vi.fn(async value => JSON.parse(atob(value.ct))), now: () => now, id: () => uuid(nonce++),
  };
  return { deps, records, setNow: (value: number) => { now = value; },
    change: (uid = actor, unlocked = ready) => { actor = uid; ready = unlocked; for (const callback of observers) callback(); },
    body: (uid = 'alice') => JSON.parse(JSON.parse(atob(records.get(uid)!.enc.ct)).text), observers };
}

describe('private local memory activity', () => {
  it('stores only encrypted exact metadata and deduplicates the same confirmed event', async () => {
    const f = fixture(), rows: LocalMemoryActivity[] = [event(1), { id: uuid(2), kind: 'index', at: 1000, indexed: 10, changed: 1, removed: 2 }];
    await appendLocalMemoryActivity('alice', rows, f.deps);
    const snapshot = JSON.stringify([...f.records]);
    await appendLocalMemoryActivity('alice', rows, f.deps);
    expect(JSON.stringify([...f.records])).toBe(snapshot);
    expect(f.body().events).toEqual(rows);
    expect(Object.keys(f.records.get('alice')!).sort()).toEqual(['enc', 'reset', 'revision', 'uid', 'v']);
    const output = JSON.parse(await exportLocalMemoryActivity('alice', f.deps));
    expect(Object.keys(output).sort()).toEqual(['events', 'format', 'v']);
    expect(output.events).toEqual(rows);
    await expect(appendLocalMemoryActivity('alice', [{ ...event(1), resultCount: 99 }], f.deps)).rejects.toThrow('local_memory_activity_unavailable');
    expect(f.observers.size).toBe(0);
  });
  it('rejects queries, content, IDs, vectors, invalid counts and dates before accessing storage', async () => {
    for (const patch of [{ query: 'SYNTHETIC-QUERY' }, { text: 'SYNTHETIC-CONTENT' }, { memoryId: 'SYNTHETIC-ID' },
      { embedding: [1, 0] }, { resultCount: 100001 }, { resultCount: NaN }, { at: Infinity }, { id: 'bad' }, { operation: 'network' }]) {
      const f = fixture();
      await expect(appendLocalMemoryActivity('alice', [{ ...event(1), ...patch } as LocalMemoryActivity], f.deps)).rejects.toThrow('local_memory_activity_unavailable');
      expect(f.deps.store.get).not.toHaveBeenCalled();
    }
  });
  it('bounds history to 200 events and prunes expired records on read, preserving a clock rollback', async () => {
    const f = fixture();
    await appendLocalMemoryActivity('alice', Array.from({ length: 200 }, (_, n) => event(n + 1)), f.deps);
    await appendLocalMemoryActivity('alice', [event(201)], f.deps);
    expect((await loadLocalMemoryActivity('alice', f.deps))).toHaveLength(200);
    expect(f.body().events.some((row: LocalMemoryActivity) => row.id === uuid(1))).toBe(false);
    f.setNow(999);
    expect(await loadLocalMemoryActivity('alice', f.deps)).toHaveLength(200);
    f.setNow(1000 + LOCAL_ACTIVITY_RETENTION_MS + 1);
    expect(await loadLocalMemoryActivity('alice', f.deps)).toEqual([]);
    expect(f.body().events).toEqual([]);
  });
  it('merges concurrent appends and handles an ACK lost after the atomic store write', async () => {
    const f = fixture();
    await Promise.all([appendLocalMemoryActivity('alice', [event(1)], f.deps), appendLocalMemoryActivity('alice', [event(2)], f.deps)]);
    expect(f.body().events.map((row: LocalMemoryActivity) => row.id)).toEqual([uuid(1), uuid(2)]);
    const original = f.deps.store.compareExchange;
    f.deps.store.compareExchange = vi.fn(async (...args) => { f.deps.store.compareExchange = original; await original(...args); throw Error('synthetic lost ACK'); });
    await expect(appendLocalMemoryActivity('alice', [event(3)], f.deps)).rejects.toThrow('local_memory_activity_unavailable');
    await appendLocalMemoryActivity('alice', [event(3)], f.deps);
    expect(f.body().events.map((row: LocalMemoryActivity) => row.id)).toEqual([uuid(1), uuid(2), uuid(3)]);
  });
  it('a clear fences a pending append and preserves the other account', async () => {
    const f = fixture(); await appendLocalMemoryActivity('alice', [event(1)], f.deps);
    f.change('bob'); await appendLocalMemoryActivity('bob', [event(2)], f.deps); f.change('alice');
    const other = JSON.stringify(f.records.get('bob'));
    let release!: () => void, started!: () => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    const original = f.deps.encrypt;
    f.deps.encrypt = vi.fn(async value => { f.deps.encrypt = original; started(); await new Promise<void>(resolve => { release = resolve; }); return original(value); });
    const append = appendLocalMemoryActivity('alice', [event(3)], f.deps), rejected = expect(append).rejects.toThrow('local_memory_activity_unavailable');
    await pending; await clearLocalMemoryActivity('alice', f.deps); release(); await rejected;
    expect(await loadLocalMemoryActivity('alice', f.deps)).toEqual([]);
    expect(JSON.stringify(f.records.get('bob'))).toBe(other);
  });
  it('observed account/vault ABA during encryption cannot commit', async () => {
    for (const mode of ['account', 'vault']) {
      const f = fixture(), original = f.deps.encrypt;
      f.deps.encrypt = vi.fn(async value => { if (mode === 'account') { f.change('bob'); f.change('alice'); } else { f.change('alice', false); f.change('alice', true); } return original(value); });
      await expect(appendLocalMemoryActivity('alice', [event(1)], f.deps)).rejects.toThrow('local_memory_activity_unavailable');
      expect(f.records.size).toBe(0); expect(f.observers.size).toBe(0);
    }
  });
  it('does not overwrite malformed or foreign ciphertext and stops after bounded CAS contention', async () => {
    const f = fixture(); await appendLocalMemoryActivity('alice', [event(1)], f.deps);
    const valid = structuredClone(f.records.get('alice')!);
    for (const patch of [{ uid: 'bob' }, { enc: { ...valid.enc, ct: 'bad' } }, { extra: 'private' }]) {
      f.records.set('alice', { ...valid, ...patch } as StoredMemoryActivity);
      const before = JSON.stringify([...f.records]);
      await expect(appendLocalMemoryActivity('alice', [event(2)], f.deps)).rejects.toThrow('local_memory_activity_unavailable');
      expect(JSON.stringify([...f.records])).toBe(before);
    }
    f.records.clear(); f.deps.store.compareExchange = vi.fn(async () => false);
    await expect(appendLocalMemoryActivity('alice', [event(2)], f.deps)).rejects.toThrow('local_memory_activity_unavailable');
    expect(f.deps.store.compareExchange).toHaveBeenCalledTimes(8);
  });
});

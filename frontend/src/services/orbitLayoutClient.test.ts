import { afterEach, expect, it, vi } from 'vitest';
import { OrbitLayoutClient } from './orbitLayoutClient';
import { OrbitGraph } from './orbitGraph';
import { OrbitLayoutWorkerMock } from '../test/orbitLayoutWorkerMock';
import { IncrementalMemoryPublication } from './incrementalMemoryPublication';
import type { MemoryObject } from '../types/universe';
import type { OrbitRecord } from './orbitLayoutProtocol';
const scope = { uid: 'alice', teamIds: new Set(['crew']) }, now = 12345;
const row = (id: string, extra: Partial<MemoryObject> = {}): MemoryObject => ({ id, uid: scope.uid, text: 'Synthetic untransferred content', celestialType: 'planet', position: [0, 0, 0], connections: [], importance: 0.5, timestamp: 1, updatedAt: 0, embedding: [], ...extra });
const project = (row: MemoryObject): OrbitRecord => ({ id: row.id, celestialType: row.celestialType, position: row.position, connections: row.connections, parentId: row.parentId ?? null, orbitRadius: row.orbitRadius ?? null, orbitSpeed: row.orbitSpeed ?? null, importance: row.importance, updatedAt: row.updatedAt });
const signal = () => new AbortController().signal;
function fixture(options: ConstructorParameters<typeof OrbitLayoutClient>[1] = {}) { const worker = new OrbitLayoutWorkerMock(), client = new OrbitLayoutClient(scope, { createWorker: () => worker as unknown as Worker, yieldTask: async () => {}, ...options }); return { client, worker }; }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('applies ACL before metadata getters and sends no content, vectors or identity fields', async () => {
  const f = fixture(), root = row('root', { celestialType: 'sun' }), child = row('child', { connections: ['root'] }), team = row('team', { uid: 'other', teamId: 'crew' }), denied = row('DENIED', { uid: 'other', teamId: 'outside' });
  Object.defineProperty(denied, 'position', { get() { throw Error('Read denied metadata'); } });
  for (const value of [root, child, team]) for (const field of ['text', 'embedding'] as const) Object.defineProperty(value, field, { get() { throw Error('Read content/vector'); } });
  try { const result = await f.client.select([root, child, team, denied], ['child', 'DENIED'], 4, now, signal()); expect([...result.positions]).toEqual(new OrbitGraph([root, child, team].map(project)).sample(['child'], 4, now).positions.map(([id, ...position]) => [id, position]));
    const messages = f.worker.postMessage.mock.calls.map(([message]) => message); expect(JSON.stringify(messages)).not.toMatch(/DENIED|alice|crew|outside|Synthetic|embedding|"text"/); expect(messages.filter(message => message.type === 'sample')).toHaveLength(1);
  } finally { f.client.dispose(); }
});
it('reuses the metadata replica while time advances and keeps the previous frame readable during the next request', async () => {
  const f = fixture(), source = [row('a')];
  try { const first = await f.client.select(source, ['a'], 1, now, signal()), marker = f.worker.postMessage.mock.calls.length; const pending = f.client.select(source, ['a'], 2, now, signal()); expect(first.positions.get('a')).toBeDefined(); const second = await pending;
    expect(first.positions.get('a')).toBeDefined(); expect(second.positions.get('a')).not.toEqual(first.positions.get('a')); expect(f.worker.postMessage.mock.calls.slice(marker).map(([message]) => message.type)).toEqual(['sample']); f.client.dispose(); expect(first.positions.size).toBe(0); expect(second.positions.get('a')).toBeUndefined();
  } finally { f.client.dispose(); }
});
it('projects only the changed published row and never enumerates the raw source for a warm edit', async () => {
  const f = fixture(), publisher = new IncrementalMemoryPublication<MemoryObject>('asc'); let reads = 0;
  const rows = Array.from({ length: 1000 }, (_, at) => Object.defineProperty(row('m' + at, { timestamp: at }), 'position', { get() { reads++; return [0, 0, 0]; } })); publisher.apply('source', { changed: rows.map(value => ({ id: value.id, value })), removed: [], order: { reset: rows.map(value => value.id), changes: [] } });
  try { await f.client.select(publisher.snapshot(), ['m999'], 1, now, signal()); reads = 0; const marker = f.worker.postMessage.mock.calls.length, value = Object.defineProperty(row('m500', { timestamp: 500 }), 'position', { get() { reads++; return [3, 4, 5]; } }); publisher.apply('source', { changed: [{ id: value.id, value }], removed: [], order: { changes: [] } }); const source = publisher.snapshot(); vi.spyOn(Object.getPrototypeOf(source), Symbol.iterator).mockImplementation(() => { throw Error('Enumerated warm source'); });
    const result = await f.client.select(source, ['m500'], 1, now, signal()); expect(reads).toBe(1); expect(result.positions.has('m500')).toBe(true); const messages = f.worker.postMessage.mock.calls.slice(marker).map(([message]) => message); expect(messages.flatMap(message => message.type === 'patch-chunk' ? message.frame.changed ?? [] : [])).toHaveLength(1); expect(messages.some(message => message.type === 'patch-chunk' && message.frame.order)).toBe(false);
  } finally { f.client.dispose(); }
});
it('withdraws earlier frames on a source or selection change and handles missing and cyclic parents', async () => {
  const f = fixture(), source = [row('a', { parentId: 'b' }), row('b', { parentId: 'a' }), row('c', { parentId: 'missing' })];
  try { const first = await f.client.select(source, ['a'], 1, now, signal()); await f.client.select(source, ['b', 'c'], 1, now, signal()); expect(first.positions.get('a')).toBeUndefined(); const second = await f.client.select(source, ['b'], 1, now, signal()); await f.client.select([row('fresh')], ['fresh'], 1, now, signal()); expect(second.positions.get('b')).toBeUndefined();
  } finally { f.client.dispose(); }
});
it('rejects a forged frame before exposing positions and retires a late response after scope revocation', async () => {
  const f = fixture(), normal = f.worker.postMessage.getMockImplementation()!; f.worker.postMessage.mockImplementation(message => { if (message.type === 'sample') queueMicrotask(() => f.worker.onmessage?.({ data: { v: 1, seq: message.seq, ok: true, frame: { time: message.time, now: message.now, positions: [['other', 0, 0, 0]] } } })); else normal(message); });
  await expect(f.client.select([row('a')], ['a'], 1, now, signal())).rejects.toThrow('orbit_layout_unavailable'); expect(f.worker.terminate).toHaveBeenCalledOnce();
  const worker = new OrbitLayoutWorkerMock(), client = new OrbitLayoutClient(scope, { createWorker: () => worker as unknown as Worker, yieldTask: async () => {} }); let allowed = true, release: (() => void) | undefined; const post = worker.postMessage.getMockImplementation()!; worker.postMessage.mockImplementation(message => { if (message.type === 'sample') release = () => post(message); else post(message); });
  const pending = client.select([row('a')], ['a'], 1, now, signal(), () => { if (!allowed) throw Error('scope retired'); }); await vi.waitFor(() => expect(release).toBeTypeOf('function')); allowed = false; release!(); await expect(pending).rejects.toThrow(); expect(worker.terminate).toHaveBeenCalledOnce(); client.dispose();
});
it('times out a stalled frame and never resolves positions from a retired snapshot', async () => {
  vi.useFakeTimers(); const f = fixture(), publisher = new IncrementalMemoryPublication<MemoryObject>('asc'); publisher.apply('source', { changed: [{ id: 'a', value: row('a') }], removed: [], order: { reset: ['a'], changes: [] } }); const old = publisher.snapshot(); publisher.clear(); await expect(f.client.select(old, ['a'], 1, now, signal())).rejects.toThrow(); expect(f.worker.postMessage).not.toHaveBeenCalled();
  const g = fixture(); g.worker.postMessage.mockImplementation(() => {}); const pending = g.client.select([row('a')], ['a'], 1, now, signal()), check = expect(pending).rejects.toThrow('orbit_layout_unavailable'); await vi.advanceTimersByTimeAsync(30_001); await check; expect(g.worker.terminate).toHaveBeenCalledOnce();
});

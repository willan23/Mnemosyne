import { expect, it } from 'vitest';
import { MemoryViewTransport } from './memoryViewTransport';
import type { MemoryViewMessage, MemoryViewRecord, MemoryViewOptions } from './memoryViewProtocol';

type Message = MemoryViewMessage extends infer M ? M extends { id: number } ? Omit<M, 'v' | 'id'> : never : never;
const row = (id: string, timestamp = 1): MemoryViewRecord => ({ id, timestamp, updatedAt: 1, importance: .5, fields: [id], connections: [], taxonomyLane: null });
const list = { mode: 'list', query: '', locale: 'en', limit: 100 } as const;
function fixture() {
  const transport = new MemoryViewTransport(); let id = 0;
  const send = (message: Message) => transport.handle(structuredClone({ ...message, id: ++id, v: 2 }) as MemoryViewMessage);
  const initialize = (rows: MemoryViewRecord[]) => {
    send({ type: 'patch-start', reset: true, preserve: false, counts: { size: rows.length, changed: rows.length, removed: 0, moves: 0, order: rows.length } });
    for (let i = 0; i < rows.length; i += 128) send({ type: 'patch-chunk', frame: { order: rows.slice(i, i + 128).map(row => row.id) } });
    for (let i = 0; i < rows.length; i += 128) send({ type: 'patch-chunk', frame: { changed: rows.slice(i, i + 128) } });
    send({ type: 'patch-end' });
  };
  const query = (options: MemoryViewOptions = list) => { send({ type: 'query-start', options, now: 1, filteredCount: null, reuseFilter: false }); return send({ type: 'query-end' }); };
  return { transport, send, initialize, query };
}
it('streams a baseline then applies precise order moves, content changes and removals', () => {
  const f = fixture(); f.initialize([row('a'), row('b'), row('c')]); expect(f.query()).toEqual({ count: 3, ids: ['a', 'b', 'c'] });
  f.send({ type: 'patch-start', reset: false, preserve: true, counts: { size: 2, changed: 1, removed: 1, moves: 3, order: 0 } });
  f.send({ type: 'patch-chunk', frame: { moves: [{ type: 'removed', id: 'c', oldIndex: 2, newIndex: -1 }, { type: 'added', id: 'c', oldIndex: -1, newIndex: 0 }, { type: 'removed', id: 'b', oldIndex: 2, newIndex: -1 }] } });
  f.send({ type: 'patch-chunk', frame: { removed: ['b'] } }); f.send({ type: 'patch-chunk', frame: { changed: [row('a', 2)] } }); f.send({ type: 'patch-end' });
  expect(f.query()).toEqual({ count: 2, ids: ['a', 'c'] });
});
it('streams scene filters, distinguishes an empty set from no filter and reuses the committed filter', () => {
  const f = fixture(); f.initialize([row('a'), row('b')]);
  const options = { mode: 'scene', activeId: null, filteredIds: null, taxonomy: null } as const;
  f.send({ type: 'query-start', options, now: 1, filteredCount: 1, reuseFilter: false }); f.send({ type: 'filter-chunk', ids: ['b'] });
  expect(f.send({ type: 'query-end' })).toEqual({ count: 1, ids: ['b'] });
  f.send({ type: 'query-start', options, now: 1, filteredCount: null, reuseFilter: true }); expect(f.send({ type: 'query-end' })).toEqual({ count: 1, ids: ['b'] });
  f.send({ type: 'query-start', options, now: 1, filteredCount: 0, reuseFilter: false }); expect(f.send({ type: 'query-end' })).toEqual({ count: 0, ids: [] });
  expect(f.query(options)).toEqual({ count: 2, ids: ['a', 'b'] });
});
it.each([
  { type: 'patch-start', reset: true, preserve: false, counts: { size: 100001, changed: 0, removed: 0, moves: 0, order: 100001 } },
  { type: 'patch-chunk', frame: { changed: [row('a')] } },
  { type: 'patch-end' },
  { type: 'filter-chunk', ids: ['a'] },
  { type: 'query-end' },
] as Message[])('rejects phase/capacity violations, clears the replica, and requires a fresh full baseline %#', message => {
  const f = fixture(); f.initialize([row('a')]); expect(() => f.send(message)).toThrow('memory_view_unavailable');
  expect(() => f.query()).toThrow(); f.initialize([row('restored')]); expect(f.query()).toEqual({ count: 1, ids: ['restored'] });
});
it('refuses oversized frames, duplicated order IDs, wrong positions and missing declared records', () => {
  for (const variant of ['oversized', 'duplicate', 'position', 'incomplete'] as const) {
    const f = fixture(); f.initialize([row('a')]);
    if (variant === 'position') {
      f.send({ type: 'patch-start', reset: false, preserve: true, counts: { size: 0, changed: 0, removed: 1, moves: 1, order: 0 } });
      expect(() => f.send({ type: 'patch-chunk', frame: { moves: [{ type: 'removed', id: 'other', oldIndex: 0, newIndex: -1 }] } })).toThrow();
    } else {
      const count = variant === 'oversized' ? 129 : 2;
      f.send({ type: 'patch-start', reset: true, preserve: false, counts: { size: count, changed: count, removed: 0, moves: 0, order: count } });
      if (variant === 'oversized') expect(() => f.send({ type: 'patch-chunk', frame: { order: Array.from({ length: count }, (_, i) => 'm' + i) } })).toThrow();
      else if (variant === 'duplicate') expect(() => f.send({ type: 'patch-chunk', frame: { order: ['a', 'a'] } })).toThrow();
      else { f.send({ type: 'patch-chunk', frame: { order: ['a', 'b'] } }); f.send({ type: 'patch-chunk', frame: { changed: [row('a')] } }); expect(() => f.send({ type: 'patch-end' })).toThrow(); }
    }
    expect(() => f.query()).toThrow();
  }
});
it('cannot query a half-applied patch or finish a partial filter transfer', () => {
  const f = fixture(); f.initialize([row('a')]);
  f.send({ type: 'patch-start', reset: false, preserve: true, counts: { size: 1, changed: 1, removed: 0, moves: 0, order: 0 } });
  expect(() => f.query()).toThrow(); f.initialize([row('a')]);
  f.send({ type: 'query-start', options: { mode: 'scene', activeId: null, taxonomy: null, filteredIds: null }, now: 1, filteredCount: 1, reuseFilter: false });
  expect(() => f.send({ type: 'query-end' })).toThrow();
});
it('rejects the old one-shot wire format and replayed message IDs', () => {
  const f = fixture(); f.initialize([row('a')]);
  expect(() => f.transport.handle({ v: 1, id: 99 } as unknown as MemoryViewMessage)).toThrow();
  f.initialize([row('a')]); const message = { v: 2, id: 999, type: 'query-start', options: list, now: 1, filteredCount: null, reuseFilter: false } as const;
  f.transport.handle(message); expect(() => f.transport.handle(message)).toThrow();
});

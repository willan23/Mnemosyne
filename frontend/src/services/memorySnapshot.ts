import { memoryNodeAt, memoryNodeById, memoryNodeCount, memoryNodeIncluded, memoryNodeRange, type PersistentMemoryNode } from './persistentMemoryTree';

export interface MemorySnapshotFence { active: boolean }
export interface MemorySnapshotMove { type: 'added' | 'removed'; id: string; oldIndex: number; newIndex: number }
export interface MemorySnapshotJournal { entries: Map<number, { ids: readonly string[]; moves: ReadonlyArray<readonly MemorySnapshotMove[]> }>; weight: number }
export interface MemorySnapshotRoots<T extends { id: string }> {
  root: PersistentMemoryNode<T> | null; byId: PersistentMemoryNode<T> | null;
  views: readonly string[]; fence: MemorySnapshotFence; revision: number;
  journal?: MemorySnapshotJournal;
}
type Data<T extends { id: string }> = MemorySnapshotRoots<T> & { view: number; cache: Map<number, MemorySnapshot<T>> };
const data = new WeakMap<object, Data<{ id: string }>>();
const unavailable = () => new Error('memory_snapshot_unavailable');
function read<T extends { id: string }>(value: MemorySnapshotFacade<T>): Data<T> { const row = data.get(value); if (!row?.fence.active) throw unavailable(); return row as Data<T>; }
/** Only the branded Proxy supplies the complete readonly Array contract through its indexed/native forwarding. */
function snapshotReceiver<T extends { id: string }>(value: MemorySnapshotFacade<T>): MemorySnapshot<T> { read(value); return value as unknown as MemorySnapshot<T>; }
const position = (value: number, length: number) => { const n = Math.trunc(Number(value)) || 0; return n < 0 ? Math.max(length + n, 0) : Math.min(n, length); };

/** Explicit immutable collection, not a native Array. Array methods stay available for legacy readers. */
export type MemorySnapshot<T extends { id: string }> = ReadonlyArray<T> & MemorySnapshotFacade<T>;
class MemorySnapshotFacade<T extends { id: string }> {
  get length(): number { const row = read(this); return memoryNodeCount(row.root, row.view); }
  get revision(): number { return read(this).revision; }
  get [Symbol.isConcatSpreadable](): boolean { return true; }
  get(id: string): T | undefined { const row = read(this), node = memoryNodeById(row.byId, id); return node && memoryNodeIncluded(node, row.view) ? node.value : undefined; }
  at(index: number): T | undefined { const row = read(this), length = memoryNodeCount(row.root, row.view), at = Math.trunc(Number(index)) || 0; return memoryNodeAt(row.root, at < 0 ? length + at : at, row.view); }
  view(name: string): MemorySnapshot<T> { const row = read(this), index = row.views.indexOf(name); if (index < 0) throw unavailable(); return createMemorySnapshot(row, index, row.cache); }
  *[Symbol.iterator](): Generator<T, undefined, unknown> { const row = read(this); for (const value of memoryNodeRange(row.root, 0, memoryNodeCount(row.root, row.view), row.view)) { read(this); yield value; } read(this); }
  *values(): Generator<T, undefined, unknown> { yield* this; }
  *keys(): Generator<number, undefined, unknown> { for (let index = 0; index < this.length; index++) yield index; }
  *entries(): Generator<[number, T], undefined, unknown> { let index = 0; for (const value of this) yield [index++, value]; }
  slice(start = 0, end = this.length): T[] { const row = read(this), length = this.length, values: T[] = []; for (const value of memoryNodeRange(row.root, position(start, length), position(end, length), row.view)) { read(this); values.push(value); } return values; }
  map<U>(callback: (value: T, index: number, array: readonly T[]) => U, thisArg?: unknown): U[] { const values: U[] = []; let index = 0; for (const value of this) values.push(callback.call(thisArg, value, index++, snapshotReceiver(this))); return values; }
  filter<S extends T>(predicate: (value: T, index: number, array: readonly T[]) => value is S, thisArg?: unknown): S[];
  filter(predicate: (value: T, index: number, array: readonly T[]) => unknown, thisArg?: unknown): T[];
  filter(predicate: (value: T, index: number, array: readonly T[]) => unknown, thisArg?: unknown): T[] { const values: T[] = []; let index = 0; for (const value of this) if (predicate.call(thisArg, value, index++, snapshotReceiver(this))) values.push(value); return values; }
  find<S extends T>(predicate: (value: T, index: number, array: readonly T[]) => value is S, thisArg?: unknown): S | undefined;
  find(predicate: (value: T, index: number, array: readonly T[]) => unknown, thisArg?: unknown): T | undefined;
  find(predicate: (value: T, index: number, array: readonly T[]) => unknown, thisArg?: unknown): T | undefined { let index = 0; for (const value of this) if (predicate.call(thisArg, value, index++, snapshotReceiver(this))) return value; }
  some(predicate: (value: T, index: number, array: readonly T[]) => unknown, thisArg?: unknown): boolean { let index = 0; for (const value of this) if (predicate.call(thisArg, value, index++, snapshotReceiver(this))) return true; return false; }
  every<S extends T>(predicate: (value: T, index: number, array: readonly T[]) => value is S, thisArg?: unknown): this is MemorySnapshot<S>;
  every(predicate: (value: T, index: number, array: readonly T[]) => unknown, thisArg?: unknown): boolean;
  every(predicate: (value: T, index: number, array: readonly T[]) => unknown, thisArg?: unknown): boolean { let index = 0; for (const value of this) if (!predicate.call(thisArg, value, index++, snapshotReceiver(this))) return false; return true; }
  forEach(callback: (value: T, index: number, array: readonly T[]) => void, thisArg?: unknown): void { let index = 0; for (const value of this) callback.call(thisArg, value, index++, snapshotReceiver(this)); }
  toJSON(): T[] { return [...this]; }
  toString(): string { return this.slice().toString(); }
  toLocaleString(...args: Parameters<ReadonlyArray<T>['toLocaleString']>): string { return this.slice().toLocaleString(...args); }
}
export function createMemorySnapshot<T extends { id: string }>(roots: MemorySnapshotRoots<T>, view = -1, cache = new Map<number, MemorySnapshot<T>>()): MemorySnapshot<T> {
  const prior = cache.get(view); if (prior) return prior;
  const target = Object.freeze(new MemorySnapshotFacade<T>());
  const snapshot: MemorySnapshot<T> = new Proxy(target, {
    get(object, key, receiver) {
      if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) return receiver.at(Number(key));
      if (Reflect.has(object, key)) return Reflect.get(object, key, receiver);
      return Reflect.get(Array.prototype, key, receiver);
    },
    has(object, key): boolean { if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) return Number(key) < snapshot.length; return Reflect.has(object, key) || Reflect.has(Array.prototype, key); },
    set() { throw unavailable(); }, defineProperty() { throw unavailable(); }, deleteProperty() { throw unavailable(); }, setPrototypeOf() { throw unavailable(); },
  }) as unknown as MemorySnapshot<T>;
  data.set(snapshot, { ...roots, view, cache } as Data<{ id: string }>); cache.set(view, snapshot); return snapshot;
}
export const isMemorySnapshot = <T extends { id: string }>(value: readonly T[]): value is MemorySnapshot<T> => data.has(value);
export const memorySnapshotScopeActive = (value: object): boolean => data.get(value)?.fence.active !== false;
export const memoryById = <T extends { id: string }>(values: readonly T[], id: string): T | undefined => isMemorySnapshot(values) ? values.get(id) : values.find(value => value.id === id);
export interface MemorySnapshotDelta<T> { changed: T[]; removed: string[]; order: MemorySnapshotMove[] }
/** Only IDs from bounded history are read. An unavailable history requires one guarded initial transfer. */
export function memorySnapshotDelta<T extends { id: string }>(previous: readonly T[] | null, next: readonly T[]): MemorySnapshotDelta<T> | undefined {
  if (!previous || !isMemorySnapshot(previous) || !isMemorySnapshot(next)) return;
  const before = data.get(previous)! as Data<T>, after = read(next);
  if (!after.journal || before.journal !== after.journal || before.fence !== after.fence || before.view !== after.view || before.revision > after.revision) return;
  const ids = new Set<string>(), order: MemorySnapshotMove[] = [];
  for (let revision = before.revision + 1; revision <= after.revision; revision++) {
    const entry = after.journal.entries.get(revision); if (!entry) return;
    for (const id of entry.ids) ids.add(id); for (const move of entry.moves[after.view + 1]) order.push(move);
  }
  const changed: T[] = [], removed: string[] = [];
  for (const id of ids) { const old = previous.get(id), value = next.get(id); if (value && value !== old) changed.push(value); else if (!value && old) removed.push(id); }
  return { changed, removed, order };
}

import type { MemoryObject } from '../types/universe';
import type { OrbitPosition } from '../engines/orbitMath';
import { canReadCachedMemory, type MemoryReadScope } from './memoryReadScope';
import { IncrementalMemoryPublication } from './incrementalMemoryPublication';
import { memoryById, memorySnapshotDelta, memorySnapshotScopeActive, type MemorySnapshot } from './memorySnapshot';
import { memoryViewId } from './memoryViewProtocol';
import { createCognitiveAnalysisYield as createControlledYield } from './cognitiveAnalysisYield';
import { orbitLayoutUnavailable as fail, orbitRecordUnits, validateOrbitRecord, ORBIT_LAYOUT_LIMITS as limits, type OrbitLayoutCommand, type OrbitPatchFrame, type OrbitRecord } from './orbitLayoutProtocol';

type Projected = { id: string; timestamp: number; source?: MemoryObject; record?: OrbitRecord; connections: readonly string[] };
export interface OrbitSelection { positions: ReadonlyMap<string, OrbitPosition>; time: number; now: number }
function guardedPositions(values: Map<string, OrbitPosition>, active: () => boolean): ReadonlyMap<string, OrbitPosition> {
  function* entries(): MapIterator<[string, OrbitPosition]> { if (!active()) return; for (const value of values) { if (!active()) return; yield value; } }
  const result: ReadonlyMap<string, OrbitPosition> = Object.freeze({ get size() { return active() ? values.size : 0; },
    get: (id: string) => active() ? values.get(id) : undefined, has: (id: string) => active() && values.has(id), entries, [Symbol.iterator]: entries, [Symbol.toStringTag]: 'Map',
    *keys(): MapIterator<string> { for (const [id] of entries()) yield id; }, *values(): MapIterator<OrbitPosition> { for (const [, position] of entries()) yield position; },
    forEach(callback: (value: OrbitPosition, key: string, map: ReadonlyMap<string, OrbitPosition>) => void, thisArg?: unknown) { for (const [id, position] of entries()) callback.call(thisArg, position, id, result); } });
  return result;
}
/** Scoped metadata replica and one sample in flight. The UI never calculates or follows parent chains. */
export class OrbitLayoutClient {
  private readonly scope: MemoryReadScope; private readonly createWorker: () => Worker;
  private readonly yieldTask: () => Promise<void>; private readonly cancelYield: () => void;
  private projected = new IncrementalMemoryPublication<Projected>('asc', { views: { eligible: row => Boolean(row.record) } });
  private source: readonly MemoryObject[] | null = null; private transferred: MemorySnapshot<Projected> | null = null;
  private worker: Worker | null = null; private generation = 0; private selectionEpoch = 0; private seq = 0; private busy = false;
  private lastIds: readonly string[] = []; private currentPositions: Map<string, OrbitPosition> | null = null;
  private pending: { seq: number; resolve: (value: unknown) => void; reject: () => void } | null = null;
  constructor(scope: MemoryReadScope, options: { createWorker?: () => Worker; yieldTask?: () => Promise<void> } = {}) {
    this.scope = { uid: scope.uid, teamIds: new Set(scope.teamIds) }; this.createWorker = options.createWorker ?? (() => new Worker(new URL('./orbitLayoutWorker.ts', import.meta.url), { type: 'module' }));
    const controlled = createControlledYield(); this.yieldTask = options.yieldTask ?? controlled.yieldTask; this.cancelYield = controlled.cancel;
  }
  dispose(): void {
    this.generation++; this.selectionEpoch++; this.busy = false; this.cancelYield(); const pending = this.pending; this.pending = null;
    this.worker?.terminate(); this.worker = null; this.source = this.transferred = null; this.projected.clear(); this.lastIds = []; this.currentPositions?.clear(); this.currentPositions = null; pending?.reject();
  }
  private eligible(row: MemoryObject): boolean { return !row.deletedAt && canReadCachedMemory(row, this.scope); }
  private project(row: MemoryObject): Projected {
    if (!memoryViewId(row.id)) throw fail();
    if (!this.eligible(row)) return { id: row.id, timestamp: 0, source: row, connections: [] };
    if (!Array.isArray(row.connections) || row.connections.length > limits.recordConnections) throw fail();
    const position = row.position;
    const record: OrbitRecord = { id: row.id, celestialType: row.celestialType, position: [position[0], position[1], position[2]], connections: row.connections.filter(memoryViewId),
      parentId: memoryViewId(row.parentId) ? row.parentId : null, orbitRadius: row.orbitRadius ?? null, orbitSpeed: row.orbitSpeed ?? null, importance: row.importance, updatedAt: row.updatedAt };
    validateOrbitRecord(record); return { id: row.id, timestamp: 0, source: row, record, connections: record.connections };
  }
  private async prepare(source: readonly MemoryObject[], guard: () => void): Promise<void> {
    if (source === this.source) return; const delta = memorySnapshotDelta(this.source, source);
    if (!delta) {
      this.projected.clear(); let changed: Array<{ id: string; value: Projected }> = [], units = 0, offset = 0;
      const commit = async () => { if (!changed.length) return; this.projected.apply('source', { changed, removed: [], order: { changes: changed.map(({ id }, at) => ({ type: 'added' as const, id, oldIndex: -1, newIndex: offset + at })) } }); offset += changed.length; changed = []; units = 0; await this.yieldTask(); guard(); };
      for (const row of source) { guard(); const value = this.project(row); changed.push({ id: row.id, value }); units += value.record ? orbitRecordUnits(value.record) + 64 : row.id.length; if (changed.length === limits.batch || units >= limits.targetChunkUnits) await commit(); }
      await commit();
    } else {
      const prepared = new Map<string, Projected>();
      const value = (id: string): Projected => { let row = prepared.get(id); if (row) return row; const current = memoryById(source, id), old = this.projected.get(id); row = current ? old?.source === current ? old : this.project(current) : { id, timestamp: 0, connections: [] }; prepared.set(id, row); return row; };
      for (let at = 0; at < delta.order.length; at += limits.batch) {
        const moves = delta.order.slice(at, at + limits.batch), last = new Map<string, 'added' | 'removed'>(); for (const move of moves) last.set(move.id, move.type);
        for (const move of moves) if (!prepared.has(move.id)) { const old = this.projected.get(move.id); if (old && old.source === memoryById(source, move.id)) prepared.set(move.id, old); }
        this.projected.apply('source', { changed: Array.from(last).flatMap(([id, type]) => type === 'added' ? [{ id, value: value(id) }] : []), removed: [], order: { changes: moves } }); await this.yieldTask(); guard();
      }
      let changed: Array<{ id: string; value: Projected }> = [], units = 0;
      const commit = async () => { if (!changed.length) return; this.projected.apply('source', { changed, removed: [], order: { changes: [] } }); changed = []; units = 0; await this.yieldTask(); guard(); };
      for (const row of delta.changed) { guard(); if (!this.projected.get(row.id)) throw fail(); const next = value(row.id); if (this.projected.get(row.id) !== next) { changed.push({ id: row.id, value: next }); units += next.record ? orbitRecordUnits(next.record) + 64 : row.id.length; } if (changed.length === limits.batch || units >= limits.targetChunkUnits) await commit(); }
      await commit(); for (const id of delta.removed) if (this.projected.get(id)) throw fail();
    }
    if (this.projected.count !== source.length) throw fail();
  }
  private request(message: OrbitLayoutCommand): Promise<unknown> {
    if (!this.worker) { const worker = this.createWorker(); this.worker = worker; worker.onmessage = event => { if (this.worker !== worker) return; const pending = this.pending; if (!pending || event.data?.seq !== pending.seq) { this.dispose(); return; } this.pending = null; pending.resolve(event.data); }; worker.onerror = worker.onmessageerror = () => { if (this.worker === worker) this.dispose(); }; }
    const seq = ++this.seq, worker = this.worker;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { if (this.worker === worker && this.pending?.seq === seq) this.dispose(); }, 30_000); this.pending = { seq, resolve: value => { clearTimeout(timer); resolve(value); }, reject: () => { clearTimeout(timer); reject(fail()); } }; try { worker.postMessage({ ...message, v: 1, seq }); } catch { this.dispose(); } });
  }
  private async exchange(message: OrbitLayoutCommand, guard: () => void, ack: boolean): Promise<Record<string, unknown>> {
    guard(); const response = await this.request(message); guard(); if (!response || typeof response !== 'object' || Array.isArray(response)) throw fail(); const row = response as Record<string, unknown>;
    if (row.v !== 1 || row.seq !== this.seq || row.ok !== true || Object.keys(row).sort().join(',') !== (ack ? 'ack,ok,seq,v' : 'frame,ok,seq,v') || ack && row.ack !== true) throw fail(); return row;
  }
  private async frame(frame: OrbitPatchFrame, guard: () => void): Promise<void> { await this.exchange({ type: 'patch-chunk', frame }, guard, true); await this.yieldTask(); guard(); }
  private async records(rows: Iterable<Projected>, guard: () => void, baseline = false): Promise<void> {
    let changed: OrbitRecord[] = [], units = 0;
    const flush = () => this.frame({ changed, ...(baseline ? { order: changed.map(row => row.id) } : {}) }, guard);
    for (const row of rows) { guard(); if (!row.record) throw fail(); const size = orbitRecordUnits(row.record) + row.id.length + 64; if (changed.length && (changed.length === limits.batch || units + size > limits.targetChunkUnits)) { await flush(); changed = []; units = 0; } changed.push(row.record); units += size; }
    if (changed.length) await flush();
  }
  async select(source: readonly MemoryObject[], ids: readonly string[], time: number, now: number, signal: AbortSignal, assertCurrent: () => void = () => {}): Promise<OrbitSelection> {
    if (this.busy) { this.dispose(); throw fail(); } if (this.source && !memorySnapshotScopeActive(this.source)) this.dispose();
    const generation = this.generation, guard = () => { if (signal.aborted || generation !== this.generation || !memorySnapshotScopeActive(source) || !this.scope.uid) throw fail(); assertCurrent(); };
    const abort = () => { if (generation === this.generation) this.dispose(); }; this.busy = true; signal.addEventListener('abort', abort, { once: true });
    if (source !== this.source) { this.selectionEpoch++; this.currentPositions?.clear(); }
    try {
      guard(); if (source.length > limits.documents || !Array.isArray(ids) || ids.length > limits.sampleIds || !ids.every(memoryViewId) || new Set(ids).size !== ids.length || !Number.isFinite(time) || !Number.isFinite(now)) throw fail();
      await this.prepare(source, guard); guard(); const next = this.projected.snapshot().view('eligible'), delta = memorySnapshotDelta(this.transferred, next), requested = ids.filter(id => Boolean(next.get(id)?.record));
      if (requested.length !== this.lastIds.length || requested.some((id, at) => this.lastIds[at] !== id)) { this.selectionEpoch++; this.currentPositions?.clear(); this.lastIds = requested; } const epoch = this.selectionEpoch;
      if (next !== this.transferred) {
        await this.exchange({ type: 'patch-start', reset: !delta, preserve: Boolean(delta), counts: { size: next.length, changed: delta?.changed.length ?? next.length, removed: delta?.removed.length ?? 0, moves: delta?.order.length ?? 0, order: delta ? 0 : next.length } }, guard, true);
        if (delta) { for (let at = 0; at < delta.order.length; at += limits.batch) await this.frame({ moves: delta.order.slice(at, at + limits.batch) }, guard); for (let at = 0; at < delta.removed.length; at += limits.batch) await this.frame({ removed: delta.removed.slice(at, at + limits.batch) }, guard); await this.records(delta.changed, guard); }
        else await this.records(next, guard, true);
        await this.exchange({ type: 'patch-end' }, guard, true);
      }
      const response = await this.exchange({ type: 'sample', ids: requested, time, now }, guard, false), frame = response.frame as Record<string, unknown>;
      if (!frame || typeof frame !== 'object' || Array.isArray(frame) || Object.keys(frame).sort().join(',') !== 'now,positions,time' || frame.time !== time || frame.now !== now || !Array.isArray(frame.positions) || frame.positions.length !== requested.length) throw fail();
      const values = new Map<string, OrbitPosition>();
      for (let at = 0; at < frame.positions.length; at++) { const point = frame.positions[at]; if (!Array.isArray(point) || point.length !== 4 || point[0] !== requested[at] || !point.slice(1).every(Number.isFinite)) throw fail(); const row = next.get(point[0])?.source; if (!row || !this.eligible(row)) throw fail(); values.set(point[0], Object.freeze([point[1], point[2], point[3]]) as OrbitPosition); }
      this.source = source; this.transferred = next; this.currentPositions = values;
      return { time, now, positions: guardedPositions(values, () => { try { guard(); return epoch === this.selectionEpoch && this.transferred === next && this.source === source; } catch { if (generation === this.generation) this.dispose(); return false; } }) };
    } catch { if (generation === this.generation) this.dispose(); throw fail(); }
    finally { signal.removeEventListener('abort', abort); if (generation === this.generation) this.busy = false; }
  }
}

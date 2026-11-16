import { orbitPosition, type OrbitPosition } from '../engines/orbitMath';
import { memoryViewId } from './memoryViewProtocol';
import { freezeOrbitRecord, orbitLayoutUnavailable as fail, orbitRecordUnits, ORBIT_LAYOUT_LIMITS as limits, type OrbitFrame, type OrbitRecord } from './orbitLayoutProtocol';

/** Source-order parent plan. Construct and sample in the Worker, never in a UI frame. */
export class OrbitGraph {
  private readonly records: readonly OrbitRecord[];
  private readonly ordinal = new Map<string, number>();
  private readonly parents: Int32Array;
  readonly cyclesBroken: number;
  get size(): number { return this.records.length; }
  constructor(source: Iterable<OrbitRecord>) {
    const records: OrbitRecord[] = []; let units = 0, connections = 0;
    for (const value of source) {
      if (!value || typeof value !== 'object' || records.length >= limits.documents || this.ordinal.has(value.id)) throw fail();
      const row = freezeOrbitRecord(value); units += orbitRecordUnits(row); connections += row.connections.length;
      if (units > limits.units || connections > limits.connections) throw fail();
      this.ordinal.set(row.id, records.length); records.push(row);
    }
    this.records = Object.freeze(records); this.parents = new Int32Array(records.length).fill(-1);
    for (let at = 0; at < records.length; at++) {
      const row = records[at], explicit = row.parentId === null ? undefined : this.ordinal.get(row.parentId);
      if (explicit !== undefined) { this.parents[at] = explicit; continue; }
      const moon = row.celestialType === 'moon', rootChild = ['planet', 'star', 'comet'].includes(row.celestialType);
      if (!moon && !rootChild) continue;
      let first = Infinity;
      for (const id of row.connections) {
        const ordinal = this.ordinal.get(id); if (ordinal === undefined || ordinal >= first) continue;
        const type = records[ordinal].celestialType;
        if (moon ? type === 'planet' : type === 'sun' || type === 'black_hole' || type === 'nebula') first = ordinal;
      }
      if (first !== Infinity) this.parents[at] = first;
    }
    // Functional graph: cut one edge per cycle at its first published node.
    const state = new Uint8Array(records.length), pathAt = new Int32Array(records.length), path: number[] = []; let cycles = 0;
    for (let start = 0; start < records.length; start++) {
      if (state[start]) continue; path.length = 0; let at = start;
      while (at !== -1 && state[at] === 0) { pathAt[at] = path.length; path.push(at); state[at] = 1; at = this.parents[at]; }
      if (at !== -1 && state[at] === 1) { let anchor = at; for (let index = pathAt[at]; index < path.length; index++) anchor = Math.min(anchor, path[index]); this.parents[anchor] = -1; cycles++; }
      for (const ordinal of path) state[ordinal] = 2;
    }
    this.cyclesBroken = cycles;
  }
  parentOf(id: string): string | null | undefined {
    const at = this.ordinal.get(id); if (at === undefined) return;
    return this.parents[at] === -1 ? null : this.records[this.parents[at]].id;
  }
  sample(ids: readonly string[], time: number, now: number): OrbitFrame {
    if (!Array.isArray(ids) || ids.length > limits.sampleIds || !Number.isFinite(time) || !Number.isFinite(now)) throw fail();
    const requested = new Set<string>(), ordinals: number[] = [];
    for (const id of ids) { const at = this.ordinal.get(id); if (!memoryViewId(id) || at === undefined || requested.has(id)) throw fail(); requested.add(id); ordinals.push(at); }
    const positions = new Map<number, OrbitPosition>(), path: number[] = [];
    for (const start of ordinals) {
      path.length = 0; let at = start;
      while (at !== -1 && !positions.has(at)) { path.push(at); at = this.parents[at]; }
      let parent = at === -1 ? null : positions.get(at)!;
      while (path.length) {
        const ordinal = path.pop()!, position = orbitPosition(this.records[ordinal], parent, time, now);
        if (!position.every(Number.isFinite)) throw fail(); positions.set(ordinal, position); parent = position;
      }
    }
    return { time, now, positions: ordinals.map((at, index) => { const position = positions.get(at)!; return [ids[index], position[0], position[1], position[2]]; }) };
  }
}

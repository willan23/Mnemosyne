import type { CelestialType } from '../types/universe';
import { memoryViewId } from './memoryViewProtocol';
import type { MemoryViewPatchCounts } from './memoryViewProtocol';
import type { MemorySnapshotMove } from './memorySnapshot';

export const ORBIT_LAYOUT_LIMITS = Object.freeze({ documents: 100_000, connections: 5_000_000, recordConnections: 2500, units: 128_000_000, batch: 128, targetChunkUnits: 65_536, sampleIds: 704 });
export interface OrbitRecord {
  readonly id: string;
  readonly celestialType: CelestialType;
  readonly position: readonly [number, number, number];
  readonly connections: readonly string[];
  readonly parentId: string | null;
  readonly orbitRadius: number | null;
  readonly orbitSpeed: number | null;
  readonly importance: number;
  readonly updatedAt: number;
}
export interface OrbitFrame { time: number; now: number; positions: Array<[string, number, number, number]> }
/** Fresh baselines pair canonical IDs with records; a warm frame contains one delta kind. */
export interface OrbitPatchFrame { changed?: OrbitRecord[]; removed?: string[]; order?: string[]; moves?: MemorySnapshotMove[] }
export type OrbitLayoutCommand =
  { type: 'patch-start'; reset: boolean; preserve: boolean; counts: MemoryViewPatchCounts } |
  { type: 'patch-chunk'; frame: OrbitPatchFrame } |
  { type: 'patch-end' } |
  { type: 'sample'; ids: string[]; time: number; now: number };
export type OrbitLayoutMessage = OrbitLayoutCommand & { v: 1; seq: number };
const types = new Set(['star', 'sun', 'planet', 'moon', 'comet', 'black_hole', 'nebula']);
const keys = new Set(['id', 'celestialType', 'position', 'connections', 'parentId', 'orbitRadius', 'orbitSpeed', 'importance', 'updatedAt']);
export const orbitLayoutUnavailable = () => new Error('orbit_layout_unavailable');
export function validateOrbitRecord(value: OrbitRecord): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.size || Object.keys(value).some(key => !keys.has(key)) ||
    !memoryViewId(value.id) || !types.has(value.celestialType) || !Array.isArray(value.position) || value.position.length !== 3 || !value.position.every(Number.isFinite) ||
    !Array.isArray(value.connections) || value.connections.length > ORBIT_LAYOUT_LIMITS.recordConnections || !value.connections.every(memoryViewId) ||
    value.parentId !== null && !memoryViewId(value.parentId) || value.orbitRadius !== null && !Number.isFinite(value.orbitRadius) ||
    value.orbitSpeed !== null && !Number.isFinite(value.orbitSpeed) || !Number.isFinite(value.importance) || !Number.isFinite(value.updatedAt)) throw orbitLayoutUnavailable();
}
/** Worker-owned immutable metadata; no content, identity, embeddings, network or persistence. */
export function freezeOrbitRecord(value: OrbitRecord): OrbitRecord {
  validateOrbitRecord(value);
  if (Object.isFrozen(value) && Object.isFrozen(value.position) && Object.isFrozen(value.connections)) return value;
  return Object.freeze({ id: value.id, celestialType: value.celestialType,
    position: Object.freeze([value.position[0], value.position[1], value.position[2]]) as readonly [number, number, number],
    connections: Object.freeze([...value.connections]), parentId: value.parentId, orbitRadius: value.orbitRadius, orbitSpeed: value.orbitSpeed, importance: value.importance, updatedAt: value.updatedAt });
}
export function orbitRecordUnits(value: OrbitRecord): number {
  return value.id.length + value.celestialType.length + (value.parentId?.length ?? 0) + value.connections.reduce((sum, id) => sum + id.length, 0);
}

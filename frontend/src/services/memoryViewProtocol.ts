import type { MemorySnapshotMove } from './memorySnapshot';

export const MEMORY_VIEW_LIMITS = Object.freeze({ documents: 100_000, changes: 200_000, batch: 128, targetChunkUnits: 65_536 });
export interface MemoryViewRecord {
  id: string;
  timestamp: number;
  fields: string[];
  taxonomyLane: string | null;
  importance: number;
  updatedAt: number;
  connections: string[];
}
export type MemoryViewOptions = {
  mode: 'list'; query: string; locale: 'pt-PT' | 'pt-BR' | 'en' | 'fr'; limit: number;
} | {
  mode: 'scene'; activeId: string | null; filteredIds: string[] | null; taxonomy: string | null;
} | {
  /** Null is reserved for streamed headers; a completed related query requires explicit IDs. */
  mode: 'related'; filteredIds: string[] | null; limit: number;
};
export interface MemoryViewRequest {
  v: 1; id: number; changed: MemoryViewRecord[]; order?: string[]; options: MemoryViewOptions; now: number;
}
export interface MemoryViewSelection { ids: string[]; count: number }
export const memoryViewId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 512 && !id.includes('/');

export interface MemoryViewPatchCounts { size: number; changed: number; removed: number; moves: number; order: number }
export interface MemoryViewPatchFrame { changed?: MemoryViewRecord[]; removed?: string[]; moves?: MemorySnapshotMove[]; order?: string[] }
/** Separate acknowledged transport. The Worker never accepts the internal one-shot request above. */
export type MemoryViewMessage = { v: 2; id: number } & (
  { type: 'patch-start'; reset: boolean; preserve: boolean; counts: MemoryViewPatchCounts } |
  { type: 'patch-chunk'; frame: MemoryViewPatchFrame } |
  { type: 'patch-end' } |
  { type: 'query-start'; options: MemoryViewOptions; now: number; filteredCount: number | null; reuseFilter: boolean } |
  { type: 'filter-chunk'; ids: string[] } |
  { type: 'query-end' }
);

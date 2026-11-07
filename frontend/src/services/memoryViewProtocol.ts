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
};
export interface MemoryViewRequest {
  v: 1; id: number; changed: MemoryViewRecord[]; order?: string[]; options: MemoryViewOptions; now: number;
}
export interface MemoryViewSelection { ids: string[]; count: number }
export const memoryViewId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 512 && !id.includes('/');

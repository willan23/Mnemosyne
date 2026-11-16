import type { MemoryPublicationPatch } from './incrementalMemoryPublication';

export const INDEXED_SEMANTIC_WRITE_LIMITS = Object.freeze({ documents: 100_000, pendingBatches: 256, pendingChanges: 200_000, retainedReferences: 200_000 });
export interface IndexedSemanticDocument {
  id: string; timestamp: number; scope: string | null; embedding: number[] | null; embeddingModel?: string;
}
export interface IndexedSemanticMetadataSize { removed: number; changes: number; reset?: number }
export type IndexedSemanticWriteMessage =
  { v: 1; seq: number; type: 'init'; direction?: 'asc' | 'desc'; sourceBase?: number } |
  { v: 1; seq: number; type: 'patch-start'; source: string; changed: number; removed: string[]; order: MemoryPublicationPatch<IndexedSemanticDocument>['order']; priority?: number; orderedReset?: true; metadata?: IndexedSemanticMetadataSize } |
  { v: 1; seq: number; type: 'patch-metadata'; removed?: string[]; changes?: MemoryPublicationPatch<IndexedSemanticDocument>['order']['changes']; resetIds?: string[] } |
  { v: 1; seq: number; type: 'patch-chunk'; changed: MemoryPublicationPatch<IndexedSemanticDocument>['changed'] } |
  { v: 1; seq: number; type: 'patch-end' } |
  { v: 1; seq: number; type: 'remove'; source: string } |
  { v: 1; seq: number; type: 'exclude'; source: string; changes: Array<[string, boolean, (IndexedSemanticDocument | null)?]> } |
  { v: 1; seq: number; type: 'query'; query: number[]; space: string; scope: string; excludeId?: string; source?: string };
export interface IndexedSemanticWriteResult {
  indexed: number; changed?: number; removed?: number; orderChanges?: number; resetIds?: number; count?: number; neighbors?: Array<[string, number, number]>;
}

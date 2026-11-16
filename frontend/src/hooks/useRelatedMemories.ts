import { useMemo } from 'react';
import type { MemoryObject } from '../types/universe';
import { useMemoryView } from './useMemoryView';

const noIds: string[] = [];
/** Preserve the publisher's exact order; only IDs cross the Worker boundary. */
export function useRelatedMemories(memories: readonly MemoryObject[], ids: string[] | undefined, active: boolean, limit: number) {
  const options = useMemo(() => ({ mode: 'related' as const, filteredIds: ids ?? noIds, limit: Math.max(1, limit) }), [ids, limit]);
  return useMemoryView(memories, options, active && Boolean(ids?.length));
}

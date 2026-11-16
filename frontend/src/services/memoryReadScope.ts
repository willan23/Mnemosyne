export interface MemoryReadScope {
  uid: string;
  teamIds: ReadonlySet<string>;
}

/** Current membership takes precedence over the legacy author query. */
export function canReadCachedMemory(memory: {
  uid: string;
  teamId?: string | null;
  teamScopeAmbiguous?: boolean;
  sharedWithIds?: unknown;
}, scope: MemoryReadScope): boolean {
  if (!scope.uid || memory.teamScopeAmbiguous) return false;
  if (memory.teamId != null) {
    return typeof memory.teamId === 'string' && memory.teamId.length > 0 &&
      scope.teamIds.has(memory.teamId);
  }
  return memory.uid === scope.uid ||
    (Array.isArray(memory.sharedWithIds) && memory.sharedWithIds.includes(scope.uid));
}

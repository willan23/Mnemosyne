/** Candidates for a personal memory's automatic semantic links.
 * Team and shared memories can be visible to the user, but must not be linked
 * into their personal graph by a background write.
 */
export interface PersonalSemanticCandidate {
  uid: string;
  teamId?: string | null;
  teamScopeAmbiguous?: boolean;
  sharedWithIds?: unknown;
  deletedAt?: number | null;
  encLocked?: boolean;
}
export function isPersonalSemanticCandidate(memory: PersonalSemanticCandidate, ownerUid: string): boolean {
  return (
    memory.uid === ownerUid &&
    memory.teamId == null &&
    !memory.teamScopeAmbiguous &&
    (memory.sharedWithIds == null ||
      (Array.isArray(memory.sharedWithIds) && memory.sharedWithIds.length === 0)) &&
    !memory.deletedAt &&
    !memory.encLocked
  );
}
export function personalSemanticCandidates<T extends PersonalSemanticCandidate>(memories: T[], ownerUid: string): T[] {
  return memories.filter(memory => isPersonalSemanticCandidate(memory, ownerUid));
}

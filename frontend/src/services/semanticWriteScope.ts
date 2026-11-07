import { isPersonalSemanticCandidate } from './personalSemanticScope';
import type { SemanticWriteCandidate } from './semanticWriteProtocol';

export interface SemanticWriteScope { readonly uid: string; readonly teamId?: string; readonly excludeId?: string }
const scopes = new WeakMap<(row: SemanticWriteCandidate) => boolean, SemanticWriteScope>();

/** Only this exact predicate can use the corresponding pre-partitioned Worker index. */
export function semanticCandidateEligibility(uid: string, teamId?: string, excludeId?: string) {
  const predicate = (row: SemanticWriteCandidate): boolean => row.id !== excludeId && (teamId
    ? row.teamId === teamId && !row.teamScopeAmbiguous && !row.encLocked && !row.deletedAt
    : isPersonalSemanticCandidate(row, uid));
  scopes.set(predicate, Object.freeze({ uid, teamId, excludeId }));
  return predicate;
}
export const readSemanticWriteScope = (predicate?: (row: SemanticWriteCandidate) => boolean) => predicate ? scopes.get(predicate) : undefined;

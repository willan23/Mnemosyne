import { attachmentActorIdValid, attachmentIdValid } from './attachmentEnvelope';
import { capturePublicCapsuleCipher, publicCapsuleRecord, publicCapsuleTimeValid, PUBLIC_CAPSULE_MAX_CIPHER_CHARS, type PublicCapsuleSource } from './publicCapsuleContract';

export const CAPSULE_MAX_SOURCES = 13;
export const CAPSULE_MAX_LIFETIME_MS = 30 * 86400000;
export const CAPSULE_PLAIN_MAX_BYTES = Math.floor(PUBLIC_CAPSULE_MAX_CIPHER_CHARS / 4) * 3 - 16;
export interface CapsulePublicationSource { sessionId: string; teamId: string | null; revision: number }
export interface CapsulePublicationRequest {
  v: 1; actorUid: string; publicationId: string; sources: readonly CapsulePublicationSource[];
  ciphertext: PublicCapsuleSource['ciphertext']; expiresAt: number;
}
export type CapsulePublicationMode = 'publish' | 'status' | 'cancel';
export interface CapsulePublicationOutcome {
  v: 1; actorUid: string; publicationId: string; digest: string;
  status: 'unknown' | 'committed' | 'cancelled' | 'withdrawn' | 'expired'; createdAt: number | null; expiresAt: number;
}
export function captureCapsulePublication(value: unknown): CapsulePublicationRequest {
  const row = publicCapsuleRecord(value, ['v', 'actorUid', 'publicationId', 'sources', 'ciphertext', 'expiresAt']);
  if (row.v !== 1 || !attachmentActorIdValid(row.actorUid) || !attachmentIdValid(row.publicationId) || !publicCapsuleTimeValid(row.expiresAt) ||
    !Array.isArray(row.sources) || row.sources.length < 1 || row.sources.length > CAPSULE_MAX_SOURCES) throw Error('Invalid capsule publication');
  const sources = row.sources.map(value => {
    const source = publicCapsuleRecord(value, ['sessionId', 'teamId', 'revision']);
    if (!attachmentActorIdValid(source.sessionId) || source.teamId !== null && !attachmentActorIdValid(source.teamId) || !publicCapsuleTimeValid(source.revision)) throw Error('Invalid capsule source');
    return Object.freeze({ sessionId: source.sessionId, teamId: source.teamId as string | null, revision: source.revision });
  });
  if (new Set(sources.map(source => source.sessionId)).size !== sources.length || sources.some(source => source.teamId !== sources[0].teamId)) throw Error('Mixed capsule scope');
  return Object.freeze({ v: 1, actorUid: row.actorUid, publicationId: row.publicationId, sources: Object.freeze(sources),
    ciphertext: capturePublicCapsuleCipher(row.ciphertext), expiresAt: row.expiresAt });
}
export function capsulePublicationBytes(input: CapsulePublicationRequest): string {
  return JSON.stringify([1, input.actorUid, input.publicationId, input.sources.map(source => [source.sessionId, source.teamId, source.revision]),
    input.ciphertext, input.expiresAt]);
}
export function captureCapsulePublicationOutcome(value: unknown, input: CapsulePublicationRequest, digest: string): CapsulePublicationOutcome {
  const row = publicCapsuleRecord(value, ['v','actorUid','publicationId','digest','status','createdAt','expiresAt']);
  if (row.v !== 1 || row.actorUid !== input.actorUid || row.publicationId !== input.publicationId || row.digest !== digest || row.expiresAt !== input.expiresAt ||
    !['unknown','committed','cancelled','withdrawn','expired'].includes(row.status as string) ||
    (row.createdAt !== null && !publicCapsuleTimeValid(row.createdAt)) || row.status === 'unknown' && row.createdAt !== null ||
    ['committed','cancelled','withdrawn'].includes(row.status as string) && row.createdAt === null) throw Error('Invalid capsule publication response');
  return Object.freeze({v:1,actorUid:input.actorUid,publicationId:input.publicationId,digest,status:row.status as CapsulePublicationOutcome['status'],createdAt:row.createdAt as number|null,expiresAt:input.expiresAt});
}

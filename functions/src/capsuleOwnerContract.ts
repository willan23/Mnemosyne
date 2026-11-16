import { publicCapsuleRecord, publicCapsuleIdValid, publicCapsuleTimeValid, publicCapsuleCountValid } from './publicCapsuleContract';
export interface OwnedCapsule {
  shareId: string; sourceToken: string; createdAt: number | null; expiresAt: number | null;
  revoked: boolean; revokedAt: number | null; views: number | null; importCount: number | null; itemCount: number | null;
}
export interface CapsuleOwnerQuery { v: 1; actorUid: string; shareId: string | null; after: string | null }
export function captureCapsuleOwnerQuery(value: unknown): CapsuleOwnerQuery {
  const row = publicCapsuleRecord(value, ['v', 'actorUid', 'shareId', 'after']);
  if (row.v !== 1 || !publicCapsuleIdValid(row.actorUid) || row.shareId !== null && !publicCapsuleIdValid(row.shareId) ||
    row.after !== null && !publicCapsuleIdValid(row.after) || row.shareId !== null && row.after !== null) throw Error('Invalid capsule owner query');
  return Object.freeze({ v: 1, actorUid: row.actorUid, shareId: row.shareId as string | null, after: row.after as string | null });
}
export function captureOwnedCapsule(value: unknown): OwnedCapsule {
  const row = publicCapsuleRecord(value, ['shareId', 'sourceToken', 'createdAt', 'expiresAt', 'revoked', 'revokedAt', 'views', 'importCount', 'itemCount']);
  if (!publicCapsuleIdValid(row.shareId) || typeof row.sourceToken !== 'string' || !/^[a-f0-9]{64}$/.test(row.sourceToken) || typeof row.revoked !== 'boolean' ||
    ['createdAt','expiresAt','revokedAt'].some(key => row[key] !== null && !publicCapsuleTimeValid(row[key])) ||
    ['views','importCount'].some(key => row[key] !== null && !publicCapsuleCountValid(row[key])) ||
    row.itemCount !== null && (!publicCapsuleCountValid(row.itemCount) || row.itemCount < 1 || row.itemCount > 300) || !row.revoked && row.revokedAt !== null) throw Error('Invalid owned capsule');
  return Object.freeze({ shareId: row.shareId, sourceToken: row.sourceToken, createdAt: row.createdAt as number | null, expiresAt: row.expiresAt as number | null,
    revoked: row.revoked, revokedAt: row.revokedAt as number | null, views: row.views as number | null, importCount: row.importCount as number | null, itemCount: row.itemCount as number | null });
}

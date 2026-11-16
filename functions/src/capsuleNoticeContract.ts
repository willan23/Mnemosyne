/** Pure transport contract shared by the callable and the web client. */
import { ENCRYPTED_IMPORT_MAX_MEMORIES } from './importLimits';
export interface CapsuleImportNotice {
  id: string; ownerUid: string; shareId: string; importerUid: string; itemCount: number; createdAt: number;
  titleHint: string | null; read: boolean; importId: string | null; planDigest: string | null;
}
export const capsuleNoticeIdValid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') &&
  !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
export const capsuleNoticeDigestValid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function captureCapsuleNotice(id: string, value: unknown): CapsuleImportNotice {
  if (!capsuleNoticeIdValid(id) || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid capsule notice source');
  const data = value as Record<string, unknown>;
  if (!capsuleNoticeIdValid(data.ownerUid) || !capsuleNoticeIdValid(data.shareId) || !capsuleNoticeIdValid(data.importerUid) || typeof data.itemCount !== 'number' ||
    !Number.isSafeInteger(data.itemCount) || data.itemCount < 1 || data.itemCount > ENCRYPTED_IMPORT_MAX_MEMORIES || typeof data.createdAt !== 'number' ||
    !Number.isSafeInteger(data.createdAt) || data.createdAt < 1 || typeof data.read !== 'boolean' ||
    data.titleHint != null && (typeof data.titleHint !== 'string' || new TextEncoder().encode(data.titleHint).byteLength > 1000) ||
    (data.importId != null || data.planDigest != null) && (data.importId !== id || !capsuleNoticeDigestValid(data.planDigest))) throw new Error('Invalid capsule notice source');
  return Object.freeze({ id, ownerUid: data.ownerUid, shareId: data.shareId, importerUid: data.importerUid, itemCount: data.itemCount,
    createdAt: data.createdAt, titleHint: data.titleHint == null ? null : data.titleHint as string, read: data.read,
    importId: data.importId == null ? null : data.importId as string, planDigest: data.planDigest == null ? null : data.planDigest as string });
}
/** Fields affecting the displayed event; read/readAt are deliberately excluded. */
export function capsuleNoticeSourceBytes(id: string, value: unknown): string {
  const row = captureCapsuleNotice(id, value);
  return JSON.stringify([1, row.id, row.ownerUid, row.shareId, row.importerUid, row.itemCount, row.createdAt, row.titleHint, row.importId, row.planDigest]);
}

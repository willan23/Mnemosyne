import { attachmentActorIdValid, attachmentIdValid } from './attachmentEnvelope';
export interface AttachmentMutationInput {
  operationId: string; sessionId: string; action: 'add' | 'remove'; ids: string[]; expectedRevision: number; expectedStateDigest: string;
}
export class AttachmentMutationContractError extends Error { constructor() { super('Attachment mutation unavailable'); } }
export function parseAttachmentMutationInput(value: unknown): AttachmentMutationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AttachmentMutationContractError();
  const data = value as AttachmentMutationInput;
  if (Object.keys(data).sort().join(',') !== 'action,expectedRevision,expectedStateDigest,ids,operationId,sessionId' ||
      !attachmentIdValid(data.operationId) || !attachmentActorIdValid(data.sessionId) || !['add', 'remove'].includes(data.action) ||
      !Array.isArray(data.ids) || data.ids.length < 1 || data.ids.length > 20 || data.ids.some(id => !attachmentIdValid(id)) || new Set(data.ids).size !== data.ids.length ||
      !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 1 || !/^[a-f0-9]{64}$/.test(data.expectedStateDigest)) throw new AttachmentMutationContractError();
  return { operationId: data.operationId, sessionId: data.sessionId, action: data.action, ids: [...data.ids].sort(),
    expectedRevision: data.expectedRevision, expectedStateDigest: data.expectedStateDigest };
}
export function attachmentSessionRevision(data: Record<string, unknown>): number {
  const raw = data.updatedAt ?? data.timestamp;
  const value = raw && typeof raw === 'object' && 'toMillis' in raw && typeof raw.toMillis === 'function' ? raw.toMillis() : raw;
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new AttachmentMutationContractError(); return value as number;
}
const canonical = (value: unknown, depth = 0): unknown => {
  if (depth > 12) throw new AttachmentMutationContractError();
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item, depth + 1)]));
  }
  throw new AttachmentMutationContractError();
};
/** Digest binds the exact cipher, scope, revision and attachment list; no plaintext enters the request. */
export function attachmentSessionStateBytes(sessionId: string, data: Record<string, unknown>): Uint8Array {
  const enc = data.enc as { v?: unknown; iv?: unknown; ct?: unknown } | undefined;
  if (!attachmentActorIdValid(sessionId) || data.text !== '' || data.title != null || !enc ||
      Object.keys(enc).sort().join(',') !== 'ct,iv,v' || ![1, 2].includes(enc.v as number) || typeof enc.iv !== 'string' || typeof enc.ct !== 'string' ||
      !enc.iv || !enc.ct || enc.iv.length > 64 || enc.ct.length > 8 * 1024 * 1024 ||
      (data.teamId !== null && !attachmentActorIdValid(data.teamId)) || (data.attachments != null && !Array.isArray(data.attachments))) throw new AttachmentMutationContractError();
  const state = canonical({ sessionId, enc, uid: data.uid, teamId: data.teamId,
    keyEpoch: data.keyEpoch ?? null, keyId: data.keyId ?? null, revision: attachmentSessionRevision(data), attachments: data.attachments ?? null });
  return new TextEncoder().encode(JSON.stringify(state));
}
export function opaqueAttachmentId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^mnemosyne-attachment:v1:([^:]+)$/.exec(value); return match && attachmentIdValid(match[1]) ? match[1] : null;
}

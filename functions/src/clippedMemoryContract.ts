import { attachmentIdValid } from './attachmentEnvelope';
export interface ClippedMemoryInput { sessionId: string; enc: {v: 1; iv: string; ct: string} }
export interface ClippedMemoryOutcome { sessionId: string; digest: string; status: 'unknown' | 'committed' | 'cancelled'; createdAt: number | null }
export function parseClippedMemoryInput(value: unknown): ClippedMemoryInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid clip request');
  const data = value as Record<string, unknown>; const enc = data.enc as Record<string, unknown> | null;
  if (Object.keys(data).sort().join(',') !== 'enc,sessionId' || !attachmentIdValid(data.sessionId) || !enc || typeof enc !== 'object' || Array.isArray(enc) ||
      Object.keys(enc).sort().join(',') !== 'ct,iv,v' || enc.v !== 1 || typeof enc.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(enc.iv) ||
      typeof enc.ct !== 'string' || enc.ct.length < 24 || enc.ct.length > 16384 || enc.ct.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(enc.ct)) throw new Error('Invalid clip request');
  return {sessionId: data.sessionId, enc: {v: 1, iv: enc.iv, ct: enc.ct}};
}
export const clippedMemoryRequestBytes = (value: ClippedMemoryInput) => JSON.stringify({sessionId: value.sessionId, enc: {v: 1, iv: value.enc.iv, ct: value.enc.ct}});

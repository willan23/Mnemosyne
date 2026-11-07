import app, { auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { capturePublicCapsule, capturePublicCapsuleOpening, publicCapsuleSourceBytes, publicCapsuleIdValid, publicCapsuleRecord,
  publicCapsuleHashValid, publicCapsuleCountValid, type PublicCapsuleSource, type PublicCapsuleOpening } from '../../../functions/src/publicCapsuleContract';
import type { OwnedCapsule } from '../../../functions/src/capsuleOwnerContract';
export type { PublicCapsuleSource, PublicCapsuleOpening } from '../../../functions/src/publicCapsuleContract';
export class PublicCapsuleError extends Error {
  readonly retryable: boolean;
  constructor(retryable = false) { super('Não foi possível carregar a cápsula. Tenta novamente mais tarde.'); this.retryable = retryable; }
}
export interface PublicCapsuleClientDeps {
  call: (name: 'getPublicCapsule' | 'recordCapsuleOpening', value: unknown) => Promise<unknown>;
  hash: (bytes: string) => Promise<string>;
}
const MAX_RESPONSE_BYTES = 1_100_000;
/** Public requests deliberately omit Auth, cookies and the page referrer. No URL fragment is serialized. */
export async function callPublicCapsule(name: 'getPublicCapsule' | 'recordCapsuleOpening', value: unknown, request = fetch): Promise<unknown> {
  let command: unknown;
  try {
    if (name === 'getPublicCapsule') {
      const row = publicCapsuleRecord(value, ['v', 'shareId']); if (row.v !== 1 || !publicCapsuleIdValid(row.shareId)) throw new PublicCapsuleError();
      command = { v: 1, shareId: row.shareId };
    } else if (name === 'recordCapsuleOpening') command = capturePublicCapsuleOpening(value);
    else throw new PublicCapsuleError();
  } catch { throw new PublicCapsuleError(); }
  const project = app.options.projectId;
  if (!project || !/^[a-z0-9-]{6,30}$/.test(project)) throw new PublicCapsuleError();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await request(`https://europe-west1-${project}.cloudfunctions.net/${name}`, { method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: command }), signal: controller.signal });
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) { await response.body?.cancel(); throw new PublicCapsuleError(); }
    if (!response.body) throw new PublicCapsuleError();
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new PublicCapsuleError(); } chunks.push(chunk.value); } }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let parsed: unknown; try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new PublicCapsuleError(response.status >= 500); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new PublicCapsuleError();
    const envelope = parsed as Record<string, unknown>;
    if (!response.ok || 'error' in envelope || !('result' in envelope)) throw new PublicCapsuleError(response.status >= 500);
    return envelope.result;
  } catch (error) {
    if (error instanceof PublicCapsuleError) throw error;
    throw new PublicCapsuleError(true);
  } finally { clearTimeout(timer); }
}
const defaults = (): PublicCapsuleClientDeps => ({ call: callPublicCapsule,
  hash: async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bytes))), byte => byte.toString(16).padStart(2, '0')).join('') });
export function createPublicCapsuleService(deps = defaults()) {
  return {
    async read(shareId: string, current: () => boolean = () => true): Promise<PublicCapsuleSource> {
      if (!publicCapsuleIdValid(shareId) || !current()) throw new PublicCapsuleError();
      const result = await deps.call('getPublicCapsule', { v: 1, shareId }); if (!current()) throw new PublicCapsuleError();
      let row; try { row = capturePublicCapsule(result); } catch { throw new PublicCapsuleError(); }
      if (row.shareId !== shareId) throw new PublicCapsuleError();
      const actual = await deps.hash(publicCapsuleSourceBytes(row)); if (!current() || actual !== row.sourceDigest) throw new PublicCapsuleError();
      return row;
    },
    async opening(value: PublicCapsuleOpening, current: () => boolean = () => true): Promise<number> {
      const input = capturePublicCapsuleOpening(value); let result: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!current()) throw new PublicCapsuleError();
        try { result = await deps.call('recordCapsuleOpening', input); break; }
        catch (error) { if (!(error instanceof PublicCapsuleError) || !error.retryable || attempt > 0 || !current()) throw error; }
      }
      if (!current()) throw new PublicCapsuleError();
      let row; try { row = publicCapsuleRecord(result, ['v', 'shareId', 'openingId', 'sourceDigest', 'viewDeadline', 'counted', 'changed', 'currentViews']); } catch { throw new PublicCapsuleError(); }
      if (row.v !== 1 || row.shareId !== input.shareId || row.openingId !== input.openingId || row.sourceDigest !== input.sourceDigest || row.viewDeadline !== input.viewDeadline ||
        row.counted !== true || typeof row.changed !== 'boolean' || !publicCapsuleCountValid(row.currentViews)) throw new PublicCapsuleError();
      return row.currentViews;
    },
  };
}
export const publicCapsuleService = createPublicCapsuleService();
/** Security revocation is account-bound and remains available with the personal vault locked. */
export async function revokePublicCapsule(target: Pick<OwnedCapsule,'shareId'|'sourceToken'>, current: () => boolean = () => true): Promise<void> {
  const uid = auth.currentUser?.uid, {shareId,sourceToken}=target; if (!uid || !publicCapsuleIdValid(shareId) || !publicCapsuleHashValid(sourceToken)) throw new PublicCapsuleError();
  let active = true; const stop = onAuthStateChanged(auth, user => { if (user?.uid !== uid) active = false; });
  const guard = () => { if (!active || auth.currentUser?.uid !== uid || !current()) throw new PublicCapsuleError(); };
  try { guard(); const result = (await httpsCallable(getFunctions(app, 'europe-west1'), 'revokePublicCapsule')({ v: 2, actorUid: uid, shareId, sourceToken })).data; guard();
    const row = publicCapsuleRecord(result, ['v', 'actorUid', 'shareId', 'sourceToken', 'revoked', 'changed']);
    if (row.v !== 2 || row.actorUid !== uid || row.shareId !== shareId || row.sourceToken !== sourceToken || row.revoked !== true || typeof row.changed !== 'boolean') throw new PublicCapsuleError();
  } finally { stop(); }
}

import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebase';
import { CLIP_CAPTURE_ENABLED } from '../config/releaseGates';
import { clipMemoryTitle, formatClipMemoryText, parseClipPayload, type ClipPayload } from '../utils/clipCapture';
import { buildEncryptedMemoryFields, decryptMemoryEnvelope, encryptMemoryFields, isEncryptedMemoryEnvelope } from './memoryCrypto';
import { withPersonalMemoryMutation, type PersonalMemoryMutationDeps } from './personalMemoryMutation';
import { clippedMemoryRequestBytes, parseClippedMemoryInput, type ClippedMemoryInput, type ClippedMemoryOutcome } from '../../../functions/src/clippedMemoryContract';

export class ClipCaptureError extends Error {
  readonly reason: 'pending' | 'storage' | 'checkpoint' | 'busy' | 'unavailable';
  constructor(reason: ClipCaptureError['reason']) {
    super('A captura aguarda confirmação. Recupera ou cancela a operação pendente antes de repetir.');
    this.reason = reason;
  }
}
export interface ClipCaptureDeps {
  createEnabled: () => boolean;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  exclusive: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  id: () => string;
  prepare: typeof buildEncryptedMemoryFields;
  encryptJournal: typeof encryptMemoryFields; decryptJournal: typeof decryptMemoryEnvelope;
  call: (mode: 'create' | 'status' | 'cancel', request: ClippedMemoryInput) => Promise<unknown>;
  mutation?: PersonalMemoryMutationDeps;
}
export const clipCaptureCheckpointKey = (uid: string) => `mnemosyne:clip-capture:v1:${encodeURIComponent(uid)}`;
const event = 'mnemosyne:clip-capture-changed';
const notify = () => window.dispatchEvent(new Event(event));
export function hasPendingClipCapture(uid: string) { try { return localStorage.getItem(clipCaptureCheckpointKey(uid)) !== null; } catch { return true; } }
export function observeClipCaptures(callback: () => void) {
  window.addEventListener(event, callback); window.addEventListener('storage', callback);
  return () => { window.removeEventListener(event, callback); window.removeEventListener('storage', callback); };
}
export async function withClipCaptureLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new ClipCaptureError('unavailable');
  return navigator.locks.request(name, {mode: 'exclusive', ifAvailable: true}, lock => {
    if (!lock) throw new ClipCaptureError('busy'); return work();
  });
}
function defaults(): ClipCaptureDeps {
  const names = {create: 'createClippedMemory', status: 'getClippedMemoryStatus', cancel: 'cancelClippedMemory'};
  return {createEnabled: () => CLIP_CAPTURE_ENABLED, storage: localStorage, id: () => crypto.randomUUID(), prepare: buildEncryptedMemoryFields,
    encryptJournal: encryptMemoryFields, decryptJournal: decryptMemoryEnvelope,
    call: async (mode, request) => (await httpsCallable(getFunctions(app, 'europe-west1'), names[mode])(request)).data,
    exclusive: withClipCaptureLock};
}
async function readCheckpoint(raw: string, uid: string, deps: ClipCaptureDeps, guard: () => void): Promise<ClippedMemoryInput> {
  try {
    if (raw.length > 65536) throw new Error(); const envelope: unknown = JSON.parse(raw);
    if (!isEncryptedMemoryEnvelope(envelope)) throw new Error();
    const text = (await deps.decryptJournal(envelope)).text; guard(); if (text.length > 32000) throw new Error();
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).sort().join(',') !== 'request,uid,v' || data.v !== 1 || data.uid !== uid) throw new Error();
    return parseClippedMemoryInput(data.request);
  } catch { guard(); throw new ClipCaptureError('checkpoint'); }
}
async function outcome(value: unknown, request: ClippedMemoryInput, guard: () => void): Promise<ClippedMemoryOutcome> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clippedMemoryRequestBytes(request)))); guard();
  const digest = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'createdAt,digest,sessionId,status') throw new ClipCaptureError('pending');
  const data = value as ClippedMemoryOutcome;
  if (data.sessionId !== request.sessionId || data.digest !== digest || !['unknown','committed','cancelled'].includes(data.status) ||
      (data.status === 'unknown' ? data.createdAt !== null : !Number.isSafeInteger(data.createdAt) || data.createdAt! < 1)) throw new ClipCaptureError('pending');
  return data;
}
async function operate(uid: string, mode: 'start' | 'recover' | 'cancel', clip: ClipPayload | undefined, prepared: (() => void) | undefined, deps: ClipCaptureDeps): Promise<ClippedMemoryOutcome> {
  if (mode === 'start' && !deps.createEnabled()) throw new ClipCaptureError('unavailable');
  return withPersonalMemoryMutation(uid, async context => deps.exclusive(clipCaptureCheckpointKey(uid), async () => {
    const guard = context.assertCurrent; guard(); const key = clipCaptureCheckpointKey(uid);
    let raw: string | null; try { raw = deps.storage.getItem(key); } catch { throw new ClipCaptureError('storage'); }
    let request: ClippedMemoryInput;
    if (raw !== null) {
      if (mode === 'start') throw new ClipCaptureError('pending'); request = await readCheckpoint(raw, uid, deps, guard);
    } else {
      if (mode !== 'start' || !clip) throw new ClipCaptureError('unavailable');
      const normalized = parseClipPayload(clip); if (!normalized) throw new ClipCaptureError('unavailable');
      const fields = await deps.prepare(formatClipMemoryText(normalized), clipMemoryTitle(normalized)); guard();
      request = parseClippedMemoryInput({sessionId: deps.id(), enc: fields.enc});
      const encrypted = await deps.encryptJournal({text: JSON.stringify({v: 1, uid, request})}); guard();
      if (!isEncryptedMemoryEnvelope(encrypted)) throw new ClipCaptureError('checkpoint'); raw = JSON.stringify(encrypted);
      try { deps.storage.setItem(key, raw); if (deps.storage.getItem(key) !== raw) throw new Error(); } catch { throw new ClipCaptureError('storage'); }
      // Only the verified encrypted checkpoint permits clearing the incoming browser queue.
      guard(); prepared?.(); guard(); notify(); guard();
    }
    guard(); let known = await outcome(await deps.call('status', request), request, guard); guard();
    if (known.status === 'unknown') {
      if (mode !== 'cancel' && !deps.createEnabled()) throw new ClipCaptureError('pending');
      known = await outcome(await deps.call(mode === 'cancel' ? 'cancel' : 'create', request), request, guard); guard();
      if (known.status === 'unknown') throw new ClipCaptureError('pending');
    }
    if (mode !== 'cancel' && known.status !== 'committed') throw new ClipCaptureError('pending');
    try {
      if (deps.storage.getItem(key) !== raw) throw new Error();
      deps.storage.removeItem(key); if (deps.storage.getItem(key) !== null) throw new Error();
    } catch { throw new ClipCaptureError('storage'); }
    guard(); notify(); return known;
  }), deps.mutation);
}
/** Ciphertext sync is independent of AI/cloud-provider consent: no plaintext or attachment is sent. */
export async function persistClippedMemory(uid: string, clip: ClipPayload, prepared?: () => void, deps = defaults()): Promise<string> {
  const result = await operate(uid, 'start', clip, prepared, deps); return result.sessionId;
}
export const recoverPendingClipCapture = (uid: string, deps = defaults()) => operate(uid, 'recover', undefined, undefined, deps);
export const cancelPendingClipCapture = (uid: string, deps = defaults()) => operate(uid, 'cancel', undefined, undefined, deps);

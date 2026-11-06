import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { auth, db } from '../firebase';
import { ATTACHMENT_WRITES_ENABLED } from '../config/releaseGates';
import { attachmentActorIdValid, attachmentIdValid } from '../../../functions/src/attachmentEnvelope';
import { attachmentSessionRevision, attachmentSessionStateBytes, parseAttachmentMutationInput, type AttachmentMutationInput } from '../../../functions/src/attachmentMutationContract';
import { authorizeCloudUse } from './cloudUsePolicy';
import { getLocalAiConfig, type MemoryPermission } from './localAiConfig';
import { decryptMemoryEnvelope, encryptMemoryFields, isEncryptedMemoryEnvelope, isMemoryCryptoReady, onMemoryCryptoChanged, type EncryptedMemoryEnvelope } from './memoryCrypto';
import { getTeamKeyCacheGeneration, onTeamKeyChanged } from './teamVault';
import { forgetAssociatedUploadCheckpoints } from './attachmentUploadCheckpoint';

export class AttachmentMutationRecoveryError extends Error {
  readonly reason: 'unavailable' | 'access-changed' | 'pending' | 'checkpoint' | 'storage' | 'unsupported' | 'busy';
  constructor(reason: AttachmentMutationRecoveryError['reason']) {
    super('Não foi possível confirmar os anexos. A operação pendente foi conservada para recuperação.');
    this.reason = reason;
  }
}
export type AttachmentMutationOutcome = { operationId: string; sessionId: string; status: 'committed'; updatedAt: number; versionId: string | null; changed: boolean } |
  { operationId: string; sessionId: string; status: 'cancelled' };
interface Checkpoint { v: 1; uid: string; sessionId: string; request: AttachmentMutationInput }
export interface AttachmentMutationRecoveryDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  uid: () => string | null; ready: () => boolean; policy: () => MemoryPermission; generation: () => number;
  subscribe: (changed: () => void) => () => void; id: () => string;
  exclusive: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  loadSession: (sessionId: string) => Promise<Record<string, unknown>>;
  encrypt: (fields: { text: string }) => Promise<EncryptedMemoryEnvelope>;
  decrypt: (envelope: EncryptedMemoryEnvelope) => Promise<{ text: string }>;
  mutate: (request: AttachmentMutationInput) => Promise<unknown>;
  status: (operationId: string) => Promise<unknown>;
  cancel: (request: AttachmentMutationInput) => Promise<unknown>;
  forgetUploads: (uid: string, ids: string[], guard: () => void) => Promise<void>;
}
const key = (uid: string, sessionId: string) => `mnemosyne:attachment-mutation:v1:${encodeURIComponent(uid)}:${encodeURIComponent(sessionId)}`;
const event = 'mnemosyne:attachment-mutation-changed';
const notify = () => window.dispatchEvent(new Event(event));
export function hasPendingAttachmentMutation(uid: string, sessionId: string) {
  try { return localStorage.getItem(key(uid, sessionId)) !== null; } catch { return false; }
}
export function observeAttachmentMutations(callback: () => void) {
  window.addEventListener(event, callback); window.addEventListener('storage', callback);
  return () => { window.removeEventListener(event, callback); window.removeEventListener('storage', callback); };
}
function defaults(): AttachmentMutationRecoveryDeps {
  const call = async (name: string, payload: unknown) => (await httpsCallable(getFunctions(app, 'europe-west1'), name)(payload)).data;
  return { storage: localStorage, uid: () => auth.currentUser?.uid ?? null, ready: isMemoryCryptoReady,
    policy: () => getLocalAiConfig().memoryPermission, generation: getTeamKeyCacheGeneration, id: () => crypto.randomUUID(),
    encrypt: encryptMemoryFields, decrypt: decryptMemoryEnvelope,
    loadSession: async id => { const snapshot = await getDocFromServer(doc(db, 'sessions', id)); if (!snapshot.exists()) throw new AttachmentMutationRecoveryError('unavailable'); return snapshot.data(); },
    mutate: request => call('mutateSessionAttachments', request), status: operationId => call('getAttachmentMutationStatus', { operationId }),
    cancel: request => call('cancelSessionAttachmentMutation', request),
    forgetUploads: forgetAssociatedUploadCheckpoints,
    subscribe: changed => {
      const uid = auth.currentUser?.uid; const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) changed(); });
      const stopVault = onMemoryCryptoChanged(changed); const stopTeam = onTeamKeyChanged(changed);
      window.addEventListener('mnemosyne:local-ai-config', changed); window.addEventListener('storage', changed);
      return () => { stopAuth(); stopVault(); stopTeam(); window.removeEventListener('mnemosyne:local-ai-config', changed); window.removeEventListener('storage', changed); };
    },
    exclusive: async (name, work) => {
      if (!navigator.locks) throw new AttachmentMutationRecoveryError('unsupported');
      return navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, lock => {
        if (!lock) throw new AttachmentMutationRecoveryError('busy'); return work();
      });
    } };
}
function parseCheckpoint(raw: unknown, uid: string, sessionId: string): Checkpoint {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AttachmentMutationRecoveryError('checkpoint');
  const value = raw as Checkpoint;
  if (Object.keys(value).sort().join(',') !== 'request,sessionId,uid,v' || value.v !== 1 || value.uid !== uid || value.sessionId !== sessionId) throw new AttachmentMutationRecoveryError('checkpoint');
  const request = parseAttachmentMutationInput(value.request);
  if (request.sessionId !== sessionId) throw new AttachmentMutationRecoveryError('checkpoint');
  return { v: 1, uid, sessionId, request };
}
function parseOutcome(value: unknown, request: AttachmentMutationInput, unknownAllowed: boolean): AttachmentMutationOutcome | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AttachmentMutationRecoveryError('pending');
  const result = value as AttachmentMutationOutcome | { operationId: string; status: 'unknown' };
  if (result.operationId !== request.operationId) throw new AttachmentMutationRecoveryError('pending');
  if (result.status === 'unknown' && unknownAllowed && Object.keys(result).sort().join(',') === 'operationId,status') return null;
  if (!('sessionId' in result) || result.sessionId !== request.sessionId) throw new AttachmentMutationRecoveryError('pending');
  if (result.status === 'cancelled' && Object.keys(result).sort().join(',') === 'operationId,sessionId,status') return result;
  if (result.status !== 'committed' || Object.keys(result).sort().join(',') !== 'changed,operationId,sessionId,status,updatedAt,versionId' ||
      typeof result.changed !== 'boolean' || !Number.isSafeInteger(result.updatedAt) ||
      (result.changed ? result.updatedAt <= request.expectedRevision : result.updatedAt !== request.expectedRevision) ||
      result.versionId !== (result.changed ? request.operationId : null)) throw new AttachmentMutationRecoveryError('pending');
  return result;
}
/** One encrypted checkpoint per memory. Unknown/failed replies preserve the exact id and CAS for an explicit retry or serialized cancellation. */
async function operate(uid: string, sessionId: string, action: 'recover' | 'cancel' | 'start',
  proposal: { action: 'add' | 'remove'; ids: string[] } | undefined, deps: AttachmentMutationRecoveryDeps): Promise<AttachmentMutationOutcome> {
  if (!attachmentActorIdValid(uid) || !attachmentActorIdValid(sessionId) || (action === 'start' && !ATTACHMENT_WRITES_ENABLED)) throw new AttachmentMutationRecoveryError('unavailable');
  if (proposal && (!['add', 'remove'].includes(proposal.action) || !Array.isArray(proposal.ids) || proposal.ids.length < 1 || proposal.ids.length > 20 ||
      proposal.ids.some(id => !attachmentIdValid(id)) || new Set(proposal.ids).size !== proposal.ids.length)) throw new AttachmentMutationRecoveryError('unavailable');
  const policy = deps.policy(); const generation = deps.generation(); let changed = false;
  const stop = deps.subscribe(() => { changed = true; });
  const guard = () => { if (changed || deps.uid() !== uid || !deps.ready() || deps.policy() !== policy || deps.generation() !== generation) throw new AttachmentMutationRecoveryError('access-changed'); };
  try {
    guard(); authorizeCloudUse({ purpose: 'attachment-storage', provider: 'Firebase', policy,
      payloadSummary: { bytes: 2048, containsMemory: false, containsAttachment: false, containsPrompt: false } }); guard();
    return await deps.exclusive(key(uid, sessionId), async () => {
      guard(); const storageKey = key(uid, sessionId); let raw: string | null;
      try { raw = deps.storage.getItem(storageKey); } catch { throw new AttachmentMutationRecoveryError('storage'); }
      let checkpoint: Checkpoint;
      const existing = raw !== null;
      if (raw !== null) {
        try {
          if (raw.length > 16384) throw new Error(); const envelope: unknown = JSON.parse(raw);
          if (!isEncryptedMemoryEnvelope(envelope)) throw new Error();
          const plaintext = (await deps.decrypt(envelope)).text; guard(); if (plaintext.length > 8192) throw new Error();
          checkpoint = parseCheckpoint(JSON.parse(plaintext), uid, sessionId);
        } catch (error) { if (error instanceof AttachmentMutationRecoveryError) throw error; throw new AttachmentMutationRecoveryError('checkpoint'); }
        if (proposal && (proposal.action !== checkpoint.request.action || JSON.stringify([...proposal.ids].sort()) !== JSON.stringify(checkpoint.request.ids))) throw new AttachmentMutationRecoveryError('pending');
      } else {
        if (action !== 'start' || !proposal) throw new AttachmentMutationRecoveryError('unavailable');
        const state = await deps.loadSession(sessionId); guard();
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(attachmentSessionStateBytes(sessionId, state)).buffer)); guard();
        const request = parseAttachmentMutationInput({ operationId: deps.id(), sessionId, action: proposal.action, ids: proposal.ids,
          expectedRevision: attachmentSessionRevision(state), expectedStateDigest: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') });
        checkpoint = { v: 1, uid, sessionId, request };
        const encrypted = await deps.encrypt({ text: JSON.stringify(checkpoint) }); guard();
        if (!isEncryptedMemoryEnvelope(encrypted)) throw new AttachmentMutationRecoveryError('checkpoint');
        raw = JSON.stringify(encrypted);
        try { deps.storage.setItem(storageKey, raw); if (deps.storage.getItem(storageKey) !== raw) throw new Error(); } catch { throw new AttachmentMutationRecoveryError('storage'); }
        notify();
      }
      guard(); let outcome: AttachmentMutationOutcome | null = null;
      if (existing) { outcome = parseOutcome(await deps.status(checkpoint.request.operationId), checkpoint.request, true); guard(); }
      if (!outcome) {
        if (action !== 'cancel' && !ATTACHMENT_WRITES_ENABLED) throw new AttachmentMutationRecoveryError('pending');
        const response = action === 'cancel' ? await deps.cancel(checkpoint.request) : await deps.mutate(checkpoint.request); guard();
        outcome = parseOutcome(response, checkpoint.request, false);
      }
      if (!outcome) throw new AttachmentMutationRecoveryError('pending');
      guard();
      if (outcome.status === 'committed' && checkpoint.request.action === 'add') {
        await deps.forgetUploads(uid, checkpoint.request.ids, guard); guard();
      }
      try { if (deps.storage.getItem(storageKey) !== raw) throw new Error(); deps.storage.removeItem(storageKey); if (deps.storage.getItem(storageKey) !== null) throw new Error(); } catch { throw new AttachmentMutationRecoveryError('storage'); }
      notify(); return outcome;
    });
  } catch (error) { if (error instanceof AttachmentMutationRecoveryError) throw error; throw new AttachmentMutationRecoveryError('pending'); }
  finally { stop(); }
}
export const associateSessionAttachments = (input: { uid: string; sessionId: string; action: 'add' | 'remove'; ids: string[] }, deps = defaults()) =>
  operate(input.uid, input.sessionId, 'start', { action: input.action, ids: input.ids }, deps);
export const recoverSessionAttachmentMutation = (uid: string, sessionId: string, deps = defaults()) => operate(uid, sessionId, 'recover', undefined, deps);
export const cancelPendingSessionAttachmentMutation = (uid: string, sessionId: string, deps = defaults()) => operate(uid, sessionId, 'cancel', undefined, deps);

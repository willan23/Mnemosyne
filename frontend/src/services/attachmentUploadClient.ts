import { getFunctions, httpsCallable } from 'firebase/functions';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import app, { auth, db } from '../firebase';
import { ATTACHMENT_WRITES_ENABLED } from '../config/releaseGates';
import { authorizeCloudUse } from './cloudUsePolicy';
import { getLocalAiConfig, type MemoryPermission } from './localAiConfig';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from './memoryCrypto';
import { getTeamKeyCacheGeneration, onTeamKeyChanged } from './teamVault';
import { parseTeam } from './teamsService';
import { unlockTeamKey } from './teamKeyAccess';
import { readSessionMnemonic } from '../utils/sessionMnemonic';
import { attachmentKeyWrapper, personalAttachmentKeyWrapper, sealAttachment, type AttachmentKeyWrapper } from './attachmentCrypto';
import { attachmentActorIdValid, attachmentIdValid, encodeAttachmentHeader, type AttachmentEnvelopeHeader, type AttachmentScope } from '../../../functions/src/attachmentEnvelope';
import { attachmentBytesDigest, notifyAttachmentUploadCheckpoints, readUploadCheckpoint, saveUploadCheckpoint, uploadCheckpointDefaults,
  uploadCheckpointLock, validateCheckpointBytes, type AttachmentUploadCheckpoint, type AttachmentUploadCheckpointDeps } from './attachmentUploadCheckpoint';
import type { Attachment } from '../types/attachments';
export class AttachmentUploadError extends Error {
  readonly reason: 'unavailable' | 'pending' | 'verifying' | 'expired';
  constructor(reason: AttachmentUploadError['reason'] = 'unavailable') { super('Não foi possível enviar o anexo cifrado.'); this.reason = reason; }
}
export interface AttachmentUploadClientDeps extends AttachmentUploadCheckpointDeps {
  uid: () => string | null; ready: () => boolean; policy: () => MemoryPermission; generation: () => number;
  subscribe: (changed: () => void) => () => void; now: () => number; id: () => string;
  prepareScope: (uid: string, teamId?: string) => Promise<{ scope: AttachmentScope; wrapper: AttachmentKeyWrapper }>;
  begin: (header: AttachmentEnvelopeHeader) => Promise<unknown>; complete: (id: string) => Promise<unknown>;
  inspect: (header: AttachmentEnvelopeHeader) => Promise<unknown>; cancelPending: (header: AttachmentEnvelopeHeader) => Promise<unknown>;
  post: (url: string, form: FormData, signal: AbortSignal) => Promise<{ ok: boolean }>;
}
function defaultDeps(): AttachmentUploadClientDeps {
  const call = async (name: string, payload: unknown) => (await httpsCallable(getFunctions(app, 'europe-west1'), name)(payload)).data;
  return { ...uploadCheckpointDefaults(), uid: () => auth.currentUser?.uid ?? null, ready: isMemoryCryptoReady, policy: () => getLocalAiConfig().memoryPermission,
    generation: getTeamKeyCacheGeneration, now: Date.now, id: () => crypto.randomUUID(),
    subscribe: changed => {
      const uid = auth.currentUser?.uid;
      const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) changed(); });
      const stopVault = onMemoryCryptoChanged(changed); const stopTeam = onTeamKeyChanged(changed);
      window.addEventListener('mnemosyne:local-ai-config', changed); window.addEventListener('storage', changed);
      return () => { stopAuth(); stopVault(); stopTeam(); window.removeEventListener('mnemosyne:local-ai-config', changed); window.removeEventListener('storage', changed); };
    },
    prepareScope: async (uid, teamId) => {
      if (!teamId) return { scope: { kind: 'personal', uid }, wrapper: personalAttachmentKeyWrapper };
      if (!attachmentActorIdValid(teamId)) throw new AttachmentUploadError();
      const team = parseTeam(teamId, (await getDocFromServer(doc(db, 'teams', teamId))).data() ?? {});
      if (!team || !team.memberUids.includes(uid) || team.keyRotationStatus !== 'active' || team.pendingRotationId || !team.activeKeyEpoch || !team.activeKeyId || !team.wrappedKeys[uid]) throw new AttachmentUploadError();
      const key = await unlockTeamKey(team, uid, readSessionMnemonic(), { epoch: team.activeKeyEpoch, notify: false });
      return { scope: { kind: 'team', teamId, keyEpoch: team.activeKeyEpoch, keyId: team.activeKeyId }, wrapper: attachmentKeyWrapper(key) };
    },
    begin: header => call('beginAttachmentUpload', header), complete: id => call('completeAttachmentUpload', { id }),
    inspect: header => call('getAttachmentUploadStatus', { header }), cancelPending: header => call('cancelUnconfirmedAttachmentUpload', { header }),
    post: (url, body, signal) => fetch(url, { method: 'POST', body, signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' }),
  };
}
function readPost(value: unknown, header: AttachmentEnvelopeHeader, bytes: number, now: number): { url: string; fields: Record<string, string> } | 'ready' {
  if (!value || typeof value !== 'object') throw new AttachmentUploadError();
  const post = value as { id?: unknown; status?: unknown; bytes?: unknown; expiresAt?: unknown; url?: unknown; bucket?: unknown; fields?: unknown };
  if (post.id !== header.id) throw new AttachmentUploadError();
  if (post.status === 'ready') return 'ready';
  if (post.status !== 'reserved' || post.bytes !== bytes || typeof post.bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{2,62}$/.test(post.bucket) ||
      typeof post.expiresAt !== 'number' || post.expiresAt <= now || post.expiresAt > now + 120_000 || typeof post.url !== 'string' ||
      !post.fields || typeof post.fields !== 'object' || Array.isArray(post.fields)) throw new AttachmentUploadError();
  const url = new URL(post.url);
  if (url.protocol !== 'https:' || url.hostname !== 'storage.googleapis.com' || url.username || url.password || url.port || url.search || url.hash ||
      ![`/${post.bucket}`, `/${post.bucket}/`].includes(url.pathname)) throw new AttachmentUploadError();
  const fields = post.fields as Record<string, string>;
  if (Object.keys(fields).length > 12 || Object.entries(fields).some(([key, value]) =>
      !['key', 'Content-Type', 'policy', 'x-goog-algorithm', 'x-goog-credential', 'x-goog-date', 'x-goog-signature'].includes(key) || typeof value !== 'string' || value.length > 16384) ||
      fields.key !== `quarantine/${header.uid}/${header.id}` || fields['Content-Type'] !== 'application/octet-stream' || !fields.policy || !fields['x-goog-signature']) throw new AttachmentUploadError();
  const policy = JSON.parse(atob(fields.policy)) as { expiration?: string; conditions?: unknown[] };
  if (!policy.expiration || Math.abs(Date.parse(policy.expiration) - post.expiresAt) > 1000 || !Number.isFinite(Date.parse(policy.expiration)) ||
      !Array.isArray(policy.conditions) || !policy.conditions.some(condition => JSON.stringify(condition) === JSON.stringify(['content-length-range', bytes, bytes]))) throw new AttachmentUploadError();
  return { url: post.url, fields };
}
type Progress = (progress: { progress: number; state: 'running' | 'success' | 'error' }) => void;
const descriptor = (header: AttachmentEnvelopeHeader): Attachment => ({ type: header.category, url: `mnemosyne-attachment:v1:${header.id}`, name: 'Anexo cifrado',
  size: encodeAttachmentHeader(header).length + header.cipherBytes, mimeType: 'application/octet-stream', source: 'upload' });
async function inspect(checkpoint: AttachmentUploadCheckpoint, deps: AttachmentUploadClientDeps, guard: () => void) {
  const value = await deps.inspect(checkpoint.header) as { id: string; digest: string; status: 'unknown' | 'reserved' | 'verifying' | 'ready' | 'cancelled' | 'expired';
    bytes: number; expiresAt: number | null; postExpiresAt: number | null; retryAt: number | null }; guard();
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'bytes,digest,expiresAt,id,postExpiresAt,retryAt,status' ||
      value.id !== checkpoint.header.id || value.digest !== await attachmentBytesDigest(encodeAttachmentHeader(checkpoint.header)) || value.bytes !== descriptor(checkpoint.header).size ||
      !['unknown', 'reserved', 'verifying', 'ready', 'cancelled', 'expired'].includes(value.status) ||
      [value.expiresAt, value.postExpiresAt, value.retryAt].some(item => item !== null && (!Number.isSafeInteger(item) || item < 1)) ||
      (['reserved', 'verifying', 'expired', 'ready'].includes(value.status) && (value.expiresAt === null || value.postExpiresAt === null)) ||
      (value.status === 'verifying' && value.retryAt === null)) throw new AttachmentUploadError('pending'); guard(); return value;
}
async function inContext<T>(uid: string, deps: AttachmentUploadClientDeps, bytes: number | ((guard: () => void) => Promise<number>), work: (guard: () => void, signal: AbortSignal) => Promise<T>, outerGuard: () => void = () => {}) {
  const policy = deps.policy(); const generation = deps.generation(); let changed = false; const controller = new AbortController();
  const stop = deps.subscribe(() => { changed = true; controller.abort(); });
  const guard = () => { outerGuard(); if (changed || deps.uid() !== uid || !deps.ready() || deps.policy() !== policy || deps.generation() !== generation) throw new AttachmentUploadError('pending'); };
  try {
    guard(); if (!attachmentActorIdValid(uid)) throw new AttachmentUploadError();
    const payloadBytes = typeof bytes === 'number' ? bytes : await bytes(guard); guard();
    if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 1) throw new AttachmentUploadError();
    authorizeCloudUse({ purpose: 'attachment-storage', provider: 'Firebase / Google Cloud Storage', policy,
      payloadSummary: { bytes: payloadBytes, containsAttachment: true, containsMemory: false, containsPrompt: false } }); guard(); return await work(guard, controller.signal);
  } catch (error) { if (error instanceof AttachmentUploadError) throw error; throw new AttachmentUploadError('pending'); }
  finally { stop(); controller.abort(); }
}
async function continueUpload(checkpoint: AttachmentUploadCheckpoint, bytes: ArrayBuffer | null, deps: AttachmentUploadClientDeps,
  guard: () => void, signal: AbortSignal, onProgress?: Progress) {
  if (bytes) await validateCheckpointBytes(checkpoint, bytes, guard);
  const status = await inspect(checkpoint, deps, guard);
  if (status.status === 'cancelled') {
    await deps.journal.remove(checkpoint.uid, checkpoint.header.id); guard(); notifyAttachmentUploadCheckpoints(); return { status: 'cancelled' as const };
  }
  if (status.status !== 'ready') {
    if (!ATTACHMENT_WRITES_ENABLED) throw new AttachmentUploadError('pending');
    if (status.status === 'expired' || (status.expiresAt !== null && status.expiresAt <= deps.now())) throw new AttachmentUploadError('expired');
    if (status.status === 'verifying' && status.retryAt! > deps.now()) throw new AttachmentUploadError('verifying');
    if (checkpoint.phase === 'ready' || !bytes) throw new AttachmentUploadError('pending');
    if (checkpoint.phase === 'pending' && status.status !== 'verifying') {
      const reply = await deps.begin(checkpoint.header); guard(); const post = readPost(reply, checkpoint.header, bytes.byteLength, deps.now());
      if (post !== 'ready') {
        checkpoint = { ...checkpoint, phase: 'posting' }; await saveUploadCheckpoint(checkpoint, bytes, deps, guard);
        const form = new FormData(); Object.entries(post.fields).forEach(([key, value]) => form.append(key, value));
        form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), 'attachment.bin');
        const controller = new AbortController(); const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 5 * 60_000);
        try { const response = await deps.post(post.url, form, controller.signal); guard(); if (!response.ok) throw new AttachmentUploadError('pending'); }
        finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); }
        onProgress?.({ progress: 80, state: 'running' });
      } else checkpoint = { ...checkpoint, phase: 'ready' };
    }
    if (checkpoint.phase !== 'ready') {
      // A POST already attempted is never blindly replayed: its response may have been lost and a worker may be publishing that generation.
      const completion = await deps.complete(checkpoint.header.id) as { id?: string; status?: string }; guard();
      if (completion?.id !== checkpoint.header.id || !['ready', 'verifying'].includes(completion.status ?? '')) throw new AttachmentUploadError('pending');
      if (completion.status === 'verifying') throw new AttachmentUploadError('verifying');
    }
  }
  await saveUploadCheckpoint({ ...checkpoint, phase: 'ready' }, null, deps, guard); guard(); onProgress?.({ progress: 100, state: 'success' });
  return { status: 'ready' as const, attachment: descriptor(checkpoint.header), name: checkpoint.name };
}
/** The encrypted file and encrypted checkpoint are committed locally before any reservation. Ready checkpoints remain until association. */
export async function uploadEncryptedAttachment(input: { file: File; uid: string; teamId?: string }, onProgress?: Progress, deps = defaultDeps()): Promise<Attachment> {
  if (!ATTACHMENT_WRITES_ENABLED || !Number.isSafeInteger(input.file.size) || input.file.size < 1 || input.file.size > 200 * 1024 * 1024) throw new AttachmentUploadError();
  return inContext(input.uid, deps, input.file.size, async (guard, signal) => {
    const id = deps.id(); if (!attachmentIdValid(id)) throw new AttachmentUploadError();
    return deps.exclusive(uploadCheckpointLock(input.uid, id), async () => {
      guard(); if (await deps.journal.get(input.uid, id)) throw new AttachmentUploadError('pending'); guard();
      let plaintext: Uint8Array | undefined;
      try {
        const context = await deps.prepareScope(input.uid, input.teamId); guard();
        plaintext = new Uint8Array(await input.file.arrayBuffer()); guard(); if (plaintext.byteLength !== input.file.size) throw new AttachmentUploadError();
        const sealed = await sealAttachment({ id, uid: input.uid, scope: context.scope, bytes: plaintext, name: input.file.name, mimeType: input.file.type }, context.wrapper, guard);
        plaintext.fill(0); guard();
        const checkpoint: AttachmentUploadCheckpoint = { v: 1, uid: input.uid, header: sealed.header, name: input.file.name, phase: 'pending', bytesDigest: await attachmentBytesDigest(sealed.bytes) }; guard();
        const bytes = new Uint8Array(sealed.bytes).buffer;
        await saveUploadCheckpoint(checkpoint, bytes, deps, guard); onProgress?.({ progress: 0, state: 'running' });
        const outcome = await continueUpload(checkpoint, bytes, deps, guard, signal, onProgress);
        if (outcome.status !== 'ready') throw new AttachmentUploadError('pending'); return outcome.attachment;
      } finally { plaintext?.fill(0); }
    });
  });
}
export interface PreparedPersonalAttachment { id: string; header: AttachmentEnvelopeHeader; bytesDigest: string }
function assertPrepared(checkpoint: AttachmentUploadCheckpoint, expected?: PreparedPersonalAttachment) {
  if (expected && (expected.id !== checkpoint.header.id || expected.bytesDigest !== checkpoint.bytesDigest ||
      JSON.stringify(expected.header) !== JSON.stringify(checkpoint.header) || checkpoint.header.scope.kind !== 'personal')) throw new AttachmentUploadError('pending');
}
/** Pure local preparation. The caller fixes the UUID before reading files and saves the whole plan before any upload. */
export async function preparePersonalAttachment(input: { file: File; uid: string; id: string }, outerGuard: () => void, deps = defaultDeps()): Promise<PreparedPersonalAttachment> {
  if (!attachmentActorIdValid(input.uid) || !attachmentIdValid(input.id) || !Number.isSafeInteger(input.file.size) || input.file.size < 1 || input.file.size > 200 * 1024 * 1024) throw new AttachmentUploadError();
  const generation = deps.generation(); const policy = deps.policy(); let changed = false; const stop = deps.subscribe(() => { changed = true; });
  const guard = () => { outerGuard(); if (changed || deps.uid() !== input.uid || !deps.ready() || deps.generation() !== generation || deps.policy() !== policy) throw new AttachmentUploadError('pending'); };
  try {
    guard(); return await deps.exclusive(uploadCheckpointLock(input.uid, input.id), async () => {
      guard(); if (await deps.journal.get(input.uid, input.id)) throw new AttachmentUploadError('pending'); guard();
      let plaintext: Uint8Array | undefined;
      try {
        // Personal scope never performs team/network lookups; no cloud consent or reservation is requested here.
        const context = await deps.prepareScope(input.uid); guard();
        if (context.scope.kind !== 'personal' || context.scope.uid !== input.uid) throw new AttachmentUploadError();
        plaintext = new Uint8Array(await input.file.arrayBuffer()); guard(); if (plaintext.byteLength !== input.file.size) throw new AttachmentUploadError();
        const sealed = await sealAttachment({ id: input.id, uid: input.uid, scope: context.scope, bytes: plaintext, name: input.file.name, mimeType: input.file.type }, context.wrapper, guard);
        plaintext.fill(0); guard();
        const checkpoint: AttachmentUploadCheckpoint = { v: 1, uid: input.uid, header: sealed.header, name: input.file.name, phase: 'pending', bytesDigest: await attachmentBytesDigest(sealed.bytes) }; guard();
        await saveUploadCheckpoint(checkpoint, new Uint8Array(sealed.bytes).buffer, deps, guard); guard();
        return { id: input.id, header: sealed.header, bytesDigest: checkpoint.bytesDigest };
      } finally { plaintext?.fill(0); }
    });
  } finally { stop(); }
}
/** Verify the manifest against durable encrypted file bytes before the parent import can contact the server. */
export async function validatePreparedPersonalAttachment(uid: string, expected: PreparedPersonalAttachment, guard: () => void, deps = defaultDeps()) {
  return deps.exclusive(uploadCheckpointLock(uid, expected.id), async () => {
    guard(); const { checkpoint, stored } = await readUploadCheckpoint(uid, expected.id, deps, guard); assertPrepared(checkpoint, expected);
    if (stored.bytes) await validateCheckpointBytes(checkpoint, stored.bytes, guard); guard();
  });
}
/** Terminal imports may have already removed a subset of local checkpoints. A replacement checkpoint is preserved. */
export async function forgetPreparedPersonalAttachment(uid: string, expected: PreparedPersonalAttachment, guard: () => void, deps = defaultDeps()) {
  return deps.exclusive(uploadCheckpointLock(uid, expected.id), async () => {
    guard(); if (deps.uid() !== uid || !deps.ready()) throw new AttachmentUploadError('pending');
    const stored = await deps.journal.get(uid, expected.id); guard(); if (!stored) return;
    const { checkpoint } = await readUploadCheckpoint(uid, expected.id, deps, guard); assertPrepared(checkpoint, expected);
    if (checkpoint.phase !== 'ready') throw new AttachmentUploadError('pending');
    await deps.journal.remove(uid, expected.id); guard(); if (await deps.journal.get(uid, expected.id)) throw new AttachmentUploadError('pending'); guard(); notifyAttachmentUploadCheckpoints(); guard();
  });
}
export async function resumeEncryptedAttachmentUpload(uid: string, id: string, deps = defaultDeps(), outerGuard: () => void = () => {}, expected?: PreparedPersonalAttachment) {
  let expectedHeader: string;
  return inContext(uid, deps, async guard => {
    const { checkpoint } = await readUploadCheckpoint(uid, id, deps, guard); assertPrepared(checkpoint, expected); expectedHeader = JSON.stringify(checkpoint.header);
    if (expected) { const { stored } = await readUploadCheckpoint(uid, id, deps, guard); if (stored.bytes) await validateCheckpointBytes(checkpoint, stored.bytes, guard); }
    return descriptor(checkpoint.header).size!;
  }, (guard, signal) => deps.exclusive(uploadCheckpointLock(uid, id), async () => {
    const { checkpoint, stored } = await readUploadCheckpoint(uid, id, deps, guard);
    assertPrepared(checkpoint, expected);
    if (JSON.stringify(checkpoint.header) !== expectedHeader) throw new AttachmentUploadError('pending');
    return continueUpload(checkpoint, stored.bytes, deps, guard, signal);
  }), outerGuard);
}
export async function cancelRecoverableAttachmentUpload(uid: string, id: string, deps = defaultDeps(), outerGuard: () => void = () => {}, expected?: PreparedPersonalAttachment) {
  return inContext(uid, deps, 2048, guard => deps.exclusive(uploadCheckpointLock(uid, id), async () => {
    const { checkpoint } = await readUploadCheckpoint(uid, id, deps, guard);
    assertPrepared(checkpoint, expected);
    const value = await deps.cancelPending(checkpoint.header) as { id: string; digest: string; status: string }; guard();
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'digest,id,status' || value.id !== id ||
        value.digest !== await attachmentBytesDigest(encodeAttachmentHeader(checkpoint.header)) || !['cancelled', 'ready'].includes(value.status)) throw new AttachmentUploadError('pending'); guard();
    if (value.status === 'ready') { await saveUploadCheckpoint({ ...checkpoint, phase: 'ready' }, null, deps, guard); return { status: 'ready' as const, attachment: descriptor(checkpoint.header), name: checkpoint.name }; }
    await deps.journal.remove(uid, id); guard(); notifyAttachmentUploadCheckpoints(); return { status: 'cancelled' as const };
  }), outerGuard);
}
export async function cancelPreparedPersonalAttachment(uid: string, expected: PreparedPersonalAttachment, guard: () => void, deps = defaultDeps()) {
  guard(); const stored = await deps.journal.get(uid, expected.id); guard(); if (!stored) return;
  const { checkpoint } = await readUploadCheckpoint(uid, expected.id, deps, guard); assertPrepared(checkpoint, expected);
  if (checkpoint.phase === 'ready') return { status: 'ready' as const };
  return cancelRecoverableAttachmentUpload(uid, expected.id, deps, guard, expected);
}
/** Local inventory uses only the unlocked vault, without fetching remote state. */
export async function listRecoverableAttachmentUploads(uid: string, teamId?: string, deps = defaultDeps(), afterId?: string) {
  const generation = deps.generation(); let changed = false; const stop = deps.subscribe(() => { changed = true; });
  const guard = () => { if (changed || deps.uid() !== uid || !deps.ready() || deps.generation() !== generation) throw new AttachmentUploadError('pending'); };
  try {
    guard(); if (!attachmentActorIdValid(uid) || (afterId !== undefined && !attachmentIdValid(afterId))) throw new AttachmentUploadError();
    const ids = await deps.journal.ids(uid, 50, afterId); guard();
    const result: { id: string; name: string; phase: AttachmentUploadCheckpoint['phase'] }[] = [];
    let unreadableCount = 0;
    for (const id of ids) {
      try {
        const { checkpoint } = await readUploadCheckpoint(uid, id, deps, guard); const scope = checkpoint.header.scope;
        if (teamId ? scope.kind === 'team' && scope.teamId === teamId : scope.kind === 'personal') result.push({ id, name: checkpoint.name, phase: checkpoint.phase });
      } catch { guard(); unreadableCount++; } // Preserve a damaged record without hiding other recoverable files.
    }
    guard(); return { items: result, unreadableCount, nextAfterId: ids.length === 50 ? ids[ids.length - 1] : null };
  } catch { throw new AttachmentUploadError('pending'); } finally { stop(); }
}

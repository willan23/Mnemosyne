import { onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { auth } from '../firebase';
import { attachmentActorIdValid } from '../../../functions/src/attachmentEnvelope';
import { accountDeletionRecoveryTokenValid } from '../../../functions/src/accountDeletionRecoveryContract';
import { clearAttachmentUploadCheckpoints } from './attachmentUploadJournalStore';
import { discardEmbeddingReindex } from './embeddingReindex';
import { AI_PROVIDERS } from './localAiConfig';
import { removeMobileSyncCredential } from './mobileDeviceKeyStore';
import { setMemoryCryptoMnemonic } from './memoryCrypto';
import { clearTeamKeyCache } from './teamVault';
import { clearSessionMnemonic } from '../utils/sessionMnemonic';
import { ACCOUNT_DELETION_ENABLED } from '../config/releaseGates';
import {starterAssimilationKey} from './starterAssimilationState';
import {clearCognitiveDraft} from './cognitiveDraftStore';
import {clearMemoryEditorDrafts} from './memoryEditorDraftStore';
import {clearSemanticClusterRequests} from './semanticClusterStore';
import {clearPersonalMigrationRequests} from './personalMigrationStore';
import {clearTeamHistoryChangeRequests} from './teamHistoryChangeStore';
import {reviewInboxStore} from './reviewInboxStore';
import {commsP2PInboxStore} from './commsP2PInboxStore';
import {localMemoryActivityStore} from './localMemoryActivityStore';
export interface AccountDeletionStatus { uid: string; status: 'unknown' | 'pending' | 'complete'; retryAt: number | null }
type Checkpoint = { v: 1; uid: string; phase: 'pending' | 'remote-complete' } | { v: 2; uid: string; phase: 'pending' | 'remote-complete'; recoveryToken: string };
export interface AccountDeletionClientDeps {
  currentUid: () => string | null; observeAuth: (changed: () => void) => () => void;
  storage: Storage; call: (name: 'deleteUserAccount' | 'getAccountDeletionStatus' | 'getAccountDeletionRecoveryStatus', input: { uid: string; recoveryToken?: string }) => Promise<unknown>;
  createRecoveryToken?: () => string;
  lockVault: () => void; cleanup: (uid: string, guard: () => void) => Promise<void>;
}
const key = (uid: string) => `mnemosyne:account-deletion:v1:${encodeURIComponent(uid)}`;
const failure = () => new Error('Não foi possível confirmar a eliminação. O pedido fica disponível para retomar.');
function parseStatus(input: unknown, uid: string, allowUnknown = false): AccountDeletionStatus {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure();
  const data = input as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== 'retryAt,status,uid' || data.uid !== uid ||
      !['pending', 'complete', ...(allowUnknown ? ['unknown'] : [])].includes(data.status as string) ||
      (data.status === 'pending' ? !Number.isSafeInteger(data.retryAt) || (data.retryAt as number) < 0 : data.retryAt !== null)) throw failure();
  return data as unknown as AccountDeletionStatus;
}
function readCheckpoint(uid: string, storage: Storage): Checkpoint | null {
  const raw = storage.getItem(key(uid)); if (raw === null) return null;
  const data = JSON.parse(raw) as Checkpoint;
  if (!data || data.uid !== uid || !['pending', 'remote-complete'].includes(data.phase) ||
      (data.v === 1 ? Object.keys(data).sort().join(',') !== 'phase,uid,v' :
        data.v !== 2 || Object.keys(data).sort().join(',') !== 'phase,recoveryToken,uid,v' || !accountDeletionRecoveryTokenValid(data.recoveryToken))) throw failure();
  return data;
}
function saveCheckpoint(checkpoint: Checkpoint, storage: Storage) {
  const raw = JSON.stringify(checkpoint); storage.setItem(key(checkpoint.uid), raw);
  if (storage.getItem(key(checkpoint.uid)) !== raw) throw failure();
}
function createRecoveryToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function hasLocalAccountDeletion(uid: string) { try { return localStorage.getItem(key(uid)) !== null; } catch { return true; } }
export function completedLocalAccountDeletionUids(storage?: Storage): string[] {
  try { return localDeletionUids(storage ?? localStorage, checkpoint => checkpoint.phase === 'remote-complete'); } catch { return []; }
}
export function recoverableLocalAccountDeletionUids(storage?: Storage): string[] {
  try { return localDeletionUids(storage ?? localStorage, checkpoint => checkpoint.v === 2 && checkpoint.phase === 'pending'); } catch { return []; }
}
function localDeletionUids(storage: Storage, matches: (checkpoint: Checkpoint) => boolean): string[] {
  const prefix = 'mnemosyne:account-deletion:v1:'; const uids: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const stored = storage.key(index); if (!stored?.startsWith(prefix)) continue;
    try { const uid = decodeURIComponent(stored.slice(prefix.length)); const checkpoint = attachmentActorIdValid(uid) ? readCheckpoint(uid, storage) : null; if (checkpoint && matches(checkpoint)) uids.push(uid); } catch { /* Preserve unreadable requests. */ }
  }
  return uids;
}
/** Known account keys are exact or use encoded UID boundaries. Browser preferences and other accounts remain separate. */
export function clearAccountLocalStorage(uid: string, storage: Storage) {
  const encoded = encodeURIComponent(uid);
  const exact = new Set([`mnemosyne:comms-p2p-content:v1:${encoded}`, `mnemosyne:comms-p2p:v1:${encoded}`, `mnemosyne:comms-p2p-session:v1:${encoded}`, `mnemosyne:comms-delivery:v1:${encoded}`, `mnemosyne:comms-contact:v1:${encoded}`, `mnemosyne:comms-contact-removal:v1:${encoded}`, `mnemosyne:comms-identity-rollover:v1:${encoded}`, `mnemosyne:comms-identity-backup:v1:${encoded}`, `mnemosyne:comms-import:v1:${encoded}`, `mnemosyne:document-import:v1:${encoded}`, `mnemosyne:obsidian-import:v1:${encoded}`, `mnemosyne:personal-connections:v1:${encoded}`, `mnemosyne:personal-revision:v1:${encoded}`, `mnemosyne:clip-capture:v1:${encoded}`, `mnemosyne:attached-memory-creation:v1:${encoded}`, `mnemosyne:team-creation:v1:${encoded}`, `mnemosyne:team-deletion:v1:${encoded}`,
    starterAssimilationKey(uid),
    `mnemosyne:team-revision:v1:${encoded}`,
    `mnemosyne:memory-edit:v1:${encoded}`,
    `mnemosyne:embedding-index:v1:${encoded}`,
    `mnemosyne:team-connection:v1:${encoded}`,
    `mnemosyne:semantic-relations:v1:${encoded}`,
    `mnemosyne:sync-conflict:v1:${encoded}`,
    `mnemosyne.search.recent.v2.${uid}`, `mnemosyne:review-inbox:v1:${uid}`, `mnemosyne.embedding.selection.v1.${uid}`,
    `mnemosyne.memory-migration.v1.${uid}`, `mnemosyne.semantic-proposals.v2.${uid}`, `mnemosyne.pulse.seen.${uid}`,
    `mnemosyne_desktop_sync_identity_${uid}`, `mnemosyne_identity_vault_${uid}`,
    ...AI_PROVIDERS.map(provider => `mnemosyne_ai_secret_${uid}_${provider.id}`)]);
  const prefixes = [...['comms-identity-history', 'attachment-mutation', 'team-rotation-recovery', 'team-history', 'sync-import', 'sync-outbox', 'sync-index'].map(name => `mnemosyne:${name}:v1:${encoded}:`),`mnemosyne:mobile-pairing:v2:${encoded}:`,`mnemosyne:mobile-pairing-archive:v2:${encoded}:`];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((value): value is string => value !== null);
  for (const stored of keys) if (exact.has(stored) || prefixes.some(prefix => stored.startsWith(prefix))) storage.removeItem(stored);
}
const defaults = (): AccountDeletionClientDeps => ({ currentUid: () => auth.currentUser?.uid ?? null,
  observeAuth: changed => onAuthStateChanged(auth, changed), storage: localStorage,
  call: async (name, input) => (await httpsCallable(getFunctions(app, 'europe-west1'), name)(input)).data,
  lockVault: () => { setMemoryCryptoMnemonic(null); clearTeamKeyCache(); clearSessionMnemonic(); },
  cleanup: async (uid, guard) => {
    guard(); await discardEmbeddingReindex(uid); guard(); await clearAttachmentUploadCheckpoints(uid); guard();
    await clearCognitiveDraft(uid,guard);guard();
    await clearMemoryEditorDrafts(uid,guard);guard();
    await clearSemanticClusterRequests(uid,guard);guard();
    await clearPersonalMigrationRequests(uid,guard);guard();
    await clearTeamHistoryChangeRequests(uid,guard);guard();
    await reviewInboxStore.clear(uid,guard);guard();
    await localMemoryActivityStore.remove(uid,guard);guard();
    await commsP2PInboxStore.clear(uid,guard);guard();
    await removeMobileSyncCredential(uid,guard); guard(); clearAccountLocalStorage(uid, localStorage);
    // These legacy device gates have no UID binding; clear only while the originally confirmed account is still active.
    if (auth.currentUser?.uid === uid) {
      localStorage.removeItem('mnemosyne.pin.vault.v1'); localStorage.removeItem('mnemosyne.webauthn.credential.v1');
    }
  },
});
async function guarded<T>(uid: string, deps: AccountDeletionClientDeps, work: (guard: () => void) => Promise<T>) {
  if (!attachmentActorIdValid(uid)) throw failure(); let changed = false;
  const guard = () => { if (changed || deps.currentUid() !== uid) throw failure(); };
  guard(); const stop = deps.observeAuth(() => { if (deps.currentUid() !== uid) changed = true; });
  try { return await work(guard); } finally { stop(); }
}
export async function inspectAccountDeletion(uid: string, deps = defaults()) {
  return guarded(uid, deps, async guard => { const result = await deps.call('getAccountDeletionStatus', { uid }); guard(); return parseStatus(result, uid, true); });
}
/** Start requires explicit UI confirmation. Resume checks the durable local/server state before retrying the same account. */
export async function requestAccountDeletion(uid: string, mode: 'start' | 'resume', injected?: AccountDeletionClientDeps): Promise<AccountDeletionStatus> {
  if (!injected && mode === 'start' && !ACCOUNT_DELETION_ENABLED) throw new Error('A eliminação automática está em validação. Contacta o suporte na página de eliminação.');
  const deps = injected ?? defaults();
  return guarded(uid, deps, async guard => {
    let checkpoint = readCheckpoint(uid, deps.storage); guard();
    if (mode === 'resume' && checkpoint?.phase !== 'remote-complete') {
      const status = parseStatus(await deps.call('getAccountDeletionStatus', { uid }), uid, true); guard();
      if (status.status === 'unknown' && !checkpoint) throw failure();
      if (status.status === 'complete') { checkpoint = { ...(checkpoint ?? { v: 1, uid }), phase: 'remote-complete' }; saveCheckpoint(checkpoint, deps.storage); }
    }
    if (checkpoint?.phase !== 'remote-complete') {
      const recoveryToken = checkpoint?.v === 2 ? checkpoint.recoveryToken : (deps.createRecoveryToken ?? createRecoveryToken)();
      if (!accountDeletionRecoveryTokenValid(recoveryToken)) throw failure();
      checkpoint = { v: 2, uid, phase: 'pending', recoveryToken };
      saveCheckpoint(checkpoint, deps.storage); guard(); deps.lockVault(); guard();
      const result = parseStatus(await deps.call('deleteUserAccount', { uid, recoveryToken }), uid); guard();
      if (result.status === 'pending') return result;
      saveCheckpoint({ ...checkpoint, phase: 'remote-complete' }, deps.storage); guard();
    }
    await deps.cleanup(uid, guard); guard();
    deps.storage.removeItem(key(uid)); if (deps.storage.getItem(key(uid)) !== null) throw failure();
    return { uid, status: 'complete', retryAt: null };
  });
}

/** A lost final ACK can be verified without Auth. This endpoint cannot start or resume any remote deletion. */
export async function recoverAccountDeletionWithoutAuth(uid: string, deps = defaults()): Promise<AccountDeletionStatus> {
  if (!attachmentActorIdValid(uid)) throw failure();
  const checkpoint = readCheckpoint(uid, deps.storage);
  if (checkpoint?.v !== 2 || checkpoint.phase !== 'pending') throw failure();
  return guardedLocalRecovery(uid, deps, async guard => {
    const result = parseStatus(await deps.call('getAccountDeletionRecoveryStatus', { uid, recoveryToken: checkpoint.recoveryToken }), uid); guard();
    const current = readCheckpoint(uid, deps.storage);
    if (current?.v !== 2 || current.recoveryToken !== checkpoint.recoveryToken || current.phase !== 'pending') throw failure();
    if (result.status === 'pending') return result;
    saveCheckpoint({ ...checkpoint, phase: 'remote-complete' }, deps.storage); guard();
    await deps.cleanup(uid, guard); guard();
    deps.storage.removeItem(key(uid)); if (deps.storage.getItem(key(uid)) !== null) throw failure();
    return result;
  });
}

async function guardedLocalRecovery<T>(uid: string, deps: AccountDeletionClientDeps, work: (guard: () => void) => Promise<T>) {
  let changed = false;
  const guard = () => { const current = deps.currentUid(); if (changed || (current !== null && current !== uid)) throw failure(); };
  guard(); const stop = deps.observeAuth(() => { if (deps.currentUid() !== null && deps.currentUid() !== uid) changed = true; });
  try { return await work(guard); } finally { stop(); }
}

/** Auth may disappear after remote success. Only a previously acknowledged completion allows offline UID-scoped cleanup. */
export async function finishCompletedLocalAccountDeletion(uid: string, deps = defaults()) {
  if (!attachmentActorIdValid(uid) || readCheckpoint(uid, deps.storage)?.phase !== 'remote-complete') throw failure();
  return guardedLocalRecovery(uid, deps, async guard => {
    await deps.cleanup(uid, guard); guard(); deps.storage.removeItem(key(uid)); if (deps.storage.getItem(key(uid)) !== null) throw failure();
  });
}

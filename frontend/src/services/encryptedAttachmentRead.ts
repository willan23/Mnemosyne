import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { auth, db } from '../firebase';
import { attachmentActorIdValid, attachmentIdValid, parseAttachmentScope, type AttachmentScope } from '../../../functions/src/attachmentEnvelope';
import { attachmentKeyWrapper, openAttachment, personalAttachmentKeyWrapper, type AttachmentKeyWrapper, type OpenAttachmentMetadata } from './attachmentCrypto';
import { getTeamKeyCacheGeneration, onTeamKeyChanged } from './teamVault';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from './memoryCrypto';
import { getLocalAiConfig, type MemoryPermission } from './localAiConfig';
import { authorizeCloudUse } from './cloudUsePolicy';
import { parseTeam } from './teamsService';
import { unlockTeamKey } from './teamKeyAccess';
import { readSessionMnemonic } from '../utils/sessionMnemonic';
const denied = () => new Error('Não foi possível aceder ao anexo.');
export function encryptedAttachmentId(value: string): string | null {
  const match = /^mnemosyne-attachment:v1:([^:]+)$/.exec(value); return match && attachmentIdValid(match[1]) ? match[1] : null;
}
export interface EncryptedAttachmentReadClientDeps {
  uid: () => string | null; ready: () => boolean; policy: () => MemoryPermission; generation: () => number; now: () => number;
  subscribe: (changed: () => void) => () => void;
  mint: (id: string, sessionId: string) => Promise<unknown>;
  wrapper: (scope: AttachmentScope, uid: string) => Promise<AttachmentKeyWrapper>;
  fetch: (url: string, signal: AbortSignal) => Promise<Response>;
}
const defaults = (): EncryptedAttachmentReadClientDeps => ({ uid: () => auth.currentUser?.uid ?? null, ready: isMemoryCryptoReady,
  policy: () => getLocalAiConfig().memoryPermission, generation: getTeamKeyCacheGeneration, now: Date.now,
  subscribe: changed => {
    const uid = auth.currentUser?.uid;
    const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) changed(); });
    const stopVault = onMemoryCryptoChanged(changed); const stopTeam = onTeamKeyChanged(changed);
    window.addEventListener('mnemosyne:local-ai-config', changed); window.addEventListener('storage', changed);
    return () => { stopAuth(); stopVault(); stopTeam(); window.removeEventListener('mnemosyne:local-ai-config', changed); window.removeEventListener('storage', changed); };
  },
  mint: async (id, sessionId) => (await httpsCallable(getFunctions(app, 'europe-west1'), 'mintEncryptedAttachmentReadUrl')({ id, sessionId })).data,
  wrapper: async (scope, uid) => {
    if (scope.kind === 'personal') { if (scope.uid !== uid) throw denied(); return personalAttachmentKeyWrapper; }
    const [snapshot, epochSnapshot] = await Promise.all([getDocFromServer(doc(db, 'teams', scope.teamId)), getDocFromServer(doc(db, 'teams', scope.teamId, 'keyEpochs', String(scope.keyEpoch)))]);
    const team = parseTeam(scope.teamId, snapshot.data() ?? {}); const epoch = epochSnapshot.data();
    if (!team || !team.memberUids.includes(uid) || !team.wrappedKeys[uid] || !epoch || epoch.epoch !== scope.keyEpoch || epoch.keyId !== scope.keyId ||
        !Array.isArray(epoch.memberUids) || !epoch.memberUids.includes(uid) || !epoch.wrappedKeys?.[uid]) throw denied();
    return attachmentKeyWrapper(await unlockTeamKey(team, uid, readSessionMnemonic(), { epoch: scope.keyEpoch, notify: false }));
  },
  fetch: (url, signal) => fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error' }),
});
function parseGrant(value: unknown, id: string, now: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw denied();
  const data = value as { id: string; uid: string; scope: AttachmentScope; bytes: number; bucket: string; generation: string; url: string; expiresAt: number };
  if (data.id !== id || !attachmentActorIdValid(data.uid) || !Number.isSafeInteger(data.bytes) || data.bytes < 1 || data.bytes > 200 * 1024 * 1024 + 8192 ||
      !/^[a-z0-9][a-z0-9.-]{2,62}$/.test(data.bucket) || !/^[1-9][0-9]*$/.test(data.generation) ||
      !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now || data.expiresAt > now + 120_000) throw denied();
  const scope = parseAttachmentScope(data.scope); if (scope.kind === 'personal' && scope.uid !== data.uid) throw denied();
  const url = new URL(data.url);
  if (url.protocol !== 'https:' || url.hostname !== 'storage.googleapis.com' || url.port || url.username || url.password || url.hash ||
      decodeURIComponent(url.pathname) !== `/${data.bucket}/encrypted/${id}` || url.searchParams.has('token') ||
      url.searchParams.get('generation') !== data.generation || url.searchParams.get('response-content-type') !== 'application/octet-stream' ||
      url.searchParams.get('response-content-disposition') !== 'attachment; filename="attachment.bin"' || !url.searchParams.get('X-Goog-Signature')) throw denied();
  return { ...data, scope };
}
/** No remote URL or plaintext is persisted. Caller owns returned bytes and must revoke any derived local preview. */
export async function readEncryptedAttachment(value: string, sessionId: string, deps = defaults()): Promise<{ metadata: OpenAttachmentMetadata; bytes: Uint8Array; expiresAt: number }> {
  const id = encryptedAttachmentId(value); const uid = deps.uid(); const policy = deps.policy(); const generation = deps.generation();
  if (!id || !uid || !attachmentActorIdValid(sessionId) || !deps.ready()) throw denied();
  let changed = false; const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = deps.subscribe(() => { changed = true; controller.abort(); });
  const guard = () => { if (changed || !deps.ready() || deps.uid() !== uid || deps.policy() !== policy || deps.generation() !== generation || controller.signal.aborted) throw denied(); };
  let buffer: Uint8Array<ArrayBuffer> | undefined; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let opened: Awaited<ReturnType<typeof openAttachment>> | undefined; let delivered = false;
  try {
    guard(); authorizeCloudUse({ purpose: 'attachment-storage', provider: 'Firebase / Google Cloud Storage', policy,
      payloadSummary: { bytes: 0, containsAttachment: true, containsMemory: false, containsPrompt: false } }); guard();
    const grant = parseGrant(await deps.mint(id, sessionId), id, deps.now()); guard();
    if (grant.scope.kind === 'personal' && grant.uid !== uid) throw denied();
    const wrapper = await deps.wrapper(grant.scope, uid); guard();
    if (deps.now() >= grant.expiresAt) throw denied();
    timer = setTimeout(() => controller.abort(), Math.min(120_000, grant.expiresAt - deps.now()));
    const response = await deps.fetch(grant.url, controller.signal); guard();
    if (!response.ok || response.redirected || response.status !== 200 || response.headers.get('content-type')?.split(';')[0] !== 'application/octet-stream' ||
        Number(response.headers.get('content-length')) !== grant.bytes || !response.body) throw denied();
    buffer = new Uint8Array(grant.bytes); reader = response.body.getReader(); let used = 0;
    while (true) {
      const chunk = await reader.read(); guard(); if (deps.now() >= grant.expiresAt) throw denied();
      if (chunk.done) break;
      if (!chunk.value || used + chunk.value.byteLength > grant.bytes) throw denied();
      buffer.set(chunk.value, used); used += chunk.value.byteLength;
    }
    if (used !== grant.bytes) throw denied();
    opened = await openAttachment(buffer, { id, uid: grant.uid, scope: grant.scope }, wrapper, guard); guard();
    if (deps.now() >= grant.expiresAt) throw denied();
    delivered = true; return { ...opened, expiresAt: grant.expiresAt };
  } catch { throw denied(); }
  finally { buffer?.fill(0); if (!delivered) opened?.bytes.fill(0); await reader?.cancel().catch(() => undefined); clearTimeout(timer); stop(); controller.abort(); }
}

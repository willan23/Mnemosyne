import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { attachmentKeyWrapper, openAttachment, personalAttachmentKeyWrapper, type AttachmentKeyWrapper, type OpenAttachmentMetadata } from './attachmentCrypto';
import { getCachedTeamKey, getTeamKeyCacheGeneration, onTeamKeyChanged } from './teamVault';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from './memoryCrypto';
import { readUploadCheckpoint, uploadCheckpointDefaults, uploadCheckpointLock, validateCheckpointBytes, type AttachmentUploadCheckpointDeps } from './attachmentUploadCheckpoint';
import type { AttachmentScope } from '../../../functions/src/attachmentEnvelope';

export class AttachmentDraftRecoveryError extends Error {
  constructor() { super('Não foi possível guardar o ficheiro local. O rascunho cifrado foi conservado.'); }
}
export interface AttachmentDraftRecoveryDeps extends AttachmentUploadCheckpointDeps {
  uid: () => string | null; ready: () => boolean; generation: () => number;
  subscribe: (changed: () => void) => () => void;
  localWrapper: (scope: AttachmentScope) => AttachmentKeyWrapper;
  deliver: (bytes: Uint8Array, metadata: OpenAttachmentMetadata, guard: () => void, signal: AbortSignal) => Promise<void>;
}
/** Explicit download only: no preview, cloud authorization, network call or journal deletion. */
async function deliverLocalFile(bytes: Uint8Array, metadata: OpenAttachmentMetadata, guard: () => void, signal: AbortSignal) {
  guard();
  const blob = new Blob([new Uint8Array(bytes).buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  try {
    anchor.href = url;
    const filename = metadata.name.split(/[\\/]/).pop()!;
    anchor.download = Array.from(filename, char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? '_' : char).join('') || 'anexo-recuperado';
    anchor.rel = 'noopener'; document.body.appendChild(anchor); guard(); anchor.click();
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new AttachmentDraftRecoveryError()); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    }); guard();
  } finally { anchor.remove(); URL.revokeObjectURL(url); }
}
function defaults(): AttachmentDraftRecoveryDeps {
  return { ...uploadCheckpointDefaults(), uid: () => auth.currentUser?.uid ?? null, ready: isMemoryCryptoReady, generation: getTeamKeyCacheGeneration,
    subscribe: changed => {
      const uid = auth.currentUser?.uid;
      const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) changed(); });
      const stopVault = onMemoryCryptoChanged(changed); const stopTeam = onTeamKeyChanged(changed);
      window.addEventListener('mnemosyne:local-ai-config', changed); window.addEventListener('storage', changed);
      return () => { stopAuth(); stopVault(); stopTeam(); window.removeEventListener('mnemosyne:local-ai-config', changed); window.removeEventListener('storage', changed); };
    },
    localWrapper: scope => {
      if (scope.kind === 'personal') return personalAttachmentKeyWrapper;
      const key = getCachedTeamKey(scope.teamId, scope.keyEpoch);
      if (!key) throw new AttachmentDraftRecoveryError(); return attachmentKeyWrapper(key);
    }, deliver: deliverLocalFile };
}
/** Restores an expired/unsent draft from verified local ciphertext; never requests a historical team key remotely. */
export async function downloadRecoveredAttachmentDraft(uid: string, id: string, deps = defaults()) {
  const generation = deps.generation(); let changed = false; const controller = new AbortController();
  const stop = deps.subscribe(() => { changed = true; controller.abort(); });
  const guard = () => { if (changed || deps.uid() !== uid || !deps.ready() || deps.generation() !== generation) throw new AttachmentDraftRecoveryError(); };
  try {
    guard(); await deps.exclusive(uploadCheckpointLock(uid, id), async () => {
      const { checkpoint, stored } = await readUploadCheckpoint(uid, id, deps, guard);
      if (checkpoint.phase === 'ready' || !stored.bytes) throw new AttachmentDraftRecoveryError();
      const cipher = await validateCheckpointBytes(checkpoint, stored.bytes, guard);
      const wrapper = deps.localWrapper(checkpoint.header.scope); guard();
      const opened = await openAttachment(cipher, { id, uid, scope: checkpoint.header.scope }, wrapper, guard);
      try { guard(); await deps.deliver(opened.bytes, opened.metadata, guard, controller.signal); guard(); }
      finally { opened.bytes.fill(0); }
    });
  } catch { throw new AttachmentDraftRecoveryError(); }
  finally { stop(); controller.abort(); }
}

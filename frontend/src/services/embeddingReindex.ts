import type { SessionData } from '../hooks/useSessions';
import { embeddingProfile, embeddingProfileSpace, type EmbeddingProfileId } from './embeddingProfile';
import { embeddingServiceForProfile } from './embeddingService';
import { readEmbeddingSelection, writeEmbeddingSelection } from './embeddingSelection';
import { decryptMemoryEnvelope, encryptMemoryFields, isEncryptedMemoryEnvelope,
  isMemoryCryptoReady, onMemoryCryptoChanged } from './memoryCrypto';
import { clearEmbeddingReindexCheckpoints, embeddingReindexStore, type EmbeddingReindexStore, type ReindexKey } from './embeddingReindexStore';

export interface PreparedEmbedding {
  version: 1;
  uid: string;
  memoryId: string;
  space: string;
  sourceDigest: string;
  vector: number[];
}

let running = false;
let active: { uid: string; profile: EmbeddingProfileId; cancel: () => void } | null = null;

function eligible(memory: SessionData | undefined, uid: string): memory is SessionData {
  return !!memory && memory.uid === uid && memory.teamId == null && !memory.teamScopeAmbiguous &&
    (memory.sharedWithIds == null || (Array.isArray(memory.sharedWithIds) && !memory.sharedWithIds.length)) &&
    memory.deletedAt == null && !memory.encLocked && !!memory.text.trim();
}

async function sourceDigest(memory: SessionData): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([memory.text, memory.title ?? null, memory.updatedAt]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Revalidates current ownership/content before a prepared vector can be used. */
export async function readPreparedEmbedding(uid: string, profile: EmbeddingProfileId,
  readCurrent: () => SessionData | undefined, options: { signal: AbortSignal; store?: EmbeddingReindexStore }) {
  let changed = false;
  const stop = onMemoryCryptoChanged(() => { changed = true; });
  const check = () => {
    if (changed || options.signal.aborted || !isMemoryCryptoReady()) throw new Error('Reindex cancelled');
  };
  try {
    check();
    const memory = readCurrent();
    if (!eligible(memory, uid)) return null;
    const space = embeddingProfileSpace(profile);
    const envelope = await (options.store ?? embeddingReindexStore).get([uid, space, memory.id]);
    check();
    if (envelope === undefined) return null;
    if (!isEncryptedMemoryEnvelope(envelope)) throw new Error('Invalid reindex checkpoint');
    const saved = JSON.parse((await decryptMemoryEnvelope(envelope)).text) as PreparedEmbedding;
    check();
    if (saved.version !== 1 || saved.uid !== uid || saved.memoryId !== memory.id || saved.space !== space ||
        !Array.isArray(saved.vector) || saved.vector.length !== embeddingProfile(profile).dimensions ||
        !saved.vector.every(Number.isFinite)) throw new Error('Invalid reindex checkpoint');
    const current = readCurrent();
    if (!eligible(current, uid) || current.id !== memory.id) return null;
    const digest = await sourceDigest(current);
    check();
    // React session objects are immutable. A newer snapshot must be validated by a new read.
    if (readCurrent() !== current || digest !== saved.sourceDigest) return null;
    return saved;
  } finally { stop(); }
}

/** Stages encrypted candidate vectors only. It never changes active vectors or Firestore. */
async function prepare(uid: string, profile: EmbeddingProfileId,
  readCurrent: () => SessionData[], options: {
    signal: AbortSignal;
    store?: EmbeddingReindexStore;
    embed?: (text: string) => Promise<number[]>;
    onProgress?: (progress: { prepared: number; reused: number; skipped: number; total: number }) => void;
  }) {
  if (!uid || !isMemoryCryptoReady()) throw new Error('Unlock the vault before reindexing');
  if (running) throw new Error('A reindex is already running in this tab');
  const space = embeddingProfileSpace(profile);
  const dimensions = embeddingProfile(profile).dimensions;
  const store = options.store ?? embeddingReindexStore;
  const service = embeddingServiceForProfile(profile);
  const embed = options.embed ?? ((text: string) => service.getEmbedding(text));
  let invalidated = false;
  const invalidate = () => { invalidated = true; service.clearCache(); };
  const stop = onMemoryCryptoChanged(invalidate);
  options.signal.addEventListener('abort', invalidate, { once: true });
  const check = () => {
    if (invalidated || options.signal.aborted || !isMemoryCryptoReady()) throw new Error('Reindex cancelled');
  };
  const progress = { prepared: 0, reused: 0, skipped: 0, total: 0 };
  let source: SessionData[] | null = null;
  let byId = new Map<string, SessionData>();
  const currentById = (id: string) => {
    const next = readCurrent();
    if (next !== source) { source = next; byId = new Map(next.map(memory => [memory.id, memory])); }
    return byId.get(id);
  };
  running = true;
  active = { uid, profile, cancel: invalidate };
  try {
    check();
    const ids = [...new Set(readCurrent().map(memory => memory.id))];
    progress.total = ids.length;
    for (const id of ids) {
      check();
      const memory = currentById(id);
      const key: ReindexKey = [uid, space, id];
      if (!eligible(memory, uid)) {
        await store.remove(key);
        progress.skipped++;
      } else {
        const digest = await sourceDigest(memory);
        check();
        const envelope = await store.get(key);
        check();
        let reusable = false;
        if (envelope !== undefined) {
          if (!isEncryptedMemoryEnvelope(envelope)) throw new Error('Invalid reindex checkpoint');
          const saved = JSON.parse((await decryptMemoryEnvelope(envelope)).text) as PreparedEmbedding;
          check();
          if (saved.version !== 1 || saved.uid !== uid || saved.memoryId !== id || saved.space !== space ||
              !Array.isArray(saved.vector) || saved.vector.length !== dimensions || !saved.vector.every(Number.isFinite)) {
            throw new Error('Invalid reindex checkpoint');
          }
          reusable = saved.sourceDigest === digest;
        }
        if (reusable) progress.reused++;
        else {
          const vector = await embed(memory.text);
          check();
          if (vector.length !== dimensions || !vector.every(Number.isFinite)) throw new Error('Invalid reindex vector');
          const latest = currentById(id);
          if (!eligible(latest, uid) || await sourceDigest(latest) !== digest) {
            await store.remove(key);
            progress.skipped++;
          } else {
            check();
            const prepared: PreparedEmbedding = { version: 1, uid, memoryId: id, space, sourceDigest: digest, vector };
            const encrypted = await encryptMemoryFields({ text: JSON.stringify(prepared) });
            check();
            await store.put(key, encrypted);
            check();
            progress.prepared++;
          }
        }
      }
      check();
      options.onProgress?.({ ...progress });
    }
    if (readEmbeddingSelection(uid) === profile) writeEmbeddingSelection(uid, profile);
    return progress;
  } finally {
    running = false;
    active = null;
    stop();
    options.signal.removeEventListener('abort', invalidate);
  }
}

/** Shared lock serializes preparation/discard across tabs for one account. */
export async function prepareEmbeddingReindex(...args: Parameters<typeof prepare>) {
  // Injectable stores support isolated tests; the real persistent adapter requires Web Locks.
  if (args[3].store) return prepare(...args);
  if (!navigator.locks) throw new Error('This browser cannot coordinate reindex checkpoints');
  return navigator.locks.request(`mnemosyne-reindex:${args[0]}`,
    { signal: args[3].signal }, () => prepare(...args));
}

export async function discardEmbeddingReindex(uid: string, profile?: EmbeddingProfileId): Promise<void> {
  if (!uid) throw new Error('Invalid reindex scope');
  const space = profile ? embeddingProfileSpace(profile) : undefined;
  const selected = readEmbeddingSelection(uid);
  writeEmbeddingSelection(uid, !profile || selected === profile ? null : selected);
  if (active?.uid === uid && (!profile || active.profile === profile)) active.cancel();
  // Preparation is unavailable without Web Locks, so no persistent job can race cleanup here.
  const clear = async () => {
    if (!profile || readEmbeddingSelection(uid) === profile) writeEmbeddingSelection(uid, null);
    await clearEmbeddingReindexCheckpoints(uid, space);
  };
  if (!navigator.locks) return clear();
  await navigator.locks.request(`mnemosyne-reindex:${uid}`, clear);
}

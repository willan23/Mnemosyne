import type { SessionData } from '../hooks/useSessions';
import type { EmbeddingProfileId } from './embeddingProfile';
import { readPreparedEmbedding } from './embeddingReindex';
import type { EmbeddingReindexStore } from './embeddingReindexStore';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from './memoryCrypto';
import { onEmbeddingSelectionChanged, writeEmbeddingSelection } from './embeddingSelection';

/** Select only a fully prepared immutable snapshot. Active Firestore vectors remain the rollback source. */
export async function promotePreparedEmbeddings(uid: string, profile: EmbeddingProfileId,
  readCurrent: () => readonly SessionData[], options: { signal: AbortSignal; store?: EmbeddingReindexStore }) {
  if (!uid || !isMemoryCryptoReady()) throw new Error('Unlock the vault before promotion');
  let invalidated = false;
  const invalidate = () => { invalidated = true; };
  const stopCrypto = onMemoryCryptoChanged(invalidate);
  const stopSelection = onEmbeddingSelectionChanged(uid, invalidate);
  const check = () => {
    if (invalidated || options.signal.aborted || !isMemoryCryptoReady()) throw new Error('Promotion cancelled');
  };
  const promote = async () => {
    check();
    const snapshot = readCurrent();
    const eligible = snapshot.filter(memory => memory.uid === uid && memory.teamId == null &&
      !memory.teamScopeAmbiguous && !memory.encLocked && memory.deletedAt == null && !!memory.text.trim() &&
      (memory.sharedWithIds == null || (Array.isArray(memory.sharedWithIds) && !memory.sharedWithIds.length)));
    if (!eligible.length) throw new Error('No eligible memories');
    const byId = new Map(snapshot.map(memory => [memory.id, memory]));
    for (const memory of eligible) {
      check();
      if (readCurrent() !== snapshot) throw new Error('Memories changed during promotion');
      const prepared = await readPreparedEmbedding(uid, profile,
        () => readCurrent() === snapshot ? byId.get(memory.id) : undefined, options);
      if (!prepared) throw new Error('Prepare all current memories before promotion');
    }
    check();
    if (readCurrent() !== snapshot) throw new Error('Memories changed during promotion');
    writeEmbeddingSelection(uid, profile);
    return { selected: profile, verified: eligible.length };
  };
  try {
    if (options.store) return await promote();
    if (!navigator.locks) throw new Error('This browser cannot coordinate index promotion');
    return await navigator.locks.request(`mnemosyne-reindex:${uid}`, { signal: options.signal }, promote);
  } finally { stopCrypto(); stopSelection(); }
}

/** Synchronous rollback also invalidates a promotion that is still validating. */
export function rollbackEmbeddingSelection(uid: string) {
  writeEmbeddingSelection(uid, null);
}

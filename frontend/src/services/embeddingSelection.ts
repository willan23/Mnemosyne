import { embeddingProfileSpace, type EmbeddingProfileId } from './embeddingProfile';

const EVENT = 'mnemosyne:embedding-selection';
const key = (uid: string) => `mnemosyne.embedding.selection.v1.${uid}`;

/** Device-local model preference only; no content, vectors or memory identifiers. */
export function readEmbeddingSelection(uid: string): EmbeddingProfileId | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key(uid)) || 'null');
    if (!saved || saved.uid !== uid || saved.version !== 1 ||
        !['englishPinned', 'multilingualCandidate'].includes(saved.profile) ||
        saved.space !== embeddingProfileSpace(saved.profile)) return null;
    return saved.profile;
  } catch { return null; }
}

export function writeEmbeddingSelection(uid: string, profile: EmbeddingProfileId | null): void {
  if (!uid) throw new Error('Invalid account');
  if (profile === null) localStorage.removeItem(key(uid));
  else localStorage.setItem(key(uid), JSON.stringify({ version: 1, uid, profile,
    space: embeddingProfileSpace(profile), generation: crypto.randomUUID() }));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: uid }));
}

export function onEmbeddingSelectionChanged(uid: string, callback: () => void): () => void {
  const local = (event: Event) => { if ((event as CustomEvent).detail === uid) callback(); };
  const remote = (event: StorageEvent) => { if (event.key === key(uid) || event.key === null) callback(); };
  window.addEventListener(EVENT, local);
  window.addEventListener('storage', remote);
  return () => { window.removeEventListener(EVENT, local); window.removeEventListener('storage', remote); };
}

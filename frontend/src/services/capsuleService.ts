/**
 * Cápsulas públicas cifradas: packs multi-memória + avisos de importação.
 */

import {
  addDoc,
  collection,
  doc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  limit,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';

export const CAPSULE_PACK_MARKER = '[[MNEMOSYNE_CAPSULE_PACK_V1]]';

export interface CapsulePackItem {
  title?: string;
  text: string;
  tags?: string[];
}

export interface CapsulePackPayload {
  v: 1;
  type: 'pack';
  createdAt: number;
  items: CapsulePackItem[];
}

export function isCapsulePackText(text: string): boolean {
  return text.trimStart().startsWith(CAPSULE_PACK_MARKER);
}

export function encodeCapsulePack(items: CapsulePackItem[]): string {
  const payload: CapsulePackPayload = {
    v: 1,
    type: 'pack',
    createdAt: Date.now(),
    items: items
      .filter((i) => i.text?.trim())
      .map((i) => ({
        title: i.title?.trim() || undefined,
        text: i.text.trim(),
        tags: i.tags?.filter(Boolean),
      })),
  };
  return `${CAPSULE_PACK_MARKER}\n${JSON.stringify(payload)}`;
}

export function decodeCapsulePack(text: string): CapsulePackPayload | null {
  if (!isCapsulePackText(text)) return null;
  try {
    const json = text.trim().slice(CAPSULE_PACK_MARKER.length).trim();
    const parsed = JSON.parse(json) as CapsulePackPayload;
    if (parsed?.v !== 1 || parsed.type !== 'pack' || !Array.isArray(parsed.items)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface CapsuleImportNotice {
  id: string;
  ownerUid: string;
  shareId: string;
  titleHint?: string | null;
  importerUid: string;
  itemCount: number;
  createdAt?: number;
  read?: boolean;
}

/** Regista importação e notifica o autor da cápsula (se diferente do importador). */
export async function recordCapsuleImport(params: {
  shareId: string;
  ownerUid: string | null | undefined;
  importerUid: string;
  titleHint?: string | null;
  itemCount?: number;
}): Promise<void> {
  const { shareId, ownerUid, importerUid, titleHint, itemCount = 1 } = params;
  if (!shareId || !importerUid) return;

  try {
    await updateDoc(doc(db, 'shares', shareId), {
      importCount: increment(1),
      lastImportedAt: Date.now(),
    });
  } catch (error) {
    // Rules may block if share is legacy; non-fatal
    console.warn('Unable to bump share importCount:', error);
  }

  if (!ownerUid || ownerUid === importerUid) return;

  try {
    await addDoc(collection(db, 'capsuleImportNotices'), {
      ownerUid,
      shareId,
      titleHint: titleHint || null,
      importerUid,
      itemCount,
      read: false,
      createdAt: Date.now(),
      createdAtServer: serverTimestamp(),
    });
  } catch (error) {
    console.warn('Unable to create capsule import notice:', error);
  }
}

export function watchCapsuleImportNotices(
  ownerUid: string,
  onNotice: (notice: CapsuleImportNotice) => void,
): Unsubscribe {
  // Single-field filter avoids composite index requirement
  const q = query(
    collection(db, 'capsuleImportNotices'),
    where('ownerUid', '==', ownerUid),
    limit(40),
  );

  const seen = new Set<string>();

  return onSnapshot(
    q,
    (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type !== 'added' && change.type !== 'modified') return;
        const data = change.doc.data();
        if (data.read === true) return;
        if (seen.has(change.doc.id)) return;
        seen.add(change.doc.id);
        onNotice({
          id: change.doc.id,
          ownerUid: data.ownerUid,
          shareId: data.shareId,
          titleHint: data.titleHint,
          importerUid: data.importerUid,
          itemCount: typeof data.itemCount === 'number' ? data.itemCount : 1,
          createdAt: data.createdAt,
          read: data.read,
        });
      });
    },
    (error) => {
      console.warn('capsuleImportNotices listener:', error);
    },
  );
}

export async function markCapsuleNoticeRead(noticeId: string): Promise<void> {
  await updateDoc(doc(db, 'capsuleImportNotices', noticeId), { read: true });
}

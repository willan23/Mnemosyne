import { onAuthStateChanged } from 'firebase/auth';
import { collection, limit, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { auth, db } from '../firebase';
import { captureCapsuleNotice, capsuleNoticeSourceBytes, capsuleNoticeIdValid as idValid, capsuleNoticeDigestValid as shaValid, type CapsuleImportNotice } from '../../../functions/src/capsuleNoticeContract';
export { captureCapsuleNotice, capsuleNoticeSourceBytes, type CapsuleImportNotice } from '../../../functions/src/capsuleNoticeContract';

const fail = () => new Error('Não foi possível confirmar o aviso da cápsula.');
export interface CapsuleNoticeClientDeps {
  uid: () => string | null;
  observeAuth: (changed: (uid: string | null) => void) => Unsubscribe;
  subscribe: (uid: string, receive: (rows: { id: string; data: unknown }[], fromCache: boolean) => void, failed: () => void) => Unsubscribe;
  hash: (bytes: string) => Promise<string>;
  call: (command: { v: 1; actorUid: string; noticeId: string; sourceDigest: string }) => Promise<unknown>;
}
const defaults = (): CapsuleNoticeClientDeps => ({
  uid: () => auth.currentUser?.uid ?? null,
  observeAuth: changed => onAuthStateChanged(auth, user => changed(user?.uid ?? null)),
  subscribe: (uid, receive, failed) => onSnapshot(query(collection(db, 'capsuleImportNotices'), where('ownerUid', '==', uid), where('read', '==', false), limit(40)),
    { includeMetadataChanges: true }, snapshot => receive(snapshot.docChanges({ includeMetadataChanges: true }).filter(change => change.type !== 'removed' && !change.doc.metadata.hasPendingWrites)
      .map(change => ({ id: change.doc.id, data: change.doc.data() })), snapshot.metadata.fromCache), failed),
  hash: async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bytes))), byte => byte.toString(16).padStart(2, '0')).join(''),
  call: async command => (await httpsCallable(getFunctions(app, 'europe-west1'), 'acknowledgeCapsuleNotice')(command)).data,
});

export function createCapsuleNoticeService(deps = defaults()) {
  return {
    watch(ownerUid: string, onNotice: (notice: CapsuleImportNotice) => void, failed: () => void = () => {}): Unsubscribe {
      if (!idValid(ownerUid) || deps.uid() !== ownerUid) return () => {};
      let active = true;
      const current = () => active && deps.uid() === ownerUid;
      const stopAuth = deps.observeAuth(uid => { if (uid !== ownerUid) active = false; });
      const seen = new Set<string>();
      const stop = deps.subscribe(ownerUid, (rows, fromCache) => {
        if (!current() || fromCache) return;
        for (const row of rows) {
          if (!current()) return;
          let notice: CapsuleImportNotice; try { notice = captureCapsuleNotice(row.id, row.data); } catch { continue; }
          if (notice.ownerUid !== ownerUid || notice.read || seen.has(notice.id)) continue;
          onNotice(notice); seen.add(notice.id);
        }
      }, () => { if (current()) failed(); });
      return () => { active = false; stop(); stopAuth(); };
    },
    async acknowledge(value: CapsuleImportNotice, guard: () => boolean = () => true): Promise<void> {
      const notice = captureCapsuleNotice(value.id, value), uid = notice.ownerUid;
      let active = deps.uid() === uid;
      const stop = deps.observeAuth(currentUid => { if (currentUid !== uid) active = false; });
      const assertCurrent = () => { if (!active || deps.uid() !== uid || !guard()) throw fail(); };
      try {
        assertCurrent(); const sourceDigest = await deps.hash(capsuleNoticeSourceBytes(notice.id, notice)); assertCurrent();
        if (!shaValid(sourceDigest)) throw fail();
        const result = await deps.call({ v: 1, actorUid: uid, noticeId: notice.id, sourceDigest }); assertCurrent();
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw fail();
        const row = result as Record<string, unknown>;
        if (Object.keys(row).sort().join(',') !== 'acknowledged,actorUid,changed,noticeId,sourceDigest,v' || row.v !== 1 || row.actorUid !== uid ||
          row.noticeId !== notice.id || row.sourceDigest !== sourceDigest || row.acknowledged !== true || typeof row.changed !== 'boolean') throw fail();
      } finally { stop(); }
    },
  };
}
export const watchCapsuleImportNotices = (uid: string, onNotice: (notice: CapsuleImportNotice) => void, failed?: () => void) => createCapsuleNoticeService().watch(uid, onNotice, failed);
export const markCapsuleNoticeRead = (notice: CapsuleImportNotice, guard?: () => boolean) => createCapsuleNoticeService().acknowledge(notice, guard);

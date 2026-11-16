import * as admin from 'firebase-admin';
import { liveAccountInTransaction } from './accountAccess';
import { currentPeriod } from './usage';

/** Hygiene cannot erase current-month charges or recreate a profile removed while a page was being read. */
export async function resetAccountMonthlyUsage(db: FirebaseFirestore.Firestore, uid: string, now = new Date()): Promise<boolean> {
  const period = currentPeriod(now);
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) return false;
    const ref = db.doc(`users/${uid}`); const profile = (await tx.get(ref)).data()!; const usage = profile.usage;
    if (!usage || typeof usage !== 'object' || Array.isArray(usage) || !Number.isSafeInteger(usage.memoriesThisMonth) || usage.memoriesThisMonth <= 0 ||
        (usage.periodYear === period.periodYear && usage.periodMonth === period.periodMonth) ||
        (usage.periodYear > period.periodYear || (usage.periodYear === period.periodYear && usage.periodMonth > period.periodMonth))) return false;
    tx.update(ref, { usage: { ...usage, ...period, memoriesThisMonth: 0, updatedAt: now.getTime() } }); return true;
  });
}

/** Bounded scan progresses past unchanged/deleting profiles; incomplete scans are reported explicitly. */
export async function resetMonthlyUsagePages(db: FirebaseFirestore.Firestore, now = new Date(), maxPages = 500) {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null; let reset = 0; let scanned = 0;
  for (let page = 0; page < maxPages; page++) {
    const base = db.collection('users').orderBy(admin.firestore.FieldPath.documentId());
    const rows = await (cursor ? base.startAfter(cursor) : base).limit(100).get();
    if (rows.empty) return { reset, scanned, complete: true };
    for (let offset = 0; offset < rows.docs.length; offset += 10) {
      const results = await Promise.all(rows.docs.slice(offset, offset + 10).map(row => resetAccountMonthlyUsage(db, row.id, now)));
      reset += results.filter(Boolean).length;
    }
    scanned += rows.size; cursor = rows.docs[rows.docs.length - 1];
    if (rows.size < 100) return { reset, scanned, complete: true };
  }
  const remaining = cursor ? await db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).startAfter(cursor).limit(1).get() : null;
  return { reset, scanned, complete: remaining?.empty === true };
}

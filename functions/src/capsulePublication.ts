import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { createHash } from 'node:crypto';
import { attachmentActorIdValid } from './attachmentEnvelope';
import { liveAccountInTransaction } from './accountAccess';
import { consumeServerRateLimit } from './rateLimit';
import { teamRevisionAccess, teamRevisionParent } from './teamRevisions';
import { parseTeamRevisionCipher, teamRevisionTime } from './teamRevisionContract';
import { publicCapsuleRecord, publicCapsuleTimeValid } from './publicCapsuleContract';
import { captureCapsulePublication, capsulePublicationBytes, CAPSULE_MAX_LIFETIME_MS, type CapsulePublicationMode, type CapsulePublicationOutcome } from './capsulePublicationContract';

if (!admin.apps.length) admin.initializeApp();
export const CAPSULE_PUBLICATION_ENABLED = false;
const DAY = 86400000;
export const CAPSULE_PUBLICATION_LIMITS = { operations: 40, publications: 20, cipherBytes: 10 * 1024 * 1024 } as const;
export interface CapsulePublicationDeps { firestore: FirebaseFirestore.Firestore; auth: Pick<admin.auth.Auth, 'getUser'>; now: () => number; enabled: () => boolean }
const defaults = (): CapsulePublicationDeps => ({ firestore: admin.firestore(), auth: admin.auth(), now: Date.now, enabled: () => CAPSULE_PUBLICATION_ENABLED });
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code, 'Capsule publication unavailable');

/** A publication is a frozen external copy. It never proves authorship or retracts downloaded copies. */
export async function executeCapsulePublication(uid: string, value: unknown, mode: CapsulePublicationMode, deps = defaults()): Promise<CapsulePublicationOutcome> {
  let input; try { input = captureCapsulePublication(value); } catch { throw fail('invalid-argument'); }
  if (!attachmentActorIdValid(uid) || input.actorUid !== uid) throw fail('permission-denied');
  if (!['publish', 'status', 'cancel'].includes(mode)) throw fail('invalid-argument');
  const digest = createHash('sha256').update(capsulePublicationBytes(input)).digest('hex');
  try { const actor = await deps.auth.getUser(uid); if (actor.uid !== uid || actor.disabled) throw Error(); } catch { throw fail('permission-denied'); }
  const db = deps.firestore, receiptRef = db.doc(`capsulePublications/${input.publicationId}`), shareRef = db.doc(`shares/${input.publicationId}`);
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
    const [receipt, share] = await tx.getAll(receiptRef, shareRef), row = receipt.data(), now = deps.now();
    if (!publicCapsuleTimeValid(now)) throw fail();
    const outcome: CapsulePublicationOutcome = { v: 1, actorUid: uid, publicationId: input.publicationId, digest, status: 'unknown', createdAt: null, expiresAt: input.expiresAt };
    if (row) {
      if (row.v !== 1 || row.uid !== uid || row.publicationId !== input.publicationId || row.digest !== digest || row.capsuleExpiresAt !== input.expiresAt ||
        !['committed', 'cancelled'].includes(row.status) || !publicCapsuleTimeValid(row.createdAt)) throw fail('permission-denied');
      if (row.status === 'cancelled') {
        if (share.exists) throw fail();
        return { ...outcome, status: 'cancelled', createdAt: row.createdAt };
      }
      const current = share.data();
      if (current && (current.uid !== uid || current.publicationDigest !== digest)) throw fail();
      return { ...outcome, createdAt: row.createdAt, status: !current || current.revokedAt != null ? 'withdrawn' : input.expiresAt <= now ? 'expired' : 'committed' };
    }
    if (mode === 'status') return outcome;
    if (input.expiresAt <= now) return { ...outcome, status: 'expired' };
    if (input.expiresAt > now + CAPSULE_MAX_LIFETIME_MS) throw fail('invalid-argument');
    if (share.exists) throw fail('already-exists');
    if (mode === 'publish' && !deps.enabled()) throw fail();
    if (mode === 'publish') {
      const teamId = input.sources[0].teamId, access = teamId === null ? null : await teamRevisionAccess(tx, db, uid, teamId);
      if (access?.revoked) throw fail('permission-denied');
      const snapshots = await tx.getAll(...input.sources.map(source => db.doc(`sessions/${source.sessionId}`)));
      for (let index = 0; index < snapshots.length; index++) {
        const data = snapshots[index].data(), source = input.sources[index];
        if (!data || data.teamId !== teamId || data.deletedAt != null || data.teamScopeAmbiguous === true ||
          teamRevisionTime(data.updatedAt ?? data.timestamp) !== source.revision || !attachmentActorIdValid(data.uid) || !await liveAccountInTransaction(tx, db, data.uid, false)) throw fail('permission-denied');
        if (teamId === null) {
          let enc; try { enc = parseTeamRevisionCipher(data.enc); } catch { throw fail(); }
          if (data.uid !== uid || enc.v !== 1 || data.text !== '' || data.title != null) throw fail('permission-denied');
        } else {
          if (!access || access.revoked) throw fail('permission-denied');
          teamRevisionParent(snapshots[index], teamId, access.row.activeKeyEpoch);
        }
      }
    }
    const day = Math.floor(now / DAY), budgetRef = db.doc(`capsulePublicationBudgets/${uid}_${day}`), budget = (await tx.get(budgetRef)).data();
    if (budget && (budget.v !== 1 || budget.uid !== uid || budget.day !== day ||
      ['operations', 'publications', 'cipherBytes'].some(key => !Number.isSafeInteger(budget[key]) || budget[key] < 0))) throw fail('resource-exhausted');
    const bytes = mode === 'publish' ? Buffer.byteLength(JSON.stringify(input.ciphertext), 'utf8') : 0;
    const next = { operations: (budget?.operations ?? 0) + 1, publications: (budget?.publications ?? 0) + (mode === 'publish' ? 1 : 0), cipherBytes: (budget?.cipherBytes ?? 0) + bytes };
    if (next.operations > CAPSULE_PUBLICATION_LIMITS.operations || next.publications > CAPSULE_PUBLICATION_LIMITS.publications || next.cipherBytes > CAPSULE_PUBLICATION_LIMITS.cipherBytes) throw fail('resource-exhausted');
    const status = mode === 'publish' ? 'committed' as const : 'cancelled' as const;
    tx.set(budgetRef, { v: 1, uid, day, ...next, expiresAt: admin.firestore.Timestamp.fromMillis((day + 3) * DAY) });
    tx.create(receiptRef, { v: 1, uid, publicationId: input.publicationId, digest, status, createdAt: now, capsuleExpiresAt: input.expiresAt,
      expiresAt: admin.firestore.Timestamp.fromMillis(input.expiresAt + DAY) });
    if (mode === 'publish') tx.create(shareRef, { uid, sessionId: input.sources[0].sessionId, sourceIds: input.sources.map(source => source.sessionId),
      encrypted: true, ciphertext: input.ciphertext, pack: input.sources.length > 1, itemCount: input.sources.length, createdAt: now, expiresAt: input.expiresAt,
      views: 0, importCount: 0, publicationDigest: digest, retireAt: admin.firestore.Timestamp.fromMillis(input.expiresAt + 2 * DAY) });
    return { ...outcome, status, createdAt: now };
  });
}
export const mutateCapsulePublication = functions.runWith({ maxInstances: 3, timeoutSeconds: 30, memory: '256MB' }).region('europe-west1').https.onCall(async (value, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated');
  const uid = context.auth.uid;
  let call; try { const row = publicCapsuleRecord(value, ['mode', 'request']); call = { mode: row.mode, request: captureCapsulePublication(row.request) }; } catch { throw fail('invalid-argument'); }
  if (!['publish', 'status', 'cancel'].includes(call.mode as string)) throw fail('invalid-argument');
  if (call.request.actorUid !== uid) throw fail('permission-denied');
  if (!(await consumeServerRateLimit(`uid:${uid}`, { bucket: `capsule-publication-${call.mode}`, max: 120, windowMs: 60000 })).allowed) throw fail('resource-exhausted');
  return executeCapsulePublication(uid, call.request, call.mode as CapsulePublicationMode);
});

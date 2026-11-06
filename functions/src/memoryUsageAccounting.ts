import { nextUsageAfterMemoryCreate } from './usage';
import { attachmentActorIdValid } from './attachmentEnvelope';
/** A receipt prevents redelivery or an atomic initial create from charging usage twice. */
export async function accountCreatedSessionUsage(db: FirebaseFirestore.Firestore, sessionId: string, uid: string, now = Date.now(),
  expectedCreateTime?: { seconds: number; nanoseconds: number }) {
  if (!attachmentActorIdValid(uid) || !attachmentActorIdValid(sessionId) || !Number.isSafeInteger(now) || now < 1) return;
  if (expectedCreateTime && (!Number.isSafeInteger(expectedCreateTime.seconds) || !Number.isSafeInteger(expectedCreateTime.nanoseconds) ||
      expectedCreateTime.nanoseconds < 0 || expectedCreateTime.nanoseconds > 999_999_999)) return;
  const user = db.doc(`users/${uid}`); const receipt = db.doc(`memoryUsageReceipts/${sessionId}`);
  await db.runTransaction(async tx => {
    const [profile, existing, deletion, session] = await tx.getAll(user, receipt, db.doc(`accountDeletions/${uid}`), db.doc(`sessions/${sessionId}`));
    if (existing.exists) {
      if (existing.data()?.uid !== uid || existing.data()?.sessionId !== sessionId) throw new Error('Memory usage receipt mismatch'); return;
    }
    if (!profile.exists || profile.data()?.deletionState === 'deleting' || deletion.exists || !session.exists || session.data()?.uid !== uid ||
        session.data()?.deletedAt != null || (expectedCreateTime && (session.createTime?.seconds !== expectedCreateTime.seconds ||
          session.createTime?.nanoseconds !== expectedCreateTime.nanoseconds))) return;
    const teamId = session.data()?.teamId;
    if (teamId != null) {
      if (!attachmentActorIdValid(teamId)) return;
      const team = await tx.get(db.doc(`teams/${teamId}`));
      if (!team.exists || team.data()?.deletionState === 'deleting' || !Array.isArray(team.data()?.memberUids) || !team.data()!.memberUids.includes(uid)) return;
    }
    const usage = nextUsageAfterMemoryCreate(profile.data()?.usage, new Date(now));
    tx.update(user, { usage: { ...usage, updatedAt: now } });
    tx.create(receipt, { v: 1, uid, sessionId, ...usage, createdAt: now });
  });
}

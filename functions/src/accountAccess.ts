import * as admin from 'firebase-admin';
import { attachmentActorIdValid } from './attachmentEnvelope';

/** Consistent metadata snapshot. The permanent marker remains authoritative after profile removal. */
export async function liveAccountInTransaction(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, uid: string, requireProfile = true): Promise<boolean> {
  if (!attachmentActorIdValid(uid)) return false;
  const [profile, deletion] = await tx.getAll(db.doc(`users/${uid}`), db.doc(`accountDeletions/${uid}`));
  return !deletion.exists && profile.data()?.deletionState !== 'deleting' && (!requireProfile || profile.exists);
}
export async function isLiveAccount(uid: string, db = admin.firestore()): Promise<boolean> {
  if (!attachmentActorIdValid(uid)) return false;
  try { return await db.runTransaction(tx => liveAccountInTransaction(tx, db, uid)); }
  catch { return false; }
}

export class AccountUnavailableError extends Error {
  constructor() { super('Conta indisponível.'); this.name = 'AccountUnavailableError'; }
}
/** Check both boundaries; an already dispatched external request cannot be recalled. */
export async function withLiveAccount<T>(uid: string, operation: () => Promise<T>, check = isLiveAccount): Promise<T> {
  if (!await check(uid)) throw new AccountUnavailableError();
  const result = await operation();
  if (!await check(uid)) throw new AccountUnavailableError();
  return result;
}

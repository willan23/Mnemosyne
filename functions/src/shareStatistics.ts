import * as functions from 'firebase-functions/v1';
import { attachmentActorIdValid } from './attachmentEnvelope';

/** Retired unbound counters. Openings use receipts; importCount is derived by import completion. */
export async function recordLiveShareStatistic(uid: string, input: unknown, kind: 'view' | 'conversion', db: FirebaseFirestore.Firestore) {
  const shareId = input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).join(',') === 'shareId'
    ? (input as { shareId?: unknown }).shareId : null;
  if (!attachmentActorIdValid(uid) || !attachmentActorIdValid(shareId)) throw new functions.https.HttpsError('invalid-argument', 'Invalid share request');
  void kind; void db;
  throw new functions.https.HttpsError('failed-precondition', 'Legacy share counter unavailable');
}

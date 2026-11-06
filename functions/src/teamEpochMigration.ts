import { FieldPath } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { attachmentActorIdValid } from './attachmentEnvelope';
import { parseWrappedKeyEnvelope, type WrappedKeyEnvelope } from './teams';

export interface TeamEpochMigrationResult {
  scanned: number;
  eligible: number;
  migrated: number;
  skipped: number;
  failed: number;
}

interface LegacyTeamKeys {
  memberUids: string[];
  wrappedKeys: Record<string, WrappedKeyEnvelope>;
}

/** Refuse partial or malformed teams rather than activating an incomplete epoch. */
export function readLegacyTeamKeys(data: FirebaseFirestore.DocumentData): LegacyTeamKeys | null {
  if (!attachmentActorIdValid(data.ownerUid) || !Array.isArray(data.memberUids) ||
      data.memberUids.length < 1 || data.memberUids.length > 10 ||
      data.memberUids.some((uid: unknown) => !attachmentActorIdValid(uid)) ||
      new Set(data.memberUids).size !== data.memberUids.length ||
      !data.memberUids.includes(data.ownerUid) ||
      !data.wrappedKeys || typeof data.wrappedKeys !== 'object' || Array.isArray(data.wrappedKeys)) return null;
  const raw = data.wrappedKeys as Record<string, unknown>;
  const members = data.memberUids as string[];
  if (Object.keys(raw).length !== members.length ||
      Object.keys(raw).some((uid) => !members.includes(uid))) return null;
  try {
    const wrappedKeys = Object.fromEntries(members.map(uid => [uid, parseWrappedKeyEnvelope(raw[uid])]));
    return { memberUids: members, wrappedKeys };
  } catch {
    return null;
  }
}

function migrationCandidate(data: FirebaseFirestore.DocumentData): LegacyTeamKeys | null {
  if (data.activeKeyId !== undefined || data.keyRotationStatus !== undefined || data.pendingRotationId != null ||
      data.deletionState === 'deleting' || data.status === 'deleting' || data.deletedAt != null) return null;
  return readLegacyTeamKeys(data);
}

async function hasDeletionFence(
  db: FirebaseFirestore.Firestore,
  teamId: string,
  members: string[],
  tx?: FirebaseFirestore.Transaction,
): Promise<boolean> {
  const markers = [db.doc(`teamDeletions/${teamId}`), ...members.map(uid => db.doc(`accountDeletions/${uid}`))];
  const profiles = members.map(uid => db.doc(`users/${uid}`));
  const refs = [...markers, ...profiles];
  const snapshots = await (tx ? tx.getAll(...refs) : db.getAll(...refs));
  return snapshots.slice(0, markers.length).some(row => row.exists) ||
    snapshots.slice(markers.length).some(row => row.get('deletionState') === 'deleting');
}

export async function migrateLegacyTeamEpochs(
  db: FirebaseFirestore.Firestore,
  options: { apply?: boolean; pageSize?: number; now?: number } = {},
): Promise<TeamEpochMigrationResult> {
  const pageSize = Number.isSafeInteger(options.pageSize) && (options.pageSize as number) > 0
    ? Math.min(200, options.pageSize as number) : 100;
  const now = options.now ?? Date.now();
  const result: TeamEpochMigrationResult = { scanned: 0, eligible: 0, migrated: 0, skipped: 0, failed: 0 };
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    const base = db.collection('teams').orderBy(FieldPath.documentId()).limit(pageSize);
    const page: FirebaseFirestore.QuerySnapshot = await (cursor ? base.startAfter(cursor) : base).get();
    for (const snapshot of page.docs) {
      result.scanned += 1;
      const data = snapshot.data();
      if (data.activeKeyEpoch !== undefined) {
        result.skipped += 1;
        continue;
      }
      const candidate = migrationCandidate(data);
      if (!candidate || await hasDeletionFence(db, snapshot.id, candidate.memberUids)) {
        result.failed += 1;
        continue;
      }
      const epochRef = snapshot.ref.collection('keyEpochs').doc('1');
      if ((await epochRef.get()).exists) {
        result.failed += 1;
        continue;
      }
      result.eligible += 1;
      if (!options.apply) continue;
      const keyId = randomUUID();
      try {
        const outcome = await db.runTransaction(async (tx): Promise<'migrated' | 'skipped' | 'failed'> => {
          const fresh: FirebaseFirestore.DocumentSnapshot = await tx.get(snapshot.ref);
          const priorEpoch: FirebaseFirestore.DocumentSnapshot = await tx.get(epochRef);
          if (!fresh.exists) return 'skipped';
          const current = fresh.data() || {};
          if (current.activeKeyEpoch !== undefined) return 'skipped';
          const keys = migrationCandidate(current);
          if (priorEpoch.exists || !keys || await hasDeletionFence(db, snapshot.id, keys.memberUids, tx)) return 'failed';
          tx.create(epochRef, {
            epoch: 1, keyId, status: 'active', memberUids: keys.memberUids,
            wrappedKeys: keys.wrappedKeys, createdAt: now, activatedAt: now,
            retiredAt: null, reason: 'team_created', rotationId: `migration-${keyId}`,
          });
          tx.update(snapshot.ref, {
            activeKeyEpoch: 1, activeKeyId: keyId, keyRotationStatus: 'active',
            pendingRotationId: null, nextRotationDueAt: now + 90 * 86_400_000,
            updatedAt: now,
          });
          return 'migrated';
        });
        result[outcome] += 1;
      } catch {
        result.failed += 1;
      }
    }
    if (page.size < pageSize) break;
    cursor = page.docs[page.docs.length - 1];
  }
  return result;
}

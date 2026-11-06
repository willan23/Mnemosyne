import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import { liveAccountInTransaction } from './accountAccess';

type SnapshotData = Record<string, unknown> | undefined;
export type MemoryEventKind = 'write' | 'update' | 'delete' | 'index'
    | 'relation-suggested' | 'relation-accepted' | 'relation-rejected';

// Classify persisted changes, never inferred intent or an unconfirmed client action.
export function sessionEventKinds(before: SnapshotData, after: SnapshotData): MemoryEventKind[] {
    if (!before && !after) return [];
    const kinds: MemoryEventKind[] = [];
    if (!after || (after.deletedAt != null && before?.deletedAt == null)) kinds.push('delete');
    else if (!before) kinds.push('write');
    else if (!isDeepStrictEqual(before, after)) kinds.push('update');
    if (after && after.deletedAt == null && Array.isArray(after.embedding) && after.embedding.length > 0
        && (!isDeepStrictEqual(before?.embedding, after.embedding)
            || before?.embeddingModel !== after.embeddingModel)) kinds.push('index');
    return kinds;
}

export function relationEventKinds(before: SnapshotData, after: SnapshotData): MemoryEventKind[] {
    if (!after || isDeepStrictEqual(before, after)) return [];
    if (after.status === 'suggested') return ['relation-suggested'];
    if (before?.status === 'suggested' && after.status === 'accepted') return ['relation-accepted'];
    if (before?.status === 'suggested' && after.status === 'rejected') return ['relation-rejected'];
    return [];
}

export interface MemoryLedgerInput {
    eventId: string;
    occurredAt: string;
    memoryId: string;
    kinds: MemoryEventKind[];
    targetId?: string;
}

/** At-least-once delivery is deduplicated; deletion marker and writes share a transaction. */
export async function recordMemoryEvents(
    db: FirebaseFirestore.Firestore, uid: string, input: MemoryLedgerInput,
): Promise<void> {
    if (!uid || !input.kinds.length) return;
    const user = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
        if (!await liveAccountInTransaction(tx, db, uid)) return;
        const profile = await tx.get(user);
        if (!profile.exists || profile.data()?.deletionState === 'deleting') return;
        const refs = input.kinds.map((kind) => user.collection('memoryEvents').doc(
            createHash('sha256').update(JSON.stringify([input.eventId, kind])).digest('hex'),
        ));
        const existing = await tx.getAll(...refs);
        refs.forEach((ref, index) => {
            if (existing[index].exists) return;
            // Explicit allowlist: never spread a session, proposal, query, vector or error.
            tx.create(ref, {
                schemaVersion: 1,
                kind: input.kinds[index],
                memoryId: input.memoryId,
                ...(input.targetId ? { targetId: input.targetId } : {}),
                occurredAt: input.occurredAt,
                recordedAt: FieldValue.serverTimestamp(),
                source: 'firestore',
            });
        });
    });
}

const regional = functions.region('europe-west1').runWith({ failurePolicy: true });

/** One event per prepared API result, before response delivery; no query or document IDs. */
export async function recordMemoryRetrieval(
    db: FirebaseFirestore.Firestore, uid: string, operation: 'list' | 'get' | 'search', resultCount: number,
): Promise<void> {
    if (!Number.isInteger(resultCount) || resultCount < 0 || resultCount > 100) {
        throw new Error('Invalid retrieval count');
    }
    const user = db.collection('users').doc(uid);
    const ref = user.collection('memoryEvents').doc(randomUUID());
    await db.runTransaction(async (tx) => {
        if (!await liveAccountInTransaction(tx, db, uid)) return;
        const profile = await tx.get(user);
        if (!profile.exists || profile.data()?.deletionState === 'deleting') return;
        tx.create(ref, {
            schemaVersion: 1, kind: 'retrieve', operation, resultCount,
            occurredAt: new Date().toISOString(),
            recordedAt: FieldValue.serverTimestamp(), source: 'api-v1',
        });
    });
}

export const onSessionLedgerWrite = regional.firestore.document('sessions/{memoryId}')
    .onWrite(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const uid = after?.uid ?? before?.uid;
        if (typeof uid !== 'string') return;
        await recordMemoryEvents(admin.firestore(), uid, {
            eventId: context.eventId, occurredAt: context.timestamp,
            memoryId: context.params.memoryId, kinds: sessionEventKinds(before, after),
        });
    });

export const onRelationLedgerWrite = regional.firestore
    .document('sessions/{memoryId}/relationSuggestions/{targetId}')
    .onWrite(async (change, context) => {
        const kinds = relationEventKinds(change.before.data(), change.after.data());
        if (!kinds.length) return;
        const db = admin.firestore();
        const session = await db.collection('sessions').doc(context.params.memoryId).get();
        const uid = session.data()?.uid;
        if (typeof uid !== 'string') return;
        await recordMemoryEvents(db, uid, {
            eventId: context.eventId, occurredAt: context.timestamp,
            memoryId: context.params.memoryId, targetId: context.params.targetId, kinds,
        });
    });

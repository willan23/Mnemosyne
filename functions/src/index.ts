import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { OwnerAckState, tombstoneAckedByAllActiveDevices } from './mobileSyncRetention';

// Initialize Firebase Admin
admin.initializeApp();

const db = admin.firestore();
const regionalFunctions = functions.region('europe-west1');
const MOBILE_SYNC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const getRuntimeConfig = (): Record<string, any> => {
    const compatFunctions = functions as unknown as { config?: () => Record<string, any> };
    return typeof compatFunctions.config === 'function' ? compatFunctions.config() : {};
};

const deleteRefsInBatches = async (refs: FirebaseFirestore.DocumentReference[]): Promise<void> => {
    let batch = db.batch();
    let operationCount = 0;

    for (const ref of refs) {
        batch.delete(ref);
        operationCount += 1;

        if (operationCount >= 450) {
            await batch.commit();
            batch = db.batch();
            operationCount = 0;
        }
    }

    if (operationCount > 0) {
        await batch.commit();
    }
};

const loadOwnerAckState = async (ownerUid: string): Promise<OwnerAckState> => {
    const trustedSnapshot = await db.collection('trustedDevices')
        .where('ownerUid', '==', ownerUid)
        .get();
    const activeDeviceIds = trustedSnapshot.docs
        .map((trustedDoc) => trustedDoc.data())
        .filter((device) => device.status === 'active' && typeof device.deviceId === 'string')
        .map((device) => device.deviceId as string);

    const envelopesSnapshot = await db.collection('mobileSyncEnvelopes')
        .where('ownerUid', '==', ownerUid)
        .get();
    const pulledTombstonesByDevice = new Map<string, Set<string>>();

    for (const envelopeDoc of envelopesSnapshot.docs) {
        const envelope = envelopeDoc.data();
        if (
            envelope.status !== 'pulled' ||
            envelope.direction !== 'desktop-to-mobile' ||
            typeof envelope.deviceId !== 'string' ||
            !Array.isArray(envelope.tombstoneIds)
        ) {
            continue;
        }

        const ackedIds = pulledTombstonesByDevice.get(envelope.deviceId) || new Set<string>();
        envelope.tombstoneIds
            .filter((memoryId): memoryId is string => typeof memoryId === 'string')
            .forEach((memoryId) => ackedIds.add(memoryId));
        pulledTombstonesByDevice.set(envelope.deviceId, ackedIds);
    }

    return { activeDeviceIds, pulledTombstonesByDevice };
};

// Export Stripe functions
export {
    createCheckoutSession,
    createBillingPortalSession,
    getSubscriptionStatus,
    handleStripeWebhook
} from './stripe';

export const cleanupMobileSyncRetention = regionalFunctions.pubsub
    .schedule('every 24 hours')
    .timeZone('Europe/Lisbon')
    .onRun(async () => {
        const cutoff = Date.now() - MOBILE_SYNC_RETENTION_MS;
        const staleEnvelopeSnapshot = await db.collection('mobileSyncEnvelopes')
            .where('expiresAt', '<', cutoff)
            .limit(500)
            .get();
        const envelopeDeletes = staleEnvelopeSnapshot.docs
            .filter((envelopeDoc) => {
                const envelope = envelopeDoc.data();
                const isTerminal = envelope.status === 'pulled' || envelope.status === 'failed';
                const staleByExpiry = typeof envelope.expiresAt === 'number' && envelope.expiresAt < cutoff;
                const staleByPulledAt = typeof envelope.pulledAt === 'number' && envelope.pulledAt < cutoff;
                return isTerminal && (staleByExpiry || staleByPulledAt);
            })
            .map((envelopeDoc) => envelopeDoc.ref);

        const staleTombstoneSnapshot = await db.collection('sessions')
            .where('deletedAt', '<', cutoff)
            .limit(500)
            .get();
        const ownerAckStateCache = new Map<string, Promise<OwnerAckState>>();
        const tombstoneDeletes: FirebaseFirestore.DocumentReference[] = [];
        let retainedTombstones = 0;

        for (const tombstoneDoc of staleTombstoneSnapshot.docs) {
            const tombstone = tombstoneDoc.data();
            if (
                typeof tombstone.uid !== 'string' ||
                (Array.isArray(tombstone.tags) && tombstone.tags.includes('sync-conflict'))
            ) {
                continue;
            }

            if (!ownerAckStateCache.has(tombstone.uid)) {
                ownerAckStateCache.set(tombstone.uid, loadOwnerAckState(tombstone.uid));
            }
            const ackState = await ownerAckStateCache.get(tombstone.uid);
            if (ackState && tombstoneAckedByAllActiveDevices(tombstoneDoc.id, tombstone.deletedByDeviceId, ackState)) {
                tombstoneDeletes.push(tombstoneDoc.ref);
            } else {
                retainedTombstones += 1;
            }
        }

        await deleteRefsInBatches(envelopeDeletes);
        await deleteRefsInBatches(tombstoneDeletes);
        console.log(`Mobile sync retention: deleted ${envelopeDeletes.length} envelope(s), ${tombstoneDeletes.length} tombstone(s), retained ${retainedTombstones} tombstone(s).`);
        return null;
    });

/**
 * Cloud Function triggered when a new session is created
 * Extracts knowledge graph and updates the session document
 */
export const processMemoryKG = functions.firestore
    .document('sessions/{sessionId}')
    .onCreate(async (snap, context) => {
        // [DEPRECATION NOTICE: Zero-Knowledge Architecture Migration]
        // This cloud-based extraction has been disabled to prevent sending
        // unencrypted user memories to OpenAI/Gemini endpoints.
        // Extraction is now handled locally entirely in the client's browser
        // via Xenova/transformers.js BEFORE adding the document, ensuring E2EE.
        console.log(`🔒 Cloud extraction disabled for E2EE compliance. Client will handle extraction.`);
        return null;
    });

/**
 * Track share view
 */
export const trackShareView = functions.https.onCall(async (data: { shareId: string }) => {
    try {
        const shareRef = db.collection('shares').doc(data.shareId);
        await shareRef.update({
            views: admin.firestore.FieldValue.increment(1),
            lastViewedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { success: true };
    } catch (error) {
        console.error('❌ Error tracking view:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

/**
 * Track conversion (when someone creates account after viewing share)
 */
export const trackConversion = functions.https.onCall(async (data: { shareId: string }) => {
    try {
        const shareRef = db.collection('shares').doc(data.shareId);
        await shareRef.update({
            conversions: admin.firestore.FieldValue.increment(1)
        });
        return { success: true };
    } catch (error) {
        console.error('❌ Error tracking conversion:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

/**
 * Trigger when a session is shared
 */
export const onMemoryShared = functions.firestore
    .document('shares/{shareId}')
    .onCreate(async (snap, context) => {
        console.log(`📤 Memory shared: ${context.params.shareId}`);

        // Could send notification, analytics, etc.
        return null;
    });

/**
 * Delete user account and all associated data
 */
/**
 * Delete user account and all associated data
 */
export const deleteUserAccount = functions.https.onCall(async (data, context) => {
    // Check authentication
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'User must be authenticated to delete account'
        );
    }

    const uid = context.auth.uid;
    console.log(`🗑️ Deleting account for user: ${uid}`);

    try {
        const batch = admin.firestore().batch();
        let deletedCount = 0;

        // Delete all sessions
        const sessionsSnapshot = await admin.firestore()
            .collection('sessions')
            .where('uid', '==', uid)
            .get();

        sessionsSnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
            deletedCount++;
        });
        console.log(`📝 Deleting ${sessionsSnapshot.size} sessions`);

        // Delete all shares (need to get session IDs first)
        if (sessionsSnapshot.size > 0) {
            const sessionIds = sessionsSnapshot.docs.map(d => d.id);
            // Firestore 'in' query limited to 10 items, so batch if needed
            for (let i = 0; i < sessionIds.length; i += 10) {
                const batchIds = sessionIds.slice(i, i + 10);
                const sharesSnapshot = await admin.firestore()
                    .collection('shares')
                    .where('sessionId', 'in', batchIds)
                    .get();

                sharesSnapshot.docs.forEach(doc => {
                    batch.delete(doc.ref);
                    deletedCount++;
                });
            }
        }

        // Delete all notifications
        const notificationsSnapshot = await admin.firestore()
            .collection('notifications')
            .where('uid', '==', uid)
            .get();

        notificationsSnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
            deletedCount++;
        });
        console.log(`🔔 Deleting ${notificationsSnapshot.size} notifications`);

        // Delete user profile
        const userDoc = admin.firestore().collection('users').doc(uid);
        batch.delete(userDoc);
        deletedCount++;

        // Commit all deletions
        await batch.commit();
        console.log(`✅ Deleted ${deletedCount} documents from Firestore`);

        // Delete Firebase Auth user
        await admin.auth().deleteUser(uid);
        console.log(`✅ Deleted Firebase Auth user: ${uid}`);

        return {
            success: true,
            deletedDocuments: deletedCount,
            message: 'Account and all data deleted successfully'
        };
    } catch (error) {
        console.error('❌ Error deleting account:', error);
        throw new functions.https.HttpsError(
            'internal',
            'Failed to delete account',
            error instanceof Error ? error.message : 'Unknown error'
        );
    }
});


/**
 * Admin-only reviewer flag. This does not create Stripe subscriptions.
 */
export const grantReviewerAccess = functions.https.onCall(async (data, context) => {
    const { email, secret } = data;
    const reviewerSecret = getRuntimeConfig().reviewer?.secret;

    if (!reviewerSecret) {
        throw new functions.https.HttpsError('failed-precondition', 'Reviewer access is not configured');
    }

    if (secret !== reviewerSecret) {
        console.warn(`⛔ Unauthorized attempt to grant access to ${email}`);
        throw new functions.https.HttpsError('permission-denied', 'Invalid secret key');
    }

    if (!email) {
        throw new functions.https.HttpsError('invalid-argument', 'Email is required');
    }

    try {
        console.log(`🔓 Granting reviewer flag to: ${email}`);
        const userRecord = await admin.auth().getUserByEmail(email);
        const uid = userRecord.uid;

        await db.collection('users').doc(uid).set({
            reviewerAccess: {
                enabled: true,
                grantedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`✅ Reviewer flag granted to ${email} (${uid})`);

        return {
            success: true,
            message: `Reviewer flag granted to ${email}`,
            uid: uid
        };
    } catch (error) {
        console.error("❌ Error granting access:", error);
        throw new functions.https.HttpsError('internal', error instanceof Error ? error.message : 'Unknown error');
    }
});

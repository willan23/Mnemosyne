import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { LLMKGExtractor } from './kg-extractor';

// Initialize Firebase Admin
admin.initializeApp();

const db = admin.firestore();
const extractor = new LLMKGExtractor();

// Export Stripe functions
export {
    createCheckoutSession,
    createBillingPortalSession,
    getSubscriptionStatus,
    handleStripeWebhook
} from './stripe';

/**
 * Cloud Function triggered when a new session is created
 * Extracts knowledge graph and updates the session document
 */
export const processMemoryKG = functions.firestore
    .document('sessions/{sessionId}')
    .onCreate(async (snap, context) => {
        const sessionId = context.params.sessionId;
        const data = snap.data();

        console.log(`🧠 Processing memory: ${sessionId}`);

        // Skip if already processed
        if (data.nodes && data.links) {
            console.log('⏭️ Already processed, skipping');
            return null;
        }

        const text = data.text;
        if (!text || text.trim().length === 0) {
            console.log('⚠️ Empty text, skipping');
            return null;
        }

        try {
            // Extract knowledge graph
            const result = await extractor.extract(text);

            // Convert to Firestore format
            const nodes = result.entities.map((entity, index) => ({
                id: `${sessionId}-${index}`,
                name: entity.name,
                val: 5 // Default importance value
            }));

            const links = result.relations.map(rel => ({
                source: rel.source,
                target: rel.target,
                type: rel.type
            }));

            // Determine which processing method was used
            let processingMethod = 'fallback';
            if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your-gemini-key-here') {
                processingMethod = 'gemini';
            } else if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sk-proj-your-key-here') {
                processingMethod = 'openai';
            }

            // Update session with extracted KG
            await snap.ref.update({
                nodes,
                links,
                processedAt: admin.firestore.FieldValue.serverTimestamp(),
                processingMethod
            });

            console.log(`✅ Processed: ${nodes.length} nodes, ${links.length} links`);

            return { success: true, nodes: nodes.length, links: links.length };
        } catch (error) {
            console.error('❌ Error processing memory:', error);

            // Mark as failed but don't throw (to avoid retries)
            await snap.ref.update({
                processingError: error instanceof Error ? error.message : 'Unknown error',
                processedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
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

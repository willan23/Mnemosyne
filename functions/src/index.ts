import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
export { initializeAccount } from './accountBootstrap';
export {mutateMobilePairing,getMobilePairingMutationStatus} from './mobilePairing';
export {acknowledgeCapsuleNotice} from './capsuleNotices';
export {getPublicCapsule,recordCapsuleOpening,revokePublicCapsule} from './publicCapsules';
export {mutateCapsulePublication} from './capsulePublication';
export {getOwnedCapsules} from './capsuleOwner';
export {lookupCommsRecipient,createCommsContactRequest,getCommsContactRequestStatus,cancelCommsContactRequest,respondCommsContactRequest} from './commsContacts';
export {beginCommsContactRemoval,getCommsContactRemovalStatus,advanceCommsContactRemoval,cancelCommsContactRemoval} from './commsContactRemovals';
export {createCommsDelivery,getCommsDeliveryStatus,cancelCommsDelivery,acknowledgeCommsDelivery} from './commsDelivery';
export {listCommsPage} from './commsLists';
export {mutateCommsP2P,getCommsP2PMutationStatus,cancelCommsP2PMutation,readCommsP2PSession} from './commsP2PSignaling';
export {admitCommsP2PContent,getCommsP2PContentStatus,cancelCommsP2PContent,acknowledgeCommsP2PContent} from './commsP2PContent';
export {cleanupCommsP2PExpiry} from './commsP2PCleanup';
import { runMobileSyncRetentionPage } from './mobileSyncRetention';

import { accountCreatedSessionUsage } from './memoryUsageAccounting';
import { resetMonthlyUsagePages } from './monthlyUsageReset';
import { recordLiveShareStatistic } from './shareStatistics';
import { generateImageHandler, generateTextHandler, webResearchHandler } from './webApi';
import { aiProviderSecrets, aiImageProviderSecrets } from './params';
import { GENERATION_HTTP_POLICY } from './generationHttpPolicy';


// Initialize Firebase Admin
if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const regionalFunctions = functions.region('europe-west1');
// Export Stripe functions
export {
    createCheckoutSession,
    createBillingPortalSession,
    getSubscriptionStatus,
    handleStripeWebhook
} from './stripe';

export { mintAttachmentReadUrl } from './attachmentAccess';
export { beginAttachmentUpload, completeAttachmentUpload, cancelAttachmentUpload, cleanupAttachmentQuarantine, purgeUnreferencedAttachment } from './attachmentUploads';

export { createApiKey, listApiKeys, revokeApiKey } from './apiKeys';
export { setAgentAccess } from './agentAccess';
export { previewAgentAuthorization, authorizeAgentClient, revokeAgentGrant, listAgentGrants } from './agentOAuth';

export {
    createTeam,
    cancelTeamCreation,
    lookupTeamInvitee,
    inviteMember,
    acceptInvite,
    leaveTeam,
    removeTeamMember,
    requestTeamKeyRotation,
    commitTeamKeyRotation,
    superviseTeamKeyRotations,
    requestScheduledTeamKeyRotations,
    deleteTeam,
    getTeamDeletionStatus,
    getPendingTeamDeletions,
    setMemberRole,
} from './teams';

export { publicApi } from './publicApi';

export const webResearch = regionalFunctions
    .runWith({ timeoutSeconds: 60, memory: '512MB' })
    .https
    .onRequest(webResearchHandler);

export const generateText = functions.region('europe-west1')
    .runWith({ timeoutSeconds: GENERATION_HTTP_POLICY.text.functionTimeoutSeconds, memory: '512MB', secrets: aiProviderSecrets })
    .https
    .onRequest(generateTextHandler);

export const generateImage = functions.region('europe-west1')
    .runWith({ timeoutSeconds: GENERATION_HTTP_POLICY.image.functionTimeoutSeconds, memory: '512MB', secrets: aiImageProviderSecrets })
    .https
    .onRequest(generateImageHandler);

export const cleanupMobileSyncRetention = regionalFunctions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .pubsub.schedule('every 24 hours').timeZone('Europe/Lisbon').onRun(async () => {
        const startedAt = Date.now();
        const totals = { scanned: 0, deleted: 0, retained: 0, failed: 0, tombstonesDeleted: 0 };
        while (Date.now() - startedAt < 7 * 60 * 1000) {
            const page = await runMobileSyncRetentionPage();
            for (const key of ['scanned', 'deleted', 'retained', 'failed'] as const) totals[key] += page[key];
            if (!page.more || !page.cursorAdvanced) break;
        }
        // Receipt-backed envelope cleanup only. Memory tombstones require a separate dependency/recovery protocol.
        console.log('Mobile sync envelope retention', totals);
        return null;
    });
/**
 * Server-side memory usage accounting: increments users/{uid}.usage in a
 * transaction whenever a session (memory) is created. See usage.ts for the
 * full design. The counter feeds the free-tier limit check in firestore.rules
 * and the usage display in the frontend (which already listens to users/{uid}).
 */
export const onMemoryCreated = regionalFunctions.firestore
    .document('sessions/{sessionId}')
    .onCreate(async (snap) => {
        const uid = snap.data()?.uid;
        if (typeof uid !== 'string' || !uid) return null;

        if (!snap.createTime) return null;
        await accountCreatedSessionUsage(db, snap.id, uid, Date.now(), snap.createTime);
        return null;
    });

/**
 * Monthly usage reset (hygiene). Correctness does not depend on this job:
 * both the onCreate trigger and the security rules are period-aware, so a
 * stale counter from a previous month never blocks anyone.
 */
export const resetMonthlyUsage = regionalFunctions
    .runWith({ timeoutSeconds: 540 })
    .pubsub
    .schedule('0 3 1 * *')
    .timeZone('UTC')
    .onRun(async () => {
        const result = await resetMonthlyUsagePages(db);
        if (!result.complete) throw new Error('Monthly usage hygiene scan incomplete.');
        console.log('Monthly usage hygiene completed.', result);
        return null;
    });

/**
 * Retired unbound view counter. New public openings use bounded receipts.
 */
export const trackShareView = regionalFunctions.https.onCall(async (data: { shareId?: unknown }, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }
    return recordLiveShareStatistic(context.auth.uid, data, 'view', db);
});

/**
 * Retired client-asserted conversion counter; no verified attribution exists here.
 */
export const trackConversion = regionalFunctions.https.onCall(async (data: { shareId?: unknown }, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }
    return recordLiveShareStatistic(context.auth.uid, data, 'conversion', db);
});

/**
 * Trigger when a session is shared
 */
export const onMemoryShared = regionalFunctions.firestore
    .document('shares/{shareId}')
    .onCreate(async (snap, context) => {
        console.log('Memory share event recorded');
        return null;
    });

export { deleteUserAccount, getAccountDeletionStatus, getAccountDeletionRecoveryStatus, repairAccountDeletionAuth } from './accountDeletion';

export { sealDesktopAuthBridge, redeemDesktopAuthBridge } from './desktopAuth';
export { onSessionLedgerWrite, onRelationLedgerWrite } from './memoryLedger';
export { mintEncryptedAttachmentReadUrl } from './encryptedAttachmentAccess';
export { mutateSessionAttachments, getAttachmentMutationStatus, cancelSessionAttachmentMutation } from './attachmentMutations';
export { getAttachmentUploadStatus, cancelUnconfirmedAttachmentUpload } from './attachmentUploadRecovery';
export { createAttachedMemory, createPersonalMemory, getAttachedMemoryCreationStatus, cancelAttachedMemoryCreation } from './attachedMemoryCreation';
export { createClippedMemory, getClippedMemoryStatus, cancelClippedMemory } from './clippedMemoryCreation';
export {preparePersonalConnection, applyPersonalConnection, getPersonalConnectionStatus, cancelPersonalConnection} from './personalConnections';
export {beginObsidianImport,applyObsidianImportBatch,getObsidianImportStatus,cancelObsidianImport,beginCapsuleImport,applyCapsuleImportBatch} from './obsidianImport';
export {preparePersonalRevision,applyPersonalRevision,getPersonalRevisionStatus,cancelPersonalRevision} from './personalRevisions';
export {prepareTeamRevision,applyTeamRevision,getTeamRevisionStatus,cancelTeamRevision} from './teamRevisions';
export {prepareMemoryEdit,applyMemoryEdit,getMemoryEditStatus,cancelMemoryEdit} from './memoryEdits';
export {getAgentMutationProposal,listAgentMutationProposals,rejectAgentMutationProposal,approveAgentMutationProposal} from './agentMutations';
export {prepareAgentMutationReversal,applyAgentMutationReversal,getAgentMutationReversalStatus,cancelAgentMutationReversal} from './agentReversals';
export {createTeamMemory} from './attachedMemoryCreation';
export {prepareTeamConnection,applyTeamConnection,getTeamConnectionStatus,cancelTeamConnection} from './teamConnections';
export {prepareSemanticClusters,applySemanticClusters,getSemanticClusterStatus,cancelSemanticClusters} from './semanticClusters';
export {prepareSemanticRelationCandidates,prepareSemanticRelationReview,applySemanticRelations,getSemanticRelationStatus,cancelSemanticRelations} from './semanticRelations';
export {prepareEmbeddingIndexRevision,applyEmbeddingIndexRevision,getEmbeddingIndexRevisionStatus,cancelEmbeddingIndexRevision} from './embeddingIndexRevisions';
export {prepareSyncConflictDecision,applySyncConflictDecision,getSyncConflictDecisionStatus,cancelSyncConflictDecision} from './syncConflictResolution';
export {preparePersonalMigration,applyPersonalMigration,getPersonalMigrationStatus,cancelPersonalMigration,getPersonalMigrationArchive} from './personalMigration';
export {prepareTeamHistoryChange,applyTeamHistoryChange,getTeamHistoryChangeStatus,cancelTeamHistoryChange} from './teamHistoryChanges';
export {prepareCommsIdentityRollover,applyCommsIdentityRollover,getCommsIdentityRolloverStatus,cancelCommsIdentityRollover} from './commsIdentityRollovers';
export {publishCommsIdentityKey} from './commsIdentityPublication';
export {beginDocumentImport,applyDocumentImportBatch,getDocumentImportStatus,cancelDocumentImport} from './documentImport';
export { applyMobileSyncImportBatch, getMobileSyncImportStatus, prepareMobileSyncImportBatch } from './mobileSyncImport';
export { publishMobileSyncEnvelope, getMobileSyncPublicationStatus, cancelMobileSyncPublication } from './mobileSyncPublication';

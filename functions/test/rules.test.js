/**
 * Firestore + Storage security rules suite (@firebase/rules-unit-testing).
 *
 * `npm test` skips these unless FIRESTORE_EMULATOR_HOST is set.
 * Full run (downloads emulators on first use; needs a JDK):
 *   npm run test:firestore-rules   (from repo root)
 *   npm run test:rules             (from functions/, emulator already running)
 */
const { providerHttp } = require('../lib/providerTransport');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, afterEach, before, test } = require('node:test');
const { spawnSync } = require('node:child_process');

const emulatorOn = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

if (!emulatorOn) {
  test('firestore/storage rules suite skipped (run npm run test:firestore-rules from repo root)', {
    skip: 'FIRESTORE_EMULATOR_HOST is not set',
  }, () => {});
} else {
  const {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
  } = require('@firebase/rules-unit-testing');

  const PROJECT_ID = 'demo-mnemosyne-rules';
  const root = path.resolve(__dirname, '../..');
  const admin = require('firebase-admin');
  const { reserveAiBudget, aiBudgetDocumentId, reserveAiGenerationBudget, isAiGenerationAdmissionLive } = require('../lib/aiBudget');
  const { isLiveAccount, withLiveAccount } = require('../lib/accountAccess');
  const { resetAccountMonthlyUsage, resetMonthlyUsagePages } = require('../lib/monthlyUsageReset');
  const { executeSealDesktopAuthBridge, executeRedeemDesktopAuthBridge } = require('../lib/desktopAuth');
  const { consumeServerRateLimit } = require('../lib/rateLimit');
  const { beginProviderAttempt, finishProviderAttempt, releaseProviderAttempt, CIRCUIT_COOLDOWN_MS } = require('../lib/providerCircuit');
  const providerImage = require('./providerFixtures').png().toString('base64');
  const { migrateLegacyTeamEpochs } = require('../lib/teamEpochMigration');
  const { migrateTeamInviteInboxPage } = require('../lib/teamInviteInboxMigration');
  const { inventoryAttachmentReferencesPage } = require('../lib/attachmentReferenceInventory');
  const { createLegacyAttachmentReconciler, reconcileLegacyAttachmentReferencesPage } = require('../lib/legacyAttachmentReconciliation');
  const { executeCreateTeam, executeCancelTeamCreation, executeInviteMember, executeLookupTeamInvitee, executeRequestTeamKeyRotation, executeCommitTeamKeyRotation, supervisePendingTeamRotations, requestDueTeamKeyRotations, executeAcceptInvite, buildInviteDocument, purgeUserTeamMemberships, executeSetMemberRole } = require('../lib/teams');
  const { recordLiveShareStatistic } = require('../lib/shareStatistics');
  const { executeCapsuleNoticeAcknowledgement, capsuleNoticeSourceDigest } = require('../lib/capsuleNotices');
  const { executeGetPublicCapsule, executeRecordCapsuleOpening, executeRevokePublicCapsule, capsuleOwnerSourceToken, consumePublicCapsuleBudget, PUBLIC_CAPSULE_DAILY_REQUESTS } = require('../lib/publicCapsules');
  const { purgeSessions } = require('../lib/documentDeletion');
  const { executeCapsulePublication, CAPSULE_PUBLICATION_LIMITS } = require('../lib/capsulePublication');
  const { executeGetOwnedCapsules } = require('../lib/capsuleOwner');
  const { executeDeleteTeam, inspectTeamDeletion, listPendingTeamDeletions, getPendingTeamDeletions, deleteTeam, getTeamDeletionStatus } = require('../lib/teamDeletion');
  const { teamDeletionOwnerDigest } = require('../lib/teamDeletionContract');
  const { createFirestoreMemoryApi } = require('../lib/memoriesStore');
  const { recordMemoryEvents } = require('../lib/memoryLedger');
  const { authorizeAttachmentRead } = require('../lib/attachmentAccess');
  const { authorizeEncryptedAttachmentRead, mintEncryptedAttachmentReadForUid } = require('../lib/encryptedAttachmentAccess');
  const { executeAttachmentMutation, attachmentMutationStatus, cancelAttachmentMutation } = require('../lib/attachmentMutations');
  const { inspectAttachmentUpload, cancelPendingAttachmentUpload } = require('../lib/attachmentUploadRecovery');
  const { executeCreateAttachedMemory, inspectOrCancelAttachedMemory, executeAttachedMemoryCall } = require('../lib/attachedMemoryCreation');
  const {executeClippedMemory} = require('../lib/clippedMemoryCreation');
  const {executePersonalConnection,executePersonalConnectionPreparation} = require('../lib/personalConnections');
  const {executeTeamConnectionPreparation,executeTeamConnection,executeTeamConnectionCall}=require('../lib/teamConnections');
  const semanticClusters=require('../lib/semanticClusters'),semanticClusterContract=require('../lib/semanticClusterContract');
  const semanticRelations=require('../lib/semanticRelations'),semanticRelationContract=require('../lib/semanticRelationContract');
  const {executeDocumentImport,documentPlanDigest}=require('../lib/documentImport');
  const {parseDocumentImportPlan,documentPlanBatches}=require('../lib/documentImportContract');
  const {executeObsidianImport,obsidianPlanDigest}=require('../lib/obsidianImport');
  const {parseObsidianImportPlan,obsidianPlanBatches}=require('../lib/obsidianImportContract');
  const {executeSyncImportBatch, executeSyncImportStatus, executeSyncImportPreparation, syncStateHash, syncDocumentStateHash, syncConflictId} = require('../lib/mobileSyncImport');
  const {normalizedSyncMetadata,SYNC_MEMORY_METADATA_FIELDS} = require('../lib/mobileSyncImportContract');
  const {executeSyncPublication, SYNC_DAILY_CIPHER_BYTES} = require('../lib/mobileSyncPublication');
  const {syncDeviceState} = require('../lib/mobileSyncPublicationContract');
  const {purgeTerminalSyncEnvelope,runMobileSyncRetentionPage} = require('../lib/mobileSyncRetention');
  const { accountCreatedSessionUsage } = require('../lib/memoryUsageAccounting');
  const { executeAccountDeletion, purgeHistoricalAccountWraps, getAccountDeletionStatus, deleteUserAccount, accountDeletionRecoveryDigest,
    inspectAccountDeletionRecovery, getAccountDeletionRecoveryStatus, finishInterruptedAccountAuthDeletions } = require('../lib/accountDeletion');
  const { writeLiveBillingAccount } = require('../lib/stripe');
  const { attachmentSessionStateBytes } = require('../lib/attachmentMutationContract');
  const { reserveAttachmentUpload, issueAttachmentPost, finalizeAttachmentUpload, cancelAttachmentReservation,
    cleanupAttachmentReservation, sweepAttachmentReservations, requestReadyAttachmentPurge, cleanupReadyAttachmentPurge,
    purgeAccountAttachmentUploads, attachmentDescriptor } = require('../lib/attachmentUploads');
  const { encodeAttachmentHeader } = require('../lib/attachmentEnvelope');
  const { issueAgentSession, verifyAgentSession, AGENT_TOKEN_LIFETIME_MS } = require('../lib/agentSessions');
  const { executeSetAgentAccess, setAgentAccess } = require('../lib/agentAccess');
  // Test setup captures a fresh baseline; stale-command tests below retain old commands explicitly.
  const setAgentAccessForTest = async (uid, disabled, db) => {
    const profile = (await db.doc('users/' + uid).get()).data() || {};
    return executeSetAgentAccess(uid, { expectedUid: uid, disabled,
      baseline: { disabled: profile.agentAccessDisabled === true, epoch: profile.agentAccessEpoch ?? 0 } }, db);
  };
  const { generateApiKey, verifyApiKeySecret, executeCreateApiKey, executeListApiKeys, executeRevokeApiKey, touchApiKeyLastUsed } = require('../lib/apiKeys');
  const { createHash } = require('node:crypto');
  const { executePreviewAgentAuthorization, executeAuthorizeAgentClient, redeemAgentAuthorizationCode,
    executeRevokeAgentGrant, executeListAgentGrants, AGENT_AUTHORIZATION_LIFETIME_MS } = require('../lib/agentOAuth');
  const { createTeamAgentMemoryApi, AGENT_TEAM_RESULT_BYTES } = require('../lib/agentVaultMemories');
  const { publicApiHandler: agentVaultHttpHandler } = require('../lib/publicApi');

  const agentMutations = require('../lib/agentMutations');
  const agentReversals = require('../lib/agentReversals');
  const reversalContract = require('../lib/agentReversalContract');
  async function seedAgentVaultFixture(writes = false) {
    const db = admin.firestore(), keyId = '12345678-1234-4234-8234-123456789012';
    for (const uid of ['owner', 'alice', 'bob', 'outsider']) await db.doc('users/' + uid).set({});
    const team = { name: 'Synthetic crew', ownerUid: 'owner', memberUids: ['owner', 'alice', 'bob'],
      roles: { owner: 'owner', alice: 'admin', bob: 'member' }, activeKeyEpoch: 1, activeKeyId: keyId,
      keyRotationStatus: 'active', pendingRotationId: null, wrappedKeys: { owner: { v: 1 }, alice: { v: 1 }, bob: { v: 1 } } };
    for (const id of ['crew', 'other']) {
      await db.doc('teams/' + id).set({ ...team, name: id === 'crew' ? team.name : 'Other team' });
      await db.doc('teams/' + id + '/keyEpochs/1').set({ epoch: 1, keyId, status: 'active', memberUids: team.memberUids, wrappedKeys: team.wrappedKeys });
    }
    const enc = { v: 2, iv: 'A'.repeat(16), ct: 'B'.repeat(32) };
    const note = { uid: 'bob', teamId: 'crew', timestamp: 1000, updatedAt: 1000, text: '', title: null,
      enc, keyEpoch: 1, keyId, tags: ['synthetic'], embedding: [1, 0], embeddingModel: 'synthetic-model-a' };
    await db.doc('sessions/crew-one').set(note);
    await db.doc('sessions/crew-two').set({ ...note, uid: 'alice', timestamp: 1001, embeddingModel: 'synthetic-model-b' });
    await db.doc('sessions/other-note').set({ ...note, teamId: 'other' });
    await db.doc('sessions/personal-note').set({ ...note, uid: 'alice', teamId: null, enc: { ...enc, v: 1 } });
    const verifier = 'v'.repeat(43), input = { response_type: 'code', client_id: 'synthetic-vault-client', redirect_uri: 'https://client.example/callback',
      scope: writes ? 'memories:read memories:search memories:write' : 'memories:read memories:search', state: 'synthetic-vault-state-0123456789',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', vault: 'team:crew' };
    const client = { name: 'Synthetic vault client', enabled: true, redirectUris: [input.redirect_uri], scopes: input.scope.split(' '), vaultTypes: ['personal', 'team'] };
    await db.doc('agentClients/' + input.client_id).set(client);
    const code = async (vault = input.vault) => {
      const request = { ...input, vault }, preview = await executePreviewAgentAuthorization('alice', request, db, { writesEnabled: writes });
      const result = await executeAuthorizeAgentClient('alice', { ...request, expectedUid: 'alice', confirmed: true, consentDigest: preview.consentDigest }, db, 1000, { writesEnabled: writes });
      return { grant_type: 'authorization_code', client_id: input.client_id, redirect_uri: input.redirect_uri,
        code: new URL(result.redirectUrl).searchParams.get('code'), code_verifier: verifier };
    };
    const issue = async (vault = input.vault) => {
      const token = await redeemAgentAuthorizationCode(await code(vault), db, 1001, { writesEnabled: writes });
      return { token, key: await verifyAgentSession(token.access_token, db, 1002) };
    };
    const http = async (token, url, body, override = {}) => {
      const response = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; },
        status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } };
      await agentVaultHttpHandler({ method: body ? 'POST' : 'GET', url, headers: { authorization: 'Bearer ' + token.access_token }, query: {}, body }, response, {
        verifyApiKey: secret => verifyAgentSession(secret, db, 1002), consumeRateLimit: async () => ({ allowed: true, remaining: 10 }), touchLastUsed: async () => {},
        memories: createFirestoreMemoryApi(db), memoriesForTeamGrant: key => createTeamAgentMemoryApi(key, db), ...override,
      }); return response;
    };
    return { db, keyId, team, note, input, client, code, issue, http };
  }

  async function seedAgentMutationFixture(vault = 'personal', operation = 'edit') {
    const f = await seedAgentVaultFixture(true), issued = await f.issue(vault);
    assert.match(issued.token.access_token, /^mne_review_/); assert.equal(issued.key.keyPrefix, 'mne_review_');
    let now = 1002;
    const deps = { firestore: f.db, now: () => now, enabled: true, memoryWritesEnabled: () => true };
    await f.db.doc('config/teamSecurity').set({ writesEnabled: true });
    const target = { sessionId: vault === 'personal' ? 'personal-note' : 'crew-two', teamId: vault === 'personal' ? null : 'crew' };
    const baseline = await agentMutations.executePrepareAgentMutation(issued.key, target, deps);
    const prior = (await f.db.doc('sessions/' + target.sessionId).get()).data().enc;
    const request = { operationId: '32345678-1234-4234-8234-123456789012', operation, baseline, priorEnc: prior,
      enc: operation === 'delete' ? null : { ...prior, ct: 'C'.repeat(32) }, metadata: operation === 'delete' ? {} : { tags: ['synthetic-reviewed'] } };
    const propose = () => agentMutations.executeProposeAgentMutation(issued.key, request, deps);
    const decision = receipt => ({ expectedUid: 'alice', proposalId: receipt.proposalId, reviewDigest: receipt.digest, confirmed: true });
    const get = () => agentMutations.executeGetAgentMutation('alice', { expectedUid: 'alice', proposalId: request.operationId }, deps);
    return { ...f, ...issued, deps, target, request, propose, decision, get, setNow: value => { now = value; } };
  }
  async function appliedAgentReversalFixture(vault = 'personal', operation = 'edit', options = {}) {
    const f = await seedAgentMutationFixture(vault, operation);
    if (options.teamOwner) {
      await f.db.doc('teams/crew').update({ ownerUid: 'alice', roles: { alice: 'owner', owner: 'admin', bob: 'member' } });
      f.key = (await f.issue(vault)).key;
    }
    if (options.sessionId) f.target.sessionId = options.sessionId;
    if (options.timestamps) await f.db.doc('sessions/' + f.target.sessionId).update({ timestamp: admin.firestore.Timestamp.fromMillis(1000), updatedAt: admin.firestore.Timestamp.fromMillis(1001) });
    if (options.teamOwner || options.sessionId || options.timestamps) {
      f.request.baseline = await agentMutations.executePrepareAgentMutation(f.key, f.target, f.deps);
      f.request.priorEnc = (await f.db.doc('sessions/' + f.target.sessionId).get()).data().enc;
    }
    const applied = await agentMutations.executeProposeAgentMutation(f.key, f.request, f.deps); await agentMutations.executeApproveAgentMutation('alice', f.decision(applied), f.deps); f.setNow(2000);
    const deps = { firestore: f.db, now: f.deps.now, enabled: () => true };
    const prepare = () => agentReversals.executePrepareAgentReversal('alice', { expectedUid: 'alice', request: { proposalId: f.request.operationId } }, deps);
    const input = preparation => ({ operationId: '42345678-1234-4234-8234-123456789012', baseline: preparation.baseline, enc: { ...preparation.sourceEnc, v: vault === 'personal' ? 1 : 2, ct: 'D'.repeat(32) } });
    const command = request => ({ expectedUid: 'alice', request, reviewDigest: createHash('sha256').update(reversalContract.agentReversalRequestBytes(request)).digest('hex'), confirmed: true });
    const status = request => agentReversals.executeAgentReversal('alice', { expectedUid: 'alice', request }, 'status', deps);
    return { ...f, deps, prepare, input, command, status };
  }

  let testEnv;

  before(async () => {
    if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8'),
      },
      storage: {
        rules: fs.readFileSync(path.join(root, 'storage.rules'), 'utf8'),
      },
    });
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  afterEach(async () => {
    if (testEnv) await testEnv.clearFirestore();
    if (testEnv) await testEnv.clearStorage();
  });

  async function coreSdkFixture(){
    const db=admin.firestore(),keyId='11111111-1111-4111-8111-111111111111',cipher={v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)},teamCipher={...cipher,v:2};
    const personal={uid:'alice',teamId:null,text:'',title:null,enc:cipher,timestamp:1,updatedAt:1,connections:[]};
    const team={...personal,teamId:'core-team',keyEpoch:1,keyId,enc:teamCipher};
    for(const uid of['alice','bob','carol','removed','foreign'])await db.doc('users/'+uid).set({uid});
    await db.doc('config/teamSecurity').set({writesEnabled:true,historyReencryptionEnabled:true});
    await db.doc('teams/core-team').set({ownerUid:'alice',memberUids:['alice','bob','carol'],roles:{alice:'owner',bob:'admin',carol:'member'},activeKeyEpoch:1,activeKeyId:keyId,keyRotationStatus:'active',pendingRotationId:null,wrappedKeys:{alice:{v:1},bob:{v:1},carol:{v:1}}});
    await db.doc('teams/core-team/keyEpochs/1').set({epoch:1,keyId,status:'active',memberUids:['alice','bob','carol'],wrappedKeys:{alice:{v:1},bob:{v:1},carol:{v:1}}});
    const proposal={targetId:'core-peer',score:0.9,embeddingModel:'synthetic',algorithmVersion:'cosine-v1',evidence:'whole-memory-vector',proposedAt:1,sourceUpdatedAt:1,targetUpdatedAt:1,status:'suggested'};
    const rows=[['sessions/core-private',personal],['sessions/core-peer',personal],['sessions/core-shared',{...personal,sharedWithIds:['bob']}],['sessions/core-team',team],
      ['sessions/core-private/versions/history',{text:'',title:null,enc:cipher,createdAt:1,previousUpdatedAt:1,editorUid:'alice'}],
      ['sessions/core-team/versions/history',{text:'',title:null,teamId:'core-team',keyEpoch:1,keyId,enc:teamCipher,createdAt:1,previousUpdatedAt:1,editorUid:'alice'}],
      ['sessions/core-private/relationSuggestions/core-peer',proposal],['users/alice/memories/core-legacy',{...personal,text:'Synthetic retained legacy text',title:'Synthetic retained legacy title',enc:null}],
      ['mobileSyncEnvelopes/core-envelope',{ownerUid:'alice',deviceId:'phone',direction:'desktop-to-mobile',payloadType:'memory-delta',senderPublicKeyJwk:{kty:'EC'},encryptedPayload:{iv:'A'.repeat(16),data:'B'.repeat(32)},memoryCount:1,tombstoneIds:[],expiresAt:1,status:'queued',createdAt:1,updatedAt:1}]];
    for(const[path,data]of rows)await db.doc(path).set(data);
    return{db,rows,personal,team,proposal,keyId};
  }
  test('core memory SDK cutover denies every principal create overwrite no-op update and deletion while preserving authorized reads',async()=>{
    const f=await coreSdkFixture(),before=await Promise.all(f.rows.map(([path])=>f.db.doc(path).get()));
    for(const uid of['alice','bob','carol','removed','foreign',null]){
      const client=uid?testEnv.authenticatedContext(uid).firestore():testEnv.unauthenticatedContext().firestore();
      for(const[path,data]of f.rows){await assertFails(client.doc(path).set(data));await assertFails(client.doc(path).update(data));await assertFails(client.doc(path).delete());}
      for(const[path,data]of[['sessions/core-new-personal',f.personal],['sessions/core-new-team',f.team],['sessions/core-private/versions/new',{text:'',title:null,enc:f.personal.enc,createdAt:2,previousUpdatedAt:1,editorUid:'alice'}],['sessions/core-peer/relationSuggestions/core-private',{...f.proposal,targetId:'core-private'}],['users/alice/memories/new',f.personal]])await assertFails(client.doc(path).set(data));
      await assertFails(client.doc('sessions/core-shared').update({uid:uid??'anonymous',sharedWithIds:[uid??'anonymous']}));
    }
    const alice=testEnv.authenticatedContext('alice').firestore(),bob=testEnv.authenticatedContext('bob').firestore(),carol=testEnv.authenticatedContext('carol').firestore();
    for(const path of['sessions/core-private','sessions/core-private/versions/history','sessions/core-private/relationSuggestions/core-peer','users/alice/memories/core-legacy','mobileSyncEnvelopes/core-envelope'])await assertSucceeds(alice.doc(path).get());
    await assertSucceeds(bob.doc('sessions/core-shared').get());await assertSucceeds(carol.doc('sessions/core-team').get());
    for(const uid of['removed','foreign',null]){const client=uid?testEnv.authenticatedContext(uid).firestore():testEnv.unauthenticatedContext().firestore();await assertFails(client.doc('sessions/core-team').get());await assertFails(client.doc('sessions/core-private').get());}
    const after=await Promise.all(f.rows.map(([path])=>f.db.doc(path).get()));for(let i=0;i<before.length;i++){assert.ok(after[i].updateTime.isEqual(before[i].updateTime));assert.deepEqual(after[i].data(),before[i].data());}
  });
  test('core memory SDK cutover refuses atomic parent history pairs migration rewrites and terminal sync expiry even with gates enabled',async()=>{
    const f=await coreSdkFixture(),alice=testEnv.authenticatedContext('alice').firestore(),bob=testEnv.authenticatedContext('bob').firestore(),before=await f.db.doc('sessions/core-team').get();
    for(const client of[alice,bob]){
      const batch=client.batch();batch.update(client.doc('sessions/core-team'),{updatedAt:2,lastVersionId:'paired'});batch.set(client.doc('sessions/core-team/versions/paired'),{text:'',title:null,teamId:'core-team',keyEpoch:1,keyId:f.keyId,enc:f.team.enc,createdAt:2,previousUpdatedAt:1,editorUid:client===alice?'alice':'bob'});await assertFails(batch.commit());
    }
    await assertFails(alice.doc('users/alice/memories/core-legacy').update({text:'',title:null,enc:f.personal.enc}));
    await assertFails(alice.doc('mobileSyncEnvelopes/core-envelope').update({status:'failed',error:'expired',updatedAt:2}));
    assert.ok((await f.db.doc('sessions/core-team').get()).updateTime.isEqual(before.updateTime));assert.equal((await f.db.doc('sessions/core-team/versions/paired').get()).exists,false);
    assert.equal((await f.db.doc('users/alice/memories/core-legacy').get()).data().text,'Synthetic retained legacy text');assert.equal((await f.db.doc('mobileSyncEnvelopes/core-envelope').get()).data().status,'queued');
  });

  const {executeCommsIdentityPreparation:prepareIdentity,executeCommsIdentityRollover:executeIdentity}=require('../lib/commsIdentityRollovers');
  const {executeCommsIdentityPublication:publishIdentity}=require('../lib/commsIdentityPublication');
  const pairingApi=require('../lib/mobilePairing'),pairingContract=require('../lib/mobilePairingContract');
  async function serverPairingFixture(){
    const db=admin.firestore(),state={now:1000000,enabled:true},key=()=>{const k=require('node:crypto').generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'jwk'});return{kty:k.kty,crv:k.crv,x:k.x,y:k.y};},desktop=key(),mobile=key(),sync=key(),id='P'.repeat(24),deviceId='M'.repeat(24);
    await db.doc('users/alice').set({uid:'alice'});const deps={firestore:db,auth:{getUser:async uid=>({uid,disabled:false})},now:()=>state.now,enabled:()=>state.enabled};
    const create={v:1,actorUid:'alice',action:'create',pairingId:id,desktopDeviceName:'Synthetic desktop',desktopPublicKeyJwk:desktop};
    const accept=created=>({v:1,actorUid:'alice',action:'accept',pairingId:id,creationDigest:created.commandDigest,expiresAt:created.expiresAt,mobileDeviceId:deviceId,mobileDeviceName:'Synthetic mobile',mobilePublicKeyJwk:mobile,encryptedHandshake:{iv:'A'.repeat(16),data:'A'.repeat(256)}});
    const trust=accepted=>({v:1,actorUid:'alice',action:'trust',pairingId:id,acceptanceDigest:accepted.commandDigest,desktopPublicKeyJwk:sync});
    return{db,state,id,deviceId,create,accept,trust,deps,run:(command,mode='apply')=>pairingApi.executeMobilePairing('alice',command,mode,deps)};
  }
  test('mobile pairing server serializes invitation retries with one expiry and one daily admission',async()=>{
    const f=await serverPairingFixture(),outcomes=await Promise.all(Array.from({length:4},()=>f.run(f.create)));assert.equal(outcomes.filter(row=>row.changed).length,1);for(const row of outcomes)assert.equal(row.expiresAt,1000000+pairingContract.PAIRING_TTL_MS);
    assert.equal((await f.db.collection('devicePairings').get()).size,1);const budgets=await f.db.collection('users/alice/mobilePairingBudgets').get();assert.equal(budgets.size,1);assert.equal(budgets.docs[0].data().created,1);
    const alice=testEnv.authenticatedContext('alice').firestore();await assertFails(alice.doc(budgets.docs[0].ref.path).update({created:0}));await assertFails(alice.doc(budgets.docs[0].ref.path).get());
    f.state.now=outcomes[0].expiresAt;f.state.enabled=false;assert.equal((await f.run(f.create)).status,'expired');assert.equal((await budgets.docs[0].ref.get()).data().created,1);
  });
  test('mobile pairing server opposing acceptances commit one exact ciphertext and device binding',async()=>{
    const f=await serverPairingFixture(),created=await f.run(f.create),first=f.accept(created),other={...first,mobileDeviceId:'Q'.repeat(24),encryptedHandshake:{iv:'B'.repeat(16),data:'B'.repeat(256)}};
    const outcomes=await Promise.allSettled([f.run(first),f.run(other)]);assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(outcomes.filter(row=>row.status==='rejected'&&row.reason.code==='already-exists').length,1);
    const row=(await f.db.doc('devicePairings/'+f.id).get()).data(),winner=row.mobileDeviceId===first.mobileDeviceId?first:other;assert.equal(row.acceptanceDigest,pairingApi.mobilePairingCommandDigest(winner));assert.deepEqual(row.encryptedHandshake,winner.encryptedHandshake);assert.equal((await f.run(winner)).changed,false);
  });
  test('mobile pairing server trust and cancellation serialize without a cancelled active device',async()=>{
    const f=await serverPairingFixture(),created=await f.run(f.create),accepted=await f.run(f.accept(created)),trust=f.trust(accepted),cancel={v:1,actorUid:'alice',action:'cancel',pairingId:f.id,creationDigest:created.commandDigest};
    const results=await Promise.allSettled([f.run(trust),f.run(cancel)]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);const row=(await f.db.doc('devicePairings/'+f.id).get()).data(),device=await f.db.doc('trustedDevices/'+f.deviceId).get();
    if(row.status==='trusted'){assert.equal(device.data().status,'active');assert.equal(device.data().pairingDigest,row.trustDigest);assert.equal((await f.run(trust)).changed,false);}else{assert.equal(row.status,'cancelled');assert.equal(device.exists,false);await assert.rejects(f.run(trust));}
  });
  test('mobile pairing server revocation is permanent across trust retries, closed enrollment and missing artifacts',async()=>{
    const f=await serverPairingFixture(),created=await f.run(f.create),accepted=await f.run(f.accept(created)),trust=f.trust(accepted);await f.run(trust);f.state.enabled=false;
    const revoke={v:1,actorUid:'alice',action:'revoke',deviceId:f.deviceId};assert.equal((await f.run(revoke)).status,'revoked');const ref=f.db.doc('trustedDevices/'+f.deviceId),before=await ref.get();assert.equal((await f.run(trust)).status,'revoked');assert.equal((await f.run(revoke)).changed,false);assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));
    await ref.delete();assert.equal((await f.run(trust)).status,'unavailable');assert.equal((await ref.get()).exists,false);
  });
  test('mobile pairing server concurrent daily budget admission cannot exceed twenty invites',async()=>{
    const f=await serverPairingFixture(),budget=f.db.doc('users/alice/mobilePairingBudgets/0');await budget.set({uid:'alice',day:0,created:19});const results=await Promise.allSettled([f.run(f.create),f.run({...f.create,pairingId:'Q'.repeat(24)})]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected'&&row.reason.code==='resource-exhausted').length,1);assert.equal((await budget.get()).data().created,20);assert.equal((await f.db.collection('devicePairings').get()).size,1);
  });
  test('mobile pairing server cancellation before or during creation always leaves the invitation terminal',async()=>{
    const f=await serverPairingFixture(),cancel={v:1,actorUid:'alice',action:'cancel',pairingId:f.id,creationDigest:pairingApi.mobilePairingCommandDigest(f.create)};await Promise.all([f.run(cancel),f.run(f.create)]);const ref=f.db.doc('devicePairings/'+f.id),row=await ref.get();assert.equal(row.data().status,'cancelled');assert.equal((await f.run(f.create)).status,'cancelled');assert.ok((await ref.get()).updateTime.isEqual(row.updateTime));assert.equal((await f.db.doc('users/alice/mobilePairingBudgets/0').get()).data().created,1);assert.equal((await f.db.collection('trustedDevices').get()).size,0);
  });
  test('mobile pairing server SDK cutover denies all principals and no-op writes while preserving owned reads and callable revocation',async()=>{
    const f=await serverPairingFixture(),created=await f.run(f.create),accepted=await f.run(f.accept(created));await f.run(f.trust(accepted));
    const pairRef=f.db.doc('devicePairings/'+f.id),deviceRef=f.db.doc('trustedDevices/'+f.deviceId),pair=await pairRef.get(),device=await deviceRef.get(),alice=testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc(pairRef.path).get());await assertSucceeds(alice.doc(deviceRef.path).get());
    for(const client of[alice,testEnv.authenticatedContext('bob').firestore(),testEnv.unauthenticatedContext().firestore()]){
      for(const snapshot of[pair,device]){await assertFails(client.doc(snapshot.ref.path).set(snapshot.data()));await assertFails(client.doc(snapshot.ref.path).update({status:snapshot.data().status}));await assertFails(client.doc(snapshot.ref.path).delete());}
      await assertFails(client.doc('devicePairings/'+'L'.repeat(24)).set({version:1,pairingId:'L'.repeat(24),ownerUid:'alice',status:'pending',desktopDeviceName:'Synthetic legacy',desktopPublicKeyJwk:f.create.desktopPublicKeyJwk,createdAt:1,expiresAt:9999999999999}));
      await assertFails(client.doc('trustedDevices/'+'F'.repeat(24)).set({deviceId:'F'.repeat(24),ownerUid:'alice',name:'Synthetic fabricated',status:'active',pairedAt:1}));
    }
    for(const uid of['bob',null]){const client=uid?testEnv.authenticatedContext(uid).firestore():testEnv.unauthenticatedContext().firestore();await assertFails(client.doc(pairRef.path).get());await assertFails(client.doc(deviceRef.path).get());}
    assert.ok((await pairRef.get()).updateTime.isEqual(pair.updateTime));assert.ok((await deviceRef.get()).updateTime.isEqual(device.updateTime));f.state.enabled=false;assert.equal((await f.run({v:1,actorUid:'alice',action:'revoke',deviceId:f.deviceId})).status,'revoked');
  });
  test('mobile pairing server refuses a fresh acceptance at expiry and account deletion without changing ciphertext',async()=>{
    const f=await serverPairingFixture(),created=await f.run(f.create),accept=f.accept(created),ref=f.db.doc('devicePairings/'+f.id),before=await ref.get();f.state.now=created.expiresAt;await assert.rejects(f.run(accept),{code:'failed-precondition'});assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));
    f.state.now=created.createdAt;await f.db.doc('accountDeletions/alice').set({status:'complete'});for(const mode of['apply','status'])await assert.rejects(f.run(accept,mode),{code:'permission-denied'});assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));assert.equal((await f.db.collection('trustedDevices').get()).size,0);
  });
  function identityPem(){const key=require('node:crypto').generateKeyPairSync('rsa',{modulusLength:2048}).publicKey;return`-----BEGIN PUBLIC KEY-----\n${key.export({type:'spki',format:'der'}).toString('base64')}\n-----END PUBLIC KEY-----`;}
  async function contactFixture(){
    const db=admin.firestore(),users=new Map(),pems={};for(const uid of ['alice','bob','carol']){users.set(uid,{uid,disabled:false,email:uid+'@example.invalid',emailVerified:true});pems[uid]=identityPem();await db.doc('users/'+uid).set({uid,publicKeyPem:pems[uid]});await db.doc('publicProfiles/'+uid).set({uid,displayName:'Synthetic '+uid,publicKeyPem:pems[uid]});}
    const service=require('../lib/commsContacts'),hash=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
    const deps={firestore:db,now:()=>1000,auth:{getUser:async uid=>{if(!users.has(uid))throw Error();return users.get(uid);},getUserByEmail:async email=>{if(email!=='bob@example.invalid')throw Error();return users.get('bob');}}};
    const input={requestId:'11111111-1111-4111-8111-111111111111',recipientUid:'bob',recipientFingerprint:hash(pems.bob)};return{db,users,pems,hash,deps,input,service,call:(mode,inputValue=input,uid='alice')=>service.executeCommsContact(uid,inputValue,mode,deps)};
  }
  test('comms email discovery requires a matching verified Auth address and retains explicit UID discovery',async()=>{
    const f=await contactFixture(),before=await f.db.doc('publicProfiles/bob').get();
    for(const patch of [{emailVerified:false},{emailVerified:undefined},{emailVerified:'true'},{email:'other@example.invalid'}]){const original={...f.users.get('bob')};Object.assign(f.users.get('bob'),patch);await assert.rejects(f.service.executeCommsRecipientLookup('alice',{lookup:'bob@example.invalid'},f.deps),{code:'failed-precondition'});f.users.set('bob',original);}
    assert.equal((await f.service.executeCommsRecipientLookup('alice',{lookup:'BOB@example.invalid'},f.deps)).uid,'bob');f.users.get('bob').emailVerified=false;assert.equal((await f.service.executeCommsRecipientLookup('alice',{lookup:'bob'},f.deps)).uid,'bob');assert.ok((await f.db.doc('publicProfiles/bob').get()).updateTime.isEqual(before.updateTime));
  });
  test('comms email discovery refuses verification or address changed between Auth lookups before Firestore admission',async()=>{
    const f=await contactFixture(),original=f.deps.auth.getUser;f.deps.auth.getUserByEmail=async()=>({...f.users.get('bob')});
    for(const patch of [{emailVerified:false},{email:'changed@example.invalid'},{disabled:true}]){const prior={...f.users.get('bob')};f.deps.auth.getUser=async uid=>{if(uid==='bob')Object.assign(f.users.get(uid),patch);return original(uid);};await assert.rejects(f.service.executeCommsRecipientLookup('alice',{lookup:'bob@example.invalid'},f.deps));f.users.set('bob',prior);}
    assert.equal((await f.db.collection('friendRequests').get()).size,0);assert.equal((await f.db.collection('commsContactBudgets').get()).size,0);
  });
  test('comms contacts serialize retries, opposing IDs and budget with one authoritative pair',async()=>{
    const f=await contactFixture(),results=await Promise.all(Array.from({length:4},()=>f.call('create')));for(const row of results)assert.deepEqual(row,results[0]);assert.equal((await f.db.collection('friendRequests').get()).size,1);assert.equal((await f.db.collection('commsContactBudgets').get()).docs[0].data().requests,1);
    await assert.rejects(f.call('create',{requestId:'22222222-2222-4222-8222-222222222222',recipientUid:'alice',recipientFingerprint:f.hash(f.pems.alice)},'bob'),{code:'already-exists'});
    assert.deepEqual(await f.service.executeCommsRecipientLookup('alice',{lookup:' BOB@example.invalid '},f.deps),{uid:'bob',displayName:'Synthetic bob',publicKeyPem:f.pems.bob,fingerprint:f.hash(f.pems.bob)});
  });
  test('comms captured actor commands preserve old v2 receipts and reject all token swaps before Firestore access',async()=>{
    const f=await contactFixture(),service=require('../lib/commsContacts'),wire={actorUid:'alice',request:f.input};await f.call('create');const initial=(await f.db.doc('friendRequests/'+f.input.requestId).get()).data();
    assert.equal((await service.executeCommsContactCall('alice',wire,'status',f.deps)).digest,initial.digest);assert.equal((await service.executeCommsContactCall('alice',wire,'create',f.deps)).status,'pending');assert.equal((await f.db.collection('friendRequests').get()).size,1);
    const old=f.deps.auth.getUser;let authReads=0;f.deps.auth.getUser=async uid=>{authReads++;return old(uid);};
    for(const mode of ['lookup','create','status','cancel','respond']){const request=mode==='lookup'?{lookup:'bob'}:mode==='respond'?{requestId:f.input.requestId,status:'accepted'}:f.input;await assert.rejects(service.executeCommsContactCall('carol',{actorUid:'alice',request},mode,f.deps),{code:'permission-denied'});}assert.equal(authReads,0);
    assert.equal((await f.db.doc('friendRequests/'+f.input.requestId).get()).data().status,'pending');assert.equal((await service.executeCommsContactCall('bob',{actorUid:'bob',request:{requestId:f.input.requestId,status:'accepted'}},'respond',f.deps)).status,'accepted');
  });
  test('comms captured actor cancellation checkpoints use the unchanged nonce/digest and never adopt a foreign command',async()=>{
    const f=await contactFixture(),service=require('../lib/commsContacts'),wire={actorUid:'alice',request:f.input},cancelled=await service.executeCommsContactCall('alice',wire,'cancel',f.deps);assert.equal(cancelled.status,'cancelled');assert.equal((await f.db.doc('friendRequests/'+f.input.requestId).get()).data().fromUid,'alice');
    await assert.rejects(service.executeCommsContactCall('carol',wire,'cancel',f.deps),{code:'permission-denied'});await assert.rejects(service.executeCommsContactCall('alice',wire,'create',f.deps));assert.deepEqual(await service.executeCommsContactCall('alice',wire,'status',f.deps),cancelled);
  });
  test('comms contact revoked peer recovery survives Auth/profile/receipt removal without new references or budget',async()=>{
    const f=await contactFixture(),service=require('../lib/commsContacts'),wire={actorUid:'alice',request:f.input};await f.call('create');const pending=await f.call('status');
    await f.db.doc('accountDeletions/bob').set({status:'complete'});f.users.delete('bob');await f.db.doc('users/bob').delete();await f.db.doc('publicProfiles/bob').delete();
    const budgetBefore=JSON.stringify((await f.db.collection('commsContactBudgets').get()).docs.map(doc=>doc.data()));assert.deepEqual(await service.executeCommsContactCall('alice',wire,'status',f.deps),{...pending,status:'revoked'});
    await f.db.doc('friendRequests/'+f.input.requestId).delete();await f.db.collection('commsContactPairs').get().then(snapshot=>Promise.all(snapshot.docs.map(doc=>doc.ref.delete())));
    for(const mode of ['status','cancel']){const result=await service.executeCommsContactCall('alice',wire,mode,f.deps);assert.equal(result.status,'revoked');assert.equal(result.createdAt,null);assert.equal(result.updatedAt,null);}
    assert.equal((await f.db.collection('friendRequests').get()).size,0);assert.equal((await f.db.collection('commsContactPairs').get()).size,0);assert.equal(JSON.stringify((await f.db.collection('commsContactBudgets').get()).docs.map(doc=>doc.data())),budgetBefore);
    await assert.rejects(service.executeCommsContactCall('alice',wire,'create',f.deps),{code:'permission-denied'});await assert.rejects(service.executeCommsContactCall('carol',wire,'status',f.deps),{code:'permission-denied'});
  });
  test('comms contact revoked peer marker is reread after Auth outage and caller marker always denies recovery',async()=>{
    const f=await contactFixture(),service=require('../lib/commsContacts'),wire={actorUid:'alice',request:f.input},original=f.deps.auth.getUser;
    f.deps.auth.getUser=async uid=>{if(uid==='bob'){await f.db.doc('accountDeletions/bob').set({status:'complete'});throw Error('Synthetic Auth disappearance');}return original(uid);};assert.equal((await service.executeCommsContactCall('alice',wire,'status',f.deps)).status,'revoked');assert.equal((await f.db.collection('friendRequests').get()).size,0);
    await f.db.doc('accountDeletions/alice').set({status:'complete'});await assert.rejects(service.executeCommsContactCall('alice',wire,'cancel',f.deps),{code:'permission-denied'});assert.equal((await f.db.collection('friendRequests').get()).size,0);
  });
  test('comms contact recovery missing/disabled peer without a permanent marker fails rather than announcing revocation',async()=>{
    const f=await contactFixture(),service=require('../lib/commsContacts'),wire={actorUid:'alice',request:f.input};f.users.get('bob').disabled=true;await assert.rejects(service.executeCommsContactCall('alice',wire,'status',f.deps));f.users.get('bob').disabled=false;await f.db.doc('users/bob').delete();await assert.rejects(service.executeCommsContactCall('alice',wire,'status',f.deps));assert.equal((await f.db.collection('friendRequests').get()).size,0);
    await f.db.doc('users/bob').set({uid:'bob',publicKeyPem:f.pems.bob,deletionState:'deleting'});assert.equal((await service.executeCommsContactCall('alice',wire,'cancel',f.deps)).status,'revoked');assert.equal((await f.db.collection('commsContactBudgets').get()).size,0);
  });
  test('comms accepted directory merges bounded real Firestore status queries and denies SDK profile discovery',async()=>{
    const f=await contactFixture(),{executeCommsList}=require('../lib/commsLists'),batch=f.db.batch();
    for(let i=0;i<31;i++){
      const peer='peer'+String(i).padStart(3,'0');f.users.set(peer,{uid:peer,disabled:false});
      batch.set(f.db.doc('users/'+peer),{uid:peer,publicKeyPem:f.pems.bob});batch.set(f.db.doc('publicProfiles/'+peer),{uid:peer,displayName:'Synthetic '+peer,publicKeyPem:f.pems.bob,privateExtra:'hidden'});
      batch.set(f.db.doc('friendRequests/z'+String(i).padStart(3,'0')),{fromUid:i%2?peer:'alice',toUid:i%2?'alice':peer,status:'accepted',createdAt:1,updatedAt:2});
    }
    for(let i=0;i<100;i++)batch.set(f.db.doc('friendRequests/a'+i),{fromUid:'alice',toUid:'bob',status:'pending',createdAt:1,updatedAt:2});await batch.commit();
    const input={uid:'alice',kind:'contact-directory',after:null},first=await executeCommsList('alice',input,f.deps),last=await executeCommsList('alice',{...input,after:first.next},f.deps);
    assert.equal(first.rows.length,25);assert.equal(first.next.id,'z024');assert.equal(last.rows.length,6);assert.equal(last.next,null);assert.equal(first.rows[0].data.privateExtra,undefined);
    const alice=testEnv.authenticatedContext('alice').firestore();await assertFails(alice.collection('publicProfiles').get());await assertFails(alice.doc('friendRequests/z000').update({status:'rejected'}));
  });
  test('comms contact removal drains real bounded batches and pair lock hides accepted rows without deleting messages',async()=>{
    const f=await contactFixture(),{executeCommsContactRemoval:remove}=require('../lib/commsContactRemovals'),{executeCommsList}=require('../lib/commsLists'),batch=f.db.batch();
    for(let i=0;i<61;i++)batch.set(f.db.doc('friendRequests/'+String(i).padStart(3,'0')),{fromUid:i%2?'bob':'alice',toUid:i%2?'alice':'bob',status:i===0||i%3?'accepted':'pending',createdAt:1,updatedAt:2,extra:'preserved'});
    batch.set(f.db.doc('friendRequests/other'),{fromUid:'bob',toUid:'carol',status:'accepted',createdAt:1,updatedAt:2});batch.set(f.db.doc('transmissions/retained'),{senderId:'alice',recipientId:'bob',status:'sent',timestamp:1,encryptedData:Buffer.alloc(256).toString('base64')});await batch.commit();
    const input={requestId:f.input.requestId,actorUid:'alice',peerUid:'bob',anchorId:'000',anchorUpdatedAt:2},call=mode=>remove('alice',input,mode,f.deps),first=await call('begin');assert.equal(first.status,'pending');assert.equal(first.removedCount,25);assert.deepEqual(await call('begin'),first);
    assert.equal((await executeCommsList('alice',{uid:'alice',kind:'contact-directory',after:null},f.deps)).rows.length,0);
    assert.equal((await call('advance')).removedCount,50);const done=await call('advance');assert.equal(done.status,'complete');assert.equal(done.removedCount,61);assert.deepEqual(await call('advance'),done);
    assert.equal((await f.db.doc('transmissions/retained').get()).exists,true);assert.equal((await f.db.doc('friendRequests/other').get()).data().status,'accepted');assert.equal((await f.db.doc('friendRequests/000').get()).data().extra,'preserved');
    for(const uid of ['alice','bob','carol']){const client=testEnv.authenticatedContext(uid).firestore(),ref=client.doc('commsContactRemovals/'+input.requestId);await assertFails(ref.get());await assertFails(ref.set({actorUid:uid}));await assertFails(ref.delete());await assertFails(client.collection('commsContactRemovals').get());}
    const next={...f.input,requestId:'22222222-2222-4222-8222-222222222222'};assert.equal((await f.call('create',next)).status,'pending');assert.deepEqual(await call('advance'),done);assert.equal((await f.db.doc('friendRequests/'+next.requestId).get()).data().status,'pending');
  });
  test('comms contact removal opposing nonces and admission/acceptance races preserve one active removal owner',async()=>{
    const f=await contactFixture(),{executeCommsContactRemoval:remove}=require('../lib/commsContactRemovals'),batch=f.db.batch();
    for(let i=0;i<61;i++)batch.set(f.db.doc('friendRequests/'+String(i).padStart(3,'0')),{fromUid:i%2?'bob':'alice',toUid:i%2?'alice':'bob',status:i===0||i%3?'accepted':'pending',createdAt:1,updatedAt:2});await batch.commit();
    const input={requestId:f.input.requestId,actorUid:'alice',peerUid:'bob',anchorId:'000',anchorUpdatedAt:2},reverse={...input,requestId:'22222222-2222-4222-8222-222222222222',actorUid:'bob',peerUid:'alice'};
    const results=await Promise.allSettled([remove('alice',input,'begin',f.deps),remove('bob',reverse,'begin',f.deps)]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal((await f.db.collection('commsContactRemovals').get()).size,1);
    await assert.rejects(f.call('create',{...f.input,requestId:'33333333-3333-4333-8333-333333333333'}),{code:'aborted'});
    const pending=(await f.db.collection('friendRequests').where('fromUid','==','bob').where('toUid','==','alice').where('status','==','pending').limit(1).get()).docs[0];assert.ok(pending);await assert.rejects(f.service.executeCommsContactResponse('alice',{requestId:pending.id,status:'accepted'},f.deps),{code:'aborted'});
  });
  test('comms contact removal current anchor ownership and permanent markers are checked before any writes',async()=>{
    const f=await contactFixture(),{executeCommsContactRemoval:remove}=require('../lib/commsContactRemovals');await f.db.doc('friendRequests/anchor').set({fromUid:'alice',toUid:'bob',status:'accepted',createdAt:1,updatedAt:2});
    const input={requestId:f.input.requestId,actorUid:'alice',peerUid:'bob',anchorId:'anchor',anchorUpdatedAt:2};await assert.rejects(remove('alice',{...input,anchorUpdatedAt:3},'begin',f.deps),{code:'aborted'});assert.equal((await f.db.collection('commsContactRemovals').get()).size,0);
    await f.db.doc('accountDeletions/bob').set({status:'complete'});assert.equal((await remove('alice',input,'begin',f.deps)).status,'revoked');assert.equal((await f.db.collection('commsContactRemovals').get()).size,0);assert.equal((await f.db.collection('commsContactPairs').get()).size,0);
  });
  test('comms contact removal cancellation records an unknown checkpoint and never undoes admitted progress',async()=>{
    const f=await contactFixture(),{executeCommsContactRemoval:remove}=require('../lib/commsContactRemovals');await f.db.doc('friendRequests/anchor').set({fromUid:'alice',toUid:'bob',status:'accepted',createdAt:1,updatedAt:2});
    const input={requestId:f.input.requestId,actorUid:'alice',peerUid:'bob',anchorId:'anchor',anchorUpdatedAt:2};const results=await Promise.allSettled([remove('alice',input,'cancel',f.deps),remove('alice',input,'begin',f.deps)]);assert.ok(results.some(row=>row.status==='fulfilled'));const receipt=await remove('alice',input,'status',f.deps);assert.ok(['cancelled','complete'].includes(receipt.status));assert.equal((await f.db.doc('friendRequests/anchor').get()).data().status,receipt.status==='cancelled'?'accepted':'cancelled');
    if(receipt.status==='cancelled')await assert.rejects(remove('alice',input,'begin',f.deps),{code:'aborted'});assert.deepEqual(await remove('alice',input,'cancel',f.deps),receipt);
  });
  test('comms accepted directory rereads revocation and current profile after Auth, preserving healthy rows',async()=>{
    const f=await contactFixture(),{executeCommsList}=require('../lib/commsLists');
    for(const peer of['bob','carol'])await f.db.doc('friendRequests/'+peer).set({fromUid:peer,toUid:'alice',status:'accepted',createdAt:1,updatedAt:2});
    const original=f.deps.auth.getUser;f.deps.auth.getUser=async uid=>{if(uid==='bob')await f.db.doc('friendRequests/bob').update({status:'rejected'});return original(uid);};
    const input={uid:'alice',kind:'contact-directory',after:null},page=await executeCommsList('alice',input,f.deps);assert.equal(page.unavailable,1);assert.deepEqual(page.rows.map(row=>row.data.uid),['carol']);
    await f.db.doc('users/carol').update({publicKeyPem:f.pems.bob});assert.equal((await executeCommsList('alice',input,f.deps)).rows.length,0);
    await f.db.doc('accountDeletions/alice').set({status:'complete'});await assert.rejects(executeCommsList('alice',input,f.deps),{code:'permission-denied'});
  });
  test('comms accepted exact UID/email search filters both directions and binds resolved identity across pages',async()=>{
    const f=await contactFixture(),{executeCommsList}=require('../lib/commsLists'),batch=f.db.batch();
    for(let i=0;i<31;i++)batch.set(f.db.doc('friendRequests/'+String(i).padStart(3,'0')),{fromUid:i%2?'alice':'bob',toUid:i%2?'bob':'alice',status:'accepted',createdAt:1,updatedAt:2});await batch.commit();
    const input={uid:'alice',kind:'contact-search',lookup:'bob@example.invalid',after:null},first=await executeCommsList('alice',input,f.deps);assert.equal(first.rows.length,25);assert.equal(first.next.targetUid,'bob');assert.equal((await executeCommsList('alice',{...input,after:first.next},f.deps)).rows.length,6);
    assert.equal((await executeCommsList('alice',{...input,lookup:'carol'},f.deps)).rows.length,0);f.users.get('carol').email='bob@example.invalid';f.deps.auth.getUserByEmail=async()=>f.users.get('carol');await assert.rejects(executeCommsList('alice',{...input,after:first.next},f.deps),{code:'aborted'});
  });
  test('comms contacts cancel/create races and receiver responses have terminal, idempotent outcomes',async()=>{
    const f=await contactFixture(),outcomes=await Promise.allSettled([f.call('create'),f.call('cancel')]);assert.ok(outcomes.some(row=>row.status==='fulfilled'));assert.equal((await f.call('status')).status,'cancelled');await assert.rejects(f.call('create'));
    const input={...f.input,requestId:'22222222-2222-4222-8222-222222222222'};await f.call('create',input);await assert.rejects(f.service.executeCommsContactResponse('alice',{requestId:input.requestId,status:'accepted'},f.deps));
    const response=await f.service.executeCommsContactResponse('bob',{requestId:input.requestId,status:'accepted'},f.deps);assert.deepEqual(await f.service.executeCommsContactResponse('bob',{requestId:input.requestId,status:'accepted'},f.deps),response);assert.equal((await f.call('cancel',input)).status,'accepted');
  });
  test('comms contacts reject stale keys/budgets/conflicts and terminate revoked peer recovery without writes',async()=>{
    const f=await contactFixture();await assert.rejects(f.call('create',{...f.input,recipientFingerprint:f.hash(f.pems.carol)}),{code:'aborted'});assert.equal((await f.db.collection('friendRequests').get()).size,0);
    await f.db.doc('commsContactBudgets/'+f.hash('alice')+'_1970-01-01').set({v:1,uid:'alice',day:'1970-01-01',requests:20});await assert.rejects(f.call('create'),{code:'resource-exhausted'});await assert.rejects(f.call('cancel'),{code:'resource-exhausted'});assert.equal((await f.db.collection('commsContactPairs').get()).size,0);await f.db.collection('commsContactBudgets').get().then(s=>Promise.all(s.docs.map(d=>d.ref.delete())));
    await f.db.doc('friendRequests/legacy').set({fromUid:'bob',toUid:'alice',status:'accepted'});await assert.rejects(f.call('create'),{code:'already-exists'});await f.db.doc('friendRequests/legacy').delete();
    await f.db.doc('accountDeletions/bob').set({status:'complete'});await assert.rejects(f.call('create'),{code:'permission-denied'});for(const mode of ['status','cancel']){const result=await f.call(mode);assert.equal(result.status,'revoked');assert.equal(result.createdAt,null);assert.equal(result.updatedAt,null);}for(const name of ['friendRequests','commsContactPairs','commsContactBudgets'])assert.equal((await f.db.collection(name).get()).size,0);await assert.rejects(f.service.executeCommsRecipientLookup('alice',{lookup:'bob'},f.deps),{code:'permission-denied'});
  });
  test('comms contacts keep metadata participant-only and pair/budget roots inaccessible to every client',async()=>{
    const f=await contactFixture();await f.call('create');const alice=testEnv.authenticatedContext('alice').firestore(),bob=testEnv.authenticatedContext('bob').firestore(),carol=testEnv.authenticatedContext('carol').firestore(),anonymous=testEnv.unauthenticatedContext().firestore(),path='friendRequests/'+f.input.requestId;
    await assertSucceeds(alice.doc(path).get());await assertSucceeds(bob.doc(path).get());await assertFails(carol.doc(path).get());await assertFails(anonymous.doc(path).get());
    for(const client of [alice,bob,carol,anonymous]){await assertFails(client.doc(path).update({status:'accepted',updatedAt:2}));await assertFails(client.doc(path).delete());await assertFails(client.doc('friendRequests/forged').set({fromUid:'alice',toUid:'bob',status:'pending'}));
      for(const collection of ['commsContactPairs','commsContactBudgets']){const row=(await f.db.collection(collection).get()).docs[0];await assertFails(client.doc(collection+'/'+row.id).get());await assertFails(client.doc(collection+'/'+row.id).set({uid:'alice'}));await assertFails(client.doc(collection+'/'+row.id).delete());await assertFails(client.collection(collection).get());}}
  });
  async function deliveryFixture(){
    const f=await contactFixture(),service=require('../lib/commsDelivery'),contract=require('../lib/commsDeliveryContract');
    const input={requestId:f.input.requestId,senderUid:'alice',recipientUid:'bob',senderFingerprint:f.hash(f.pems.alice),recipientFingerprint:f.hash(f.pems.bob),envelope:{encryptedKey:Buffer.alloc(256).toString('base64'),encryptedPayload:Buffer.alloc(32).toString('base64'),payloadIv:Buffer.alloc(12).toString('base64'),hasAttachment:false,attachmentName:null}};
    const descriptor=()=>({requestId:input.requestId,senderUid:input.senderUid,recipientUid:input.recipientUid,senderFingerprint:input.senderFingerprint,recipientFingerprint:input.recipientFingerprint,digest:f.hash(contract.commsDeliveryRequestBytes(input))});
    const call=(mode,uid='alice',value=mode==='create'?input:descriptor())=>service.executeCommsDelivery(uid,value,mode,f.deps),ack=()=>service.executeCommsDeliveryAck('bob',{transmissionId:input.requestId,senderUid:'alice',recipientUid:'bob',digest:descriptor().digest},f.deps);return{...f,service,contract,input,descriptor,call,ack};
  }
  test('comms delivery admits one capsule, receipt and three quotas under real transaction retries',async()=>{
    const f=await deliveryFixture(),results=await Promise.all(Array.from({length:4},()=>f.call('create')));for(const row of results)assert.deepEqual(row,results[0]);assert.equal((await f.db.collection('transmissions').get()).size,1);assert.equal((await f.db.collection('commsDeliveryRequests').get()).size,1);const budgets=await f.db.collection('commsDeliveryBudgets').get();assert.equal(budgets.size,3);for(const row of budgets.docs){assert.equal(row.data().requests,1);assert.equal(row.data().bytes,Buffer.byteLength(f.contract.commsDeliveryRequestBytes(f.input)));}
    await assert.rejects(f.call('status','carol'),{code:'permission-denied'});assert.equal((await f.call('status')).status,'sent');
  });
  test('comms pages traverse relay/contact/rooms and skip revoked participants without failing other rows in real Firestore',async()=>{
    const f=await deliveryFixture(),{executeCommsList}=require('../lib/commsLists'),data={senderId:'bob',recipientId:'alice',timestamp:1,status:'sent',encryptedData:Buffer.alloc(256).toString('base64')};
    const rows=Array.from({length:28},(_,i)=>({id:String(i).padStart(3,'0'),data}));rows.push({id:'099',data:{...data,senderId:'carol'}});rows.push({id:'100',data:{...data,recipientId:'carol'}});for(const row of rows)await f.db.doc('transmissions/'+row.id).set(row.data);await f.db.doc('accountDeletions/carol').set({status:'complete'});
    const input={uid:'alice',kind:'relay-in',after:null},first=await executeCommsList('alice',input,f.deps),second=await executeCommsList('alice',{...input,after:first.next},f.deps);assert.equal(first.rows.length,25);assert.equal(second.rows.length,3);assert.equal(second.unavailable,1);assert.equal(second.next,null);assert.equal(new Set([...first.rows,...second.rows].map(row=>row.id)).size,28);assert.equal(JSON.stringify(second).includes('carol'),false);
    await f.db.doc('friendRequests/a').set({fromUid:'bob',toUid:'alice',fromLabel:'Synthetic Bob',toLabel:'Synthetic Alice',status:'pending',createdAt:1,updatedAt:1});await f.db.doc('p2pRooms/a').set({callerId:'bob',calleeId:'alice',status:'offer',offer:{type:'offer',sdp:'v=0'}});for(const kind of['contact-in','room-in'])assert.equal((await executeCommsList('alice',{...input,kind},f.deps)).rows.length,1);
    await assert.rejects(executeCommsList('carol',input,f.deps),{code:'permission-denied'});await f.db.doc('accountDeletions/alice').set({status:'complete'});await assert.rejects(executeCommsList('alice',input,f.deps),{code:'permission-denied'});
  });
  test('comms page final transaction removes a participant deleted during Auth verification',async()=>{
    const f=await deliveryFixture(),{executeCommsList}=require('../lib/commsLists');await f.db.doc('transmissions/a').set({senderId:'bob',recipientId:'alice',timestamp:1,status:'sent',encryptedData:Buffer.alloc(256).toString('base64')});const original=f.deps.auth.getUser;f.deps.auth.getUser=async uid=>{if(uid==='bob')await f.db.doc('accountDeletions/bob').set({status:'complete'});return original(uid);};
    const page=await executeCommsList('alice',{uid:'alice',kind:'relay-in',after:null},f.deps);assert.equal(page.rows.length,0);assert.equal(page.unavailable,1);
  });
  async function p2pFixture(){const f=await deliveryFixture(),api=require('../lib/commsP2PSignaling'),contract=require('../lib/commsP2PContract'),offer={type:'offer',sdp:'v=0'},binding={roomId:f.input.requestId,actorUid:'alice',callerUid:'alice',calleeUid:'bob',callerFingerprint:f.hash(f.pems.alice),calleeFingerprint:f.hash(f.pems.bob),offerDigest:f.hash(contract.commsP2POfferBytes(offer))},input={...binding,operationId:binding.roomId,kind:'create',signal:offer};const descriptor=value=>{const{signal,...rest}=value;return{...rest,digest:f.hash(contract.commsP2PMutationBytes(value))};};return{...f,api,contract,binding,input,descriptor,apply:(value=input)=>api.executeCommsP2PMutation(value.actorUid,value,'apply',f.deps),cancel:(value=input)=>api.executeCommsP2PMutation(value.actorUid,descriptor(value),'cancel',f.deps),read:(uid='alice')=>api.executeReadCommsP2P(uid,{...binding,actorUid:uid},f.deps)};}
  test('comms P2P signaling retries charge one room/receipt/budget set and deny all SDK root/candidate/private access',async()=>{
    const f=await p2pFixture(),results=await Promise.all(Array.from({length:4},()=>f.apply()));for(const row of results)assert.deepEqual(row,results[0]);const room='p2pRooms/'+f.binding.roomId;assert.equal((await f.db.collection('p2pRooms').get()).size,1);assert.equal((await f.db.collection('commsP2PRequests').get()).size,1);const budgets=await f.db.collection('commsP2PBudgets').get();assert.equal(budgets.size,4);for(const row of budgets.docs)assert.equal(row.data().requests,1);
    for(const client of[testEnv.authenticatedContext('alice').firestore(),testEnv.authenticatedContext('bob').firestore(),testEnv.authenticatedContext('carol').firestore(),testEnv.unauthenticatedContext().firestore()]){await assertFails(client.doc(room).get());await assertFails(client.doc(room).update({status:'closed'}));await assertFails(client.doc('p2pRooms/forged').set({callerId:'alice',calleeId:'bob'}));await assertFails(client.doc(room+'/callerCandidates/forged').set({uid:'alice',candidate:{}}));await assertFails(client.doc(room+'/calleeCandidates/forged').set({uid:'bob',candidate:{}}));for(const collection of['commsP2PRequests','commsP2PBudgets']){const doc=(await f.db.collection(collection).get()).docs[0];await assertFails(client.doc(collection+'/'+doc.id).get());await assertFails(client.collection(collection).get());}}
    const {executeCommsList}=require('../lib/commsLists');assert.equal((await executeCommsList('bob',{uid:'bob',kind:'room-in',after:null},f.deps)).rows[0].id,f.binding.roomId);assert.equal((await f.read('bob')).offer.sdp,'v=0');
  });
  test('comms P2P answer and remote ICE are actor-bound/idempotent and closing atomically erases SDP/candidates',async()=>{
    const f=await p2pFixture();await f.apply();const answer={...f.binding,actorUid:'bob',operationId:'22222222-2222-4222-8222-222222222222',kind:'answer',signal:{type:'answer',sdp:'v=0 answer'}};await f.apply(answer);const candidate={...f.binding,operationId:'33333333-3333-4333-8333-333333333333',kind:'candidate',signal:{candidate:'candidate:synthetic',sdpMid:'0',sdpMLineIndex:0}};await Promise.all([f.apply(candidate),f.apply(candidate)]);assert.equal((await f.read('bob')).candidates.length,1);
    await assert.rejects(f.api.executeReadCommsP2P('carol',f.binding,f.deps),{code:'permission-denied'});await f.cancel();const room=(await f.db.doc('p2pRooms/'+f.binding.roomId).get()).data();assert.equal(room.status,'closed');assert.equal(room.offer,undefined);assert.equal(room.answer,undefined);assert.equal((await f.db.collection('p2pRooms/'+f.binding.roomId+'/callerCandidates').get()).size,0);await assert.rejects(f.apply());
  });
  test('comms P2P cancel/apply races, expiry and purged-recipient recovery never leave a reopened room',async()=>{
    const f=await p2pFixture();await Promise.allSettled([f.apply(),f.cancel()]);await assert.rejects(f.apply());const receipt=await f.api.executeCommsP2PMutation('alice',f.descriptor(f.input),'status',f.deps);assert.equal(receipt.status,'cancelled');
    const other=await p2pFixture();other.input.roomId='44444444-4444-4444-8444-444444444444';other.input.operationId=other.input.roomId;other.binding.roomId=other.input.roomId;await other.apply();other.deps.now=()=>1000+other.contract.COMMS_P2P_SESSION_MS;const expired=await other.api.executeReadCommsP2P('alice',other.binding,other.deps);assert.equal(expired.status,'expired');assert.equal(expired.offer,null);
    await other.db.doc('accountDeletions/bob').set({status:'complete'});await other.db.doc('p2pRooms/'+other.input.roomId).delete();await other.db.doc('commsP2PRequests/'+other.input.operationId).delete();assert.equal((await other.cancel()).status,'revoked');assert.equal((await other.db.doc('commsP2PRequests/'+other.input.operationId).get()).exists,false);
  });
  async function p2pContentFixture(){const f=await p2pFixture();await f.apply();await f.apply({...f.binding,actorUid:'bob',operationId:'22222222-2222-4222-8222-222222222222',kind:'answer',signal:{type:'answer',sdp:'v=0 answer'}});const api=require('../lib/commsP2PContent'),packet={requestId:'88888888-8888-4888-8888-888888888888',senderUid:'alice',recipientUid:'bob',senderFingerprint:f.binding.callerFingerprint,recipientFingerprint:f.binding.calleeFingerprint,digest:'e'.repeat(64),bytes:640},input={actorUid:'alice',packet,session:f.binding},call=(mode,uid=mode==='ack'?'bob':'alice',value=mode==='admit'?input:{actorUid:uid,packet})=>api.executeCommsP2PContent(uid,value,mode,f.deps);return{...f,contentApi:api,packet,contentInput:input,contentCall:call};}
  async function legacyP2PFixture(){
    const db=admin.firestore(),api=require('../lib/commsP2PLegacy'),room='p2pRooms/SyntheticLegacyRoom01',cutoverId='11111111-1111-4111-8111-111111111111',planId='22222222-2222-4222-8222-222222222222';
    await db.doc(room).set({callerId:'alice',calleeId:'bob',status:'active',createdAt:999999999999999,updatedAt:-1,offer:{type:'offer',sdp:'Synthetic private network offer'},answer:{type:'answer',sdp:'Synthetic private network answer'},callerLabel:'Synthetic private label',custom:{retained:true}});
    const policy={projectId:PROJECT_ID,rulesSha256:'a'.repeat(64),rulesetName:`projects/${PROJECT_ID}/rulesets/synthetic-policy`,releaseUpdateTime:'2026-10-12T00:00:00Z'};
    // Actual emulator server versions/timestamps; only the ten-minute wall wait and Rules API observation are synthetic.
    const deps={projectId:PROJECT_ID,firestore:db,enabled:()=>true,graceMs:0,verifyRules:async()=>policy};
    return{db,api,deps,room,cutoverId,planId,activate:()=>api.recordCommsP2PLegacyCutover(cutoverId,deps),prepare:(path=room,kind='room',id=planId)=>api.prepareCommsP2PLegacyPlan({projectId:PROJECT_ID,planId:id,cutoverId,kind,path},deps)};
  }
  test('comms P2P legacy reconciliation preserves metadata, uses actual server versions, and denies SDK receipts/cutovers',async()=>{
    const f=await legacyP2PFixture();await f.db.doc(f.room+'/callerCandidates/a').set({uid:'alice',createdAt:1,candidate:{candidate:'Synthetic private ICE'}});await f.activate();const first=await f.prepare();assert.equal(JSON.stringify(first).includes('Synthetic private'),false);assert.equal(JSON.stringify(first).includes('alice'),false);
    const result=await f.api.applyCommsP2PLegacyPlan(first,f.deps);assert.deepEqual(result,{planId:f.planId,status:'applied',deletedCandidates:1,remainingChildren:false});assert.deepEqual(await f.api.applyCommsP2PLegacyPlan(first,f.deps),result);const root=(await f.db.doc(f.room).get()).data();assert.equal(root.offer,undefined);assert.equal(root.answer,undefined);assert.equal(root.callerLabel,undefined);assert.deepEqual(root.custom,{retained:true});assert.equal(root.createdAt,999999999999999);
    const page=await f.api.inventoryCommsP2PLegacyPage({source:'rooms',afterPath:null,limit:50},f.deps);assert.equal(page.rows[0].kind,'reconciled');
    for(const client of[testEnv.authenticatedContext('alice').firestore(),testEnv.authenticatedContext('bob').firestore(),testEnv.authenticatedContext('carol').firestore(),testEnv.unauthenticatedContext().firestore()])for(const [collection,id]of [['commsP2PLegacyCutovers',f.cutoverId],['commsP2PLegacyReceipts',f.planId]]){await assertFails(client.doc(collection+'/'+id).get());await assertFails(client.collection(collection).get());await assertFails(client.doc(collection+'/'+id).set({status:'applied'}));}
  });
  test('comms P2P legacy bounded continuation works with native commit versions and never adopts a modern replacement',async()=>{
    const f=await legacyP2PFixture(),batch=f.db.batch();for(let i=0;i<35;i++)batch.set(f.db.doc(f.room+'/callerCandidates/'+String(i).padStart(3,'0')),{uid:'alice',createdAt:1,candidate:{candidate:'Synthetic private ICE'}});await batch.commit();await f.activate();const first=await f.prepare();assert.equal(first.children.length,32);assert.equal((await f.api.applyCommsP2PLegacyPlan(first,f.deps)).remainingChildren,true);
    const second=await f.prepare(f.room,'room','33333333-3333-4333-8333-333333333333');assert.equal(second.children.length,3);assert.equal((await f.api.applyCommsP2PLegacyPlan(second,f.deps)).remainingChildren,false);assert.equal((await f.db.collection(f.room+'/callerCandidates').get()).size,0);
    const pending=await f.prepare(f.room,'room','44444444-4444-4444-8444-444444444444');await f.db.doc(f.room).set({v:2,callerId:'alice',calleeId:'bob',status:'active',offer:{type:'offer',sdp:'Synthetic modern offer'}});await assert.rejects(f.api.applyCommsP2PLegacyPlan(pending,f.deps));assert.equal((await f.db.doc(f.room).get()).data().v,2);
  });
  test('comms P2P legacy versions catch unprojected SDP/ICE changes and orphan parent recreation atomically',async()=>{
    const f=await legacyP2PFixture();await f.db.doc(f.room+'/callerCandidates/a').set({uid:'alice',candidate:{candidate:'Synthetic private ICE'}});const orphan='p2pRooms/missing/callerCandidates/a';await f.db.doc(orphan).set({uid:'alice',candidate:{candidate:'Synthetic orphan ICE'}});await f.activate();const plan=await f.prepare();await f.db.doc(f.room).update({offer:{type:'offer',sdp:'Synthetic changed offer'}});await assert.rejects(f.api.applyCommsP2PLegacyPlan(plan,f.deps));assert.equal((await f.db.doc(f.room+'/callerCandidates/a').get()).exists,true);
    const orphanPlan=await f.prepare(orphan,'orphan','33333333-3333-4333-8333-333333333333');await f.db.doc('p2pRooms/missing').set({v:2,status:'active'});await assert.rejects(f.api.applyCommsP2PLegacyPlan(orphanPlan,f.deps));assert.equal((await f.db.doc(orphan).get()).exists,true);
  });
  test('comms P2P legacy inventory scopes collection groups, paginates, and suppresses references to purged owners',async()=>{
    const f=await legacyP2PFixture(),orphan='p2pRooms/missing/calleeCandidates/a';await f.db.doc(orphan).set({uid:'alice',candidate:{candidate:'Synthetic orphan ICE'}});await f.db.doc('other/x/calleeCandidates/y').set({uid:'carol'});await f.activate();const first=await f.api.inventoryCommsP2PLegacyPage({source:'calleeCandidates',afterPath:null,limit:1},f.deps);assert.equal(first.rows[0].kind,'unsupported');assert.equal(first.exhausted,false);const second=await f.api.inventoryCommsP2PLegacyPage({source:'calleeCandidates',afterPath:first.nextAfterPath,limit:1},f.deps);assert.equal(second.rows[0].kind,'orphan');assert.equal(second.exhausted,true);
    const plan=await f.prepare(orphan,'orphan');await f.db.doc('accountDeletions/alice').set({status:'complete'});await f.api.applyCommsP2PLegacyPlan(plan,f.deps);assert.equal((await f.db.doc('commsP2PLegacyReceipts/'+f.planId).get()).data().ownerUid,null);assert.equal((await f.db.doc(orphan).get()).exists,false);assert.equal((await f.db.doc('other/x/calleeCandidates/y').get()).exists,true);
  });
  test('comms P2P expiry cleanup atomically deletes only expired signaling and preserves authenticated content ACK',async()=>{
    const f=await p2pContentFixture();await f.contentCall('admit');await f.apply({...f.binding,operationId:'33333333-3333-4333-8333-333333333333',kind:'candidate',signal:{candidate:'candidate:synthetic',sdpMid:'0',sdpMLineIndex:0}});
    const api=require('../lib/commsP2PCleanup'),roomId=f.binding.roomId,ref=f.db.doc('p2pRooms/'+roomId),budgets=JSON.stringify((await f.db.collection('commsDeliveryBudgets').get()).docs.map(row=>row.data()));
    f.deps.now=()=>600999;assert.equal(await api.cleanupExpiredCommsP2PRoom(roomId,f.deps),false);f.deps.now=()=>601000;
    const results=await Promise.all(Array.from({length:4},()=>api.cleanupExpiredCommsP2PRoom(roomId,f.deps)));assert.equal(results.filter(Boolean).length,1);assert.equal((await ref.get()).exists,false);assert.equal((await ref.collection('callerCandidates').get()).size,0);
    assert.equal((await f.contentCall('ack')).status,'received');assert.equal((await f.contentCall('status')).status,'received');assert.equal(JSON.stringify((await f.db.collection('commsDeliveryBudgets').get()).docs.map(row=>row.data())),budgets);assert.equal((await f.db.collection('commsP2PRequests').get()).size,3);
    assert.equal((await f.api.executeCommsP2PMutation('alice',f.descriptor(f.input),'status',f.deps)).roomStatus,'unknown');
  });
  test('comms P2P cleanup cursor moves beyond retained legacy rows without skipping equal expiry timestamps',async()=>{
    const f=await p2pFixture();await f.apply();const batch=f.db.batch();for(let i=0;i<50;i++)batch.set(f.db.doc('p2pRooms/00000000-0000-4000-8000-'+String(i).padStart(12,'0')),{v:1,expiresAt:i===49?600999.5:601000,offer:{type:'offer',sdp:'Synthetic retained legacy SDP'}});await batch.commit();
    const api=require('../lib/commsP2PCleanup'),deps={...f.deps,now:()=>601000,id:()=>require('node:crypto').randomUUID()};
    const first=await api.runCommsP2PExpiryCleanup(deps);assert.deepEqual(first,{scanned:50,deleted:0,retained:50,failed:0,cursorAdvanced:true,more:true});
    const second=await api.runCommsP2PExpiryCleanup(deps);assert.deepEqual(second,{scanned:1,deleted:1,retained:0,failed:0,cursorAdvanced:true,more:false});assert.equal((await f.db.doc('p2pRooms/'+f.binding.roomId).get()).exists,false);assert.equal((await f.db.collection('p2pRooms').get()).size,50);
    for(const client of[testEnv.authenticatedContext('alice').firestore(),testEnv.authenticatedContext('bob').firestore(),testEnv.unauthenticatedContext().firestore()]){await assertFails(client.doc('commsP2PCleanup/state').get());await assertFails(client.doc('commsP2PCleanup/state').set({v:1}));}
  });
  test('comms P2P cleanup retains malformed roots/oversized children and refuses a corrupt sweep cursor',async()=>{
    const f=await p2pFixture();await f.apply();const api=require('../lib/commsP2PCleanup'),deps={...f.deps,now:()=>601000,id:()=>require('node:crypto').randomUUID()},ref=f.db.doc('p2pRooms/'+f.binding.roomId),batch=f.db.batch();for(let i=0;i<65;i++)batch.set(ref.collection('callerCandidates').doc(String(i)),{candidate:'Synthetic retained candidate'});await batch.commit();await assert.rejects(api.cleanupExpiredCommsP2PRoom(f.binding.roomId,deps));assert.equal((await ref.get()).exists,true);assert.equal((await ref.collection('callerCandidates').get()).size,65);
    const sweep=await api.runCommsP2PExpiryCleanup(deps);assert.equal(sweep.failed,1);assert.equal(sweep.deleted,0);await f.db.doc('commsP2PCleanup/state').set({v:1,after:{expiresAt:601000,roomId:'../outside'},updatedAt:601000,revision:require('node:crypto').randomUUID()});await assert.rejects(api.runCommsP2PExpiryCleanup(deps));assert.equal((await ref.get()).exists,true);
  });
  test('comms P2P content admission is metadata-only with one shared delivery quota charge under real retries',async()=>{
    const f=await p2pContentFixture(),results=await Promise.all(Array.from({length:4},()=>f.contentCall('admit')));for(const row of results)assert.deepEqual(row,results[0]);const doc=await f.db.doc('commsP2PContentReceipts/'+f.packet.requestId).get();assert.equal(doc.data().status,'admitted');assert.equal(doc.data().envelope,undefined);const budgets=await f.db.collection('commsDeliveryBudgets').get();assert.equal(budgets.size,3);for(const row of budgets.docs){assert.equal(row.data().requests,1);assert.equal(row.data().bytes,640);}
    for(const client of[testEnv.authenticatedContext('alice').firestore(),testEnv.authenticatedContext('bob').firestore(),testEnv.authenticatedContext('carol').firestore(),testEnv.unauthenticatedContext().firestore()]){await assertFails(client.doc(doc.ref.path).get());await assertFails(client.doc(doc.ref.path).update({status:'received'}));await assertFails(client.collection('commsP2PContentReceipts').get());}
    await assert.rejects(f.contentCall('ack','alice'),{code:'permission-denied'});await assert.rejects(f.contentCall('status','carol'),{code:'invalid-argument'});const ack=await f.contentCall('ack');assert.equal(ack.status,'received');assert.deepEqual(await f.contentCall('ack'),ack);assert.deepEqual(await f.contentCall('cancel'),ack);
  });
  test('comms P2P content retoma preserves its identity/quota through a new active room and terminal races',async()=>{
    const f=await p2pContentFixture();await f.contentCall('admit');const before=JSON.stringify((await f.db.collection('commsDeliveryBudgets').get()).docs.map(row=>({id:row.id,data:row.data()})));await f.cancel();const roomId='55555555-5555-4555-8555-555555555555',binding={...f.binding,roomId};await f.apply({...binding,operationId:roomId,kind:'create',signal:{type:'offer',sdp:'v=0'}});await f.apply({...binding,actorUid:'bob',operationId:'66666666-6666-4666-8666-666666666666',kind:'answer',signal:{type:'answer',sdp:'v=0 resumed'}});
    assert.equal((await f.contentCall('admit','alice',{...f.contentInput,session:binding})).roomId,roomId);assert.equal(JSON.stringify((await f.db.collection('commsDeliveryBudgets').get()).docs.map(row=>({id:row.id,data:row.data()}))),before);await Promise.allSettled([f.contentCall('ack'),f.contentCall('cancel')]);assert.ok(['received','cancelled'].includes((await f.contentCall('status')).status));
  });
  test('comms P2P content cannot bypass relay quota or recreate a deleted peer reference',async()=>{
    const f=await p2pContentFixture(),limit=require('../lib/commsDelivery'),ref=f.db.doc('commsDeliveryBudgets/'+limit.commsDeliveryBudgetId('sender','alice','1970-01-01'));await ref.set({v:1,kind:'sender',uid:'alice',day:'1970-01-01',requests:100,bytes:0});await assert.rejects(f.contentCall('admit'),{code:'resource-exhausted'});assert.equal((await f.db.doc('commsP2PContentReceipts/'+f.packet.requestId).get()).exists,false);await f.db.doc('accountDeletions/bob').set({status:'complete'});assert.equal((await f.contentCall('status')).status,'revoked');assert.equal((await f.contentCall('cancel')).status,'revoked');assert.equal((await f.db.doc('commsP2PContentReceipts/'+f.packet.requestId).get()).exists,false);
  });
  test('comms pages preserve real Firestore Unicode ordering and resume after a long unavailable document ID',async()=>{
    const f=await deliveryFixture(),{executeCommsList}=require('../lib/commsLists'),data={senderId:'bob',recipientId:'alice',timestamp:1,status:'sent',encryptedData:Buffer.alloc(256).toString('base64')};
    const long='z'.repeat(500);for(const id of[long,'\uE000','\u{10000}'])await f.db.doc('transmissions/'+id).set(data);const input={uid:'alice',kind:'relay-in',after:{uid:'alice',kind:'relay-in',id:long}};
    const page=await executeCommsList('alice',input,f.deps);assert.deepEqual(page.rows.map(row=>row.id),['\uE000','\u{10000}']);assert.equal(page.next,null);assert.equal((await executeCommsList('alice',{...input,after:null},f.deps)).unavailable,1);
  });
  test('comms delivery create/cancel and ACK/cancel races remain terminal and idempotent in Firestore',async()=>{
    const f=await deliveryFixture(),results=await Promise.allSettled([f.call('create'),f.call('cancel')]);assert.ok(results.some(row=>row.status==='fulfilled'));assert.equal((await f.call('status')).status,'cancelled');assert.equal((await f.db.doc('transmissions/'+f.input.requestId).get()).exists,false);await assert.rejects(f.call('create'));
    f.input.requestId='22222222-2222-4222-8222-222222222222';await f.call('create');const outcomes=await Promise.allSettled([f.ack(),f.call('cancel')]);assert.ok(outcomes.some(row=>row.status==='fulfilled'));const status=await f.call('status');assert.ok(['received','cancelled'].includes(status.status));assert.equal((await f.db.doc('transmissions/'+f.input.requestId).get()).exists,status.status==='received');assert.equal((await f.db.doc('commsDeliveryRequests/'+f.input.requestId).get()).data().status,status.status);
  });
  test('comms delivery stale keys, project admission and account revocation never leave partial records',async()=>{
    const f=await deliveryFixture();await assert.rejects(f.call('create','alice',{...f.input,recipientFingerprint:f.hash(f.pems.carol)}),{code:'aborted'});assert.equal((await f.db.collection('commsDeliveryRequests').get()).size,0);
    const ref=f.db.doc('commsDeliveryBudgets/project_1970-01-01');await ref.set({v:1,kind:'project',uid:null,day:'1970-01-01',requests:1000,bytes:0});await assert.rejects(f.call('create'),{code:'resource-exhausted'});assert.equal((await f.db.collection('transmissions').get()).size,0);await ref.delete();await f.call('create');
    await f.db.doc('accountDeletions/bob').set({status:'complete'});assert.equal((await f.call('status')).status,'sent');assert.equal((await f.call('cancel')).status,'cancelled');assert.equal((await f.db.doc('transmissions/'+f.input.requestId).get()).exists,false);
    f.input.requestId='22222222-2222-4222-8222-222222222222';assert.equal((await f.call('status')).status,'revoked');assert.equal((await f.call('cancel')).status,'revoked');assert.equal((await f.db.doc('commsDeliveryRequests/'+f.input.requestId).get()).exists,false);
  });
  test('comms delivery exposes only participant ciphertext and denies every SDK mutation/private receipt/budget read',async()=>{
    const f=await deliveryFixture();await f.call('create');const alice=testEnv.authenticatedContext('alice').firestore(),bob=testEnv.authenticatedContext('bob').firestore(),carol=testEnv.authenticatedContext('carol').firestore(),anonymous=testEnv.unauthenticatedContext().firestore(),path='transmissions/'+f.input.requestId;
    await assertSucceeds(alice.doc(path).get());await assertSucceeds(bob.doc(path).get());await assertFails(carol.doc(path).get());await assertFails(anonymous.doc(path).get());
    for(const client of[alice,bob,carol,anonymous]){await assertFails(client.doc(path).update({status:'received',receivedAt:2}));await assertFails(client.doc(path).delete());await assertFails(client.doc('transmissions/forged').set({senderId:'alice',recipientId:'bob'}));for(const collection of['commsDeliveryRequests','commsDeliveryBudgets']){const row=(await f.db.collection(collection).get()).docs[0];await assertFails(client.doc(collection+'/'+row.id).get());await assertFails(client.collection(collection).get());await assertFails(client.doc(collection+'/'+row.id).set({uid:'alice'}));}}
    const confirmed=await f.ack();assert.deepEqual(await f.ack(),confirmed);assert.equal((await f.call('cancel')).status,'received');
  });
  test('comms identity publication initializes one server pair under concurrent retries and denies every SDK bootstrap or refresh',async()=>{
    const f=await publicationFixture(),outcomes=await Promise.all(Array.from({length:4},()=>f.call()));assert.equal(outcomes.filter(row=>row.changed).length,1);
    for(const path of ['users/alice','publicProfiles/alice'])assert.equal((await f.db.doc(path).get()).data().publicKeyPem,f.pem);const original=await f.db.doc('publicProfiles/alice').get();
    for(const client of [testEnv.authenticatedContext('alice').firestore(),testEnv.authenticatedContext('bob').firestore(),testEnv.unauthenticatedContext().firestore()]){
      const batch=client.batch();batch.set(client.doc('users/alice'),{uid:'alice',publicKeyPem:f.pem},{merge:true});batch.set(client.doc('publicProfiles/alice'),{uid:'alice',publicKeyPem:f.pem},{merge:true});await assertFails(batch.commit());
      for(const patch of [{publicKeyPem:f.pem},{publicKeyUpdatedAt:new Date(2)}])await assertFails(client.doc('users/alice').update(patch));
      for(const patch of [{publicKeyPem:f.pem},{displayName:'Forged'},{emailHash:'forged'},{publicKeyUpdatedAt:new Date(2)}])await assertFails(client.doc('publicProfiles/alice').update(patch));
      await assertFails(client.doc('publicProfiles/alice').delete());
    }
    assert.ok((await f.db.doc('publicProfiles/alice').get()).updateTime.isEqual(original.updateTime));const alice=testEnv.authenticatedContext('alice').firestore();await assertFails(alice.doc('users/alice').update({displayName:'Synthetic own profile'}));
  });
  test('comms identity publication denies paired replacement, single-profile mutation and key erasure',async()=>{
    const f=await identityFixture(),alice=testEnv.authenticatedContext('alice').firestore(),batch=alice.batch();
    for(const path of ['users/alice','publicProfiles/alice'])batch.update(alice.doc(path),{publicKeyPem:f.nextPem});await assertFails(batch.commit());
    for(const path of ['users/alice','publicProfiles/alice']){await assertFails(alice.doc(path).update({publicKeyPem:f.nextPem}));await assertFails(alice.doc(path).update({publicKeyPem:null}));await assertFails(alice.doc(path).delete());}
    for(const path of ['users/alice','publicProfiles/alice'])assert.equal((await f.db.doc(path).get()).data().publicKeyPem,f.oldPem);
  });
  test('comms identity publication closed gates and check mode never initialize or repair but confirm the same durable key',async()=>{
    const f=await publicationFixture();f.state.enabled=false;assert.equal((await f.call()).status,'unpublished');assert.equal((await f.db.doc('publicProfiles/alice').get()).exists,false);
    f.state.enabled=true;assert.equal((await f.call('check')).status,'unpublished');await f.call();const original=await f.db.doc('publicProfiles/alice').get();f.state.enabled=false;f.state.user.displayName='Synthetic delayed metadata';
    assert.equal((await f.call()).status,'current');assert.ok((await f.db.doc('publicProfiles/alice').get()).updateTime.isEqual(original.updateTime));await f.db.doc('publicProfiles/alice').delete();assert.equal((await f.call()).status,'unpublished');assert.equal((await f.db.doc('publicProfiles/alice').get()).exists,false);
    f.state.enabled=true;assert.equal((await f.call()).changed,true);assert.equal((await f.db.doc('publicProfiles/alice').get()).data().publicKeyPem,f.pem);
  });
  async function publicationFixture(){const db=admin.firestore(),pem=identityPem(),state={enabled:true,user:{uid:'alice',disabled:false,displayName:'Synthetic server Alice',email:'synthetic@example.invalid'}};await db.doc('users/alice').set({uid:'alice',usage:{synthetic:1}});const deps={firestore:db,auth:{getUser:async()=>state.user},enabled:()=>state.enabled},input={v:1,actorUid:'alice',publicKeyPem:pem,mode:'publish'};return{db,pem,state,deps,input,call:(mode='publish',publicKeyPem=pem)=>publishIdentity('alice',{...input,mode,publicKeyPem},deps)};}
  test('comms identity publication competing keys admit one pair and a stale bootstrap cannot undo a server rollover',async()=>{
    const f=await publicationFixture(),other=identityPem(),results=await Promise.allSettled([f.call(),f.call('publish',other)]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);const published=(await f.db.doc('users/alice').get()).data().publicKeyPem;assert.equal((await f.db.doc('publicProfiles/alice').get()).data().publicKeyPem,published);
    const next=identityPem(),baseline=await prepareIdentity('alice',{}, {firestore:f.db,now:()=>1000});await executeIdentity('alice',{operationId:'55555555-5555-4555-8555-555555555555',baseline,publicKeyPem:next},'apply',{firestore:f.db,now:()=>1000});
    await assert.rejects(f.call('publish',published),{code:'already-exists'});for(const path of ['users/alice','publicProfiles/alice'])assert.equal((await f.db.doc(path).get()).data().publicKeyPem,next);
  });
  test('comms identity publication derives metadata from Auth, refreshes it without changing the key timestamp and rejects foreign authority',async()=>{
    const f=await publicationFixture();await f.call();const prior=(await f.db.doc('publicProfiles/alice').get()).data(),privateBefore=await f.db.doc('users/alice').get();f.state.user.displayName='Synthetic renamed by Auth';f.state.user.email='Changed@EXAMPLE.INVALID';await f.call();const after=(await f.db.doc('publicProfiles/alice').get()).data();
    assert.equal(after.displayName,f.state.user.displayName);assert.equal(after.emailHash,require('node:crypto').createHash('sha256').update(f.state.user.email.trim().toLowerCase()).digest('hex'));assert.ok(after.publicKeyUpdatedAt.isEqual(prior.publicKeyUpdatedAt));assert.ok((await f.db.doc('users/alice').get()).updateTime.isEqual(privateBefore.updateTime));
    await assert.rejects(publishIdentity('bob',f.input,f.deps),{code:'permission-denied'});await assert.rejects(publishIdentity('alice',{...f.input,displayName:'Forged'},f.deps),{code:'invalid-argument'});
  });
  test('comms identity publication permanent deletion and disabled Auth deny both confirmation and resurrection',async()=>{
    const f=await publicationFixture();await f.call();f.state.user.disabled=true;for(const mode of ['check','publish'])await assert.rejects(f.call(mode),{code:'permission-denied'});f.state.user.disabled=false;
    await f.db.doc('accountDeletions/alice').set({status:'complete'});await f.db.doc('users/alice').delete();await f.db.doc('publicProfiles/alice').delete();for(const mode of ['check','publish'])await assert.rejects(f.call(mode),{code:'permission-denied'});for(const path of ['users/alice','publicProfiles/alice'])assert.equal((await f.db.doc(path).get()).exists,false);
  });
  test('comms identity publication checks existing UID and canonical RSA before any profile change',async()=>{
    const f=await publicationFixture();await assert.rejects(f.call('publish','Synthetic invalid PEM'),{code:'invalid-argument'});assert.equal((await f.db.doc('publicProfiles/alice').get()).exists,false);
    await f.db.doc('publicProfiles/alice').set({uid:'bob',publicKeyPem:f.pem});await assert.rejects(f.call(),{code:'permission-denied'});assert.equal((await f.db.doc('users/alice').get()).data().publicKeyPem,undefined);
  });
  test('comms identity publication from a stale SDK transaction cannot revert an Admin rollover',async()=>{
    const f=await identityFixture(),alice=testEnv.authenticatedContext('alice').firestore();let changed=false;
    await assertFails(alice.runTransaction(async tx=>{const user=alice.doc('users/alice'),profile=alice.doc('publicProfiles/alice');await tx.get(user);await tx.get(profile);
      if(!changed){changed=true;await f.call('apply');}tx.update(user,{publicKeyPem:f.oldPem});tx.update(profile,{publicKeyPem:f.oldPem});
    }));for(const path of ['users/alice','publicProfiles/alice'])assert.equal((await f.db.doc(path).get()).data().publicKeyPem,f.nextPem);
  });
  test('comms identity conflict republish uses the reviewed version and retains the original private receipt',async()=>{
    const f=await identityFixture();await f.call('apply');const third=identityPem(),batch=f.db.batch();for(const path of ['users/alice','publicProfiles/alice'])batch.update(f.db.doc(path),{publicKeyPem:third});await batch.commit();
    const baseline=await prepareIdentity('alice',{},f.deps),next={...f.input,operationId:'22222222-2222-4222-8222-222222222222',baseline};assert.equal((await f.call('status')).current,false);
    await assert.rejects(f.call('apply',{...next,baseline:f.input.baseline}),{code:'aborted'});assert.equal((await f.db.doc('users/alice').get()).data().publicKeyPem,third);
    assert.equal((await f.call('apply',next)).current,true);assert.equal((await f.db.collection('commsIdentityRollovers').get()).size,2);const budget=(await f.db.collection('commsIdentityBudgets').get()).docs[0].data();assert.equal(budget.rollovers,2);
  });
  async function identityFixture(){const db=admin.firestore(),oldPem=identityPem(),nextPem=identityPem();await db.doc('users/alice').set({uid:'alice',publicKeyPem:oldPem,usage:{synthetic:1}});await db.doc('users/bob').set({uid:'bob'});await db.doc('publicProfiles/alice').set({uid:'alice',publicKeyPem:oldPem,displayName:'Synthetic Alice'});
    const deps={firestore:db,now:()=>1000},input={operationId:'11111111-1111-4111-8111-111111111111',baseline:await prepareIdentity('alice',{},deps),publicKeyPem:nextPem};return{db,deps,input,oldPem,nextPem,call:(mode,value=input)=>executeIdentity('alice',value,mode,deps)};}
  test('comms identity rollover concurrent replay commits one profile pair, receipt and budget',async()=>{
    const f=await identityFixture(),outcomes=await Promise.all(Array.from({length:4},()=>f.call('apply')));for(const result of outcomes)assert.deepEqual(result,outcomes[0]);
    for(const path of ['users/alice','publicProfiles/alice'])assert.equal((await f.db.doc(path).get()).data().publicKeyPem,f.nextPem);assert.deepEqual((await f.db.doc('users/alice').get()).data().usage,{synthetic:1});
    assert.equal((await f.db.collection('commsIdentityRollovers').get()).size,1);assert.equal((await f.db.collection('commsIdentityBudgets').get()).docs[0].data().rollovers,1);
  });
  test('comms identity rollover competing IDs and profile ABA refuse silent rebasing',async()=>{
    const f=await identityFixture(),other={...f.input,operationId:'22222222-2222-4222-8222-222222222222',publicKeyPem:identityPem()};const results=await Promise.allSettled([f.call('apply'),f.call('apply',other)]);
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal((await f.db.collection('commsIdentityBudgets').get()).docs[0].data().rollovers,1);
    const baseline=await prepareIdentity('alice',{},f.deps);await f.db.doc('users/alice').update({syntheticChanged:1});await f.db.doc('users/alice').update({syntheticChanged:admin.firestore.FieldValue.delete()});
    await assert.rejects(f.call('apply',{...other,operationId:'33333333-3333-4333-8333-333333333333',baseline,publicKeyPem:identityPem()}),{code:'aborted'});
  });
  test('comms identity rollover cancel races safely with apply and closed-state status never recreates removed public profiles',async()=>{
    const f=await identityFixture();const results=await Promise.allSettled([f.call('apply'),f.call('cancel')]);assert.ok(results.some(row=>row.status==='fulfilled'));
    const status=await f.call('status');assert.ok(['committed','cancelled'].includes(status.status));if(status.status==='cancelled')assert.equal((await f.db.doc('users/alice').get()).data().publicKeyPem,f.oldPem);
    await f.db.doc('publicProfiles/alice').delete();const historical=await f.call('cancel');assert.equal(historical.current,false);assert.equal((await f.db.doc('publicProfiles/alice').get()).exists,false);
  });
  test('comms identity rollover quota refusal is atomic and private receipts/budgets deny every client',async()=>{
    const f=await identityFixture(),id=require('node:crypto').createHash('sha256').update('alice').digest('hex')+'_1970-01-01',path='commsIdentityBudgets/'+id;
    await f.db.doc(path).set({v:1,uid:'alice',day:'1970-01-01',rollovers:5});await assert.rejects(f.call('apply'),{code:'resource-exhausted'});assert.equal((await f.db.doc('users/alice').get()).data().publicKeyPem,f.oldPem);assert.equal((await f.db.doc('commsIdentityRollovers/'+f.input.operationId).get()).exists,false);
    await f.call('cancel');for(const client of [testEnv.authenticatedContext('alice').firestore(),testEnv.authenticatedContext('bob').firestore(),testEnv.unauthenticatedContext().firestore()]){
      for(const item of ['commsIdentityRollovers/'+f.input.operationId,path]){await assertFails(client.doc(item).get());await assertFails(client.doc(item).set({uid:'alice'}));await assertFails(client.doc(item).delete());}
      for(const collection of ['commsIdentityRollovers','commsIdentityBudgets'])await assertFails(client.collection(collection).where('uid','==','alice').get());
    }
  });
  test('comms identity rollover revoked accounts refuse preparation, apply, confirmation and cancellation',async()=>{
    const f=await identityFixture();await f.call('apply');await f.db.doc('accountDeletions/alice').set({status:'complete'});await assert.rejects(prepareIdentity('alice',{},f.deps),{code:'permission-denied'});for(const mode of ['apply','status','cancel'])await assert.rejects(f.call(mode),{code:'permission-denied'});
  });
  const embeddingIndex=require('../lib/embeddingIndexRevisions'),embeddingIndexContract=require('../lib/embeddingIndexContract');
  async function embeddingIndexFixture(){
    const db=admin.firestore(),ref=db.doc('sessions/index-note');for(const uid of ['alice','bob'])await db.doc('users/'+uid).set({});
    await ref.set({uid:'alice',teamId:null,text:'',title:null,enc:{v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)},timestamp:1,updatedAt:10,
      embedding:[1,0],connections:['peer'],nodes:[{id:'retained'}],links:[],attachments:[{id:'retained'}],learning:{revisedAt:3},generatedImagePrompt:{retained:true}});
    const deps={firestore:db,now:()=>1000},prepare=async()=>embeddingIndex.executeEmbeddingIndexPreparation('alice',{sessionId:ref.id,viewDigest:syncStateHash((await ref.get()).data())},deps),
      request={operationId:'11111111-1111-4111-8111-111111111111',baseline:await prepare(),change:{kind:'publish',space:embeddingIndexContract.EMBEDDING_INDEX_TARGET_SPACE,vector:[1,...Array(383).fill(0)]}};
    return{db,ref,deps,request,prepare,call:(mode,input=request)=>embeddingIndex.executeEmbeddingIndexRevision('alice',input,mode,deps)};
  }
  test('embedding index concurrent ACK recovery archives exact encrypted state, preserves graph and charges once without recreating a missing parent',async()=>{
    const f=await embeddingIndexFixture(),before=(await f.ref.get()).data(),results=await Promise.all(Array.from({length:4},()=>f.call('apply')));
    for(const result of results)assert.deepEqual(result,results[0]);assert.equal((await f.ref.collection('versions').get()).size,1);
    const after=(await f.ref.get()).data(),archive=(await f.ref.collection('versions').doc(results[0].versionId).get()).data();
    for(const key of Object.keys(before)){assert.deepEqual(archive[key],before[key]);if(!['embedding','embeddingModel','updatedAt','lastVersionId'].includes(key))assert.deepEqual(after[key],before[key]);}
    const quota=(await f.db.collection('embeddingIndexBudgets').get()).docs[0];assert.equal(quota.data().operations,1);await f.ref.delete();assert.deepEqual(await f.call('apply'),results[0]);assert.equal((await f.ref.get()).exists,false);assert.equal((await quota.ref.get()).data().operations,1);
  });
  test('embedding index competing operations and restored-content ABA refuse stale baselines before partial archives or quota changes',async()=>{
    const f=await embeddingIndexFixture();await f.ref.update({connections:['temporary']});await f.ref.update({connections:['peer']});const refreshed=await f.prepare();assert.equal(refreshed.stateDigest,f.request.baseline.stateDigest);assert.notEqual(refreshed.stateHash,f.request.baseline.stateHash);
    await assert.rejects(f.call('apply'),{code:'aborted'});assert.equal((await f.ref.collection('versions').get()).size,0);f.request.baseline=refreshed;
    const results=await Promise.allSettled([f.call('apply'),f.call('apply',{...f.request,operationId:'22222222-2222-4222-8222-222222222222'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.ref.collection('versions').get()).size,1);assert.equal((await f.db.collection('embeddingIndexBudgets').get()).docs[0].data().operations,1);
  });
  test('embedding index rollback restores an absent marker, preserves new graph metadata and refuses a vector from different cipher content',async()=>{
    const f=await embeddingIndexFixture(),published=await f.call('apply');await f.ref.update({connections:['new-peer']});
    const input={operationId:'22222222-2222-4222-8222-222222222222',baseline:await f.prepare(),change:{kind:'rollback',versionId:published.versionId}};await f.call('apply',input);const row=(await f.ref.get()).data();assert.deepEqual(row.embedding,[1,0]);assert.equal(Object.hasOwn(row,'embeddingModel'),false);assert.deepEqual(row.connections,['new-peer']);
    await f.ref.update({enc:{...row.enc,ct:'C'.repeat(32)}});const changed={...input,operationId:'33333333-3333-4333-8333-333333333333',baseline:await f.prepare()};await assert.rejects(f.call('apply',changed),{code:'aborted'});assert.equal((await f.ref.collection('versions').get()).size,2);
  });
  test('embedding index cancellation serializes against apply, rejects late requests and account tombstones block every mode',async()=>{
    const f=await embeddingIndexFixture();await Promise.allSettled([f.call('apply'),f.call('cancel')]);const outcome=await f.call('status');assert(['cancelled','committed'].includes(outcome.status));assert.equal((await f.ref.collection('versions').get()).size,outcome.status==='committed'?1:0);
    if(outcome.status==='cancelled')await assert.rejects(f.call('apply'));assert.equal((await f.db.collection('embeddingIndexBudgets').get()).docs[0].data().operations,1);
    await f.db.doc('accountDeletions/alice').set({status:'complete'});for(const mode of ['apply','status','cancel'])await assert.rejects(f.call(mode),{code:'permission-denied'});await assert.rejects(f.prepare(),{code:'permission-denied'});
  });
  test('embedding index archive quota refuses atomically and SDK clients cannot bypass private receipts budgets or session/history writes',async()=>{
    const f=await embeddingIndexFixture(),quota=f.db.doc('embeddingIndexBudgets/'+createHash('sha256').update('alice').digest('hex')+'_1970-01-01');await quota.set({v:1,uid:'alice',day:'1970-01-01',operations:0,vectorBytes:0,archiveBytes:embeddingIndex.EMBEDDING_INDEX_DAILY_LIMITS.archiveBytes});await assert.rejects(f.call('apply'),{code:'resource-exhausted'});assert.equal((await f.ref.collection('versions').get()).size,0);assert.equal((await f.db.collection('embeddingIndexRevisions').get()).size,0);
    await quota.delete();const result=await f.call('apply');for(const client of [testEnv.authenticatedContext('alice').firestore(),testEnv.authenticatedContext('bob').firestore(),testEnv.unauthenticatedContext().firestore()]){
      for(const path of ['embeddingIndexRevisions/'+f.request.operationId,quota.path]){await assertFails(client.doc(path).get());await assertFails(client.doc(path).set({uid:'alice'}));await assertFails(client.doc(path).delete());}
      for(const root of ['embeddingIndexRevisions','embeddingIndexBudgets'])await assertFails(client.collection(root).where('uid','==','alice').get());
      await assertFails(client.doc(f.ref.path).update({embedding:[1,0],embeddingModel:'forged'}));await assertFails(client.doc(f.ref.path+'/versions/'+result.versionId).update({embedding:[0,1]}));
    }
    await assertSucceeds(testEnv.authenticatedContext('alice').firestore().doc(f.ref.path+'/versions/'+result.versionId).get());await assertFails(testEnv.authenticatedContext('bob').firestore().doc(f.ref.path+'/versions/'+result.versionId).get());
  });
  test('embedding index account deletion removes owned receipts quotas and encrypted history while preserving foreign roots',async()=>{
    const f=await embeddingIndexFixture();await f.call('apply');const roots=['embeddingIndexRevisions','embeddingIndexBudgets'];for(const root of roots)await f.db.doc(root+'/foreign').set({uid:'bob'});
    const files=await purgeFixture(),deps={firestore:f.db,now:files.deps.now,attachments:files.deps,cancelBilling:async()=>{},purgeMemberships:async()=>0,purgeLegacyObjects:async()=>true,deleteAuth:async()=>{}};assert.equal((await executeAccountDeletion('alice',{uid:'alice'},deps)).status,'complete');
    for(const root of roots){const rows=await f.db.collection(root).get();assert.equal(rows.size,1);assert.equal(rows.docs[0].id,'foreign');}assert.equal((await f.ref.collection('versions').get()).size,0);await assert.rejects(f.call('cancel'),{code:'permission-denied'});
  });

  const {executePersonalRevisionPreparation:prepareRevision,executePersonalRevision:executeRevision}=require('../lib/personalRevisions');
  async function revisionFixture(){
    const db=admin.firestore();await db.doc('users/alice').set({});await db.doc('users/bob').set({});
    const enc={v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)},ref=db.doc('sessions/revision-note');
    await ref.set({uid:'alice',teamId:null,timestamp:1,updatedAt:10,text:'',title:null,enc,connections:['peer'],learning:{source:'text-generation'}});
    const deps={firestore:db,now:()=>1000};const baseline=await prepareRevision('alice',{sessionId:ref.id},deps);
    const input={operationId:'11111111-1111-4111-8111-111111111111',baseline,enc:{...enc,ct:'C'.repeat(32)},priorEnc:enc,
      metadata:{embedding:[1,0],embeddingModel:'synthetic-local',semanticClusterId:null,position:[0,1,2],importance:.6,processingMethod:'learned:revision'}};
    return{db,ref,deps,input,call:(mode,value=input)=>executeRevision('alice',value,mode,deps)};
  }
  test('personal revision concurrent replay creates one atomic archive, receipt and budget and never recreates a deleted parent',async()=>{
    const f=await revisionFixture();const outcomes=await Promise.all(Array.from({length:4},()=>f.call('apply')));
    for(const result of outcomes)assert.deepEqual(result,outcomes[0]);assert.equal((await f.ref.collection('versions').get()).size,1);
    const budget=(await f.db.collection('personalRevisionBudgets').get()).docs[0];assert.equal(budget.data().revisions,1);
    await f.ref.delete();assert.deepEqual(await f.call('apply'),outcomes[0]);assert.equal((await f.ref.get()).exists,false);
    assert.equal((await budget.ref.get()).data().revisions,1);
  });
  test('personal revision competing operation IDs refuse stale drafts and retain one archive and one charge',async()=>{
    const f=await revisionFixture();const results=await Promise.allSettled([f.call('apply'),f.call('apply',{...f.input,operationId:'22222222-2222-4222-8222-222222222222'})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.ref.collection('versions').get()).size,1);
    assert.equal((await f.db.collection('personalRevisionBudgets').get()).docs[0].data().revisions,1);
  });
  test('personal revision changed then restored content preserves timestamp but refuses its stale Firestore baseline; quota exhaustion creates no archive',async()=>{
    const f=await revisionFixture();await f.ref.update({connections:['peer','temporary']});await f.ref.update({connections:['peer']});
    const restored=await prepareRevision('alice',{sessionId:f.ref.id},f.deps);
    assert.equal(restored.stateDigest,f.input.baseline.stateDigest);assert.notEqual(restored.stateHash,f.input.baseline.stateHash);
    await assert.rejects(f.call('apply'),{code:'aborted'});
    f.input.baseline=await prepareRevision('alice',{sessionId:f.ref.id},f.deps);
    const uidHash=require('node:crypto').createHash('sha256').update('alice').digest('hex');
    await f.db.doc('personalRevisionBudgets/'+uidHash+'_1970-01-01').set({v:1,uid:'alice',day:'1970-01-01',revisions:200,cipherBytes:0});
    await assert.rejects(f.call('apply'),{code:'resource-exhausted'});assert.equal((await f.ref.collection('versions').get()).size,0);assert.equal((await f.db.collection('personalRevisions').get()).size,0);
  });
  test('personal revision cancellation wins or confirms the committed operation and account revocation stops every mode',async()=>{
    const f=await revisionFixture();await Promise.allSettled([f.call('apply'),f.call('cancel')]);const result=await f.call('status');assert.ok(['committed','cancelled'].includes(result.status));
    assert.equal((await f.ref.collection('versions').get()).size,result.status==='committed'?1:0);
    if(result.status==='cancelled')await assert.rejects(f.call('apply'));
    await f.db.doc('accountDeletions/alice').set({status:'complete'});for(const mode of ['status','apply','cancel'])await assert.rejects(f.call(mode),{code:'permission-denied'});
    await assert.rejects(prepareRevision('alice',{sessionId:f.ref.id},f.deps),{code:'permission-denied'});
  });
  test('personal revision receipts and daily budgets deny direct owner, foreign and anonymous reads, lists and writes',async()=>{
    const f=await revisionFixture();await f.call('apply');const budget=(await f.db.collection('personalRevisionBudgets').get()).docs[0].ref.path;
    for(const client of [testEnv.authenticatedContext('alice').firestore(),testEnv.authenticatedContext('bob').firestore(),testEnv.unauthenticatedContext().firestore()]){
      for(const path of ['personalRevisions/'+f.input.operationId,budget]){await assertFails(client.doc(path).get());await assertFails(client.doc(path).set({uid:'alice'}));await assertFails(client.doc(path).delete());}
      for(const collection of ['personalRevisions','personalRevisionBudgets'])await assertFails(client.collection(collection).where('uid','==','alice').get());
    }
  });

  const {executeTeamRevisionPreparation:prepareTeamRevision,executeTeamRevision:executeTeamRevision}=require('../lib/teamRevisions');
  async function teamRevisionFixture(){
    const db=admin.firestore(),keyId='11111111-1111-4111-8111-111111111111';for(const uid of ['alice','bob','owner'])await db.doc('users/'+uid).set({});
    const team={ownerUid:'owner',memberUids:['owner','alice','bob'],roles:{owner:'owner',alice:'admin',bob:'member'},activeKeyEpoch:1,activeKeyId:keyId,keyRotationStatus:'active',wrappedKeys:{owner:{v:1},alice:{v:1},bob:{v:1}}};
    await db.doc('teams/crew').set(team);await db.doc('teams/crew/keyEpochs/1').set({epoch:1,keyId,status:'active',memberUids:team.memberUids,wrappedKeys:team.wrappedKeys});await db.doc('config/teamSecurity').set({writesEnabled:true});
    const enc={v:2,iv:'A'.repeat(16),ct:'B'.repeat(32)},ref=db.doc('sessions/team-revision-note');await ref.set({uid:'bob',teamId:'crew',timestamp:admin.firestore.Timestamp.fromMillis(1),updatedAt:10,text:'',title:null,enc,keyEpoch:1,keyId,connections:['peer'],learning:{schemaVersion:1,source:'text-generation',modality:'text',learnedAt:1,attachmentCount:0},parentId:null,generatedProvider:'synthetic-local',generatedModel:'synthetic',customMarker:{preserved:true}});
    const deps={firestore:db,now:()=>1000},baseline=await prepareTeamRevision('alice',{sessionId:ref.id,teamId:'crew'},deps),input={operationId:'33333333-3333-4333-8333-333333333333',baseline,enc:{...enc,ct:'C'.repeat(32)},priorEnc:enc,metadata:{embedding:[1],embeddingModel:'synthetic-local',semanticClusterId:null,position:null,importance:.6,processingMethod:'learned:revision'}};
    return{db,ref,deps,input,call:(mode,value=input)=>executeTeamRevision('alice',value,mode,deps)};
  }
  test('team revision concurrent replay writes one archive, receipt, audit and both budgets without changing author provenance',async()=>{
    const f=await teamRevisionFixture(),before=(await f.ref.get()).data(),results=await Promise.all(Array.from({length:4},()=>f.call('apply')));for(const result of results)assert.deepEqual(result,results[0]);
    const parent=(await f.ref.get()).data(),versions=await f.ref.collection('versions').get();assert.equal(versions.size,1);const old=versions.docs[0].data();assert.deepEqual(old.enc,before.enc);assert.deepEqual(old.learning,before.learning);assert.equal(old.generatedProvider,before.generatedProvider);assert.equal(parent.uid,'bob');assert.ok(parent.timestamp.isEqual(before.timestamp));assert.deepEqual(parent.customMarker,before.customMarker);
    for(const collection of ['teamRevisions','teamAudit','teamRevisionBudgets','teamRevisionTeamBudgets'])assert.equal((await f.db.collection(collection).get()).size,1);for(const collection of ['teamRevisionBudgets','teamRevisionTeamBudgets'])assert.equal((await f.db.collection(collection).get()).docs[0].data().revisions,1);
    await f.ref.delete();assert.deepEqual(await f.call('apply'),results[0]);assert.equal((await f.ref.get()).exists,false);
  });
  test('team revision competing nonces serialize and complete Firestore versions refuse restored document, team and epoch ABA',async()=>{
    const f=await teamRevisionFixture(),results=await Promise.allSettled([f.call('apply'),f.call('apply',{...f.input,operationId:'44444444-4444-4444-8444-444444444444'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.ref.collection('versions').get()).size,1);
    for(const path of [f.ref.path,'teams/crew','teams/crew/keyEpochs/1']){const baseline=await prepareTeamRevision('alice',{sessionId:f.ref.id,teamId:'crew'},f.deps),ref=f.db.doc(path);await ref.update({syntheticAba:true});await ref.update({syntheticAba:admin.firestore.FieldValue.delete()});const refreshed=await prepareTeamRevision('alice',{sessionId:f.ref.id,teamId:'crew'},f.deps);assert.equal(refreshed.stateDigest,baseline.stateDigest);await assert.rejects(f.call('apply',{...f.input,operationId:'55555555-5555-4555-8555-555555555555',baseline,priorEnc:(await f.ref.get()).data().enc}),{code:'aborted'});}
  });
  test('team revision cancellation, closed operations, rotation and permanent revocation leave no partial history or recreated references',async()=>{
    const f=await teamRevisionFixture();await f.db.doc('config/teamSecurity').update({writesEnabled:false});await assert.rejects(f.call('apply'));assert.equal((await f.ref.collection('versions').get()).size,0);await f.db.doc('config/teamSecurity').update({writesEnabled:true});await f.db.doc('teams/crew').update({pendingRotationId:f.input.operationId});await assert.rejects(f.call('apply'));await f.db.doc('teams/crew').update({pendingRotationId:admin.firestore.FieldValue.delete()});
    const cancelled=await f.call('cancel');assert.equal(cancelled.status,'cancelled');await assert.rejects(f.call('apply'));assert.deepEqual(await f.call('status'),cancelled);await f.db.doc('teamRevisions/'+f.input.operationId).delete();await f.db.doc('teamDeletions/crew').set({status:'complete'});await f.db.doc('teams/crew').delete();for(const mode of ['status','cancel'])assert.equal((await f.call(mode)).status,'revoked');assert.equal((await f.db.collection('teamRevisions').get()).size,0);assert.equal((await f.ref.collection('versions').get()).size,0);
  });
  test('team revision receipts and budgets deny direct owner, member, foreign and anonymous SDK access',async()=>{
    const f=await teamRevisionFixture();await f.call('apply');const paths=['teamRevisions/'+f.input.operationId];for(const collection of ['teamRevisionBudgets','teamRevisionTeamBudgets'])paths.push((await f.db.collection(collection).get()).docs[0].ref.path);
    for(const uid of ['owner','alice','bob','foreign',null]){const client=(uid?testEnv.authenticatedContext(uid):testEnv.unauthenticatedContext()).firestore();for(const path of paths){await assertFails(client.doc(path).get());await assertFails(client.doc(path).set({uid:'alice'}));await assertFails(client.doc(path).delete());}for(const collection of ['teamRevisions','teamRevisionBudgets','teamRevisionTeamBudgets'])await assertFails(client.collection(collection).get());}
  });
  test('team revision account cleanup removes actor, author and owner references while preserving foreign receipts',async()=>{
    const f=await teamRevisionFixture();await f.call('apply');const objects=await purgeFixture();
    await f.db.doc('teamRevisions/owner-reference').set({uid:'owner',authorUid:'owner',ownerUid:'bob',teamId:'other-team'});await f.db.doc('teamRevisions/foreign').set({uid:'owner',authorUid:'owner',ownerUid:'owner',teamId:'other-team'});await f.db.doc('teamRevisionBudgets/bob').set({uid:'bob',teamId:'crew'});await f.db.doc('teamRevisionBudgets/foreign').set({uid:'owner',teamId:'other-team'});
    const deps={firestore:f.db,now:objects.deps.now,attachments:objects.deps,cancelBilling:async()=>{},purgeMemberships:async()=>0,purgeLegacyObjects:async()=>true,deleteAuth:async()=>{}};assert.equal((await executeAccountDeletion('bob',{uid:'bob'},deps)).status,'complete');
    for(const path of ['teamRevisions/'+f.input.operationId,'teamRevisions/owner-reference','teamRevisionBudgets/bob'])assert.equal((await f.db.doc(path).get()).exists,false);for(const path of ['teamRevisions/foreign','teamRevisionBudgets/foreign'])assert.equal((await f.db.doc(path).get()).exists,true);
    assert.equal((await f.call('cancel')).status,'revoked');assert.equal((await f.db.doc('teamRevisions/'+f.input.operationId).get()).exists,false);
  });
  test('server learned creation validates provenance and SDK edits cannot bypass server revision history',async()=>{
    const f=await teamRevisionFixture(),client=testEnv.authenticatedContext('bob').firestore(),initial=(await f.ref.get()).data();
    const id='88888888-8888-4888-8888-888888888888',metadata={connections:[],learning:{...initial.learning,batchId:null},parentId:null,generatedProvider:initial.generatedProvider,generatedModel:initial.generatedModel};
    const request={sessionId:id,teamId:'crew',keyEpoch:1,keyId:initial.keyId,enc:initial.enc,attachmentIds:[],metadata},deps={...f.deps,teamWritesEnabled:true};
    for(const learning of[{...metadata.learning,plaintext:'Synthetic hidden prompt'},{...metadata.learning,attachmentCount:-1}])await assert.rejects(executeAttachedMemoryCall('bob','team-create',{actorUid:'bob',request:{...request,metadata:{...metadata,learning}}},deps));
    assert.equal((await f.db.doc('sessions/'+id).get()).exists,false);
    await executeAttachedMemoryCall('bob','team-create',{actorUid:'bob',request},deps);
    const before=await f.db.doc('sessions/'+id).get();await assertFails(client.doc('sessions/'+id).set(before.data()));await assertFails(client.doc('sessions/forged').set({...initial,timestamp:1}));
    const batch=client.batch();batch.update(client.doc('sessions/'+id),{updatedAt:1001,lastVersionId:'sdk-archive'});batch.set(client.doc('sessions/'+id+'/versions/sdk-archive'),{enc:initial.enc,createdAt:1001,editorUid:'bob'});await assertFails(batch.commit());
    const baseline=await prepareTeamRevision('bob',{sessionId:id,teamId:'crew'},f.deps),command={...f.input,operationId:'99999999-9999-4999-8999-999999999999',baseline};
    await executeTeamRevision('bob',command,'apply',f.deps);const history=await f.db.doc('sessions/'+id).collection('versions').get();assert.equal(history.size,1);assert.deepEqual(history.docs[0].data().enc,initial.enc);assert.deepEqual(history.docs[0].data().learning,metadata.learning);assert.equal(history.docs[0].data().generatedProvider,initial.generatedProvider);
  });

  const {executeMemoryEditPreparation:prepareMemoryEdit,executeMemoryEdit:executeMemoryEdit}=require('../lib/memoryEdits');
  async function memoryEditorFixture(team=false){const f=team?await teamRevisionFixture():await revisionFixture(),baseline=await prepareMemoryEdit('alice',{sessionId:f.ref.id,teamId:team?'crew':null},f.deps),before=(await f.ref.get()).data(),input={operationId:team?'77777777-7777-4777-8777-777777777777':'66666666-6666-4666-8666-666666666666',operation:'edit',baseline,priorEnc:before.enc,enc:{...before.enc,ct:'D'.repeat(32)},metadata:{tags:['Synthetic edited'],projectStatus:'active'}};return{...f,input,call:(mode,value=input,uid='alice')=>executeMemoryEdit(uid,value,mode,f.deps)};}
  test('memory editor concurrent retries atomically create one version, event, receipt and charge for personal and team memories',async()=>{
    for(const team of [false,true]){const f=await memoryEditorFixture(team),before=(await f.ref.get()).data(),results=await Promise.all(Array.from({length:3},()=>f.call('apply')));for(const result of results)assert.deepEqual(result,results[0]);const versions=await f.ref.collection('versions').get();assert.equal(versions.size,1);assert.deepEqual(versions.docs[0].data().enc,before.enc);assert.deepEqual(versions.docs[0].data().learning,before.learning);const after=(await f.ref.get()).data();assert.equal(after.uid,before.uid);assert.deepEqual(after.connections,before.connections);assert.equal((await f.db.collection('memoryEdits').where('sessionId','==',f.ref.id).get()).size,1);assert.equal((await f.db.collection('memoryEditEvents').where('sessionId','==',f.ref.id).get()).size,1);assert.equal((await f.db.collection('memoryEditBudgets').where('teamId','==',team?'crew':null).get()).docs[0].data().operations,1);await f.ref.delete();assert.deepEqual(await f.call('apply'),results[0]);assert.equal((await f.ref.get()).exists,false);}
  });
  test('memory editor competing nonces and restored Firestore states refuse stale drafts without extra history or charges',async()=>{
    const f=await memoryEditorFixture(true),results=await Promise.allSettled([f.call('apply'),f.call('apply',{...f.input,operationId:'88888888-8888-4888-8888-888888888888'})]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal((await f.ref.collection('versions').get()).size,1);
    for(const path of [f.ref.path,'teams/crew','teams/crew/keyEpochs/1']){const baseline=await prepareMemoryEdit('alice',{sessionId:f.ref.id,teamId:'crew'},f.deps),ref=f.db.doc(path);await ref.update({syntheticAba:true});await ref.update({syntheticAba:admin.firestore.FieldValue.delete()});const refreshed=await prepareMemoryEdit('alice',{sessionId:f.ref.id,teamId:'crew'},f.deps);assert.equal(refreshed.stateDigest,baseline.stateDigest);await assert.rejects(f.call('apply',{...f.input,operationId:'99999999-9999-4999-8999-999999999999',baseline,priorEnc:(await f.ref.get()).data().enc}),{code:'aborted'});}
  });
  test('memory editor team tombstone is owner-only and retains the historical cipher rather than relabelling it',async()=>{
    const f=await memoryEditorFixture(true),request={...f.input,operation:'delete',enc:null,metadata:{}};await assert.rejects(f.call('apply',request),{code:'permission-denied'});assert.equal((await f.ref.collection('versions').get()).size,0);const before=(await f.ref.get()).data(),owner={...request,baseline:await prepareMemoryEdit('owner',{sessionId:f.ref.id,teamId:'crew'},f.deps)};const result=await f.call('apply',owner,'owner');assert.equal(result.operation,'delete');const after=(await f.ref.get()).data();assert.equal(after.deletedAt,result.revision);assert.deepEqual(after.enc,before.enc);assert.equal(after.keyEpoch,before.keyEpoch);assert.ok(after.timestamp.isEqual(before.timestamp));assert.equal(after.uid,'bob');
  });
  test('memory editor cancellation and definitive revocation do not recreate content or purged receipts',async()=>{
    const f=await memoryEditorFixture(true),result=await f.call('cancel');assert.equal(result.status,'cancelled');await assert.rejects(f.call('apply'));await f.db.doc('memoryEdits/'+f.input.operationId).delete();await f.db.doc('teamDeletions/crew').set({status:'complete'});await f.db.doc('teams/crew').delete();for(const mode of ['status','cancel'])assert.equal((await f.call(mode)).status,'revoked');assert.equal((await f.db.collection('memoryEdits').get()).size,0);assert.equal((await f.ref.collection('versions').get()).size,0);
  });
  test('memory editor private receipts, audit events and quotas deny owner, member, foreign and anonymous SDK access',async()=>{
    const f=await memoryEditorFixture(true);await f.call('apply');const paths=[];for(const collection of ['memoryEdits','memoryEditEvents','memoryEditBudgets','memoryEditTeamBudgets'])paths.push((await f.db.collection(collection).get()).docs[0].ref.path);
    for(const uid of ['alice','bob','owner','foreign',null]){const client=(uid?testEnv.authenticatedContext(uid):testEnv.unauthenticatedContext()).firestore();for(const path of paths){await assertFails(client.doc(path).get());await assertFails(client.doc(path).set({uid:'alice'}));await assertFails(client.doc(path).delete());}for(const collection of ['memoryEdits','memoryEditEvents','memoryEditBudgets','memoryEditTeamBudgets'])await assertFails(client.collection(collection).get());}
  });
  test('memory editor account cleanup purges actor, author and owner references while retaining unrelated ciphertext records',async()=>{
    const f=await memoryEditorFixture(true);await f.call('apply');const files=await purgeFixture();for(const collection of ['memoryEdits','memoryEditEvents']){await f.db.doc(collection+'/owner-reference').set({uid:'owner',authorUid:'owner',ownerUid:'bob',teamId:'other'});await f.db.doc(collection+'/foreign').set({uid:'owner',authorUid:'owner',ownerUid:'owner',teamId:'other'});}const deps={firestore:f.db,now:files.deps.now,attachments:files.deps,cancelBilling:async()=>{},purgeMemberships:async()=>0,purgeLegacyObjects:async()=>true,deleteAuth:async()=>{}};assert.equal((await executeAccountDeletion('bob',{uid:'bob'},deps)).status,'complete');for(const collection of ['memoryEdits','memoryEditEvents']){assert.equal((await f.db.doc(collection+'/'+f.input.operationId).get()).exists,false);assert.equal((await f.db.doc(collection+'/owner-reference').get()).exists,false);assert.equal((await f.db.doc(collection+'/foreign').get()).exists,true);}assert.equal((await f.call('cancel')).status,'revoked');assert.equal((await f.db.doc('memoryEdits/'+f.input.operationId).get()).exists,false);
  });
  async function semanticRelationFixture(){
    const db=admin.firestore(),deps={firestore:db,now:()=>Date.parse('2026-10-14T18:00:00Z')};for(const uid of ['alice','bob'])await db.doc('users/'+uid).set({});
    for(const id of ['a','b','c'])await db.doc('sessions/'+id).set({uid:'alice',teamId:null,text:'',title:null,enc:{v:1,iv:Buffer.alloc(12).toString('base64'),ct:Buffer.alloc(32,1).toString('base64')},timestamp:1,updatedAt:10,embedding:id==='c'?[0,1]:[1,0],connections:[],attachments:[{retained:true}]});
    const {canonicalSyncState}=require('../lib/mobileSyncImportContract'),hash=value=>createHash('sha256').update(value).digest('hex'),views=await Promise.all(['a','b','c'].map(async sessionId=>({sessionId,viewHash:hash(canonicalSyncState(semanticRelationContract.semanticRelationProjection(sessionId,(await db.doc('sessions/'+sessionId).get()).data())))}))),prepared=await semanticRelations.executeSemanticRelationCandidates('alice',{views},deps),proposals=require('../lib/semanticRelationsGraph').buildSemanticRelationProposalsForSource({id:'a',embedding:[1,0],connections:[],updatedAt:10},[{id:'b',embedding:[1,0],connections:[],updatedAt:10},{id:'c',embedding:[0,1],connections:[],updatedAt:10}]),input={kind:'suggest',operationId:'11111111-1111-4111-8111-111111111111',ownerUid:'alice',sourceId:'a',dependencies:prepared.dependencies.filter(row=>['a','b'].includes(row.sessionId)),proposals};
    const review=async(decision='accepted')=>({kind:'review',operationId:'22222222-2222-4222-8222-222222222222',decision,baseline:await semanticRelations.executeSemanticRelationReviewPreparation('alice',{sourceId:'a',targetId:'b',sourceViewDigest:syncStateHash((await db.doc('sessions/a').get()).data()),targetViewDigest:syncStateHash((await db.doc('sessions/b').get()).data()),suggestionViewDigest:syncStateHash((await db.doc('sessions/a/relationSuggestions/b').get()).data())},deps)});
    return{db,deps,input,review,call:(mode,request=input,uid='alice')=>semanticRelations.executeSemanticRelationCall(uid,mode,{actorUid:uid,request},deps)};
  }
  test('semantic relation generation concurrent replays write one derived inferred proposal and preserve parent cipher with one charge',async()=>{
    const f=await semanticRelationFixture(),before=(await f.db.doc('sessions/a').get()).data(),results=await Promise.all(Array.from({length:3},()=>f.call('apply')));for(const result of results)assert.deepEqual(result,results[0]);assert.equal(results[0].changes,1);assert.deepEqual((await f.db.doc('sessions/a').get()).data(),before);assert.equal((await f.db.doc('sessions/a/relationSuggestions/b').get()).data().relationType,'inferred');assert.equal((await f.db.collection('semanticRelationChanges').get()).size,1);assert.equal((await f.db.collection('semanticRelationBudgets').get()).docs[0].data().operations,2);
  });
  test('semantic relation review serializes the accepted pair exact encrypted archives counterpart and decision with immutable acknowledgement',async()=>{
    const f=await semanticRelationFixture();await f.call('apply');const request=await f.review(),before=await Promise.all(['a','b'].map(async id=>(await f.db.doc('sessions/'+id).get()).data())),results=await Promise.all(Array.from({length:3},()=>f.call('apply',request)));for(const result of results)assert.deepEqual(result,results[0]);assert.equal(results[0].changes,4);for(const[index,id]of ['a','b'].entries()){const row=(await f.db.doc('sessions/'+id).get()).data(),archive=(await f.db.doc('sessions/'+id+'/versions/semantic-review-'+request.operationId).get()).data();assert.deepEqual(row.connections,[index?'a':'b']);assert.deepEqual(row.enc,before[index].enc);assert.deepEqual(archive.enc,before[index].enc);assert.equal((await f.db.doc('sessions/'+id+'/relationSuggestions/'+(index?'a':'b')).get()).data().status,'accepted');}assert.equal((await f.db.collection('semanticRelationChanges').get()).size,2);
  });
  test('semantic relation real full ABA rejects both source generation and reviewed authority; cancellation adds no edge or version',async()=>{
    const f=await semanticRelationFixture(),parent=f.db.doc('sessions/b'),before=(await parent.get()).data();await parent.update({syntheticABA:1});await parent.set(before);await assert.rejects(f.call('apply'),{code:'aborted'});assert.equal((await f.db.collection('semanticRelationChanges').get()).size,0);assert.equal((await f.call('cancel')).status,'cancelled');assert.equal((await f.db.collection('sessions/a/versions').get()).size,0);
  });
  test('semantic relation private roots deny every SDK principal and account deletion purges only owned receipts events and quotas',async()=>{
    const f=await semanticRelationFixture();await f.call('apply');for(const uid of ['alice','bob',null]){const client=(uid?testEnv.authenticatedContext(uid):testEnv.unauthenticatedContext()).firestore();for(const root of ['semanticRelationChanges','semanticRelationEvents','semanticRelationBudgets']){await assertFails(client.collection(root).get());await assertFails(client.doc(root+'/synthetic').get());await assertFails(client.doc(root+'/synthetic').set({uid}));await assertFails(client.doc(root+'/synthetic').delete());}}
    for(const root of ['semanticRelationChanges','semanticRelationEvents','semanticRelationBudgets'])await f.db.doc(root+'/foreign').set({uid:'bob'});const files=await purgeFixture(),deps={firestore:f.db,now:files.deps.now,attachments:files.deps,cancelBilling:async()=>{},purgeMemberships:async()=>0,purgeLegacyObjects:async()=>true,deleteAuth:async()=>{}};assert.equal((await executeAccountDeletion('alice',{uid:'alice'},deps)).status,'complete');for(const root of ['semanticRelationChanges','semanticRelationEvents','semanticRelationBudgets']){const rows=await f.db.collection(root).get();assert.equal(rows.size,1);assert.equal(rows.docs[0].id,'foreign');}
  });
  const syncConflictService=require('../lib/syncConflictResolution');
  async function syncDecisionFixture(action='apply'){
    const db=admin.firestore(),deps={firestore:db,now:()=>1000};for(const uid of ['alice','bob'])await db.doc('users/'+uid).set({});
    const cipher=n=>({v:1,iv:Buffer.alloc(12,n).toString('base64'),ct:Buffer.alloc(32,n).toString('base64')});
    await db.doc('sessions/o').set({uid:'alice',teamId:null,text:'',title:null,enc:cipher(1),timestamp:admin.firestore.Timestamp.fromMillis(1),updatedAt:admin.firestore.Timestamp.fromMillis(10),attachments:[{retained:true}],connections:['peer'],custom:{retained:true},generatedPrompt:'Synthetic legacy prompt'});
    await db.doc('sessions/c').set({uid:'alice',teamId:null,text:'',title:null,enc:cipher(2),timestamp:2,updatedAt:20,tags:['sync-conflict','new'],originalMemoryId:'o',conflictReason:'Synthetic conflict'});
    const before=await Promise.all(['o','c'].map(async id=>(await db.doc('sessions/'+id).get()).data())),target={action,conflictId:'c',conflictViewDigest:syncStateHash(before[1]),originalId:action==='apply'?'o':null,originalViewDigest:action==='apply'?syncStateHash(before[0]):null},request={operationId:require('node:crypto').randomUUID(),baseline:await syncConflictService.executeSyncConflictPreparation('alice',target,deps)};
    return{db,deps,before,target,request,call:(mode,body=request,uid='alice')=>syncConflictService.executeSyncConflictCall(uid,mode,{actorUid:uid,request:body},deps)};
  }
  test('sync conflict real concurrent retries commit the paired update full encrypted archives and one immutable receipt once',async()=>{
    const f=await syncDecisionFixture(),results=await Promise.all(Array.from({length:3},()=>f.call('apply')));for(const result of results)assert.deepEqual(result,results[0]);const original=(await f.db.doc('sessions/o').get()).data(),received=(await f.db.doc('sessions/c').get()).data();assert.deepEqual(original.enc,f.before[1].enc);assert.deepEqual(original.attachments,f.before[0].attachments);assert.deepEqual(original.connections,['peer']);assert.equal(original.generatedPrompt,null);assert.equal(received.deletedAt,1000);
    for(const[index,id]of ['o','c'].entries()){const versions=await f.db.collection('sessions/'+id+'/versions').get();assert.equal(versions.size,1);for(const[key,value]of Object.entries(f.before[index]))assert.deepEqual(versions.docs[0].data()[key],value);}assert.equal((await f.db.collection('syncConflictDecisions').get()).size,1);assert.equal((await f.db.collection('syncConflictEvents').get()).size,1);assert.equal((await f.db.collection('syncConflictBudgets').get()).docs[0].data().operations,1);await f.db.doc('sessions/o').delete();assert.deepEqual(await f.call('status'),results[0]);
  });
  test('sync conflict real updateTime ABA rejects either parent and cancellation prevents a later apply without partial history',async()=>{
    for(const id of ['o','c']){const f=await syncDecisionFixture(),row=(await f.db.doc('sessions/'+id).get()).data();await f.db.doc('sessions/'+id).set({...row,syntheticABA:true});await f.db.doc('sessions/'+id).set(row);await assert.rejects(f.call('apply'),{code:'aborted'});assert.equal((await f.db.collection('sessions/o/versions').get()).size,0);assert.equal((await f.db.collection('sessions/c/versions').get()).size,0);}
    const f=await syncDecisionFixture('discard');assert.equal((await f.call('cancel')).status,'cancelled');await assert.rejects(f.call('apply'));assert.deepEqual((await f.db.doc('sessions/c').get()).data(),f.before[1]);
  });
  test('sync conflict real keep both preserves cipher and removes only decision metadata; revoked parents stay read only',async()=>{
    const f=await syncDecisionFixture('keep-both');await f.call('apply');const row=(await f.db.doc('sessions/c').get()).data();assert.deepEqual(row.enc,f.before[1].enc);assert.deepEqual(row.tags,['new']);assert.equal('originalMemoryId' in row,false);assert.equal('conflictReason' in row,false);assert.deepEqual((await f.db.doc('sessions/o').get()).data(),f.before[0]);
    const g=await syncDecisionFixture();assert.notEqual(g.request.operationId,f.request.operationId);await g.db.doc('sessions/o').update({sharedWithIds:['bob']});for(const mode of ['status','cancel'])assert.equal((await g.call(mode)).status,'revoked');await assert.rejects(g.call('apply'),{code:'permission-denied'});
  });
  test('sync conflict private receipts events and budgets deny every SDK principal; account deletion purges owned rows only',async()=>{
    const f=await syncDecisionFixture();await f.call('apply');const roots=['syncConflictDecisions','syncConflictEvents','syncConflictBudgets'];for(const uid of ['alice','bob',null]){const client=(uid?testEnv.authenticatedContext(uid):testEnv.unauthenticatedContext()).firestore();for(const root of roots){await assertFails(client.collection(root).get());await assertFails(client.doc(root+'/synthetic').get());await assertFails(client.doc(root+'/synthetic').set({uid}));await assertFails(client.doc(root+'/synthetic').delete());}}
    for(const root of roots)await f.db.doc(root+'/foreign').set({uid:'bob'});const files=await purgeFixture(),deps={firestore:f.db,now:files.deps.now,attachments:files.deps,cancelBilling:async()=>{},purgeMemberships:async()=>0,purgeLegacyObjects:async()=>true,deleteAuth:async()=>{}};assert.equal((await executeAccountDeletion('alice',{uid:'alice'},deps)).status,'complete');for(const root of roots){const rows=await f.db.collection(root).get();assert.equal(rows.size,1);assert.equal(rows.docs[0].id,'foreign');}
  });
  const teamHistoryService=require('../lib/teamHistoryChanges');
  async function teamHistoryFixture(version=false){
    const db=admin.firestore(),deps={firestore:db,now:()=>1000},keyId='11111111-1111-4111-8111-111111111111',cipher=v=>({v,iv:Buffer.alloc(12).toString('base64'),ct:Buffer.alloc(32,v).toString('base64')});
    for(const uid of ['alice','bob'])await db.doc('users/'+uid).set({});
    await db.doc('config/teamSecurity').set({writesEnabled:false,historyReencryptionEnabled:true});
    const team={ownerUid:'alice',memberUids:['alice','bob'],roles:{bob:'admin'},activeKeyEpoch:2,activeKeyId:keyId,keyRotationStatus:'active',pendingRotationId:null,wrappedKeys:{alice:{v:1},bob:{v:1}}};
    await db.doc('teams/history-crew').set(team);await db.doc('teams/history-crew/keyEpochs/2').set({epoch:2,keyId,status:'active',memberUids:team.memberUids,wrappedKeys:team.wrappedKeys});
    await db.doc('sessions/history-p').set({uid:'alice',teamId:'history-crew',text:'',title:null,enc:cipher(1),timestamp:admin.firestore.Timestamp.fromMillis(1),updatedAt:admin.firestore.Timestamp.fromMillis(10),deletedAt:20,custom:{retained:true}});
    await db.doc('sessions/history-p/versions/v').set({text:'',title:null,enc:cipher(1),createdAt:3,previousUpdatedAt:2,editorUid:'old-author'});
    const path=version?'sessions/history-p/versions/v':'sessions/history-p',before=(await db.doc(path).get()).data(),target={teamId:'history-crew',sessionId:'history-p',versionId:version?'v':null,jobId:require('node:crypto').randomUUID(),targetEpoch:2,targetKeyId:keyId,viewDigest:syncStateHash(before),parentViewDigest:syncStateHash((await db.doc('sessions/history-p').get()).data()),teamViewDigest:syncStateHash(team)},request={operationId:require('node:crypto').randomUUID(),baseline:await teamHistoryService.executeTeamHistoryChangePreparation('bob',target,deps),priorEnc:before.enc,enc:cipher(2)};
    return{db,deps,path,before,request,call:mode=>teamHistoryService.executeTeamHistoryChangeCall('bob',mode,{actorUid:'bob',request},deps)};
  }
  test('team history real concurrent retries preserve semantic history and exact prior cipher field presence once',async()=>{
    for(const version of [false,true]){const f=await teamHistoryFixture(version),results=await Promise.all(Array.from({length:3},()=>f.call('apply')));for(const row of results)assert.deepEqual(row,results[0]);const saved=(await f.db.doc(f.path).get()).data();assert.equal(saved.rekeyRevision,1);assert.equal(saved.keyEpoch,2);assert.equal(saved.rekeyedByUid,'bob');for(const[key,value]of Object.entries(f.before))if(!['enc','teamId'].includes(key))assert.deepEqual(saved[key],value);const archive=(await f.db.doc('teamHistoryCipherArchives/'+f.request.operationId).get()).data();assert.deepEqual(archive.beforeFields.enc,{present:true,value:f.before.enc});assert.deepEqual(archive.beforeFields.keyEpoch,{present:false});assert.deepEqual(archive.beforeFields.teamId,version?{present:false}:{present:true,value:'history-crew'});assert.equal((await f.db.collection('sessions/history-p/versions').get()).size,1);await f.db.doc(f.path).delete();await f.db.doc('teams/history-crew').delete();assert.deepEqual(await f.call('status'),results[0]);}
  });
  test('team history real source parent team active and historical epoch ABA or historical key appearance abort atomically',async()=>{
    for(const path of ['sessions/history-p/versions/v','sessions/history-p','teams/history-crew','teams/history-crew/keyEpochs/2','teams/history-crew/keyEpochs/1']){const f=await teamHistoryFixture(true),ref=f.db.doc(path),before=(await ref.get()).data();if(before){await ref.set({...before,syntheticABA:true});await ref.set(before);}else await ref.set({epoch:1,status:'historical'});await assert.rejects(f.call('apply'),{code:'aborted'});assert.deepEqual((await f.db.doc(f.path).get()).data(),f.before);for(const root of ['teamHistoryChanges','teamHistoryCipherArchives','teamHistoryEvents'])assert.equal((await f.db.doc(root+'/'+f.request.operationId).get()).exists,false);assert.equal((await f.call('cancel')).status,'cancelled');}
  });
  test('team history unknown cancellation remains available during rotation; source revocation and disabled maintenance cannot mutate history',async()=>{
    const f=await teamHistoryFixture();await f.db.doc('teams/history-crew').update({keyRotationStatus:'rotating'});await f.db.doc('teams/history-crew/keyEpochs/2').delete();assert.equal((await f.call('cancel')).status,'cancelled');await assert.rejects(f.call('apply'));assert.deepEqual((await f.db.doc(f.path).get()).data(),f.before);
    const g=await teamHistoryFixture();await g.db.doc('config/teamSecurity').update({historyReencryptionEnabled:false});await assert.rejects(g.call('apply'));await g.db.doc('sessions/history-p').delete();assert.equal((await g.call('cancel')).status,'revoked');assert.equal((await g.db.doc('teamHistoryChanges/'+g.request.operationId).get()).exists,false);
  });
  test('team history private roots deny every SDK principal and account purge removes only actor-owned rows',async()=>{
    const f=await teamHistoryFixture();await f.call('apply');const roots=['teamHistoryChanges','teamHistoryEvents','teamHistoryCipherArchives','teamHistoryBudgets','teamHistoryTeamBudgets'];for(const uid of ['alice','bob',null]){const client=(uid?testEnv.authenticatedContext(uid):testEnv.unauthenticatedContext()).firestore();for(const root of roots){await assertFails(client.collection(root).get());await assertFails(client.doc(root+'/synthetic').get());await assertFails(client.doc(root+'/synthetic').set({uid}));await assertFails(client.doc(root+'/synthetic').delete());}}
    for(const root of roots)await f.db.doc(root+'/foreign').set({uid:'alice',teamId:'other'});const files=await purgeFixture(),deps={firestore:f.db,now:files.deps.now,attachments:files.deps,cancelBilling:async()=>{},purgeMemberships:async()=>0,purgeLegacyObjects:async()=>true,deleteAuth:async()=>{}};assert.equal((await executeAccountDeletion('bob',{uid:'bob'},deps)).status,'complete');for(const root of roots.slice(0,4)){const rows=await f.db.collection(root).get();assert.equal(rows.size,1);assert.equal(rows.docs[0].id,'foreign');}assert.equal((await f.db.collection('teamHistoryTeamBudgets').get()).size,2);
  });
  test('team history team deletion purges all cipher archives receipts events and both budget scopes without touching another team',async()=>{
    const f=await teamHistoryFixture();await f.call('apply');const roots=['teamHistoryChanges','teamHistoryEvents','teamHistoryCipherArchives','teamHistoryBudgets','teamHistoryTeamBudgets'];for(const root of roots)await f.db.doc(root+'/foreign').set({uid:'bob',teamId:'other'});const files=await purgeFixture();assert.equal((await executeDeleteTeam('alice',{teamId:'history-crew',expectedUid:'alice'},{firestore:f.db,now:files.deps.now,attachments:files.deps})).status,'complete');for(const root of roots){const rows=await f.db.collection(root).get();assert.equal(rows.size,1);assert.equal(rows.docs[0].id,'foreign');}
  });
  const personalMigrationService=require('../lib/personalMigration');
  async function personalMigrationFixture(kind='session'){
    const db=admin.firestore(),deps={firestore:db,now:()=>1000};for(const uid of ['alice','bob'])await db.doc('users/'+uid).set({});await db.doc('sessions/p').set({uid:'alice',teamId:null,text:'Synthetic parent',title:'Synthetic title',timestamp:admin.firestore.Timestamp.fromMillis(1),updatedAt:admin.firestore.Timestamp.fromMillis(10),unknown:{retained:true},nodes:[{retained:true}]});
    await db.doc('sessions/p/versions/v').set({text:'Synthetic historical',createdAt:3,previousUpdatedAt:2,unknown:{history:true}});await db.doc('users/alice/memories/n').set({text:'Synthetic nested',unknown:{nested:true}});
    const path=kind==='session'?'sessions/p':kind==='version'?'sessions/p/versions/v':'users/alice/memories/n',before=(await db.doc(path).get()).data(),target={kind,recordId:kind==='session'?'p':kind==='version'?'v':'n',sessionId:kind==='version'?'p':null,viewDigest:syncStateHash(before),parentViewDigest:kind==='version'?syncStateHash((await db.doc('sessions/p').get()).data()):null},cipher={v:1,iv:Buffer.alloc(12).toString('base64'),ct:Buffer.alloc(32,1).toString('base64')},request={operationId:require('node:crypto').randomUUID(),baseline:await personalMigrationService.executePersonalMigrationPreparation('alice',target,deps),enc:cipher,archive:[cipher,cipher]};return{db,deps,path,before,target,request,call:(mode,body=request,uid='alice')=>personalMigrationService.executePersonalMigrationCall(uid,mode,{actorUid:uid,request:body},deps)};
  }
  test('personal migration real concurrent replays preserve all three record kinds and metadata with one complete archive and immutable receipt',async()=>{
    for(const kind of ['session','version','nested']){const f=await personalMigrationFixture(kind),results=await Promise.all(Array.from({length:3},()=>f.call('apply')));for(const result of results)assert.deepEqual(result,results[0]);const row=(await f.db.doc(f.path).get()).data();assert.equal(row.text,'');assert.equal(row.title,null);assert.deepEqual(row.enc,f.request.enc);assert.equal(row.personalMigrationId,f.request.operationId);for(const[key,value]of Object.entries(f.before))if(!['text','title'].includes(key))assert.deepEqual(row[key],value);assert.equal('updatedAt' in row,'updatedAt' in f.before);assert.equal('uid' in row,'uid' in f.before);const archive=await personalMigrationService.executePersonalMigrationArchive('alice',{actorUid:'alice',request:{operationId:f.request.operationId}},f.deps);assert.deepEqual(archive.chunks,f.request.archive);await f.db.doc(f.path).delete();assert.deepEqual(await f.call('status'),results[0]);}
  });
  test('personal migration real full ABA on source and version parent refuses without any chunk manifest event receipt or partial conversion',async()=>{
    for(const which of ['source','parent']){const f=await personalMigrationFixture('version'),path=which==='source'?f.path:'sessions/p',row=(await f.db.doc(path).get()).data();await f.db.doc(path).set({...row,syntheticABA:true});await f.db.doc(path).set(row);await assert.rejects(f.call('apply'),{code:'aborted'});assert.deepEqual((await f.db.doc(f.path).get()).data(),f.before);for(const root of ['personalMigrations','personalMigrationArchives','personalMigrationEvents'])assert.equal((await f.db.doc(root+'/'+f.request.operationId).get()).exists,false);assert.equal((await f.call('cancel')).status,'cancelled');await assert.rejects(f.call('apply'));}
  });
  test('personal migration real archive access is owned and complete; parent revocation is read only and a corrupt stored chunk fails closed',async()=>{
    const f=await personalMigrationFixture();await f.call('apply');await assert.rejects(personalMigrationService.executePersonalMigrationArchive('bob',{actorUid:'bob',request:{operationId:f.request.operationId}},f.deps),{code:'permission-denied'});await f.db.doc(`personalMigrationArchives/${f.request.operationId}/chunks/1`).delete();await assert.rejects(personalMigrationService.executePersonalMigrationArchive('alice',{actorUid:'alice',request:{operationId:f.request.operationId}},f.deps));const g=await personalMigrationFixture('version');await g.db.doc('sessions/p').update({teamId:'crew'});for(const mode of ['status','cancel'])assert.equal((await g.call(mode)).status,'revoked');await assert.rejects(g.call('apply'),{code:'permission-denied'});
  });
  test('personal migration SDK private roots and chunks deny every principal; account purge removes complete owned archive trees and retains foreign ciphertext',async()=>{
    const f=await personalMigrationFixture();await f.call('apply');const roots=['personalMigrations','personalMigrationEvents','personalMigrationBudgets','personalMigrationArchives'];for(const uid of ['alice','bob',null]){const client=(uid?testEnv.authenticatedContext(uid):testEnv.unauthenticatedContext()).firestore();for(const root of roots){await assertFails(client.collection(root).get());await assertFails(client.doc(root+'/synthetic').get());await assertFails(client.doc(root+'/synthetic').set({uid}));await assertFails(client.doc(root+'/synthetic').delete());}const chunk=client.doc(`personalMigrationArchives/${f.request.operationId}/chunks/0`);await assertFails(chunk.get());await assertFails(chunk.set({uid}));await assertFails(chunk.delete());}
    for(const root of roots)await f.db.doc(root+'/foreign').set({uid:'bob'});await f.db.doc('personalMigrationArchives/foreign/chunks/0').set({uid:'bob',enc:f.request.enc});const files=await purgeFixture(),deps={firestore:f.db,now:files.deps.now,attachments:files.deps,cancelBilling:async()=>{},purgeMemberships:async()=>0,purgeLegacyObjects:async()=>true,deleteAuth:async()=>{}};assert.equal((await executeAccountDeletion('alice',{uid:'alice'},deps)).status,'complete');for(const root of roots){const rows=await f.db.collection(root).get();assert.equal(rows.size,1);assert.equal(rows.docs[0].id,'foreign');}assert.equal((await f.db.doc(`personalMigrationArchives/${f.request.operationId}/chunks/0`).get()).exists,false);assert.deepEqual((await f.db.doc('personalMigrationArchives/foreign/chunks/0').get()).data().enc,f.request.enc);
  });
  async function semanticClusterFixture(teamId=null){
    const db=admin.firestore(),deps={firestore:db,now:()=>Date.parse('2026-10-14T12:00:00Z')};
    for(const uid of ['alice','bob','owner','foreign'])await db.doc('users/'+uid).set({});
    if(teamId){const keyId='11111111-1111-4111-8111-111111111111',team={ownerUid:'owner',memberUids:['alice','bob','owner'],wrappedKeys:{owner:{v:1},alice:{v:1},bob:{v:1}},activeKeyEpoch:2,activeKeyId:keyId,keyRotationStatus:'active',pendingRotationId:null};await db.doc('teams/'+teamId).set(team);await db.doc('teams/'+teamId+'/keyEpochs/2').set({epoch:2,keyId,status:'active',memberUids:team.memberUids,wrappedKeys:team.wrappedKeys});await db.doc('config/teamSecurity').set({writesEnabled:true});}
    for(const[index,id]of ['a','b'].entries())await db.doc('sessions/'+id).set({uid:teamId&&index?'bob':'alice',teamId,timestamp:admin.firestore.Timestamp.fromMillis(1),updatedAt:admin.firestore.Timestamp.fromMillis(10),connections:[index?'a':'b'],enc:{v:1,iv:Buffer.alloc(12).toString('base64'),ct:Buffer.alloc(32,index+1).toString('base64')},custom:{unchanged:true},attachments:[{retained:true}]});
    const {canonicalSyncState}=require('../lib/mobileSyncImportContract'),hash=value=>createHash('sha256').update(value).digest('hex'),target={scope:{teamId},views:await Promise.all(['a','b'].map(async sessionId=>({sessionId,graphHash:hash(canonicalSyncState(semanticClusterContract.semanticClusterGraphProjection(sessionId,(await db.doc('sessions/'+sessionId).get()).data())))})))},prepared=await semanticClusters.executeSemanticClusterPreparation('alice',target,deps),namespace=hash(canonicalSyncState({uid:teamId===null?'alice':null,teamId})).slice(0,32),patches=require('../lib/semanticClusterGraph').buildSemanticClusterBackfillPatches([{id:'a',connections:['b']},{id:'b',connections:['a']}],namespace).map(row=>({sessionId:row.id,semanticClusterId:row.semanticClusterId})),input={...prepared,operationId:'22222222-2222-4222-8222-222222222222',patches};
    return{db,deps,target,input,call:(mode,request=input,uid='alice')=>semanticClusters.executeSemanticClusterCall(uid,mode,{actorUid:uid,request},deps)};
  }
  test('semantic cluster committed receipt timestamps advance exact full document versions across batches without rewriting ciphertext',async()=>{
    for(const teamId of [null,'crew']){await testEnv.clearFirestore();const f=await semanticClusterFixture(teamId),original=await Promise.all(['a','b'].map(async id=>(await f.db.doc('sessions/'+id).get()).data())),first={...f.input,patches:f.input.patches.slice(0,1)},results=await Promise.all(Array.from({length:3},()=>f.call('apply',first)));for(const result of results)assert.deepEqual(result,results[0]);assert.equal(results[0].changed,1);
      const next={...f.input,operationId:'33333333-3333-4333-8333-333333333333',patches:f.input.patches.slice(1),dependencies:f.input.dependencies.map(row=>({...row,stateHash:results[0].dependencyUpdates.find(update=>update.sessionId===row.sessionId)?.stateHash??row.stateHash}))};assert.equal((await f.call('apply',next)).changed,1);
      for(const[index,id]of ['a','b'].entries()){const row=(await f.db.doc('sessions/'+id).get()).data();for(const key of ['enc','connections','uid','attachments','custom','timestamp'])assert.deepEqual(row[key],original[index][key]);assert.equal((await f.db.collection('sessions/'+id+'/versions').get()).size,0);}assert.equal((await f.db.collection('semanticClusterChanges').get()).size,2);}
  });
  test('semantic cluster complete outgoing graph full ABA and content versions refuse stale or partial batches',async()=>{
    const f=await semanticClusterFixture();await assert.rejects(semanticClusters.executeSemanticClusterPreparation('alice',{...f.target,views:f.target.views.slice(0,1)},f.deps),{code:'aborted'});const ref=f.db.doc('sessions/a'),before=(await ref.get()).data();await ref.update({custom:{changed:true}});await ref.set(before);await assert.rejects(f.call('apply'),{code:'aborted'});assert.equal((await f.db.collection('semanticClusterChanges').get()).size,0);
  });
  test('semantic cluster private receipts events and budgets deny every SDK principal and foreign captured commands',async()=>{
    const f=await semanticClusterFixture('crew');await assert.rejects(semanticClusters.executeSemanticClusterCall('bob','apply',{actorUid:'alice',request:f.input},f.deps),{code:'permission-denied'});await f.call('apply');for(const uid of ['alice','bob','owner','foreign',null]){const client=(uid?testEnv.authenticatedContext(uid):testEnv.unauthenticatedContext()).firestore();for(const root of ['semanticClusterChanges','semanticClusterEvents','semanticClusterBudgets','semanticClusterTeamBudgets']){await assertFails(client.collection(root).get());await assertFails(client.doc(root+'/synthetic').set({uid}));await assertFails(client.doc(root+'/synthetic').get());await assertFails(client.doc(root+'/synthetic').delete());}}
  });
  test('semantic cluster participant deletion purges private references while retaining unrelated records',async()=>{
    const f=await semanticClusterFixture('crew');await f.call('apply');const files=await purgeFixture();for(const root of ['semanticClusterChanges','semanticClusterEvents'])await f.db.doc(root+'/foreign').set({uid:'owner',ownerUid:'owner',authorUids:['owner'],teamId:'other'});const deps={firestore:f.db,now:files.deps.now,attachments:files.deps,cancelBilling:async()=>{},purgeMemberships:async()=>0,purgeLegacyObjects:async()=>true,deleteAuth:async()=>{}};assert.equal((await executeAccountDeletion('bob',{uid:'bob'},deps)).status,'complete');for(const root of ['semanticClusterChanges','semanticClusterEvents']){assert.equal((await f.db.doc(root+'/'+f.input.operationId).get()).exists,false);assert.equal((await f.db.doc(root+'/foreign').get()).exists,true);}assert.equal((await f.call('cancel')).status,'revoked');
  });
  async function teamConnectionFixture(){
    const db=admin.firestore(),now=Date.parse('2026-10-14T12:00:00Z'),keyId='11111111-1111-4111-8111-111111111111';for(const uid of ['owner','alice','bob','foreign'])await db.doc('users/'+uid).set({});
    const team={ownerUid:'owner',memberUids:['owner','alice','bob'],wrappedKeys:{owner:{v:1},alice:{v:1},bob:{v:1}},activeKeyEpoch:2,activeKeyId:keyId,keyRotationStatus:'active',pendingRotationId:null};await db.doc('teams/crew').set(team);await db.doc('teams/crew/keyEpochs/2').set({epoch:2,keyId,status:'active',memberUids:team.memberUids,wrappedKeys:team.wrappedKeys});await db.doc('config/teamSecurity').set({writesEnabled:true});
    const priorEncs=[1,2].map(byte=>({v:1,iv:Buffer.alloc(12).toString('base64'),ct:Buffer.alloc(32,byte).toString('base64')}));for(const[index,id]of ['a','b'].entries())await db.doc('sessions/'+id).set({uid:index?'bob':'alice',teamId:'crew',enc:priorEncs[index],text:'',title:null,timestamp:admin.firestore.Timestamp.fromMillis(1),updatedAt:admin.firestore.Timestamp.fromMillis(10+index),connections:['peer-'+id],attachments:[{retained:true}],learning:{source:'text-generation'},generatedProvider:'synthetic',custom:{preserved:true}});
    const deps={firestore:db,now:()=>now},input={operationId:'22222222-2222-4222-8222-222222222222',operation:'link',baselines:await executeTeamConnectionPreparation('alice',{teamId:'crew',sessionIds:['a','b']},deps),priorEncs,encs:[3,4].map(byte=>({v:2,iv:Buffer.alloc(12).toString('base64'),ct:Buffer.alloc(32,byte).toString('base64')}))};return{db,input,deps,call:(mode,request=input,uid='alice')=>executeTeamConnectionCall(uid,mode,{actorUid:uid,request},deps)};
  }
  test('team connection recovery concurrent nonces create two exact archives and one receipt event shared quota with no new charges on replay',async()=>{
    const f=await teamConnectionFixture(),before=await Promise.all(['a','b'].map(async id=>(await f.db.doc('sessions/'+id).get()).data())),results=await Promise.all(Array.from({length:3},()=>f.call('apply')));for(const result of results)assert.deepEqual(result,results[0]);
    for(const[index,id]of ['a','b'].entries()){const row=(await f.db.doc('sessions/'+id).get()).data(),versions=await f.db.collection('sessions/'+id+'/versions').get();assert.equal(versions.size,1);assert.deepEqual(versions.docs[0].data().enc,before[index].enc);assert.deepEqual(versions.docs[0].data().learning,before[index].learning);assert.ok(versions.docs[0].data().timestamp.isEqual(before[index].timestamp));assert.equal(versions.docs[0].data().keyEpoch,1);assert.equal(versions.docs[0].data().keyId,null);assert.deepEqual(row.connections,[...before[index].connections,['b','a'][index]]);assert.equal(row.uid,before[index].uid);assert.deepEqual(row.custom,before[index].custom);assert.deepEqual(row.attachments,before[index].attachments);}
    assert.equal((await f.db.collection('teamConnectionChanges').get()).size,1);assert.equal((await f.db.collection('teamConnectionEvents').get()).size,1);assert.equal((await f.db.collection('memoryEditBudgets').get()).docs[0].data().operations,1);await f.db.doc('teams/crew').update({memberUids:['owner']});assert.deepEqual(await f.call('status'),results[0]);assert.deepEqual(await f.call('apply'),results[0]);assert.equal((await f.db.collection('memoryEditBudgets').get()).docs[0].data().operations,1);
  });
  test('team connection recovery pins full Firestore document and team epoch versions including changed then restored values',async()=>{
    const f=await teamConnectionFixture();for(const path of ['sessions/a','sessions/b','teams/crew','teams/crew/keyEpochs/2']){f.input.baselines=await executeTeamConnectionPreparation('alice',{teamId:'crew',sessionIds:['a','b']},f.deps);const ref=f.db.doc(path),before=(await ref.get()).data();await ref.update({syntheticABA:1});await ref.set(before);await assert.rejects(f.call('apply'),{code:'aborted'});assert.equal((await f.db.collection('teamConnectionChanges').get()).size,0);assert.equal((await f.db.collection('memoryEditBudgets').get()).size,0);assert.equal((await f.db.collection('sessions/a/versions').get()).size,0);assert.equal((await f.db.collection('sessions/b/versions').get()).size,0);}
  });
  test('team connection recovery cancel serializes against apply and a no-op never rewrites parent histories',async()=>{
    const f=await teamConnectionFixture(),results=await Promise.allSettled([f.call('apply'),f.call('cancel')]);assert.equal(results[1].status,'fulfilled');const terminal=results[1].value;assert.equal((await f.db.collection('sessions/a/versions').get()).size,terminal.status==='committed'?1:0);assert.equal((await f.db.collection('sessions/b/versions').get()).size,terminal.status==='committed'?1:0);if(terminal.status==='cancelled')await assert.rejects(f.call('apply'));
    await f.db.doc('sessions/a').update({connections:['peer-a','b']});await f.db.doc('sessions/b').update({connections:['peer-b','a']});const noop={...f.input,operationId:'33333333-3333-4333-8333-333333333333',baselines:await executeTeamConnectionPreparation('alice',{teamId:'crew',sessionIds:['a','b']},f.deps),priorEncs:await Promise.all(['a','b'].map(async id=>(await f.db.doc('sessions/'+id).get()).data().enc)),encs:[null,null]},before=await f.db.doc('sessions/a').get(),count=(await f.db.collection('sessions/a/versions').get()).size;assert.equal((await f.call('apply',noop)).changed,false);assert.ok((await f.db.doc('sessions/a').get()).updateTime.isEqual(before.updateTime));assert.equal((await f.db.collection('sessions/a/versions').get()).size,count);
  });
  test('team connection recovery private roots deny SDK and captured token mismatch cannot mutate any pair',async()=>{
    const f=await teamConnectionFixture();await assert.rejects(executeTeamConnectionCall('bob','apply',{actorUid:'alice',request:f.input},f.deps),{code:'permission-denied'});await assert.rejects(f.call('apply',f.input,'foreign'),{code:'permission-denied'});assert.equal((await f.db.collection('teamConnectionChanges').get()).size,0);await f.call('apply');for(const uid of ['owner','alice','bob','foreign',null]){const client=(uid?testEnv.authenticatedContext(uid):testEnv.unauthenticatedContext()).firestore();for(const root of ['teamConnectionChanges','teamConnectionEvents']){await assertFails(client.doc(root+'/'+f.input.operationId).get());await assertFails(client.doc(root+'/'+f.input.operationId).set({uid}));await assertFails(client.doc(root+'/'+f.input.operationId).delete());await assertFails(client.collection(root).get());}}
  });
  test('team connection recovery account purge removes both author and owner references and revocation creates no replacements',async()=>{
    const f=await teamConnectionFixture();await f.call('apply');const files=await purgeFixture();for(const root of ['teamConnectionChanges','teamConnectionEvents'])await f.db.doc(root+'/foreign').set({uid:'owner',ownerUid:'owner',authorUids:['owner','alice'],teamId:'other'});const deps={firestore:f.db,now:files.deps.now,attachments:files.deps,cancelBilling:async()=>{},purgeMemberships:async()=>0,purgeLegacyObjects:async()=>true,deleteAuth:async()=>{}};assert.equal((await executeAccountDeletion('bob',{uid:'bob'},deps)).status,'complete');for(const root of ['teamConnectionChanges','teamConnectionEvents']){assert.equal((await f.db.doc(root+'/'+f.input.operationId).get()).exists,false);assert.equal((await f.db.doc(root+'/foreign').get()).exists,true);}assert.equal((await f.call('cancel')).status,'revoked');assert.equal((await f.db.doc('teamConnectionChanges/'+f.input.operationId).get()).exists,false);
  });
  test('team connection recovery unknown cancellation works during rotation without an active key document and never admits a graph mutation',async()=>{
    const f=await teamConnectionFixture();await f.db.doc('teams/crew').update({keyRotationStatus:'rotation_pending',pendingRotationId:f.input.operationId});await f.db.doc('teams/crew/keyEpochs/2').delete();assert.equal((await f.call('status')).status,'unknown');await assert.rejects(f.call('apply'));assert.equal((await f.call('cancel')).status,'cancelled');assert.equal((await f.db.collection('sessions/a/versions').get()).size,0);assert.equal((await f.db.collection('sessions/b/versions').get()).size,0);assert.equal((await f.db.collection('memoryEditBudgets').get()).size,0);
  });
  const documentId=index=>'11111111-1111-4111-8111-'+String(index).padStart(12,'0');
  async function documentFixture(count=12,attachment=false){
    const files=await purgeFixture();const db=files.db;await db.doc('users/bob').set({});const enc={v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)};const importId=documentId(9999);
    const record=attachment?await files.create(documentId(5000)):null;const attachmentIds=record?[record.header.id]:[];
    const memories=Array.from({length:count+1},(_,i)=>({sessionId:documentId(i),role:i===0?'hub':'document',enc,attachmentIds:i<2?attachmentIds:[],metadata:{tags:['Synthetic'],connections:[],parentId:i===0?null:documentId(0),
      learning:{schemaVersion:1,source:i===0?'document-batch':'document-upload',modality:'document',learnedAt:10,batchId:importId,attachmentCount:i<2?attachmentIds.length:0}}}));
    const plan=parseDocumentImportPlan({importId,memories,attachments:record?[{id:record.header.id,headerDigest:record.digest}]:[],edges:memories.slice(1).map(item=>({sourceId:documentId(0),targetId:item.sessionId}))});
    const identity={importId,planDigest:documentPlanDigest(plan)};const deps={firestore:db,now:()=>1000};
    return{db,enc,plan,identity,deps,record,files,batches:documentPlanBatches(plan).map(batch=>({...identity,...batch})),call:(value,mode)=>executeDocumentImport('alice',value,mode,deps)};
  }
  test('document-import concurrent admissions and replayed batches create and count once, then preserve exact reciprocal hierarchy/history',async()=>{
    const f=await documentFixture(12,true);await Promise.all(Array.from({length:4},()=>f.call(f.plan,'begin')));
    const budgets=await f.db.collection('documentImportBudgets').get();assert.equal(budgets.size,1);assert.equal(budgets.docs[0].data().imports,1);
    for(const batch of f.batches)await Promise.all(Array.from({length:3},()=>f.call(batch,'apply')));
    const status=await f.call(f.identity,'status');assert.equal(status.status,'complete');assert.equal(status.createdCount,13);assert.equal(status.linkedCount,12);
    assert.equal((await f.db.doc('users/alice').get()).data().usage.memoriesThisMonth,13);assert.equal((await f.db.doc('attachmentUploads/'+f.record.header.id).get()).data().referenceRevision,1);
    for(const item of f.plan.memories){const snapshot=await f.db.doc('sessions/'+item.sessionId).get();const saved=snapshot.data();assert.deepEqual(saved.enc,f.enc);assert.equal(saved.text,'');assert.equal(saved.title,null);
      assert.deepEqual(saved.connections.sort(),f.plan.edges.filter(edge=>edge.sourceId===item.sessionId||edge.targetId===item.sessionId).map(edge=>edge.sourceId===item.sessionId?edge.targetId:edge.sourceId).sort());
      assert.equal((await snapshot.ref.collection('versions').get()).size,1);await accountCreatedSessionUsage(f.db,item.sessionId,'alice',1000);
    }
    assert.equal((await f.db.doc('users/alice').get()).data().usage.memoriesThisMonth,13);
    await f.db.doc('sessions/'+documentId(1)).delete();for(const batch of f.batches)await f.call(batch,'apply');assert.equal((await f.db.doc('sessions/'+documentId(1)).get()).exists,false);
  });
  test('document-import cancellation races admission and creation without reverting confirmed batches or charging incomplete work',async()=>{
    const f=await documentFixture();await Promise.allSettled([f.call(f.plan,'begin'),f.call(f.identity,'cancel')]);assert.equal((await f.call(f.identity,'status')).status,'cancelled');await assert.rejects(f.call(f.plan,'begin'));
    const nextId=documentId(9998);const plan=structuredClone(f.plan);plan.importId=nextId;for(const memory of plan.memories)memory.metadata.learning.batchId=nextId;
    const identity={importId:nextId,planDigest:documentPlanDigest(plan)};const batches=documentPlanBatches(plan).map(batch=>({...identity,...batch}));await f.call(plan,'begin');
    await Promise.allSettled([f.call(batches[0],'apply'),f.call(identity,'cancel')]);const status=await f.call(identity,'status');assert.equal(status.status,'cancelled');assert.ok([0,10].includes(status.createdCount));
    assert.equal((await f.db.collection('sessions').get()).size,status.createdCount);assert.equal((await f.db.doc('users/alice').get()).data().usage?.memoriesThisMonth??0,status.createdCount);await assert.rejects(f.call(batches[1],'apply'));
  });
  test('document-import attachment association serializes against purge; either the full batch references a retained original or creates nothing',async()=>{
    const f=await documentFixture(2,true);await f.call(f.plan,'begin');await Promise.allSettled([f.call(f.batches[0],'apply'),requestReadyAttachmentPurge('alice',f.record.header.id,'unreferenced',f.files.deps)]);
    const record=(await f.db.doc('attachmentUploads/'+f.record.header.id).get()).data();const notes=await f.db.collection('sessions').get();assert.equal(notes.size,record.purgeState==null?3:0);
    assert.equal((await f.db.doc('users/alice').get()).data().usage?.memoriesThisMonth??0,notes.size);if(notes.size)assert.equal(record.referenceRevision,1);
  });
  test('document-import changed header, unavailable attachment and altered ciphertext/parent stop whole batches without progress',async()=>{
    const f=await documentFixture(2,true);await f.call(f.plan,'begin');const original=structuredClone(f.record);
    await f.db.doc('attachmentUploads/'+f.record.header.id).update({status:'reserved',quotaReserved:true});await assert.rejects(f.call(f.batches[0],'apply'));assert.equal((await f.db.collection('sessions').get()).size,0);
    const changed=structuredClone(original);changed.header.iv='D'.repeat(16);changed.digest=createHash('sha256').update(encodeAttachmentHeader(changed.header)).digest('hex');await f.db.doc('attachmentUploads/'+f.record.header.id).set(changed);
    await assert.rejects(f.call(f.batches[0],'apply'));assert.equal((await f.db.collection('sessions').get()).size,0);await f.db.doc('attachmentUploads/'+f.record.header.id).set(original);await f.call(f.batches[0],'apply');
    const session=f.db.doc('sessions/'+documentId(1));const before=(await session.get()).data();for(const patch of [{enc:{...f.enc,ct:'C'.repeat(32)}},{parentId:documentId(20)},{uid:'bob'},{teamId:'crew'},{sharedWithIds:['bob']}]){
      await session.set({...before,...patch});await assert.rejects(f.call(f.batches[1],'apply'));assert.deepEqual((await f.db.doc('sessions/'+documentId(0)).get()).data().connections,[]);assert.equal((await f.call(f.identity,'status')).nextBatch,1);
    }
  });
  test('document-import private roots, batches and budgets deny direct owner/foreign/anonymous reads and writes',async()=>{
    const f=await documentFixture(2);await f.call(f.plan,'begin');await f.call(f.batches[0],'apply');const budget=(await f.db.collection('documentImportBudgets').get()).docs[0].ref.path;
    for(const client of [testEnv.authenticatedContext('alice').firestore(),testEnv.authenticatedContext('bob').firestore(),testEnv.unauthenticatedContext().firestore()])for(const path of ['documentImports/'+f.plan.importId,'documentImports/'+f.plan.importId+'/batches/0',budget]){
      await assertFails(client.doc(path).get());await assertFails(client.doc(path).set({uid:'alice'}));await assertFails(client.doc(path).delete());
    }
  });
  async function obsidianFixture(count=13){
    const db=admin.firestore();const enc={v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)};await db.doc('users/alice').set({});await db.doc('users/bob').set({});
    const plan=parseObsidianImportPlan({importId:'synthetic-vault',source:'obsidian-vault',memories:Array.from({length:count},(_,index)=>({sessionId:`note-${String(index).padStart(3,'0')}`,role:'note',enc,metadata:{tags:['Synthetic']}})),
      edges:Array.from({length:count-1},(_,index)=>({sourceId:`note-${String(index).padStart(3,'0')}`,targetId:`note-${String(index+1).padStart(3,'0')}`,kind:'wikilink'}))});
    const identity={importId:plan.importId,planDigest:obsidianPlanDigest(plan)};const deps={firestore:db,now:()=>1000};
    return{db,enc,plan,identity,deps,batches:obsidianPlanBatches(plan).map(batch=>({...identity,...batch})),call:(value,mode)=>executeObsidianImport('alice',value,mode,deps)};
  }
  test('capsule pack final batch, usage, count and derived author notice are atomic across concurrent retries and lost ACKs',async()=>{
    const f=await obsidianFixture();const share=f.db.doc('shares/synthetic-capsule');await share.set({uid:'bob',encrypted:true,ciphertext:{v:1,alg:'AES-GCM-PBKDF2',salt:'A'.repeat(24),iv:'B'.repeat(16),data:'C'.repeat(40)},importCount:0});
    const plan=parseObsidianImportPlan({...f.plan,source:'capsule-import',capsule:{shareId:'synthetic-capsule'},edges:[]});const identity={importId:plan.importId,planDigest:obsidianPlanDigest(plan)};const batches=obsidianPlanBatches(plan).map(batch=>({...identity,...batch}));
    await Promise.all(Array.from({length:3},()=>f.call(plan,'begin')));await Promise.all(Array.from({length:3},()=>f.call(batches[0],'apply')));
    assert.equal((await share.get()).data().importCount,0);assert.equal((await f.db.collection('capsuleImportNotices').get()).size,0);
    await f.db.doc('accountDeletions/bob').set({status:'complete'});await assert.rejects(f.call(batches[1],'apply'));assert.equal((await f.db.collection('sessions').get()).size,10);assert.equal((await f.call(identity,'status')).nextBatch,1);
    await f.db.doc('accountDeletions/bob').delete();await Promise.all(Array.from({length:4},()=>f.call(batches[1],'apply')));
    assert.equal((await f.call(identity,'status')).status,'complete');assert.equal((await share.get()).data().importCount,1);assert.equal((await f.db.doc('users/alice').get()).data().usage.memoriesThisMonth,13);
    const notices=await f.db.collection('capsuleImportNotices').get();assert.equal(notices.size,1);assert.equal(notices.docs[0].id,plan.importId);assert.equal(notices.docs[0].data().ownerUid,'bob');assert.equal(notices.docs[0].data().titleHint,null);assert.equal(notices.docs[0].data().itemCount,13);
    assert.match(capsuleNoticeSourceDigest(notices.docs[0].id,notices.docs[0].data()),/^[a-f0-9]{64}$/);
    await share.delete();await f.db.doc('sessions/note-012').delete();await f.call(batches[1],'apply');assert.equal((await f.db.collection('sessions').get()).size,12);assert.equal((await f.db.collection('capsuleImportNotices').get()).size,1);
  });
  test('capsule revocation interrupts pending import while preserving committed memories and recoverable cancellation',async()=>{
    const f=await obsidianFixture(),share=f.db.doc('shares/synthetic-capsule');
    await share.set({uid:'bob',encrypted:true,ciphertext:{v:1,alg:'AES-GCM-PBKDF2',salt:'A'.repeat(24),iv:'B'.repeat(16),data:'C'.repeat(40)},importCount:0});
    const plan=parseObsidianImportPlan({...f.plan,source:'capsule-import',capsule:{shareId:'synthetic-capsule'},edges:[]});
    const identity={importId:plan.importId,planDigest:obsidianPlanDigest(plan)},batches=obsidianPlanBatches(plan).map(batch=>({...identity,...batch}));
    await f.call(plan,'begin');await f.call(batches[0],'apply');
    const deps={firestore:f.db,now:()=>1000,enabled:()=>false,admit:async()=>false,admitRevoke:async()=>true,auth:{getUser:async uid=>({uid,disabled:false})}};
    await executeRevokePublicCapsule('bob',{v:2,actorUid:'bob',shareId:'synthetic-capsule',sourceToken:capsuleOwnerSourceToken('synthetic-capsule',await share.get())},deps);
    await assert.rejects(f.call(batches[1],'apply'));assert.equal((await f.db.collection('sessions').get()).size,10);
    assert.equal((await share.get()).data().importCount,0);assert.equal((await f.db.collection('capsuleImportNotices').get()).size,0);
    assert.equal((await f.call(identity,'status')).nextBatch,1);await f.call(identity,'cancel');
    assert.equal((await f.call(identity,'status')).status,'cancelled');assert.equal((await f.db.collection('sessions').get()).size,10);
    assert.equal((await f.db.doc('users/alice').get()).data().usage.memoriesThisMonth,10);
  });
  test('obsidian-import concurrent admissions and lost-ACK batch retries charge once and preserve cipher/history/reciprocal links',async()=>{
    const f=await obsidianFixture();await Promise.all(Array.from({length:4},()=>f.call(f.plan,'begin')));
    const budget=await f.db.collection('obsidianImportBudgets').get();assert.equal(budget.size,1);assert.equal(budget.docs[0].data().imports,1);assert.equal(budget.docs[0].data().memories,13);
    for(const batch of f.batches)await Promise.all(Array.from({length:3},()=>f.call(batch,'apply')));
    const status=await f.call(f.identity,'status');assert.equal(status.status,'complete');assert.equal(status.createdCount,13);assert.equal(status.linkedCount,12);
    assert.equal((await f.db.collection('memoryCreationReceipts').get()).size,13);assert.equal((await f.db.collection('memoryUsageReceipts').get()).size,13);assert.equal((await f.db.collection('obsidianImports/synthetic-vault/batches').get()).size,3);
    for(const item of f.plan.memories){const snapshot=await f.db.doc(`sessions/${item.sessionId}`).get();const memory=snapshot.data();assert.equal(memory.uid,'alice');assert.equal(memory.teamId,null);assert.equal(memory.text,'');assert.equal(memory.title,null);assert.deepEqual(memory.enc,f.enc);
      const expected=f.plan.edges.filter(edge=>[edge.sourceId,edge.targetId].includes(item.sessionId)).map(edge=>edge.sourceId===item.sessionId?edge.targetId:edge.sourceId);assert.deepEqual(memory.connections.sort(),expected.sort());
      const versions=await snapshot.ref.collection('versions').get();assert.equal(versions.size,1);assert.deepEqual(versions.docs[0].data().connections,[]);assert.deepEqual(versions.docs[0].data().enc,f.enc);
      await accountCreatedSessionUsage(f.db,item.sessionId,'alice',1000);
    }
    assert.equal((await f.db.doc('users/alice').get()).data().usage.memoriesThisMonth,13);
    await f.db.doc('sessions/note-001').delete();await f.db.doc('sessions/note-000').update({connections:[]});for(const batch of f.batches)assert.equal((await f.call(batch,'apply')).status,'complete');
    assert.equal((await f.db.doc('sessions/note-001').get()).exists,false);assert.deepEqual((await f.db.doc('sessions/note-000').get()).data().connections,[]);
  });
  test('obsidian-import immutable manifests, edited ciphertext and foreign scopes reject graph batches atomically',async()=>{
    const f=await obsidianFixture(2);await f.call(f.plan,'begin');const altered=structuredClone(f.batches[0]);altered.memories[0].enc.ct='C'.repeat(32);
    await assert.rejects(f.call(altered,'apply'),{code:'aborted'});assert.equal((await f.db.collection('sessions').get()).size,0);await f.call(f.batches[0],'apply');const initial=(await f.db.doc('sessions/note-000').get()).data();
    for(const patch of [{enc:{...f.enc,ct:'C'.repeat(32)}},{uid:'bob'},{teamId:'crew'},{sharedWithIds:['bob']},{deletedAt:2}]){
      await f.db.doc('sessions/note-000').set({...initial,...patch});await assert.rejects(f.call(f.batches[1],'apply'));
      assert.deepEqual((await f.db.doc('sessions/note-001').get()).data().connections,[]);assert.equal((await f.db.collection('sessions/note-001/versions').get()).size,0);assert.equal((await f.call(f.identity,'status')).nextBatch,1);
    }
    await f.db.doc('sessions/note-000').set({...initial,position:[9,8,7]});await f.call(f.batches[1],'apply');assert.deepEqual((await f.db.doc('sessions/note-000').get()).data().position,[9,8,7]);
    await assert.rejects(executeObsidianImport('bob',f.identity,'status',f.deps),{code:'permission-denied'});
    await f.db.doc('accountDeletions/alice').set({status:'complete'});await assert.rejects(f.call(f.batches[0],'apply'),{code:'permission-denied'});
  });
  test('obsidian-import cancellation races with admission and creation without reverting committed progress',async()=>{
    const f=await obsidianFixture();await Promise.allSettled([f.call(f.plan,'begin'),f.call(f.identity,'cancel')]);assert.equal((await f.call(f.identity,'status')).status,'cancelled');await assert.rejects(f.call(f.plan,'begin'));
    const plan={...f.plan,importId:'second-vault'};const identity={importId:plan.importId,planDigest:obsidianPlanDigest(plan)};const batches=obsidianPlanBatches(plan).map(batch=>({...identity,...batch}));await f.call(plan,'begin');
    await Promise.allSettled([f.call(batches[0],'apply'),f.call(identity,'cancel')]);const status=await f.call(identity,'status');assert.equal(status.status,'cancelled');assert.ok([0,10].includes(status.createdCount));
    assert.equal((await f.db.collection('sessions').get()).size,status.createdCount);assert.equal((await f.db.doc('users/alice').get()).data().usage?.memoriesThisMonth??0,status.createdCount);
    await assert.rejects(f.call(batches[1],'apply'));if(status.createdCount)assert.equal((await f.call(batches[0],'apply')).status,'cancelled');
  });
  test('obsidian-import graph cancellation race commits both directions or leaves both unchanged',async()=>{
    const f=await obsidianFixture(2);await f.call(f.plan,'begin');await f.call(f.batches[0],'apply');await Promise.allSettled([f.call(f.batches[1],'apply'),f.call(f.identity,'cancel')]);
    const status=await f.call(f.identity,'status');assert.ok(['cancelled','complete'].includes(status.status));for(const id of ['note-000','note-001']){
      assert.deepEqual((await f.db.doc(`sessions/${id}`).get()).data().connections,status.status==='complete'?[id==='note-000'?'note-001':'note-000']:[]);
      assert.equal((await f.db.collection(`sessions/${id}/versions`).get()).size,status.status==='complete'?1:0);
    }
  });
  test('obsidian-import whole admission quota and colliding IDs create no partial plan or budget; later quota exhaustion pauses a whole batch',async()=>{
    const f=await obsidianFixture();await f.db.doc('config/monetization').set({mode:'paid'});await f.db.doc('users/alice').set({usage:{memoriesThisMonth:20,periodYear:1970,periodMonth:1}});
    await assert.rejects(f.call(f.plan,'begin'),{code:'resource-exhausted'});assert.equal((await f.db.collection('obsidianImports').get()).size,0);assert.equal((await f.db.collection('obsidianImportBudgets').get()).size,0);
    await f.db.doc('users/alice').set({});await f.db.doc('sessions/note-012').set({uid:'bob'});await assert.rejects(f.call(f.plan,'begin'),{code:'already-exists'});assert.equal((await f.db.collection('obsidianImports').get()).size,0);
    await f.db.doc('sessions/note-012').delete();await f.call(f.plan,'begin');await f.db.doc('users/alice').set({usage:{memoriesThisMonth:28,periodYear:1970,periodMonth:1}});
    await assert.rejects(f.call(f.batches[0],'apply'),{code:'resource-exhausted'});assert.equal((await f.db.collection('sessions').get()).size,0);assert.equal((await f.call(f.identity,'status')).nextBatch,0);
  });
  test('obsidian-import manifests, batch receipts and daily budgets are inaccessible to owner, other UID and anonymous clients',async()=>{
    const f=await obsidianFixture(2);await f.call(f.plan,'begin');await f.call(f.batches[0],'apply');const budget=(await f.db.collection('obsidianImportBudgets').get()).docs[0].ref.path;
    for(const client of [testEnv.authenticatedContext('alice').firestore(),testEnv.authenticatedContext('bob').firestore(),testEnv.unauthenticatedContext().firestore()]){
      for(const path of ['obsidianImports/synthetic-vault','obsidianImports/synthetic-vault/batches/0',budget]){await assertFails(client.doc(path).get());await assertFails(client.doc(path).set({uid:'alice'}));await assertFails(client.doc(path).delete());}
    }
  });
  async function personalConnectionFixture() {
    const db=admin.firestore();const enc={v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)};
    const memory={uid:'alice',teamId:null,text:'',title:null,enc,timestamp:1,updatedAt:10,connections:[],attachments:[{synthetic:true}],learning:{source:'obsidian-vault'}};
    await db.doc('users/alice').set({});await db.doc('users/bob').set({});await db.doc('sessions/source').set(memory);await db.doc('sessions/target').set(memory);
    const deps={firestore:db,now:()=>1000};const pair={sourceId:'source',targetId:'target'};
    const prepare=async(operationId='operation',operation='link')=>{const prepared=await executePersonalConnectionPreparation('alice',pair,deps);
      return{...pair,operationId,operation,expectedSourceHash:prepared.sourceHash,expectedTargetHash:prepared.targetHash};};
    return{db,deps,prepare,memory};
  }
  test('personal-connection concurrent lost-ACK retries archive both ciphertext endpoints once and historical replay never resurrects',async()=>{
    const f=await personalConnectionFixture();const input=await f.prepare();const results=await Promise.all(Array.from({length:4},()=>executePersonalConnection('alice',input,'apply',f.deps)));
    assert.equal(results.every(value=>JSON.stringify(value)===JSON.stringify(results[0])),true);
    for(const id of ['source','target']){
      const session=(await f.db.doc(`sessions/${id}`).get()).data();assert.deepEqual(session.connections,[id==='source'?'target':'source']);assert.deepEqual(session.enc,f.memory.enc);
      const versions=await f.db.collection(`sessions/${id}/versions`).get();assert.equal(versions.size,1);assert.deepEqual(versions.docs[0].data().attachments,f.memory.attachments);assert.deepEqual(versions.docs[0].data().connections,[]);
    }
    assert.equal((await f.db.collection('memoryUsageReceipts').get()).size,0);assert.equal((await f.db.collection('personalConnectionChanges').get()).size,1);
    await f.db.doc('sessions/target').delete();await f.db.doc('sessions/source').update({connections:[]});
    assert.deepEqual(await executePersonalConnection('alice',input,'apply',f.deps),results[0]);assert.equal((await f.db.doc('sessions/target').get()).exists,false);assert.deepEqual((await f.db.doc('sessions/source').get()).data().connections,[]);
    await assert.rejects(executePersonalConnection('bob',input,'status',f.deps),{code:'permission-denied'});
  });
  test('personal-connection real Firestore version CAS and all endpoint scopes fail without partial graph or receipt writes',async()=>{
    const f=await personalConnectionFixture();
    for(const patch of [{position:[1,2,3]},{uid:'bob'},{teamId:'crew'},{sharedWithIds:['bob']},{deletedAt:11},{text:'Synthetic legacy'}]){
      await f.db.doc('sessions/source').set(f.memory);const input=await f.prepare();await f.db.doc('sessions/source').update(patch);
      await assert.rejects(executePersonalConnection('alice',input,'apply',f.deps));assert.deepEqual((await f.db.doc('sessions/target').get()).data().connections,[]);
      assert.equal((await f.db.collection('personalConnectionChanges').get()).size,0);assert.equal((await f.db.collection('sessions/source/versions').get()).size,0);
    }
    await f.db.doc('sessions/source').set(f.memory);const input=await f.prepare();await f.db.doc('accountDeletions/alice').set({status:'complete'});
    await assert.rejects(executePersonalConnection('alice',input,'apply',f.deps),{code:'permission-denied'});
  });
  test('personal-connection cancel races serialize with apply and private receipts are denied to all clients',async()=>{
    const f=await personalConnectionFixture();const input=await f.prepare();
    const results=await Promise.allSettled([executePersonalConnection('alice',input,'cancel',f.deps),executePersonalConnection('alice',input,'apply',f.deps)]);
    const stored=(await f.db.doc('personalConnectionChanges/operation').get()).data();assert.equal(['cancelled','committed'].includes(stored.status),true);
    for(const result of results)if(result.status==='fulfilled')assert.equal(result.value.status,stored.status);
    for(const id of ['source','target'])assert.deepEqual((await f.db.doc(`sessions/${id}`).get()).data().connections,stored.status==='committed'?[id==='source'?'target':'source']:[]);
    for(const uid of ['alice','bob']){const client=testEnv.authenticatedContext(uid).firestore();await assertFails(client.doc('personalConnectionChanges/operation').get());await assertFails(client.doc('personalConnectionChanges/forged').set({uid,status:'committed'}));await assertFails(client.doc('personalConnectionChanges/operation').delete());}
    const later=await f.prepare('later');await executePersonalConnection('alice',later,'cancel',f.deps);await assert.rejects(executePersonalConnection('alice',later,'apply',f.deps),{code:'failed-precondition'});
  });
  async function syncImportFixture(count=1) {
    const db=admin.firestore();const encryptedPayload={iv:'A'.repeat(16),data:'B'.repeat(32)};
    await db.doc('users/alice').set({});await db.doc('users/bob').set({});
    await db.doc('trustedDevices/phone').set({deviceId:'phone',ownerUid:'alice',status:'active',name:'Synthetic',pairedAt:1});
    await db.doc('mobileSyncEnvelopes/envelope').set({ownerUid:'alice',deviceId:'phone',direction:'desktop-to-mobile',payloadType:'memory-snapshot',status:'queued',memoryCount:count,encryptedPayload,expiresAt:100000,senderPublicKeyJwk:{synthetic:true},tombstoneIds:[]});
    const identity={envelopeId:'envelope',deviceId:'phone',direction:'desktop-to-mobile',payloadDigest:syncStateHash(encryptedPayload)};
    const enc={v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)};
    const create=id=>({sessionId:id,expectedStateHash:null,action:'create',incomingRevision:20,timestamp:10,enc,metadata:{tags:['Synthetic']}});
    return {db,identity,enc,create,deps:{firestore:db,now:()=>1000},input:{...identity,cursor:0,changes:[create('new')]}};
  }
  async function syncPublicationFixture(count=1) {
    const db=admin.firestore();const publicKey={kty:'EC',crv:'P-256',x:'A'.repeat(43),y:'B'.repeat(43),ext:true,key_ops:[]};
    const device={deviceId:'phone',ownerUid:'alice',status:'active',name:'Synthetic',pairedAt:1,publicKeyJwk:publicKey,desktopPublicKeyJwk:publicKey};
    await db.doc('users/alice').set({});await db.doc('users/bob').set({});await db.doc('trustedDevices/phone').set(device);
    const input={envelopeId:'publication',deviceId:'phone',direction:'desktop-to-mobile',payloadType:'memory-snapshot',senderPublicKeyJwk:publicKey,
      encryptedPayload:{iv:'A'.repeat(16),data:'B'.repeat(32)},memoryCount:count,tombstoneIds:[],expiresAt:100000,expectedDeviceHash:syncStateHash(syncDeviceState(device,'alice','phone'))};
    const deps={firestore:db,now:()=>1000};
    const importInput={envelopeId:input.envelopeId,deviceId:'phone',direction:'desktop-to-mobile',payloadDigest:syncStateHash(input.encryptedPayload),cursor:0,
      changes:[{sessionId:'new',expectedStateHash:null,action:'create',incomingRevision:20,timestamp:10,enc:{v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)},metadata:{}}]};
    const call=(mode,value=input)=>executeSyncPublication('alice',value,mode,deps);
    return {db,input,deps,importInput,call};
  }
  test('mobile-sync-publication concurrent publication and lost ACK consume daily quota once; missing ciphertext is never recreated',async()=>{
    const f=await syncPublicationFixture();const results=await Promise.all(Array.from({length:4},()=>f.call('publish')));
    assert.equal(results.every(result=>result.delivery==='queued'&&result.digest===results[0].digest),true);
    const budget=(await f.db.doc('mobileSyncBudgets/alice_1970-01-01').get()).data();assert.equal(budget.envelopes,1);assert.equal(budget.bytes,Buffer.byteLength(JSON.stringify(f.input.encryptedPayload)));
    assert.equal((await f.db.collection('mobileSyncPublications').get()).size,1);
    await f.db.doc('trustedDevices/phone').update({status:'revoked'});assert.deepEqual(await f.call('status'),results[0]);
    await f.db.doc('mobileSyncEnvelopes/publication').delete();assert.equal((await f.call('publish')).delivery,'unavailable');assert.equal((await f.db.doc('mobileSyncEnvelopes/publication').get()).exists,false);
    await assert.rejects(f.call('publish',{...f.input,encryptedPayload:{...f.input.encryptedPayload,data:'C'.repeat(32)}}),{code:'permission-denied'});
    await assert.rejects(executeSyncPublication('bob',f.input,'status',f.deps),{code:'permission-denied'});
  });
  test('mobile-sync-publication cancellation serializes with first import and never cancels committed progress',async()=>{
    const f=await syncPublicationFixture();await f.call('publish');
    const results=await Promise.allSettled([f.call('cancel'),executeSyncImportBatch('alice',f.importInput,f.deps)]);
    assert.equal(results[0].status,'fulfilled');const cancelled=results[0].value.delivery==='cancelled';
    assert.equal(results[1].status,cancelled?'rejected':'fulfilled');assert.equal((await f.db.doc('sessions/new').get()).exists,!cancelled);
    assert.equal((await f.db.doc('mobileSyncPublicationCancellations/publication').get()).exists,cancelled);
    assert.equal((await f.call('status')).delivery,cancelled?'cancelled':'complete');
    assert.equal((await f.db.doc('mobileSyncBudgets/alice_1970-01-01').get()).data().envelopes,1);
  });
  test('mobile-sync-publication pre-publication cancellation blocks late writes and partial import cancellation keeps all progress',async()=>{
    const f=await syncPublicationFixture(2);await f.call('cancel');await assert.rejects(f.call('publish'),{code:'failed-precondition'});
    assert.equal((await f.db.doc('mobileSyncEnvelopes/publication').get()).exists,false);assert.equal((await f.db.collection('mobileSyncBudgets').get()).size,0);
    f.input.envelopeId='partial';f.importInput.envelopeId='partial';await f.call('publish');await executeSyncImportBatch('alice',f.importInput,f.deps);
    assert.equal((await f.call('cancel')).delivery,'pending');assert.equal((await f.db.doc('mobileSyncEnvelopes/partial').get()).data().status,'queued');
    assert.equal((await f.db.doc('mobileSyncPublicationCancellations/partial').get()).exists,false);
    await executeSyncImportBatch('alice',{...f.importInput,cursor:1,changes:[{...f.importInput.changes[0],sessionId:'next'}]},f.deps);
    assert.equal((await f.call('status')).delivery,'complete');assert.equal((await f.call('cancel')).imported,2);
  });
  test('mobile-sync-publication daily admission serializes distinct IDs and marked accounts/stale devices cannot mutate',async()=>{
    const f=await syncPublicationFixture();const budget=f.db.doc('mobileSyncBudgets/alice_1970-01-01');await budget.set({v:1,uid:'alice',day:'1970-01-01',envelopes:99,bytes:0});
    const results=await Promise.allSettled(Array.from({length:4},(_,index)=>f.call('publish',{...f.input,envelopeId:`limit-${index}`})));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal((await budget.get()).data().envelopes,100);
    assert.equal(results.filter(result=>result.status==='rejected').every(result=>result.reason.code==='resource-exhausted'),true);
    await budget.set({v:1,uid:'alice',day:'1970-01-01',envelopes:0,bytes:SYNC_DAILY_CIPHER_BYTES});await assert.rejects(f.call('publish'),{code:'resource-exhausted'});
    await f.db.doc('accountDeletions/alice').set({});await assert.rejects(f.call('cancel'),{code:'permission-denied'});await f.db.doc('accountDeletions/alice').delete();
    await f.db.doc('trustedDevices/phone').update({publicKeyJwk:{kty:'EC',crv:'P-256',x:'C'.repeat(43),y:'D'.repeat(43)}});
    await assert.rejects(f.call('publish'),{code:'permission-denied'});assert.equal((await f.db.doc('mobileSyncPublications/publication').get()).exists,false);
  });
  test('mobile-sync-publication rules deny direct publication and all private receipt/budget reads and writes',async()=>{
    const f=await syncPublicationFixture();await f.call('publish');const alice=testEnv.authenticatedContext('alice').firestore();const bob=testEnv.authenticatedContext('bob').firestore();
    const data=(await f.db.doc('mobileSyncEnvelopes/publication').get()).data();await assertFails(alice.doc('mobileSyncEnvelopes/direct').set({...data,createdAt:1,updatedAt:1}));
    await assertSucceeds(alice.doc('mobileSyncEnvelopes/publication').get());await assertFails(bob.doc('mobileSyncEnvelopes/publication').get());
    for(const collection of ['mobileSyncPublications','mobileSyncPublicationCancellations','mobileSyncBudgets']){
      await assertFails(alice.doc(`${collection}/publication`).get());await assertFails(alice.doc(`${collection}/publication`).set({uid:'alice'}));await assertFails(alice.doc(`${collection}/publication`).delete());
    }
  });
  test('mobile-sync-server concurrent batches and lost ACK commit one memory, usage and receipt; exact replay never resurrects',async()=>{
    const f=await syncImportFixture();const results=await Promise.all(Array.from({length:4},()=>executeSyncImportBatch('alice',f.input,f.deps)));
    assert.equal(results.every(result=>result.status==='complete'&&result.imported===1),true);
    assert.equal((await f.db.doc('users/alice').get()).data().usage.memoriesThisMonth,1);
    assert.equal((await f.db.collection('mobileSyncImports/envelope/batches').get()).size,1);
    assert.equal((await f.db.doc('mobileSyncEnvelopes/envelope').get()).data().status,'pulled');
    await f.db.doc('sessions/new').delete();await f.db.doc('trustedDevices/phone').update({status:'revoked'});
    assert.deepEqual(await executeSyncImportBatch('alice',f.input,f.deps),results[0]);assert.equal((await f.db.doc('sessions/new').get()).exists,false);
    await assert.rejects(executeSyncImportBatch('alice',{...f.input,changes:[{...f.input.changes[0],enc:{...f.enc,ct:'C'.repeat(32)}}]},f.deps),{code:'permission-denied'});
    await assert.rejects(executeSyncImportStatus('bob',f.identity,f.deps),{code:'permission-denied'});
  });
  test('mobile-sync-server progress and final ACK are atomic; quota, expired/revoked accounts and stale CAS preserve the checkpoint',async()=>{
    const f=await syncImportFixture(2);const first=await executeSyncImportBatch('alice',f.input,f.deps);
    assert.equal(first.cursor,1);assert.equal(first.status,'pending');assert.equal((await f.db.doc('mobileSyncEnvelopes/envelope').get()).data().status,'queued');
    const next={...f.input,cursor:1,changes:[f.create('next')]};
    await f.db.doc('trustedDevices/phone').update({status:'revoked'});await assert.rejects(executeSyncImportBatch('alice',next,f.deps),{code:'permission-denied'});
    await f.db.doc('trustedDevices/phone').update({status:'active'}); // Admin isolated fixture reset.
    await f.db.doc('accountDeletions/alice').set({});await assert.rejects(executeSyncImportBatch('alice',next,f.deps),{code:'permission-denied'});await f.db.doc('accountDeletions/alice').delete();
    await f.db.doc('config/monetization').set({mode:'paid'});await f.db.doc('users/alice').update({usage:{memoriesThisMonth:30,periodYear:1970,periodMonth:1}});
    await assert.rejects(executeSyncImportBatch('alice',next,f.deps),{code:'resource-exhausted'});assert.equal((await f.db.doc('sessions/next').get()).exists,false);
    assert.deepEqual(await executeSyncImportStatus('alice',f.identity,f.deps),first);await f.db.doc('config/monetization').delete();
    const done=await executeSyncImportBatch('alice',next,f.deps);assert.equal(done.status,'complete');assert.equal(done.imported,2);
  });
  test('mobile-sync-server fresh encrypted history preserves attachments and scope; team/shared/foreign targets and references cannot be mutated',async()=>{
    const f=await syncImportFixture();const old={uid:'alice',teamId:null,text:'',title:null,enc:f.enc,timestamp:1,updatedAt:10,attachments:[{synthetic:true}]};
    await f.db.doc('sessions/old').set(old);
    const change={sessionId:'old',expectedStateHash:syncDocumentStateHash(await f.db.doc('sessions/old').get()),action:'update',incomingRevision:20,timestamp:1,enc:{...f.enc,ct:'C'.repeat(32)},metadata:{tags:['New']}};
    await f.db.doc('sessions/old').update({updatedAt:11});await assert.rejects(executeSyncImportBatch('alice',{...f.input,changes:[change]},f.deps),{code:'aborted'});await f.db.doc('sessions/old').set(old);
    for(const fields of [{teamId:'crew'},{sharedWithIds:['bob']},{uid:'bob'},{deletedAt:15}]) {
      const changed={...old,...fields};await f.db.doc('sessions/old').set(changed);
      await assert.rejects(executeSyncImportBatch('alice',{...f.input,changes:[{...change,expectedStateHash:syncDocumentStateHash(await f.db.doc('sessions/old').get())}]},f.deps));
    }
    await f.db.doc('sessions/old').set(old);await f.db.doc('sessions/team-peer').set({...old,teamId:'crew'});
    const currentChange={...change,expectedStateHash:syncDocumentStateHash(await f.db.doc('sessions/old').get())};
    await assert.rejects(executeSyncImportBatch('alice',{...f.input,changes:[{...currentChange,metadata:{connections:['team-peer']}}]},f.deps),{code:'permission-denied'});
    await executeSyncImportBatch('alice',{...f.input,changes:[currentChange]},f.deps);
    const saved=(await f.db.doc('sessions/old').get()).data();assert.equal(saved.uid,'alice');assert.equal(saved.teamId,null);assert.equal(saved.timestamp,1);assert.deepEqual(saved.attachments,old.attachments);
    const archive=(await f.db.doc(`sessions/old/versions/${syncConflictId('envelope',0)}`).get()).data();assert.deepEqual(archive.enc,old.enc);assert.deepEqual(archive.attachments,old.attachments);
    assert.equal((await f.db.doc('users/alice').get()).data().usage,undefined);
  });
  test('mobile-sync-server rules deny fabricated ACKs/receipts, legacy sync writes, revocation reversal and destructive cleanup',async()=>{
    const f=await syncImportFixture();const alice=testEnv.authenticatedContext('alice').firestore();const bob=testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(alice.doc('mobileSyncEnvelopes/envelope').get());await assertFails(bob.doc('mobileSyncEnvelopes/envelope').get());
    await assertFails(alice.doc('mobileSyncEnvelopes/envelope').update({status:'pulled',pulledAt:1000}));await assertFails(alice.doc('mobileSyncEnvelopes/envelope').delete());
    await assertFails(alice.doc('mobileSyncImports/envelope').set({uid:'alice',status:'complete'}));
    await assertFails(alice.doc('mobileSyncImports/envelope/batches/0').set({uid:'alice',status:'complete'}));
    await assertFails(alice.doc('sessions/new').set({uid:'alice',teamId:null,text:'',title:null,enc:f.enc,syncedFromEnvelopeId:'envelope',timestamp:1}));
    await f.db.doc('sessions/old').set({uid:'alice',teamId:null,text:'',enc:f.enc,timestamp:1});await assertFails(alice.doc('sessions/old').update({syncedFromEnvelopeId:'envelope'}));
    await assertFails(alice.doc('trustedDevices/phone').update({status:'revoked'}));
    assert.equal((await pairingApi.executeMobilePairing('alice',{v:1,actorUid:'alice',action:'revoke',deviceId:'phone'},'apply',{firestore:f.db,auth:{getUser:async uid=>({uid,disabled:false})},enabled:()=>false,now:()=>1000})).status,'revoked');
    await assertFails(alice.doc('trustedDevices/phone').update({status:'active'}));await assertFails(alice.doc('trustedDevices/phone').delete());
    await f.db.doc('mobileSyncEnvelopes/envelope').update({expiresAt:1});await assertFails(alice.doc('mobileSyncEnvelopes/envelope').update({status:'failed',error:'expired'}));
    await assertFails(alice.doc('mobileSyncEnvelopes/envelope').update({status:'queued'}));
  });
  test('mobile-sync-server canonical CAS distinguishes SDK references from lookalike maps and tombstones do not consume quota or permit client resurrection',async()=>{
    const f=await syncImportFixture();const ref=f.db.doc('sessions/peer');const old={uid:'alice',teamId:null,text:'',title:null,enc:f.enc,timestamp:1,updatedAt:10,legacyReference:ref};
    await f.db.doc('sessions/old').set(old);const expected=syncDocumentStateHash(await f.db.doc('sessions/old').get());
    await f.db.doc('sessions/old').update({legacyReference:{path:ref.path,id:ref.id,firestore:{}}});
    const change={sessionId:'old',expectedStateHash:expected,action:'update',incomingRevision:20,timestamp:1,enc:f.enc,metadata:{}};
    await assert.rejects(executeSyncImportBatch('alice',{...f.input,changes:[change]},f.deps),{code:'aborted'});
    assert.equal((await f.db.doc('mobileSyncImports/envelope').get()).exists,false);
    const {Firestore}=admin.firestore;
    const otherProject=new Firestore({projectId:'demo-other-sync',databaseId:'(default)'}).doc(ref.path);
    await f.db.doc('sessions/old').set(old);const originalSnapshot=await f.db.doc('sessions/old').get();
    await f.db.doc('sessions/old').update({legacyReference:otherProject});
    const rewrittenSnapshot=await f.db.doc('sessions/old').get();
    assert.equal(syncStateHash(originalSnapshot.data()),syncStateHash(rewrittenSnapshot.data()),'SDK loses foreign reference project on decode');
    assert.notEqual(syncDocumentStateHash(originalSnapshot),syncDocumentStateHash(rewrittenSnapshot));
    await assert.rejects(executeSyncImportBatch('alice',{...f.input,changes:[{...change,expectedStateHash:syncDocumentStateHash(originalSnapshot)}]},f.deps),{code:'aborted'});
    assert.equal((await f.db.doc('mobileSyncImports/envelope').get()).exists,false);
    await f.db.doc('config/monetization').set({mode:'paid'});await f.db.doc('users/alice').update({usage:{memoriesThisMonth:30,periodYear:1970,periodMonth:1}});
    await executeSyncImportBatch('alice',{...f.input,changes:[{...f.create('gone'),action:'tombstone'}]},f.deps);
    assert.equal((await f.db.doc('users/alice').get()).data().usage.memoriesThisMonth,30);assert.equal((await f.db.doc('memoryUsageReceipts/gone').get()).exists,false);
    const alice=testEnv.authenticatedContext('alice').firestore();await assertFails(alice.doc('sessions/gone').update({deletedAt:null,updatedAt:2000}));
    await assertFails(alice.doc('mobileSyncImports/envelope').get());await assertFails(alice.doc('mobileSyncImports/envelope/batches/0').get());
  });
  test('mobile-sync-server metadata projection is opaque and fresh; replacing metadata deletes omitted fields and archives every original value',async()=>{
    const f=await syncImportFixture();const old={uid:'alice',teamId:null,text:'',title:null,enc:f.enc,timestamp:1,updatedAt:10,attachments:[{synthetic:true}],tags:['SYNTHETIC_METADATA_815'],category:'SYNTHETIC_METADATA_815',connections:['peer'],position:[1,2,3],importance:0.5,celestialType:'planet',semanticClusterId:'cluster',embedding:[0.1],embeddingModel:'synthetic-model'};
    await f.db.doc('sessions/old').set(old);const prepare=()=>executeSyncImportPreparation('alice',{...f.identity,cursor:0,sessionIds:['old']},f.deps);const initial=(await prepare()).targets[0];
    assert.equal(initial.metadataHash,syncStateHash(normalizedSyncMetadata(old)));assert.equal(JSON.stringify(initial).includes('SYNTHETIC_METADATA_815'),false);assert.equal('metadata' in initial,false);assert.equal('attachments' in initial,false);
    await f.db.doc('sessions/old').update({position:[3,2,1]});const fresh=(await prepare()).targets[0];assert.notEqual(fresh.metadataHash,initial.metadataHash);assert.notEqual(fresh.stateHash,initial.stateHash);assert.equal(fresh.revision,initial.revision);
    const change={sessionId:'old',expectedStateHash:initial.stateHash,action:'update',incomingRevision:20,timestamp:1,enc:{...f.enc,ct:'C'.repeat(32)},metadata:{}};
    await assert.rejects(executeSyncImportBatch('alice',{...f.input,changes:[change]},f.deps),{code:'aborted'});assert.equal((await f.db.doc('mobileSyncImports/envelope').get()).exists,false);
    const committed={...f.input,changes:[{...change,expectedStateHash:fresh.stateHash}]};await executeSyncImportBatch('alice',committed,f.deps);
    const updated=(await f.db.doc('sessions/old').get()).data();for(const field of SYNC_MEMORY_METADATA_FIELDS)assert.equal(field in updated,false);assert.deepEqual(updated.attachments,old.attachments);assert.equal(updated.uid,'alice');assert.equal(updated.teamId,null);
    const archive=(await f.db.doc(`sessions/old/versions/${syncConflictId('envelope',0)}`).get()).data();for(const field of SYNC_MEMORY_METADATA_FIELDS)assert.deepEqual(archive[field],field==='position'?[3,2,1]:old[field]);assert.deepEqual(archive.enc,f.enc);assert.deepEqual(archive.attachments,old.attachments);
    assert.equal((await f.db.doc('users/alice').get()).data().usage,undefined);await executeSyncImportBatch('alice',committed,f.deps);assert.equal((await f.db.collection('sessions/old/versions').get()).size,1);
  });
  test('mobile-sync-server metadata-only conflicts retain original scope/history and reject foreign/team/shared/deleted connections atomically',async()=>{
    const f=await syncImportFixture();const old={uid:'alice',teamId:null,text:'',title:null,enc:f.enc,timestamp:1,updatedAt:20,tags:['Old'],attachments:[{synthetic:true}]};await f.db.doc('sessions/old').set(old);
    const change={sessionId:'old',expectedStateHash:syncDocumentStateHash(await f.db.doc('sessions/old').get()),action:'conflict',incomingRevision:20,timestamp:1,enc:f.enc,metadata:{tags:['Changed'],position:[1,2,3],connections:['peer']}};
    for(const patch of [{uid:'bob'},{teamId:'crew'},{sharedWithIds:['bob']},{deletedAt:30}]){
      await f.db.doc('sessions/peer').set({...old,...patch});await assert.rejects(executeSyncImportBatch('alice',{...f.input,changes:[change]},f.deps),{code:'permission-denied'});
      assert.equal((await f.db.doc('mobileSyncImports/envelope').get()).exists,false);assert.equal((await f.db.doc(`sessions/${syncConflictId('envelope',0)}`).get()).exists,false);
    }
    await f.db.doc('sessions/peer').set(old);const first=await executeSyncImportBatch('alice',{...f.input,changes:[change]},f.deps);assert.equal(first.conflicts,1);assert.equal(first.imported,0);
    assert.deepEqual((await f.db.doc('sessions/old').get()).data(),old);const conflict=(await f.db.doc(`sessions/${syncConflictId('envelope',0)}`).get()).data();assert.deepEqual(conflict.connections,['peer']);assert.deepEqual(conflict.position,[1,2,3]);assert.deepEqual(conflict.tags,['Changed','sync-conflict']);assert.equal(conflict.uid,'alice');assert.equal(conflict.teamId,null);
    assert.equal((await f.db.doc('users/alice').get()).data().usage.memoriesThisMonth,1);await executeSyncImportBatch('alice',{...f.input,changes:[change]},f.deps);assert.equal((await f.db.doc('users/alice').get()).data().usage.memoriesThisMonth,1);
  });
  test('mobile-sync-server malformed stored metadata prevents preparation without a receipt or partial result',async()=>{
    const f=await syncImportFixture();await f.db.doc('sessions/old').set({uid:'alice',teamId:null,text:'',title:null,enc:f.enc,timestamp:1,updatedAt:20,connections:['invalid/path']});
    await assert.rejects(executeSyncImportPreparation('alice',{...f.identity,cursor:0,sessionIds:['old']},f.deps));assert.equal((await f.db.doc('mobileSyncImports/envelope').get()).exists,false);
  });

  async function purgeFixture() {
    const db = admin.firestore(); let now = 1000; let failure = false; let leaveObject = false;
    const objects = new Map();
    await db.doc('users/alice').set({}); await db.doc('config/attachmentSecurity').set({ writesEnabled: true, readsEnabled: true, bucket: 'synthetic-private' });
    const store = { signPost: async () => ({ url: 'synthetic', fields: {} }),
      inspect: async path => objects.get(path), promote: async (source, generation, destination) => { objects.set(destination, { generation: '200' }); return '200'; },
      removeQuarantine: async (path, generation) => {
        if (failure) throw Error('synthetic storage failure');
        if (objects.has(path) && objects.get(path).generation !== generation) throw Error('synthetic generation conflict');
        if (!leaveObject) objects.delete(path);
      }, removeExpiredPath: async path => { if (failure) throw Error('synthetic storage failure'); if (!leaveObject) objects.delete(path); },
      assertPathAbsent: async path => { if (objects.has(path)) throw Error('synthetic live object remains'); },
    };
    const deps = { firestore: db, now: () => now, store: () => store };
    const create = async (id, ready = true, scope = { kind: 'personal', uid: 'alice' }, uid = 'alice') => {
      const header = { v: 1, id, uid, scope, category: 'document',
        plainBytes: 10, metadataBytes: 20, cipherBytes: 50, iv: 'A'.repeat(16), wrappedKey: { iv: 'B'.repeat(16), ct: 'C'.repeat(64) } };
      const record = await reserveAttachmentUpload(uid, header, deps);
      objects.set(record.quarantinePath, { generation: '100', size: record.bytes, prefix: encodeAttachmentHeader(header), contentType: 'application/octet-stream' });
      if (ready) await finalizeAttachmentUpload(uid, id, deps);
      return (await db.doc(`attachmentUploads/${id}`).get()).data();
    };
    return { db, deps, create, objects, setNow: value => { now = value; }, fail: value => { failure = value; }, leave: value => { leaveObject = value; } };
  }

  test('clip-recovery concurrent create and lost ACK use one immutable receipt, one memory and one usage charge', async () => {
    const db = admin.firestore(); const input = {sessionId: '11111111-1111-4111-8111-111111111111', enc: {v: 1, iv: 'A'.repeat(16), ct: 'B'.repeat(32)}};
    const deps = {firestore: db, now: () => 1000}; await db.doc('users/alice').set({}); await db.doc('users/bob').set({});
    const unknown = await executeClippedMemory('alice', input, 'status', deps); assert.equal(unknown.status, 'unknown'); assert.equal(unknown.createdAt, null);
    const results = await Promise.all(Array.from({length: 4}, () => executeClippedMemory('alice', input, 'create', deps)));
    assert.ok(results.every(value => value.status === 'committed' && value.digest === results[0].digest));
    assert.equal((await db.collection('sessions').get()).size, 1); assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth, 1);
    const saved = (await db.doc(`sessions/${input.sessionId}`).get()).data(); assert.equal(saved.text, ''); assert.equal(saved.title, null); assert.deepEqual(saved.enc, input.enc); assert.equal(saved.teamId, null);
    assert.deepEqual(await executeClippedMemory('alice', input, 'status', deps), results[0]);
    await accountCreatedSessionUsage(db, input.sessionId, 'alice', 1000); assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth, 1);
    await assert.rejects(executeClippedMemory('alice', {...input, enc: {...input.enc, ct: 'C'.repeat(32)}}, 'create', deps), {code: 'permission-denied'});
    await assert.rejects(executeClippedMemory('bob', input, 'status', deps), {code: 'permission-denied'});
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc(`memoryCreationReceipts/${input.sessionId}`).get());
    await assertFails(alice.doc(`memoryCreationReceipts/${input.sessionId}`).set({uid: 'alice', status: 'cancelled'}));
    await db.doc(`sessions/${input.sessionId}`).delete();
    assert.equal((await executeClippedMemory('alice', input, 'create', deps)).status, 'committed'); assert.equal((await db.doc(`sessions/${input.sessionId}`).get()).exists, false);
    await assertFails(alice.doc(`sessions/${input.sessionId}`).set({uid: 'alice', teamId: null, text: '', title: null, enc: input.enc}));
  });

  test('clip-recovery cancellation serializes with creation and never resurrects a cancelled operation', async () => {
    const db = admin.firestore(); const deps = {firestore: db, now: () => 1000}; await db.doc('users/alice').set({});
    const input = {sessionId: '22222222-2222-4222-8222-222222222222', enc: {v: 1, iv: 'A'.repeat(16), ct: 'B'.repeat(32)}};
    assert.equal((await executeClippedMemory('alice', input, 'cancel', deps)).status, 'cancelled');
    await assert.rejects(executeClippedMemory('alice', input, 'create', deps), {code: 'failed-precondition'});
    assert.equal((await db.doc(`sessions/${input.sessionId}`).get()).exists, false); assert.equal((await db.doc('users/alice').get()).data().usage, undefined);
    const race = {...input, sessionId: '33333333-3333-4333-8333-333333333333'};
    const results = await Promise.allSettled([executeClippedMemory('alice', race, 'create', deps), executeClippedMemory('alice', race, 'cancel', deps)]);
    const final = await executeClippedMemory('alice', race, 'status', deps);
    assert.ok(['cancelled','committed'].includes(final.status)); assert.equal((await db.doc(`sessions/${race.sessionId}`).get()).exists, final.status === 'committed');
    assert.equal(results[1].status, 'fulfilled'); assert.equal(results[1].value.status, final.status);
    assert.equal((await db.doc('users/alice').get()).data().usage?.memoriesThisMonth ?? 0, final.status === 'committed' ? 1 : 0);
  });

  test('clip-recovery paid quota is transactional across different operations and a repeated commit works at the limit', async () => {
    const db = admin.firestore(); const now = Date.UTC(2026, 9, 3); const deps = {firestore: db, now: () => now};
    await db.doc('users/alice').set({usage: {memoriesThisMonth: 29, periodYear: 2026, periodMonth: 10}});
    await db.doc('config/monetization').set({mode: 'paid'}); await db.doc('entitlements/alice').set({effectiveTier: 'free'});
    const inputs = ['44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'].map(sessionId => ({sessionId, enc: {v: 1, iv: 'A'.repeat(16), ct: 'B'.repeat(32)}}));
    const results = await Promise.allSettled(inputs.map(input => executeClippedMemory('alice', input, 'create', deps)));
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1); assert.equal(results.find(value => value.status === 'rejected').reason.code, 'resource-exhausted');
    const winner = inputs[results.findIndex(value => value.status === 'fulfilled')];
    assert.equal((await executeClippedMemory('alice', winner, 'create', deps)).status, 'committed');
    assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth, 30); assert.equal((await db.collection('sessions').get()).size, 1);
  });

  test('clip-recovery preserves unrelated IDs and a late permanent account marker blocks all three operations atomically', async () => {
    const db = admin.firestore(); const input = {sessionId: '66666666-6666-4666-8666-666666666666', enc: {v: 1, iv: 'A'.repeat(16), ct: 'B'.repeat(32)}};
    const deps = {firestore: db, now: () => 1000}; await db.doc('users/alice').set({});
    await db.doc(`sessions/${input.sessionId}`).set({uid: 'alice', teamId: 'crew', text: '', enc: input.enc});
    await assert.rejects(executeClippedMemory('alice', input, 'create', deps), {code: 'already-exists'});
    assert.equal((await db.doc(`sessions/${input.sessionId}`).get()).data().teamId, 'crew');
    await db.doc(`sessions/${input.sessionId}`).delete(); let injected = false;
    const late = {firestore: Object.create(db), now: deps.now};
    late.firestore.runTransaction = work => db.runTransaction(async tx => {
      const wrapped = new Proxy(tx, {get(target, name) {
        if (name === 'create') return (...args) => {if (!injected) throw Error('Use async late marker hook'); return target.create(...args);};
        if (name === 'getAll') return async (...refs) => {
          const snapshots = await target.getAll(...refs);
          if (!injected && refs.some(ref => ref.path === 'config/monetization')) {injected = true; await db.doc('accountDeletions/alice').set({status: 'deleting'});}
          return snapshots;
        };
        const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
      }});
      return work(wrapped);
    });
    await assert.rejects(executeClippedMemory('alice', input, 'create', late), {code: 'permission-denied'});
    for (const mode of ['create','status','cancel']) await assert.rejects(executeClippedMemory('alice', input, mode, deps), {code: 'permission-denied'});
    assert.equal((await db.doc(`sessions/${input.sessionId}`).get()).exists, false); assert.equal((await db.doc(`memoryCreationReceipts/${input.sessionId}`).get()).exists, false);
    assert.equal((await db.doc('users/alice').get()).data().usage, undefined);
  });

  test('operator-scope backfill refuses unknown ownership, applies metadata once and preserves vault content', async () => {
    const db = admin.firestore();
    const privateData = { text: 'operator-private-content', enc: { v: 1, iv: 'synthetic', ct: 'operator-private-cipher' },
      timestamp: 1, updatedAt: 2, attachments: [{ url: 'data:operator-private-attachment' }] };
    await db.doc('sessions/candidate-a').set({ ...privateData, uid: 'alice' });
    await db.doc('sessions/candidate-b').set({ ...privateData, uid: 'bob' });
    await db.doc('sessions/marked').set({ ...privateData, uid: 'alice', teamId: null });
    await db.doc('sessions/team').set({ ...privateData, uid: 'alice', teamId: 'crew' });
    await db.doc('sessions/unowned').set(privateData);
    const run = args => spawnSync(process.execPath, [path.join(root, 'scripts/backfill-personal-scope.js'),
      '--project=demo-mnemosyne-rules', ...args], { encoding: 'utf8', timeout: 30_000, env: { ...process.env } });
    const blocked = run(['--require-complete']); assert.equal(blocked.status, 1);
    const inventory = JSON.parse(blocked.stdout); assert.equal(inventory.candidates, 2); assert.equal(inventory.invalidUid, 1);
    const applyArgs = ['--apply', '--expected=2', '--backup-uri=gs://synthetic-demo/export'];
    const unknown = run(applyArgs); assert.equal(unknown.status, 1); assert.match(unknown.stderr, /uid inválido/);
    assert.equal((await db.doc('sessions/candidate-a').get()).data().teamId, undefined);
    await db.doc('sessions/unowned').delete(); // Synthetic fixture repair, no production ownership inference.
    const applied = run(applyArgs); assert.equal(applied.status, 0, applied.stderr);
    assert.equal(JSON.parse(applied.stdout).updated, 2);
    for (const id of ['candidate-a', 'candidate-b']) {
      assert.deepEqual((await db.doc(`sessions/${id}`).get()).data(), { ...privateData, uid: id === 'candidate-a' ? 'alice' : 'bob', teamId: null });
    }
    assert.deepEqual((await db.doc('sessions/team').get()).data(), { ...privateData, uid: 'alice', teamId: 'crew' });
    const repeated = run(['--apply', '--expected=0', '--backup-uri=gs://synthetic-demo/export']);
    assert.equal(repeated.status, 0, repeated.stderr); assert.equal(JSON.parse(repeated.stdout).updated, 0);
    const stale = run(applyArgs); assert.equal(stale.status, 1); assert.match(stale.stderr, /contagem mudou/);
    const output = [blocked.stdout, blocked.stderr, unknown.stdout, unknown.stderr, applied.stdout, applied.stderr,
      repeated.stdout, repeated.stderr, stale.stdout, stale.stderr].join('');
    for (const value of ['operator-private', 'alice', 'bob', 'candidate-a']) assert.equal(output.includes(value), false);
  });

  test('attachment reference inventory paginates current and historical metadata without reading ciphers or changing data', async () => {
    const f = await purgeFixture(); const record = await f.create('34343434-3434-4434-8434-343434343434');
    const descriptor = attachmentDescriptor(record); const batch = f.db.batch();
    const original = { uid: 'alice', teamId: null, keyEpoch: null, attachments: [descriptor],
      enc: { v: 1, iv: 'synthetic', ct: 'synthetic-private-cipher' }, text: 'synthetic-private-text', title: 'synthetic-private-title' };
    for (let i = 0; i < 26; i++) {
      const id = `inventory-${String(i).padStart(2, '0')}`;
      batch.set(f.db.doc(`sessions/${id}`), original); batch.set(f.db.doc(`sessions/${id}/versions/old`), original);
    }
    await batch.commit();
    const observed = [];
    const wrap = query => new Proxy(query, { get(target, key) {
      if (key === 'get') return async () => { const result = await target.get(); observed.push(...result.docs.map(doc => doc.data())); return result; };
      const value = Reflect.get(target, key); return typeof value === 'function' ? (...args) => wrap(value.apply(target, args)) : value;
    } });
    const projectedDb = { collection: name => wrap(f.db.collection(name)), collectionGroup: name => wrap(f.db.collectionGroup(name)),
      doc: path => f.db.doc(path), getAll: (...args) => f.db.getAll(...args) };
    for (const source of ['sessions', 'versions']) {
      const first = await inventoryAttachmentReferencesPage({ source, afterPath: null, limit: 25 }, projectedDb);
      assert.equal(first.scanned, 25); assert.equal(first.canonicalReferences, 25); assert.equal(first.affectedDocuments, 0); assert.equal(first.exhausted, false);
      const last = await inventoryAttachmentReferencesPage({ source, afterPath: first.nextAfterPath, limit: 25 }, projectedDb);
      assert.equal(last.scanned, 1); assert.equal(last.canonicalReferences, 1); assert.equal(last.affectedDocuments, 0); assert.equal(last.exhausted, true);
    }
    assert.equal(observed.length, 52);
    assert.ok(observed.every(value => !('text' in value) && !('title' in value) && !('enc' in value)));
    assert.deepEqual((await f.db.doc('sessions/inventory-00').get()).data(), original);
    assert.deepEqual((await f.db.doc('sessions/inventory-00/versions/old').get()).data(), original);
    assert.deepEqual((await f.db.doc(`attachmentUploads/${record.header.id}`).get()).data(), record);
    const uploads = await inventoryAttachmentReferencesPage({ source: 'attachmentUploads', afterPath: null, limit: 100 }, f.db);
    assert.equal(uploads.scanned, 1); assert.equal(uploads.affectedDocuments, 0); assert.equal(uploads.uploadStates.ready, 1);
  });

  test('attachment reference inventory finds altered descriptors invisible to the exact query, legacy URLs, orphan history and bad registries', async () => {
    const f = await purgeFixture(); const id = '35353535-3535-4535-8535-353535353535'; const record = await f.create(id);
    const descriptor = attachmentDescriptor(record);
    await f.db.doc('sessions/altered').set({ uid: 'alice', teamId: null, attachments: [{ ...descriptor, name: 'synthetic-original-name' }] });
    assert.equal((await f.db.collection('sessions').where('attachments', 'array-contains', descriptor).get()).empty, true);
    let page = await inventoryAttachmentReferencesPage({ source: 'sessions', afterPath: null, limit: 100 }, f.db);
    assert.equal(page.affectedDocuments, 1); assert.equal(page.reasons.descriptorMismatch, 1);
    const notReady = await f.create('36363636-3636-4636-8636-363636363636', false);
    const purged = await f.create('37373737-3737-4737-8737-373737373737');
    await requestReadyAttachmentPurge('alice', purged.header.id, 'unreferenced', f.deps);
    const wrongId = '38383838-3838-4838-8838-383838383838'; await f.db.doc(`attachmentUploads/${wrongId}`).set(record);
    const missingId = '39393939-3939-4939-8939-393939393939';
    const batch = f.db.batch();
    const cases = {
      duplicate: [descriptor, descriptor], wrongOwner: [descriptor], malformedEntry: [{ url: 123 }],
      legacy: [{ url: 'data:synthetic-private' }, { url: 'https://example.invalid/path?token=synthetic-private-token' }],
      missing: [{ ...descriptor, url: `mnemosyne-attachment:v1:${missingId}` }],
      invalid: [{ ...descriptor, url: `mnemosyne-attachment:v1:${wrongId}` }],
      reserved: [attachmentDescriptor(notReady)], purged: [attachmentDescriptor(purged)],
    };
    for (const [name, attachments] of Object.entries(cases)) batch.set(f.db.doc(`sessions/${name}`), { uid: name === 'wrongOwner' ? 'bob' : 'alice', teamId: null, attachments });
    batch.set(f.db.doc('sessions/malformedList'), { uid: 'alice', teamId: null, attachments: { synthetic: true } });
    batch.set(f.db.doc('sessions/orphan/versions/old'), { uid: 'alice', teamId: null, attachments: [descriptor] });
    batch.set(f.db.doc('sessions/altered/versions/mismatch'), { uid: 'bob', teamId: null, attachments: [descriptor] });
    batch.set(f.db.doc('other/unexpected/versions/old'), { uid: 'alice', teamId: null, attachments: [descriptor] });
    batch.set(f.db.doc('users/alice/memories/legacy'), { uid: 'alice', teamId: null, attachments: [descriptor] });
    batch.set(f.db.doc('users/bob/memories/mismatch'), { uid: 'alice', teamId: null, attachments: [descriptor] });
    batch.set(f.db.doc(`sessions/${'L'.repeat(129)}`), { uid: 'alice', teamId: null, attachments: [descriptor] });
    await batch.commit();
    page = await inventoryAttachmentReferencesPage({ source: 'sessions', afterPath: null, limit: 100 }, f.db);
    for (const reason of ['descriptorMismatch', 'duplicateObject', 'scopeMismatch', 'malformedEntry', 'legacyReference',
      'inlineReference', 'tokenizedReference', 'missingRegistry', 'invalidRegistry', 'objectNotReady', 'objectPurged', 'malformedList', 'invalidDocumentId']) assert.ok(page.reasons[reason] > 0, reason);
    const versions = await inventoryAttachmentReferencesPage({ source: 'versions', afterPath: null, limit: 100 }, f.db);
    assert.equal(versions.scanned, 3); assert.equal(versions.reasons.orphanVersion, 1); assert.equal(versions.reasons.unknownNamespace, 1);
    assert.ok(versions.reasons.historyAuthorMismatch > 0);
    const legacy = await inventoryAttachmentReferencesPage({ source: 'memories', afterPath: null, limit: 100 }, f.db);
    assert.equal(legacy.reasons.legacyMemoryNamespace, 2); assert.equal(legacy.reasons.legacyOwnerMismatch, 1);
    await f.db.doc(`attachmentUploads/${id}`).update({ referenceSchemaVersion: admin.firestore.FieldValue.delete() });
    const registries = await inventoryAttachmentReferencesPage({ source: 'attachmentUploads', afterPath: null, limit: 100 }, f.db);
    assert.equal(registries.reasons.missingReferenceSchema, 1); assert.equal(registries.reasons.invalidRegistry, 1);
    assert.equal(registries.uploadStates.purgePending, 1);
    const sanitized = JSON.stringify({ ...page, nextAfterPath: null });
    for (const privateValue of ['synthetic-original-name', 'synthetic-private-token', 'example.invalid', 'alice', id]) assert.equal(sanitized.includes(privateValue), false);
  });

  test('attachment reference inventory checks team epochs and unavailable uploaders and propagates read failures', async () => {
    const f = await purgeFixture(); const keyId = '40404040-4040-4404-8404-404040404040';
    await f.db.doc('users/bob').set({});
    await f.db.doc('teams/crew').set({ ownerUid: 'bob', memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} },
      activeKeyEpoch: 1, activeKeyId: keyId, keyRotationStatus: 'active', pendingRotationId: null });
    await f.db.doc('teams/crew/keyEpochs/1').set({ epoch: 1, keyId, status: 'active', memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} } });
    const record = await f.create('41414141-4141-4414-8414-414141414141', true, { kind: 'team', teamId: 'crew', keyEpoch: 1, keyId });
    await f.db.doc('sessions/team-note').set({ uid: 'bob', teamId: 'crew', keyEpoch: 2, attachments: [attachmentDescriptor(record)] });
    const input = { source: 'sessions', afterPath: null, limit: 100 };
    assert.equal((await inventoryAttachmentReferencesPage(input, f.db)).affectedDocuments, 0);
    await f.db.doc('teams/crew/keyEpochs/1').update({ keyId: '42424242-4242-4424-8424-424242424242' });
    assert.equal((await inventoryAttachmentReferencesPage(input, f.db)).reasons.epochKeyMismatch, 1);
    await f.db.doc('teams/crew/keyEpochs/1').delete(); await f.db.doc('teams/crew').delete(); await f.db.doc('users/alice').delete();
    await f.db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' });
    const unavailable = await inventoryAttachmentReferencesPage(input, f.db);
    for (const reason of ['missingTeam', 'missingEpoch', 'missingUploader', 'uploaderUnavailable']) assert.equal(unavailable.reasons[reason], 1);
    const faultyDb = { collection: name => f.db.collection(name), doc: path => f.db.doc(path),
      getAll: async () => { throw Error('synthetic read unavailable'); } };
    await assert.rejects(inventoryAttachmentReferencesPage(input, faultyDb), /synthetic read unavailable/);
    await assert.rejects(inventoryAttachmentReferencesPage({ ...input, source: 'attachmentUploads' }, faultyDb), /synthetic read unavailable/);
  });

  test('attachment purge retains current, deleted and historical references and requires a verified reference schema', async () => {
    const f = await purgeFixture(); const id = '11111111-1111-4111-8111-111111111111'; const record = await f.create(id);
    const note = f.db.doc('sessions/synthetic'); const descriptor = attachmentDescriptor(record);
    await note.set({ uid: 'alice', teamId: null, attachments: [descriptor], deletedAt: 1 });
    await assert.rejects(requestReadyAttachmentPurge('alice', id, 'unreferenced', f.deps));
    await note.update({ attachments: [] }); await note.collection('versions').doc('old').set({ attachments: [descriptor] });
    await assert.rejects(requestReadyAttachmentPurge('alice', id, 'unreferenced', f.deps));
    await note.collection('versions').doc('old').delete();
    await f.db.doc(`attachmentUploads/${id}`).update({ referenceSchemaVersion: admin.firestore.FieldValue.delete() });
    await assert.rejects(requestReadyAttachmentPurge('alice', id, 'unreferenced', f.deps));
    assert.equal((await f.db.doc(`attachmentUploads/${id}`).get()).data().purgeState, undefined);
  });

  test('account marker revokes upload recovery and a signer delayed beyond admission cannot return a grant', async () => {
    const f = await purgeFixture(); const record = await f.create('16161616-1616-4616-8616-161616161616', false);
    await f.db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' });
    await assert.rejects(reserveAttachmentUpload('alice', record.header, f.deps), { code: 'permission-denied' });
    await assert.rejects(inspectAttachmentUpload('alice', { header: record.header }, f.deps), { code: 'permission-denied' });
    await assert.rejects(cancelPendingAttachmentUpload('alice', { header: record.header }, f.deps), { code: 'permission-denied' });
    await assert.rejects(finalizeAttachmentUpload('alice', record.header.id, f.deps), { code: 'permission-denied' });
    const input = { sessionId: '17171717-1717-4717-8717-171717171717', teamId: null, keyEpoch: null, keyId: null,
      enc: { v: 1, iv: 'A'.repeat(16), ct: 'B'.repeat(24) }, attachmentIds: [record.header.id], metadata: {} };
    await assert.rejects(executeCreateAttachedMemory('alice', input, { firestore: f.db, now: f.deps.now, teamWritesEnabled: false }), { code: 'permission-denied' });
    assert.equal((await f.db.doc(`memoryCreationReceipts/${input.sessionId}`).get()).exists, false);
    await f.db.doc('accountDeletions/alice').delete();
    const signer = { signPost: async () => { await f.db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' }); return { url: 'synthetic', fields: {} }; } };
    await assert.rejects(issueAttachmentPost('alice', record.header, { ...f.deps, store: () => signer }), { code: 'permission-denied' });
    assert.equal((await f.db.doc(`attachmentUploads/${record.header.id}`).get()).data().status, 'reserved');
  });

  test('account marker denies a team attachment read or new reference when its author or uploader is revoked', async () => {
    const f = await purgeFixture(); const keyId = '88888888-8888-4888-8888-888888888888'; const id = '18181818-1818-4818-8818-181818181818';
    await f.db.doc('users/bob').set({}); await f.db.doc('config/teamSecurity').set({ writesEnabled: true });
    await f.db.doc('teams/crew').set({ ownerUid: 'bob', memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} },
      keyRotationStatus: 'active', pendingRotationId: null, activeKeyEpoch: 1, activeKeyId: keyId });
    await f.db.doc('teams/crew/keyEpochs/1').set({ epoch: 1, keyId, status: 'active', memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} } });
    const record = await f.create(id, true, { kind: 'team', teamId: 'crew', keyEpoch: 1, keyId });
    const data = { uid: 'bob', teamId: 'crew', keyEpoch: 1, keyId, text: '', title: null, enc: { v: 2, iv: 'A'.repeat(16), ct: 'B'.repeat(24) }, timestamp: 1, updatedAt: 1, attachments: [attachmentDescriptor(record)] };
    await f.db.doc('sessions/read').set(data); await authorizeEncryptedAttachmentRead('bob', id, 'read', f.db);
    await f.db.doc('sessions/read').update({ uid: 'charlie' }); await f.db.doc('accountDeletions/charlie').set({ v: 1, status: 'deleting' });
    await assert.rejects(authorizeEncryptedAttachmentRead('bob', id, 'read', f.db), { code: 'permission-denied' });
    await f.db.doc('sessions/read').update({ uid: 'bob' }); await f.db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' });
    await assert.rejects(authorizeEncryptedAttachmentRead('bob', id, 'read', f.db), { code: 'permission-denied' });
    const target = { ...data, attachments: [] }; await f.db.doc('sessions/target').set(target);
    const operationId = '19191919-1919-4919-8919-191919191919';
    const mutation = { operationId, sessionId: 'target', action: 'add', ids: [id], expectedRevision: 1,
      expectedStateDigest: createHash('sha256').update(attachmentSessionStateBytes('target', target)).digest('hex') };
    await assert.rejects(executeAttachmentMutation('bob', mutation, { firestore: f.db, now: f.deps.now, teamWritesEnabled: true }), { code: 'permission-denied' });
    const initial = { sessionId: '20202020-2020-4020-8020-202020202020', teamId: 'crew', keyEpoch: 1, keyId, enc: data.enc, attachmentIds: [id], metadata: {} };
    await assert.rejects(executeCreateAttachedMemory('bob', initial, { firestore: f.db, now: f.deps.now, teamWritesEnabled: true }), { code: 'permission-denied' });
    assert.equal((await f.db.doc(`attachmentMutations/${operationId}`).get()).exists, false);
    assert.equal((await f.db.doc(`memoryCreationReceipts/${initial.sessionId}`).get()).exists, false);
    assert.deepEqual((await f.db.doc('sessions/target').get()).data().attachments, []);
    const bucket = 'synthetic.appspot.com'; const path = 'attachments/alice/synthetic.pdf';
    await f.db.doc('sessions/legacy').set({ uid: 'alice', teamId: null, sharedWithIds: ['bob'], attachments: [
      { url: `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=synthetic` }] });
    await assert.rejects(authorizeAttachmentRead('bob', path, 'legacy', f.db, bucket), { code: 'permission-denied' });
    await f.db.doc('accountDeletions/alice').delete(); await authorizeAttachmentRead('bob', path, 'legacy', f.db, bucket);
  });

  test('attachment purge retry requires current team membership even after the purge was already recorded', async () => {
    const f = await purgeFixture(); const keyId = '88888888-8888-4888-8888-888888888888'; const id = '15151515-1515-4515-8515-151515151515';
    await f.db.doc('teams/crew').set({ ownerUid: 'bob', memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} },
      keyRotationStatus: 'active', pendingRotationId: null, activeKeyEpoch: 1, activeKeyId: keyId });
    await f.db.doc('teams/crew/keyEpochs/1').set({ epoch: 1, keyId, status: 'active', memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} } });
    await f.create(id, true, { kind: 'team', teamId: 'crew', keyEpoch: 1, keyId });
    const requested = await requestReadyAttachmentPurge('alice', id, 'unreferenced', f.deps);
    assert.deepEqual(await requestReadyAttachmentPurge('alice', id, 'unreferenced', f.deps), requested);
    await f.db.doc('teams/crew').update({ memberUids: ['bob'], wrappedKeys: { bob: {} } });
    await assert.rejects(requestReadyAttachmentPurge('alice', id, 'unreferenced', f.deps), { code: 'permission-denied' });
    await f.db.doc('teams/crew').update({ memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} }, deletionState: 'deleting' });
    await assert.rejects(requestReadyAttachmentPurge('alice', id, 'unreferenced', f.deps), { code: 'permission-denied' });
  });

  test('attachment purge revokes immediately, waits for grants and releases quota once only after confirmed object removal', async () => {
    const f = await purgeFixture(); const id = '22222222-2222-4222-8222-222222222222'; const record = await f.create(id);
    const quota = (await f.db.collection('attachmentQuotas').get()).docs[0].ref;
    const requested = await requestReadyAttachmentPurge('alice', id, 'unreferenced', f.deps);
    assert.equal(requested.status, 'pending'); assert.equal(await cleanupReadyAttachmentPurge(id, f.deps), false);
    await assert.rejects(finalizeAttachmentUpload('alice', id, f.deps), { code: 'permission-denied' });
    await assert.rejects(reserveAttachmentUpload('alice', record.header, f.deps), { code: 'permission-denied' });
    assert.equal((await inspectAttachmentUpload('alice', { header: record.header }, f.deps)).status, 'cancelled');
    assert.equal((await cancelPendingAttachmentUpload('alice', { header: record.header }, f.deps)).status, 'cancelled');
    f.setNow(requested.retryAt); f.fail(true); await assert.rejects(cleanupReadyAttachmentPurge(id, f.deps));
    assert.equal((await quota.get()).data().storedBytes, record.bytes);
    f.fail(false); f.leave(true); await assert.rejects(cleanupReadyAttachmentPurge(id, f.deps));
    assert.equal((await quota.get()).data().cleanupBytes, record.bytes);
    f.leave(false); f.objects.set(record.publishedPath, { generation: '201' }); await assert.rejects(cleanupReadyAttachmentPurge(id, f.deps));
    f.objects.set(record.publishedPath, { generation: '200' });
    const cleaned = await Promise.all([cleanupReadyAttachmentPurge(id, f.deps), cleanupReadyAttachmentPurge(id, f.deps)]);
    assert.equal(cleaned.filter(Boolean).length, 1);
    const value = (await quota.get()).data(); for (const key of ['storedBytes', 'storedFiles', 'cleanupBytes', 'cleanupFiles']) assert.equal(value[key], 0);
    assert.equal((await f.db.doc(`attachmentUploads/${id}`).get()).data().purgeState, 'deleted');
  });

  test('attachment purge and attached creation serialize: a reference wins or the file is revoked, never both', async () => {
    const f = await purgeFixture(); const id = '33333333-3333-4333-8333-333333333333'; await f.create(id);
    const request = { sessionId: '44444444-4444-4444-8444-444444444444', teamId: null, keyEpoch: null, keyId: null,
      enc: { v: 1, iv: 'D'.repeat(16), ct: 'E'.repeat(32) }, attachmentIds: [id], metadata: { connections: [] } };
    const outcomes = await Promise.allSettled([executeCreateAttachedMemory('alice', request, f.deps), requestReadyAttachmentPurge('alice', id, 'unreferenced', f.deps)]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    const memory = await f.db.doc(`sessions/${request.sessionId}`).get(); const record = (await f.db.doc(`attachmentUploads/${id}`).get()).data();
    assert.equal(memory.exists, record.purgeState == null);
    if (memory.exists) assert.equal(record.referenceRevision, 1);
  });

  test('account reference purge removes paginated current and historical references while preserving another author content and files', async () => {
    const f = await purgeFixture(); const db = f.db; const keyId = '88888888-8888-4888-8888-888888888888';
    const scope = { kind: 'team', teamId: 'crew', keyEpoch: 1, keyId };
    await db.doc('users/bob').set({});
    await db.doc('teams/crew').set({ ownerUid: 'bob', memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} },
      roles: { alice: 'member', bob: 'owner' }, activeKeyEpoch: 1, activeKeyId: keyId, keyRotationStatus: 'active', pendingRotationId: null });
    await db.doc('teams/crew/keyEpochs/1').set({ epoch: 1, keyId, status: 'active', memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} } });
    await db.doc('config/teamSecurity').set({ writesEnabled: true });
    const mine = await f.create('31313131-3131-4131-8131-313131313131', true, scope);
    const other = await f.create('32323232-3232-4232-8232-323232323232', true, scope, 'bob');
    const data = { uid: 'bob', teamId: 'crew', keyEpoch: 1, keyId, text: '', title: null, timestamp: 1, updatedAt: 1,
      enc: { v: 2, iv: 'A'.repeat(16), ct: 'B'.repeat(24) }, attachments: [attachmentDescriptor(mine), attachmentDescriptor(other)] };
    const history = { teamId: 'crew', keyEpoch: 1, keyId, enc: data.enc, text: '', title: null, createdAt: 1, previousUpdatedAt: 1,
      editorUid: 'bob', attachments: data.attachments };
    for (let index = 0; index < 60; index++) {
      const ref = db.doc(`sessions/other-${index}`); await ref.set(data); await ref.collection('versions').doc('old').set(history);
    }
    const revisionDeps={firestore:db,now:f.deps.now};
    const staleRevision={operationId:require('node:crypto').randomUUID(),baseline:await prepareTeamRevision('bob',{teamId:'crew',sessionId:'other-0'},revisionDeps),priorEnc:data.enc,enc:data.enc,metadata:{embedding:null,embeddingModel:null,semanticClusterId:null,position:null,importance:.5,processingMethod:'manual:revision'}};
    await db.doc('users/alice').update({ deletionState: 'deleting' }); await db.doc('accountDeletions/alice').set({ v: 1, phase: 'objects', status: 'deleting' });
    const first = await purgeAccountAttachmentUploads('alice', f.deps); assert.equal(first.complete, false); f.setNow(first.retryAt);
    assert.equal((await purgeAccountAttachmentUploads('alice', f.deps)).complete, true);
    for (let index = 0; index < 60; index++) {
      const current = (await db.doc(`sessions/other-${index}`).get()).data();
      assert.deepEqual(current, { ...data, attachments: [attachmentDescriptor(other)], updatedAt: first.retryAt });
      assert.deepEqual((await db.doc(`sessions/other-${index}/versions/old`).get()).data(), { ...history, attachments: [attachmentDescriptor(other)] });
    }
    assert.equal((await db.doc(`attachmentUploads/${mine.header.id}`).get()).exists, false);
    assert.equal((await db.doc(`attachmentUploads/${other.header.id}`).get()).exists, true); assert.equal(f.objects.has(other.publishedPath), true);
    assert.equal((await db.doc('users/bob').get()).exists, true); assert.equal((await db.doc('teams/crew').get()).exists, true);
    const bob = testEnv.authenticatedContext('bob').firestore();
    const writeVersion = (versionId, before) => {
      const batch = bob.batch(); batch.update(bob.doc('sessions/other-0'), { updatedAt: first.retryAt + 1, lastVersionId: versionId });
      batch.set(bob.doc(`sessions/other-0/versions/${versionId}`), { ...history, attachments: before.attachments, previousUpdatedAt: before.updatedAt, createdAt: first.retryAt + 1 }); return batch.commit();
    };
    await assertFails(writeVersion('stale', data));
    const fresh = (await db.doc('sessions/other-0').get()).data(); await assertFails(writeVersion('fresh', fresh));
    await assert.rejects(executeTeamRevision('bob',staleRevision,'apply',revisionDeps),{code:'aborted'});
    const currentRevision={...staleRevision,operationId:require('node:crypto').randomUUID(),baseline:await prepareTeamRevision('bob',{teamId:'crew',sessionId:'other-0'},revisionDeps)};
    assert.equal((await executeTeamRevision('bob',currentRevision,'apply',revisionDeps)).status,'committed');
    assert.deepEqual((await db.doc('sessions/other-0/versions/team-revision-'+currentRevision.operationId).get()).data().attachments, [attachmentDescriptor(other)]);
    assert.deepEqual((await db.doc('sessions/other-0').get()).data().attachments,[attachmentDescriptor(other)]);
  });

  test('account reference purge retains bytes and quota on wrong scope, orphan history, legacy schema or failed metadata writes', async () => {
    const f = await purgeFixture(); const db = f.db; const file = await f.create('34343434-3434-4434-8434-343434343434');
    const descriptor = attachmentDescriptor(file); await db.doc('users/bob').set({});
    const ref = db.doc('sessions/own'); await ref.set({ uid: 'bob', teamId: null, timestamp: 1, updatedAt: 1, attachments: [descriptor] });
    await db.doc('users/alice').update({ deletionState: 'deleting' }); await db.doc('accountDeletions/alice').set({ v: 1, phase: 'objects', status: 'deleting' });
    const requested = await requestReadyAttachmentPurge('alice', file.header.id, 'account', f.deps); f.setNow(requested.retryAt);
    await assert.rejects(cleanupReadyAttachmentPurge(file.header.id, f.deps)); assert.equal(f.objects.has(file.publishedPath), true);
    await ref.update({ uid: 'alice' }); await db.doc('sessions/orphan/versions/old').set({ attachments: [descriptor] });
    await assert.rejects(cleanupReadyAttachmentPurge(file.header.id, f.deps)); assert.equal(f.objects.has(file.publishedPath), true);
    await db.doc('sessions/orphan/versions/old').delete(); await ref.update({ attachments: [descriptor] });
    await db.doc(`attachmentUploads/${file.header.id}`).update({ referenceSchemaVersion: admin.firestore.FieldValue.delete() });
    await assert.rejects(cleanupReadyAttachmentPurge(file.header.id, f.deps)); assert.deepEqual((await ref.get()).data().attachments, [descriptor]);
    await db.doc(`attachmentUploads/${file.header.id}`).update({ referenceSchemaVersion: 1 });
    const faultyDb = new Proxy(db, { get(target, key) {
      if (key === 'runTransaction') return work => target.runTransaction(tx => work(new Proxy(tx, { get(transaction, field) {
        if (field === 'update') return (doc, value) => { if (doc.path === ref.path) throw Error('synthetic metadata failure'); return transaction.update(doc, value); };
        const value = Reflect.get(transaction, field, transaction); return typeof value === 'function' ? value.bind(transaction) : value;
      } })));
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(cleanupReadyAttachmentPurge(file.header.id, { ...f.deps, firestore: faultyDb }));
    assert.equal((await db.doc(`attachmentUploads/${file.header.id}`).get()).data().storedQuotaReleased, false);
    assert.equal(f.objects.has(file.publishedPath), true); assert.equal(await cleanupReadyAttachmentPurge(file.header.id, f.deps), true);
    assert.deepEqual((await ref.get()).data().attachments, []);
  });

  test('account reference purge refuses quota completion if a late reference appears during object removal and resumes without double release', async () => {
    const f = await purgeFixture(); const db = f.db; const file = await f.create('35353535-3535-4535-8535-353535353535');
    const descriptor = attachmentDescriptor(file);
    await db.doc('users/alice').update({ deletionState: 'deleting' }); await db.doc('accountDeletions/alice').set({ v: 1, phase: 'objects', status: 'deleting' });
    const requested = await requestReadyAttachmentPurge('alice', file.header.id, 'account', f.deps); f.setNow(requested.retryAt);
    const original = f.deps.store('synthetic-private'); let late = true;
    const deps = { ...f.deps, store: () => ({ ...original, removeQuarantine: async (...args) => {
      await original.removeQuarantine(...args);
      if (late) { late = false; await db.doc('sessions/late').set({ uid: 'alice', teamId: null, timestamp: 1, updatedAt: 1, attachments: [descriptor] }); }
    } }) };
    await assert.rejects(cleanupReadyAttachmentPurge(file.header.id, deps));
    assert.equal((await db.doc(`attachmentUploads/${file.header.id}`).get()).data().storedQuotaReleased, false);
    assert.equal((await db.collection('attachmentQuotas').get()).docs[0].data().storedBytes, file.bytes);
    assert.equal(await cleanupReadyAttachmentPurge(file.header.id, f.deps), true);
    assert.deepEqual((await db.doc('sessions/late').get()).data().attachments, []);
    assert.equal(await cleanupReadyAttachmentPurge(file.header.id, f.deps), false);
    assert.equal((await db.collection('attachmentQuotas').get()).docs[0].data().storedBytes, 0);
  });

  test('account attachment purge keeps authentication resumable until ready/pending objects are removed, then retains only UID-free UUID tombstones', async () => {
    const f = await purgeFixture(); const ready = await f.create('55555555-5555-4555-8555-555555555555');
    const pending = await f.create('66666666-6666-4666-8666-666666666666', false);
    await assert.rejects(purgeAccountAttachmentUploads('alice', f.deps), { code: 'permission-denied' });
    await f.db.doc('users/alice').update({ deletionState: 'deleting' }); await f.db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting', phase: 'objects' });
    const first = await purgeAccountAttachmentUploads('alice', f.deps); assert.equal(first.complete, false); assert.equal(first.pending, 2);
    assert.equal((await f.db.doc('users/alice').get()).exists, true); assert.equal((await f.db.collection('attachmentUploads').get()).size, 2);
    f.setNow(first.retryAt); f.fail(true); await assert.rejects(purgeAccountAttachmentUploads('alice', f.deps));
    assert.equal((await f.db.collection('attachmentQuotas').get()).size, 1);
    f.fail(false); assert.equal((await purgeAccountAttachmentUploads('alice', f.deps)).complete, true);
    assert.equal((await f.db.collection('attachmentUploads').get()).size, 0); assert.equal((await f.db.collection('attachmentQuotas').get()).size, 0);
    for (const record of [ready, pending]) {
      const value = (await f.db.doc(`attachmentObjectTombstones/${record.header.id}`).get()).data();
      assert.deepEqual(Object.keys(value).sort(), ['deletedAt', 'digest', 'status', 'v']); assert.equal(value.digest, record.digest);
    }
    await f.db.doc('users/alice').update({ deletionState: admin.firestore.FieldValue.delete() }); await f.db.doc('accountDeletions/alice').delete();
    await assert.rejects(reserveAttachmentUpload('alice', ready.header, f.deps));
    assert.equal((await cancelPendingAttachmentUpload('alice', { header: ready.header }, f.deps)).status, 'cancelled');
    assert.equal((await f.db.collection('attachmentUploadCancellations').get()).size, 0);
  });

  test('desktop account login supports fresh registration, preserves expiry and consumes a bridge exactly once', async () => {
    const db = admin.firestore(); let now = 1000; let minted = 0; let verified = 0;
    const bridgeId = '12121212-1212-4212-8212-121212121212';
    const deps = { firestore: db, now: () => now, verifyUser: async uid => { assert.equal(uid, 'alice'); verified++; },
      mint: async () => { minted++; return 'synthetic-desktop-token'; } };
    assert.deepEqual(await executeRedeemDesktopAuthBridge({ bridgeId }, deps), { pending: true });
    const first = await executeSealDesktopAuthBridge('alice', { bridgeId }, deps);
    assert.equal(first.expiresAt, 181000); assert.equal((await db.doc('users/alice').get()).exists, false);
    now = 2000; assert.deepEqual(await executeSealDesktopAuthBridge('alice', { bridgeId }, deps), first);
    assert.equal(minted, 1);
    await assert.rejects(executeSealDesktopAuthBridge('bob', { bridgeId }, deps), { code: 'failed-precondition' });
    const results = await Promise.allSettled([executeRedeemDesktopAuthBridge({ bridgeId }, deps), executeRedeemDesktopAuthBridge({ bridgeId }, deps)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.deepEqual(results.find(result => result.status === 'fulfilled').value, { pending: false, token: 'synthetic-desktop-token' });
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'failed-precondition');
    assert.equal((await db.doc(`desktopAuthBridges/${bridgeId}`).get()).exists, false);
    const receipt = (await db.doc(`desktopAuthBridgeReceipts/${bridgeId}`).get()).data();
    assert.deepEqual(receipt, { v: 1, status: 'consumed', consumedAt: 2000 });
    await assert.rejects(executeSealDesktopAuthBridge('alice', { bridgeId }, deps), { code: 'failed-precondition' });
    await assert.rejects(executeSealDesktopAuthBridge('bob', { bridgeId }, deps), { code: 'failed-precondition' });
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc(`desktopAuthBridgeReceipts/${bridgeId}`).get());
    await assertFails(alice.doc(`desktopAuthBridgeReceipts/${bridgeId}`).delete());
    await assertFails(alice.doc(`desktopAuthBridges/${bridgeId}`).set({ uid: 'alice', customToken: 'synthetic' }));
    assert.ok(verified >= 3);
  });

  test('desktop account login denies deletion before signing and after delayed signing or Auth verification', async () => {
    const db = admin.firestore(); const bridgeId = '13131313-1313-4313-8313-131313131313';
    let minted = 0; let verified = 0;
    const deps = { firestore: db, now: () => 1000, verifyUser: async () => { verified++; }, mint: async () => { minted++; return 'synthetic-token'; } };
    await db.doc('users/alice').set({ deletionState: 'deleting' });
    await assert.rejects(executeSealDesktopAuthBridge('alice', { bridgeId }, deps), { code: 'failed-precondition' });
    assert.equal(minted, 0); assert.equal(verified, 0);
    await db.doc('users/alice').delete(); await db.doc('accountDeletions/alice').set({ v: 1, status: 'complete' });
    await assert.rejects(executeSealDesktopAuthBridge('alice', { bridgeId }, deps), { code: 'failed-precondition' });
    assert.equal(minted, 0);
    await db.doc('accountDeletions/alice').delete(); await db.doc('users/alice').set({});
    await assert.rejects(executeSealDesktopAuthBridge('alice', { bridgeId }, { ...deps, mint: async () => {
      await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' }); return 'synthetic-late-token';
    } }), { code: 'failed-precondition' });
    assert.equal((await db.doc(`desktopAuthBridges/${bridgeId}`).get()).exists, false);
    await db.doc('accountDeletions/alice').delete();
    await executeSealDesktopAuthBridge('alice', { bridgeId }, deps);
    await assert.rejects(executeRedeemDesktopAuthBridge({ bridgeId }, { ...deps, verifyUser: async () => {
      await db.doc('accountDeletions/alice').set({ v: 1, status: 'complete' }); await db.doc('users/alice').delete();
    } }), { code: 'failed-precondition' });
    assert.equal((await db.doc(`desktopAuthBridgeReceipts/${bridgeId}`).get()).exists, false);
    assert.equal((await db.doc(`desktopAuthBridges/${bridgeId}`).get()).exists, true);
  });

  test('desktop account login rejects expired and malformed bridges and missing Auth identities without publication', async () => {
    const db = admin.firestore(); const bridgeId = '14141414-1414-4414-8414-141414141414'; let now = 1000;
    const deps = { firestore: db, now: () => now, verifyUser: async () => {}, mint: async () => 'synthetic-token' };
    await assert.rejects(executeSealDesktopAuthBridge('alice', { bridgeId }, { ...deps, verifyUser: async () => { throw Error('synthetic missing Auth'); } }));
    assert.equal((await db.doc(`desktopAuthBridges/${bridgeId}`).get()).exists, false);
    await executeSealDesktopAuthBridge('alice', { bridgeId }, deps); now = 181000;
    await assert.rejects(executeRedeemDesktopAuthBridge({ bridgeId }, deps), { code: 'failed-precondition' });
    await assert.rejects(executeSealDesktopAuthBridge('alice', { bridgeId }, deps), { code: 'failed-precondition' });
    now = 1000; await db.doc(`desktopAuthBridges/${bridgeId}`).update({ createdAt: -1, expiresAt: 10000 });
    await assert.rejects(executeRedeemDesktopAuthBridge({ bridgeId }, deps), { code: 'failed-precondition' });
    await db.doc(`desktopAuthBridges/${bridgeId}`).delete();
    await assert.rejects(executeSealDesktopAuthBridge('alice', { bridgeId }, { ...deps, mint: async () => { now = 181000; return 'synthetic-token'; } }), { code: 'failed-precondition' });
    assert.equal((await db.doc(`desktopAuthBridges/${bridgeId}`).get()).exists, false);
  });

  test('account marker denies budget and UID rate records after cleanup while other accounts remain live', async () => {
    const db = admin.firestore(); const now = new Date('2026-10-02T00:00:00Z');
    const charge = { requests: 1, inputBytes: 1, reservedOutputTokens: 1, images: 0, costUnits: 1 };
    const config = { bucket: 'synthetic', max: 2, windowMs: 60000 };
    assert.equal(await reserveAiBudget('alice', charge, now), false);
    await db.doc('users/alice').set({}); await db.doc('users/bob').set({});
    assert.equal(await reserveAiBudget('alice', charge, now), true);
    const first = await consumeServerRateLimit('uid:alice', config, 1000); assert.equal(first.allowed, true);
    await db.doc('accountDeletions/alice').set({ v: 1, status: 'complete' });
    await db.doc('users/alice').delete(); await db.doc('aiBudgets/alice_2026-10').delete(); await db.doc(`rateLimits/${first.key}`).delete();
    assert.equal(await isLiveAccount('alice'), false); assert.equal(await isLiveAccount('bob'), true);
    assert.equal(await reserveAiBudget('alice', charge, now), false);
    assert.equal((await consumeServerRateLimit('uid:alice', config, 1001)).allowed, false);
    assert.equal((await db.doc('aiBudgets/alice_2026-10').get()).exists, false);
    assert.equal((await db.doc(`rateLimits/${first.key}`).get()).exists, false);
    assert.equal(await reserveAiBudget('bob', charge, now), true);
    assert.equal((await consumeServerRateLimit('uid:bob', config, 1001)).allowed, true);
    await db.doc('users/bob').update({ deletionState: 'deleting' });
    assert.equal(await reserveAiBudget('bob', charge, now), false);
    assert.equal((await consumeServerRateLimit('uid:bob', config, 1002)).allowed, false);
  });

  test('account rate windows migrate lossless legacy IDs and hashed budgets isolate legacy UID collisions', async () => {
    const db = admin.firestore(); const config = { bucket: 'synthetic', max: 2, windowMs: 60000 };
    await db.doc('users/alice').set({}); await db.doc('rateLimits/synthetic__uid:alice').set({ clientKey: 'uid:alice', hits: [1000] });
    const migrated = await consumeServerRateLimit('uid:alice', config, 1001); assert.equal(migrated.allowed, true); assert.equal(migrated.remaining, 0);
    assert.equal((await db.doc('rateLimits/synthetic__uid:alice').get()).exists, false);
    assert.equal((await consumeServerRateLimit('uid:alice', config, 1002)).allowed, false);
    const one = await consumeServerRateLimit('uid:alice+one', config, 1000); const two = await consumeServerRateLimit('uid:alice_one', config, 1000);
    assert.equal(one.allowed, true); assert.equal(two.allowed, true); assert.notEqual(one.key, two.key);
    assert.equal((await db.doc(`rateLimits/${one.key}`).get()).data().clientKey, 'uid:alice+one');
    const now = new Date('2026-10-02T00:00:00Z'); const charge = { requests: 1, inputBytes: 1, reservedOutputTokens: 1, images: 0, costUnits: 1 };
    await db.doc('users/alice+one').set({}); await db.doc('users/alice_one').set({});
    assert.equal(await reserveAiBudget('alice+one', charge, now), true);
    assert.equal(await reserveAiBudget('alice_one', charge, now), true);
    assert.equal((await db.doc('aiBudgets/alice_one_2026-10').get()).data().uid, 'alice+one');
    assert.equal((await db.doc(`aiBudgets/${aiBudgetDocumentId('user', 'alice+one', '2026-10')}`).get()).data().uid, 'alice+one');
    assert.equal((await db.doc(`aiBudgets/${aiBudgetDocumentId('user', 'alice_one', '2026-10')}`).get()).data().uid, 'alice_one');
  });

  test('account access rejects a completed external result after its permanent marker appears', async () => {
    const db = admin.firestore(); await db.doc('users/alice').set({}); let calls = 0;
    await assert.rejects(withLiveAccount('alice', async () => {
      calls++; await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' }); return 'synthetic private result';
    }), { name: 'AccountUnavailableError' });
    assert.equal(calls, 1); await assert.rejects(withLiveAccount('alice', async () => { calls++; }), { name: 'AccountUnavailableError' });
    assert.equal(calls, 1);
  });

  async function aiCostFixture() {
    const db = admin.firestore(); const keyId = '45454545-4545-4545-8545-454545454545';
    const memberUids = ['owner', 'bob', 'carol']; const wrap = { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 9).toString('base64') };
    const wrappedKeys = Object.fromEntries(memberUids.map(uid => [uid, wrap]));
    for (const uid of memberUids) await db.doc(`users/${uid}`).set({});
    await db.doc('config/monetization').set({ mode: 'paid' });
    await db.doc('entitlements/owner').set({ effectiveTier: 'sovereign', status: 'active' });
    await db.doc('teams/crew').set({ ownerUid: 'owner', memberUids, wrappedKeys,
      activeKeyEpoch: 1, activeKeyId: keyId, keyRotationStatus: 'active', pendingRotationId: null });
    await db.doc('teams/crew/keyEpochs/1').set({ status: 'active', keyId, memberUids, wrappedKeys });
    const now = new Date('2026-10-03T10:00:00Z'); const scope = { kind: 'team', teamId: 'crew', keyEpoch: 1, keyId };
    const text = { kind: 'text', modelId: 'openai-mini', promptBytes: 20, outputTokens: 64, scope };
    const image = { kind: 'image', modelId: 'openai-image', promptBytes: 20, outputTokens: 0, scope };
    return { db, now, scope, text, image };
  }

  test('ai-cost migrates known legacy consumption without reset or double counting and refuses ambiguous counters atomically', async () => {
    const db = admin.firestore(); const now = new Date('2026-10-03T10:00:00Z');
    await db.doc('users/alice').set({}); const old = db.doc('aiBudgets/alice_2026-10');
    const usage = { requests: 2, inputBytes: 200, reservedOutputTokens: 100, images: 0, costUnits: 2 };
    await old.set({ uid: 'alice', month: '2026-10', usage });
    const input = { kind: 'text', modelId: 'hf-default', promptBytes: 20, outputTokens: 64, scope: { kind: 'personal' } };
    assert.equal((await reserveAiGenerationBudget('alice', input, now, db)).admitted, true);
    const canonical = db.doc(`aiBudgets/${aiBudgetDocumentId('user', 'alice', '2026-10')}`);
    const personal = db.doc(`aiPersonalBudgets/${aiBudgetDocumentId('user', 'alice', '2026-10')}`);
    assert.equal((await canonical.get()).data().usage.requests, 3);
    assert.deepEqual((await canonical.get()).data().usage, (await old.get()).data().usage);
    // Simulate an overlapping old instance, which doesn't retain the token reservation field.
    await old.set({ uid: 'alice', month: '2026-10', usage: { ...usage, requests: 4, inputBytes: 225, reservedOutputTokens: 200, costUnits: 4 } });
    assert.equal((await reserveAiGenerationBudget('alice', input, now, db)).admitted, true);
    assert.equal((await canonical.get()).data().usage.requests, 5);
    assert.equal((await personal.get()).data().usage.requests, 5);
    assert.equal((await canonical.get()).data().usage.reservedInputTokens, 225 + 4 * 512 + 20 + 512);
    assert.deepEqual((await canonical.get()).data().usage, (await old.get()).data().usage);
    const before = (await canonical.get()).data(); await old.update({ uid: admin.firestore.FieldValue.delete() });
    assert.deepEqual(await reserveAiGenerationBudget('alice', input, now, db), { admitted: false, reason: 'unavailable' });
    assert.deepEqual((await canonical.get()).data(), before);
    await old.update({ uid: 'alice', usage: { ...usage, costUnits: -1 } });
    assert.deepEqual(await reserveAiGenerationBudget('alice', input, now, db), { admitted: false, reason: 'unavailable' });
    assert.deepEqual((await canonical.get()).data(), before);
  });

  test('ai-cost team sponsorship shares atomic hourly and monthly ceilings without charging personal allowance or exceeding the global user cap', async () => {
    const f = await aiCostFixture();
    const callers = Array.from({ length: 10 }, (_, i) => i % 2 ? 'bob' : 'carol'), byUid = new Map([['bob',0],['carol',0]]);
    const concurrent = await Promise.all(callers.map(uid => reserveAiGenerationBudget(uid, f.image, f.now, f.db)));
    concurrent.forEach((result,index) => {if(result.admitted)byUid.set(callers[index],byUid.get(callers[index])+1);});
    let admitted = concurrent.filter(result => result.admitted).length; assert.ok(admitted > 0 && admitted <= 5);
    for (let i = 0; i < 5 && admitted < 5; i++) {
      const uid = i % 2 ? 'bob' : 'carol', result = await reserveAiGenerationBudget(uid, f.image, f.now, f.db);
      if (result.admitted) {admitted++;byUid.set(uid,byUid.get(uid)+1);} else assert.equal(result.reason, 'exhausted');
    }
    assert.equal(admitted, 5);
    const monthlyRef = f.db.doc(`teamAiBudgets/${aiBudgetDocumentId('team', 'crew', '2026-10')}`);
    const hourRef = f.db.doc(`teamAiBudgetWindows/${aiBudgetDocumentId('team', 'crew', '2026-10-03T10')}`);
    assert.equal((await monthlyRef.get()).data().usage.costUnits, 100);
    assert.equal((await hourRef.get()).data().usage.images, 5);
    const monthlyBefore = (await monthlyRef.get()).data();
    assert.deepEqual(await reserveAiGenerationBudget('bob', f.image, f.now, f.db), { admitted: false, reason: 'exhausted' });
    assert.deepEqual((await monthlyRef.get()).data(), monthlyBefore);
    let total = 0;
    for (const uid of ['bob', 'carol']) {
      const global = await f.db.doc(`aiBudgets/${aiBudgetDocumentId('user', uid, '2026-10')}`).get();
      const personal = await f.db.doc(`aiPersonalBudgets/${aiBudgetDocumentId('user', uid, '2026-10')}`).get(), count = byUid.get(uid);
      // Transaction contention need not admit both callers. A caller with no successful reservation has no ledger to charge.
      assert.equal(global.exists,count>0);assert.equal(personal.exists,count>0);
      if(count>0){assert.equal(global.data().usage.images,count);assert.equal(global.data().usage.requests,count);assert.equal(personal.data().usage.requests,0);}
      total += count;
    }
    assert.equal(total, 5);
    const own = { ...f.text, modelId: 'hf-default', scope: { kind: 'personal' } };
    assert.equal((await reserveAiGenerationBudget('bob', own, f.now, f.db)).admitted, true);
    assert.equal((await f.db.doc(`aiPersonalBudgets/${aiBudgetDocumentId('user', 'bob', '2026-10')}`).get()).data().usage.requests, 1);
    const nextHour = new Date('2026-10-03T11:00:00Z');
    for (let i = 0; i < 5; i++) assert.equal((await reserveAiGenerationBudget(i % 2 ? 'bob' : 'carol', f.image, nextHour, f.db)).admitted, true);
    assert.equal((await monthlyRef.get()).data().usage.costUnits, 200);
    assert.deepEqual(await reserveAiGenerationBudget('bob', f.image, new Date('2026-10-03T12:00:00Z'), f.db), { admitted: false, reason: 'exhausted' });
    assert.equal((await reserveAiGenerationBudget('bob', f.image, new Date('2026-11-01T00:00:00Z'), f.db)).admitted, true);
  });

  test('ai-cost denies stale team epochs, revoked parties, changed plans and rolls back every ledger on a failed write', async () => {
    const f = await aiCostFixture(); const accepted = await reserveAiGenerationBudget('bob', f.text, f.now, f.db);
    assert.equal(accepted.admitted, true); assert.equal(await isAiGenerationAdmissionLive(accepted.admission, f.db), true);
    assert.deepEqual(await reserveAiGenerationBudget('bob', { ...f.text, scope: { ...f.scope, keyEpoch: 2 } }, f.now, f.db), { admitted: false, reason: 'denied' });
    for (const path of ['accountDeletions/bob', 'accountDeletions/owner', 'teamDeletions/crew']) {
      await f.db.doc(path).set({ status: 'deleting' });
      assert.equal(await isAiGenerationAdmissionLive(accepted.admission, f.db), false);
      assert.deepEqual(await reserveAiGenerationBudget('bob', f.text, f.now, f.db), { admitted: false, reason: 'denied' });
      await f.db.doc(path).delete();
    }
    await f.db.doc('teams/crew').update({ keyRotationStatus: 'rotation_pending' });
    assert.equal(await isAiGenerationAdmissionLive(accepted.admission, f.db), false);
    await f.db.doc('teams/crew').update({ keyRotationStatus: 'active' });
    await f.db.doc('entitlements/owner').update({ effectiveTier: 'pro' });
    assert.equal(await isAiGenerationAdmissionLive(accepted.admission, f.db), false);
    assert.deepEqual(await reserveAiGenerationBudget('bob', f.text, f.now, f.db), { admitted: false, reason: 'denied' });
    await f.db.doc('entitlements/owner').update({ effectiveTier: 'sovereign' });
    const savedEpoch = (await f.db.doc('teams/crew/keyEpochs/1').get()).data();
    await f.db.doc('teams/crew/keyEpochs/1').update({ wrappedKeys: { ...savedEpoch.wrappedKeys, owner: { v: 1, alg: 'RSA-OAEP', ct: 'invalid' } } });
    assert.equal(await isAiGenerationAdmissionLive(accepted.admission, f.db), false);
    assert.deepEqual(await reserveAiGenerationBudget('bob', f.text, f.now, f.db), { admitted: false, reason: 'denied' });
    await f.db.doc('teams/crew/keyEpochs/1').update({ wrappedKeys: savedEpoch.wrappedKeys });
    const before = (await f.db.collection('aiBudgets').get()).docs.map(row => [row.id, row.data()]);
    const faultyDb = new Proxy(f.db, { get(target, key) {
      if (key === 'runTransaction') return work => target.runTransaction(tx => work(new Proxy(tx, { get(transaction, field) {
        if (field === 'set') return (ref, data) => { if (ref.path.startsWith('teamAiBudgetWindows/')) throw Error('synthetic ledger failure'); return transaction.set(ref, data); };
        const value = Reflect.get(transaction, field, transaction); return typeof value === 'function' ? value.bind(transaction) : value;
      } })));
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    assert.deepEqual(await reserveAiGenerationBudget('bob', f.text, f.now, faultyDb), { admitted: false, reason: 'unavailable' });
    assert.deepEqual((await f.db.collection('aiBudgets').get()).docs.map(row => [row.id, row.data()]), before);
    assert.equal((await f.db.doc(`teamAiBudgets/${aiBudgetDocumentId('team', 'crew', '2026-10')}`).get()).data().usage.requests, 1);
  });

  test('ai-cost HTTP refuses models and client plan overrides before providers, and discards team results revoked during provider work', async () => {
    // Retained OpenAI adapter under an explicit future release configuration; the default policy remains NVIDIA/HF.
    const policy = require('../lib/generationProviderPolicy'); const enabled = policy.isGenerationProviderEnabled;
    const f = await aiCostFixture(); const httpAuth = require('../lib/httpAuth'); const params = require('../lib/params');
    const { generateTextHandler, generateImageHandler } = require('../lib/webApi');
    const originals = { verify: httpAuth.verifyBearerIdToken, secret: params.readSecret, env: params.readEnv, fetch: providerHttp.fetch };
    let calls = 0; let revoke = null;
    const response = () => ({ code: null, body: null, set() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
    const request = (body) => ({ method: 'POST', headers: {}, body: { prompt: 'synthetic prompt', ...body } });
    try {
      policy.isGenerationProviderEnabled = id => enabled(id, ['openai']);
      httpAuth.verifyBearerIdToken = async () => ({ uid: 'bob', token: 'synthetic-id-token' });
      params.readSecret = () => 'synthetic-provider-key'; params.readEnv = () => undefined;
      providerHttp.fetch = async () => { calls++; if (revoke) await revoke(); return new Response(JSON.stringify({ model: 'gpt-4o-mini', choices: [{ message: { content: 'synthetic generated result' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }); };
      for (const handler of [generateTextHandler, generateImageHandler]) {
        for (const model of ['__proto__', 'constructor', 'toString', 'attacker/model']) {
          const res = response(); await handler(request({ model }), res); assert.equal(res.code, 400);
        }
        const res = response(); await handler(request({ planId: 'sovereign' }), res); assert.equal(res.code, 400);
      }
      await f.db.doc('users/bob').update({ subscription: { tier: 'sovereign', status: 'active' } });
      let res = response(); await generateTextHandler(request({ model: 'openai-mini' }), res); assert.equal(res.code, 403);
      assert.equal(calls, 0); assert.equal((await f.db.collection('aiBudgets').get()).size, 0);
      res = response(); await generateTextHandler(request({ model: 'openai-mini', scope: f.scope }), res); assert.equal(res.code, 400);
      res = response(); await generateTextHandler(request({ model: 'openai-mini', scope: f.scope, expectedUid: 'other' }), res); assert.equal(res.code, 403);
      assert.equal(calls, 0);
      for (const change of [() => f.db.doc('accountDeletions/owner').set({ status: 'deleting' }),
        () => f.db.doc('teams/crew').update({ keyRotationStatus: 'rotation_pending' }),
        () => f.db.doc('entitlements/owner').update({ effectiveTier: 'pro' })]) {
        revoke = change; res = response();
        await generateTextHandler(request({ model: 'openai-mini', scope: f.scope, expectedUid: 'bob' }), res);
        assert.equal(res.code, 403); assert.equal(res.body.error, 'ai_access_changed');
        assert.equal(JSON.stringify(res.body).includes('synthetic generated result'), false);
        await f.db.doc('accountDeletions/owner').delete(); await f.db.doc('teams/crew').update({ keyRotationStatus: 'active' });
        await f.db.doc('entitlements/owner').update({ effectiveTier: 'sovereign' });
      }
      assert.equal(calls, 3);
      const stored = (await f.db.collection('teamAiBudgets').get()).docs[0].data(); assert.equal(stored.usage.requests, 3);
      assert.equal(JSON.stringify(stored).includes('synthetic prompt'), false);
      assert.equal(JSON.stringify(stored).includes('synthetic generated result'), false);
    } finally { policy.isGenerationProviderEnabled = enabled; httpAuth.verifyBearerIdToken = originals.verify; params.readSecret = originals.secret; params.readEnv = originals.env; providerHttp.fetch = originals.fetch; }
  });

  test('ai-cost ledgers are private server state even to their owner or team members', async () => {
    const f = await aiCostFixture(); assert.equal((await reserveAiGenerationBudget('bob', f.text, f.now, f.db)).admitted, true);
    const client = testEnv.authenticatedContext('bob').firestore();
    for (const name of ['aiBudgets', 'aiPersonalBudgets', 'aiBudgetWindows', 'teamAiBudgets', 'teamAiBudgetWindows']) {
      const rows = await f.db.collection(name).get(); assert.ok(rows.size > 0);
      await assertFails(client.collection(name).get());
      await assertFails(client.doc(`${name}/${rows.docs[0].id}`).get());
      await assertFails(client.doc(`${name}/forged`).set({ uid: 'bob', teamId: 'crew' }));
    }
  });

  test('ai-monitoring HTTP records one reservation/attempt/outcome without content and observes auth, invalid models, failures and revocation', async () => {
    const policy = require('../lib/generationProviderPolicy'); const enabled = policy.isGenerationProviderEnabled;
    const f = await aiCostFixture(); const httpAuth = require('../lib/httpAuth'); const params = require('../lib/params');
    const { logger } = require('firebase-functions/logger'); const { generateTextHandler, generateImageHandler } = require('../lib/webApi');
    const originals = { verify: httpAuth.verifyBearerIdToken, secret: params.readSecret, env: params.readEnv, fetch: providerHttp.fetch, write: logger.write };
    const events = []; let uid = 'bob'; let mode = 'success'; let calls = 0;
    const response = () => ({ code: null, body: null, set() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, send() { return this; } });
    const request = body => ({ method: 'POST', headers: { authorization: 'synthetic-private-bearer' }, body: { prompt: 'synthetic-private-prompt', expectedUid: 'bob', scope: f.scope, ...body } });
    try {
      policy.isGenerationProviderEnabled = id => enabled(id, ['openai']);
      httpAuth.verifyBearerIdToken = async () => uid ? { uid } : null;
      params.readSecret = () => 'synthetic-private-provider-secret'; params.readEnv = () => undefined;
      logger.write = entry => events.push(entry);
      providerHttp.fetch = async url => {
        calls++; if (mode === 'revoke') await f.db.doc('accountDeletions/owner').set({ status: 'deleting' });
        if (mode === 'failure' || mode === 'rejected') return new Response('synthetic-private-provider-error-body', { status: mode === 'failure' ? 500 : 400 });
        return String(url).includes('/chat/completions')
          ? new Response(JSON.stringify({ model: 'gpt-4o-mini', choices: [{ message: { content: 'synthetic-private-generated-output' } }] }), { status: 200 })
          : new Response(JSON.stringify({ data: [{ b64_json: providerImage, revised_prompt: 'synthetic-private-revised-prompt' }] }), { status: 200 });
      };
      let res = response(); await generateTextHandler({ ...request({}), method: 'OPTIONS' }, res); assert.equal(events.length, 0); assert.equal(res.code, 204);
      uid = null; res = response(); await generateTextHandler(request({ model: 'openai-mini' }), res);
      assert.equal(res.code, 401); assert.equal(events.at(-1).reason, 'auth_required'); assert.equal(events.at(-1).modelId, 'unknown');
      uid = 'bob'; res = response(); await generateTextHandler(request({ model: 'synthetic-private-unknown-model' }), res);
      assert.equal(res.code, 400); assert.equal(events.at(-1).reason, 'invalid_request'); assert.equal(calls, 0);
      for (const [handler, model] of [[generateTextHandler, 'openai-mini'], [generateImageHandler, 'openai-image']]) {
        const start = events.length; res = response(); await handler(request({ model }), res); assert.equal(res.code, 200);
        const operation = events.slice(start); assert.deepEqual(operation.map(event => event.event), ['reservation', 'provider_attempt', 'outcome']);
        assert.equal(new Set(operation.map(event => event.operationId)).size, 1); assert.equal(operation[0].costUnitsReserved, model === 'openai-mini' ? 2 : 20);
        assert.equal(operation.at(-1).reason, 'success'); assert.equal(operation[0].scopeKind, 'team');
      }
      for (mode of ['rejected', 'failure', 'revoke']) {
        const start = events.length; res = response(); await generateTextHandler(request({ model: 'openai-mini' }), res);
        assert.equal(res.code, mode === 'rejected' ? 422 : mode === 'failure' ? 503 : 403);
        const operation = events.slice(start).filter(event => event.event !== 'circuit_opened');
        assert.deepEqual(operation.map(event => event.event), ['reservation', 'provider_attempt', 'outcome']);
        assert.equal(operation.at(-1).reason, mode === 'rejected' ? 'provider_rejected' : mode === 'failure' ? 'provider_failed' : 'access_changed');
      }
      assert.equal(calls, 5); assert.equal(JSON.stringify(events).includes('synthetic-private'), false);
      assert.ok(events.every(entry => entry.uid === undefined && entry.teamId === undefined && entry.prompt === undefined && entry.error === undefined));
      assert.equal((await f.db.collection('teamAiBudgets').get()).docs[0].data().usage.requests, 5);
    } finally { policy.isGenerationProviderEnabled = enabled; httpAuth.verifyBearerIdToken = originals.verify; params.readSecret = originals.secret; params.readEnv = originals.env; providerHttp.fetch = originals.fetch; logger.write = originals.write; }
  });

  test('ai-monitoring records rate and budget refusals without pretending to have reserved or attempted the provider', async () => {
    const policy = require('../lib/generationProviderPolicy'); const enabled = policy.isGenerationProviderEnabled;
    const f = await aiCostFixture(); const httpAuth = require('../lib/httpAuth'); const params = require('../lib/params');
    const { logger } = require('firebase-functions/logger'); const { generateTextHandler } = require('../lib/webApi');
    const originals = { verify: httpAuth.verifyBearerIdToken, secret: params.readSecret, env: params.readEnv, fetch: providerHttp.fetch, write: logger.write };
    const events = []; let calls = 0;
    const response = () => ({ code: null, set() { return this; }, status(code) { this.code = code; return this; }, json() { return this; } });
    try {
      policy.isGenerationProviderEnabled = id => enabled(id, ['openai']);
      httpAuth.verifyBearerIdToken = async () => ({ uid: 'bob' }); params.readSecret = () => 'synthetic-private-secret'; params.readEnv = () => undefined;
      providerHttp.fetch = async () => { calls++; throw Error('provider must not run'); }; logger.write = entry => events.push(entry);
      const ref = f.db.doc(`teamAiBudgets/${aiBudgetDocumentId('team', 'crew', new Date().toISOString().slice(0, 7))}`);
      const counter = { requests: 200, inputBytes: 300000, reservedInputTokens: 402400, reservedOutputTokens: 100000, images: 20, costUnits: 200 };
      await ref.set({ v: 2, kind: 'team', teamId: 'crew', ownerUid: 'owner', period: new Date().toISOString().slice(0, 7), usage: counter });
      const req = { method: 'POST', headers: {}, body: { prompt: 'synthetic-private-prompt', model: 'openai-mini', expectedUid: 'bob', scope: f.scope } };
      let res = response(); await generateTextHandler(req, res); assert.equal(res.code, 429); assert.equal(events.at(-1).reason, 'budget_exhausted');
      await ref.update({ usage: { ...counter, costUnits: -1 } }); res = response(); await generateTextHandler(req, res);
      assert.equal(res.code, 503); assert.equal(events.at(-1).reason, 'budget_unavailable');
      const { RATE_LIMITS } = require('../lib/rateLimit');
      for (let index = 0; index < RATE_LIMITS.generateText.max; index++) await consumeServerRateLimit('uid:bob', RATE_LIMITS.generateText);
      res = response(); await generateTextHandler(req, res); assert.equal(res.code, 429); assert.equal(events.at(-1).reason, 'rate_limited');
      assert.equal(events.length, 3); assert.ok(events.every(event => event.event === 'outcome')); assert.equal(calls, 0);
      assert.equal(JSON.stringify(events).includes('synthetic-private'), false);
    } finally { policy.isGenerationProviderEnabled = enabled; httpAuth.verifyBearerIdToken = originals.verify; params.readSecret = originals.secret; params.readEnv = originals.env; providerHttp.fetch = originals.fetch; logger.write = originals.write; }
  });

  test('secret-bindings HTTP refuses every provider without its declared secret and never uses legacy environment credentials', async () => {
    const f = await aiCostFixture(); const httpAuth = require('../lib/httpAuth'); const params = require('../lib/params');
    const { generateTextHandler, generateImageHandler } = require('../lib/webApi'); const {logger} = require('firebase-functions/logger');
    const names = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'NVIDIA_API_KEY_FAST', 'NVIDIA_API_KEY_CORE', 'HF_TOKEN', 'HUGGINGFACE_HUB_TOKEN'];
    const env = Object.fromEntries(names.map(name => [name, process.env[name]]));
    const secrets = [params.openrouterApiKey]; const values = secrets.map(secret => secret.value);
    const originals = {verify: httpAuth.verifyBearerIdToken, fetch: providerHttp.fetch, write: logger.write}; const events = []; let calls = 0;
    const response = () => ({code: null, body: null, set() {return this;}, status(code) {this.code = code; return this;}, json(body) {this.body = body; return this;}});
    try {
      httpAuth.verifyBearerIdToken = async () => ({uid: 'bob'}); secrets.forEach(secret => {secret.value = () => '';});
      names.forEach(name => {process.env[name] = 'synthetic-private-legacy-key';});
      providerHttp.fetch = async () => {calls++; throw Error('Network must remain unused');}; logger.write = entry => events.push(entry);
      for (const [handler, models] of [[generateTextHandler, ['openrouter-gemma-4-free', 'openai-mini', 'nvidia-llama', 'hf-default', 'gemini-flash']],
        [generateImageHandler, ['openai-image', 'nvidia-image', 'hf-image', 'gemini-image']]]) {
        for (const model of models) {
          const res = response(); await handler({method: 'POST', headers: {}, body: {prompt: 'synthetic-private-prompt', model, expectedUid: 'bob', scope: f.scope}}, res);
          assert.equal(res.code, model === 'openrouter-gemma-4-free' ? 503 : 400);
          assert.equal(res.body.error, model === 'openrouter-gemma-4-free' ? 'ai_unavailable' : 'ai_provider_disabled');
          assert.equal(JSON.stringify(res.body).includes('synthetic-private'), false);
        }
      }
      assert.equal(calls, 0); assert.equal((await f.db.collection('teamAiBudgets').get()).docs[0].data().usage.requests, 1);
      assert.equal(events.filter(event => event.event === 'reservation').length, 1);
      assert.equal(events.filter(event => event.event === 'outcome' && event.reason === 'provider_failed').length, 1);
      assert.equal(JSON.stringify(events).includes('synthetic-private'), false);
    } finally {
      httpAuth.verifyBearerIdToken = originals.verify; providerHttp.fetch = originals.fetch; logger.write = originals.write;
      secrets.forEach((secret, index) => {secret.value = values[index];});
      names.forEach(name => {if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name];});
    }
  });

  test('release policy refuses every inactive provider before generation quota, circuit, secret or provider access', async () => {
    const f = await aiCostFixture(); const auth = require('../lib/httpAuth'), params = require('../lib/params');
    const budget = require('../lib/aiBudgetReservations'), circuit = require('../lib/providerCircuit');
    const {generateTextHandler, generateImageHandler} = require('../lib/webApi');
    const originals = {verify: auth.verifyBearerIdToken, secret: params.readSecret, reserve: budget.reserveAiGenerationBudget,
      begin: circuit.beginProviderAttempt, fetch: providerHttp.fetch};
    const counts = {secret: 0, reserve: 0, begin: 0, fetch: 0};
    const blocked = name => () => {counts[name]++; throw Error('Disabled provider crossed generation boundary');};
    try {
      auth.verifyBearerIdToken = async () => ({uid: 'bob'}); params.readSecret = blocked('secret');
      budget.reserveAiGenerationBudget = blocked('reserve'); circuit.beginProviderAttempt = blocked('begin'); providerHttp.fetch = blocked('fetch');
      for (const [handler, model] of [[generateTextHandler, 'nvidia-nemotron-ultra'], [generateImageHandler, 'nvidia-image'], [generateTextHandler, 'openai-mini'], [generateImageHandler, 'openai-image'],
        [generateTextHandler, 'hf-default'], [generateImageHandler, 'hf-image'], [generateTextHandler, 'gemini-flash'], [generateImageHandler, 'gemini-image']]) {
        const res = {code: null, body: null, set() {return this;}, status(code) {this.code = code; return this;}, json(body) {this.body = body; return this;}};
        await handler({method: 'POST', headers: {}, body: {prompt: 'Synthetic prompt', model, expectedUid: 'bob', scope: f.scope}}, res);
        assert.equal(res.code, 400); assert.equal(res.body.error, 'ai_provider_disabled');
      }
      assert.deepEqual(counts, {secret: 0, reserve: 0, begin: 0, fetch: 0});
      assert.equal((await f.db.collection('teamAiBudgets').get()).size, 0);
      assert.equal((await f.db.collection('providerCircuits').get()).size, 0);
    } finally {
      auth.verifyBearerIdToken = originals.verify; params.readSecret = originals.secret; budget.reserveAiGenerationBudget = originals.reserve;
      circuit.beginProviderAttempt = originals.begin; providerHttp.fetch = originals.fetch;
    }
  });

  test('selected adapters route NVIDIA and explicitly enabled future Hugging Face/Gemini text and images without fallback', async () => {
    const policy = require('../lib/generationProviderPolicy'), enabled = policy.isGenerationProviderEnabled;
    const f = await aiCostFixture(); const auth = require('../lib/httpAuth'), params = require('../lib/params');
    const {generateTextHandler, generateImageHandler} = require('../lib/webApi');
    const originals = {verify: auth.verifyBearerIdToken, secret: params.readSecret, fetch: providerHttp.fetch};
    const secrets = [], requests = [];
    try {
      policy.isGenerationProviderEnabled = id => enabled(id, ['nvidia', 'huggingface', 'gemini']);
      auth.verifyBearerIdToken = async () => ({uid: 'bob'});
      params.readSecret = (parameter, name) => {secrets.push(name); assert.equal(parameter,
        name === 'NVIDIA_API_KEY' ? params.nvidiaApiKey : name === 'GEMINI_API_KEY' ? params.geminiApiKey : params.huggingfaceApiKey); return 'synthetic-selected-key';};
      providerHttp.fetch = async (url, options) => {
        requests.push({url: String(url), body: JSON.parse(options.body)});
        if (String(url).includes('generativelanguage.googleapis.com')) {
          const image = String(url).includes('gemini-3.1-flash-image');
          return new Response(JSON.stringify({modelVersion: image ? 'gemini-3.1-flash-image' : 'gemini-3.5-flash-lite',
            candidates: [{finishReason: 'STOP', content: {parts: image ? [{inlineData: {mimeType: 'image/png', data: providerImage}}] : [{text: 'Synthetic answer'}]}}]}), {status: 200});
        }
        if (String(url).includes('/chat/completions')) return new Response(JSON.stringify({model: JSON.parse(options.body).model, choices: [{message: {content: 'Synthetic answer'}}]}), {status: 200});
        if (String(url).includes('ai.api.nvidia.com')) return new Response(JSON.stringify({artifacts: [{base64: providerImage}]}), {status: 200});
        return new Response(JSON.stringify({data: [{b64_json: providerImage}]}), {status: 200});
      };
      for (const [handler, model, name, host] of [
        [generateTextHandler, 'nvidia-llama', 'NVIDIA_API_KEY', 'integrate.api.nvidia.com'],
        [generateTextHandler, 'nvidia-nemotron-ultra', 'NVIDIA_API_KEY', 'integrate.api.nvidia.com'],
        [generateTextHandler, 'hf-default', 'HUGGINGFACE_API_KEY', 'router.huggingface.co'],
        [generateImageHandler, 'nvidia-image', 'NVIDIA_API_KEY', 'ai.api.nvidia.com'],
        [generateImageHandler, 'hf-image', 'HUGGINGFACE_API_KEY', 'router.huggingface.co'],
        [generateTextHandler, 'gemini-flash', 'GEMINI_API_KEY', 'generativelanguage.googleapis.com'],
        [generateImageHandler, 'gemini-image', 'GEMINI_API_KEY', 'generativelanguage.googleapis.com'],
      ]) {
        const res = {code: null, body: null, set() {return this;}, status(code) {this.code = code; return this;}, json(body) {this.body = body; return this;}};
        const start = requests.length; await handler({method: 'POST', headers: {}, body: {prompt: 'Synthetic prompt', model, expectedUid: 'bob', scope: f.scope}}, res);
        assert.equal(res.code, 200); assert.equal(requests.length, start + 1); assert.equal(new URL(requests.at(-1).url).hostname, host);
        assert.equal(secrets.at(-1), name);
        if (handler === generateTextHandler) {
          assert.equal(res.body.model, model === 'hf-default' ? 'openai/gpt-oss-120b:nscale' : model === 'gemini-flash' ? 'gemini-3.5-flash-lite' : model === 'nvidia-nemotron-ultra' ? 'nvidia/nemotron-3-ultra-550b-a55b' : 'nvidia/nemotron-3-super-120b-a12b');
          if (model === 'hf-default') assert.equal(res.body.provider, 'huggingface-nscale');
          else if (model === 'gemini-flash') assert.equal(res.body.provider, 'gemini');
          else {
            assert.equal(requests.at(-1).body.chat_template_kwargs.enable_thinking, false);
            assert.equal(requests.at(-1).body.temperature, 1);
            assert.equal(requests.at(-1).body.top_p, 0.95);
            assert.equal(requests.at(-1).body.max_tokens, 900);
            assert.equal(res.body.cost_reference.reserved, model === 'nvidia-nemotron-ultra' ? 4 : 2);
          }
        } else {
          assert.equal(res.body.width, 1024); assert.equal(res.body.height, 1024); assert.equal(res.body.media_type, 'image/png');
          if (model === 'hf-image') assert.equal(requests.at(-1).body.response_format, 'b64_json');
          else if (model === 'gemini-image') assert.equal(requests.at(-1).body.generationConfig.imageConfig.imageSize, '1K');
          else {assert.equal(requests.at(-1).body.steps, 4); assert.equal(requests.at(-1).body.cfg_scale, 0);}
        }
      }
      assert.equal(secrets.length, 7); assert.equal((await f.db.collection('teamAiBudgets').get()).docs[0].data().usage.requests, 7);
    } finally {policy.isGenerationProviderEnabled = enabled; auth.verifyBearerIdToken = originals.verify; params.readSecret = originals.secret; providerHttp.fetch = originals.fetch;}
  });

  test('free OpenRouter HTTP preserves atomic admission, exact zero-price routing and content-free telemetry without fallback', async () => {
    const f = await aiCostFixture(), auth = require('../lib/httpAuth'), params = require('../lib/params'), {logger} = require('firebase-functions/logger');
    const {generateTextHandler} = require('../lib/webApi');
    const saved = {verify:auth.verifyBearerIdToken,secret:params.readSecret,fetch:providerHttp.fetch,write:logger.write},requests=[],events=[];
    const response=()=>({code:null,body:null,set(){return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
    const request=extra=>({method:'POST',headers:{},body:{prompt:'synthetic-private-free-prompt',model:'openrouter-gemma-4-free',scope:f.scope,expectedUid:'bob',...extra}});
    try {
      auth.verifyBearerIdToken=async()=>({uid:'bob'});params.readSecret=(parameter,name)=>{assert.equal(parameter,params.openrouterApiKey);assert.equal(name,'OPENROUTER_API_KEY');return 'synthetic-private-free-key';};logger.write=event=>events.push(event);
      providerHttp.fetch=async(url,options)=>{requests.push({url:String(url),body:JSON.parse(options.body)});return new Response(JSON.stringify({model:'google/gemma-4-31b-it',provider:'Google AI Studio',usage:{cost:0},choices:[{message:{content:'Synthetic free response'},finish_reason:'stop'}]}),{status:200});};
      for(const extra of [{model:'google/gemma-4-31b-it:free'},{model:'openai-mini'},{provider:{max_price:{prompt:1}}},{models:['other/paid']}]){const denied=response();await generateTextHandler(request(extra),denied);assert.equal(denied.code,400);}
      assert.equal(requests.length,0);assert.equal((await f.db.collection('teamAiBudgets').get()).size,0);
      const ok=response();await generateTextHandler(request({}),ok);assert.equal(ok.code,200);assert.equal(ok.body.inference_cost_usd,0);assert.equal(ok.body.provider,'openrouter-google-ai-studio');assert.equal(ok.body.cost_reference.reserved,1);
      assert.equal(requests.length,1);assert.equal(requests[0].url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(requests[0].body.model,'google/gemma-4-31b-it:free');assert.deepEqual(requests[0].body.provider.max_price,{prompt:0,completion:0,request:0,image:0});assert.equal(requests[0].body.provider.allow_fallbacks,false);assert.deepEqual(requests[0].body.provider.only,['google-ai-studio']);
      let attempts=0;providerHttp.fetch=async()=>{attempts++;return new Response('synthetic-private-limit-message',{status:429});};const limited=response();await generateTextHandler(request({}),limited);assert.equal(limited.code,503);assert.equal(attempts,1);
      assert.equal((await f.db.collection('teamAiBudgets').get()).docs[0].data().usage.requests,2);assert.equal(events.filter(e=>e.event==='provider_attempt').length,2);
      assert(events.some(e=>e.event==='outcome'&&e.reason==='success'));assert(events.some(e=>e.event==='outcome'&&e.reason==='provider_failed'));
      assert.equal(JSON.stringify(events).includes('synthetic-private'),false);assert.equal(JSON.stringify(limited.body).includes('synthetic-private'),false);
    } finally {auth.verifyBearerIdToken=saved.verify;params.readSecret=saved.secret;providerHttp.fetch=saved.fetch;logger.write=saved.write;}
  });

  test('HTTP account guards refuse closed accounts and suppress text/image responses revoked before or during provider work', async () => {
    const db = admin.firestore(); const httpAuth = require('../lib/httpAuth'); const params = require('../lib/params');
    const policy = require('../lib/generationProviderPolicy');
    // Patch the defining module: aiBudget re-exports this function through a read-only getter.
    const budget = require('../lib/aiBudgetReservations'); const { generateTextHandler, generateImageHandler, webResearchHandler } = require('../lib/webApi');
    const originals = { enabled: policy.isGenerationProviderEnabled, verify: httpAuth.verifyBearerIdToken, secret: params.readSecret, env: params.readEnv, fetch: providerHttp.fetch, reserve: budget.reserveAiGenerationBudget };
    let uid; let calls = 0; let boundary = 'live';
    const response = () => ({ code: null, body: null, set() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
    const revoke = async () => {
      await db.doc(`accountDeletions/${uid}`).set({ v: 1, status: 'complete' }); await db.doc(`users/${uid}`).delete();
      const budgets = await db.collection('aiBudgets').where('uid', '==', uid).get();
      const rates = await db.collection('rateLimits').where('clientKey', '==', `uid:${uid}`).get();
      for (const row of [...budgets.docs, ...rates.docs]) await row.ref.delete();
    };
    try {
      httpAuth.verifyBearerIdToken = async () => ({ uid, token: 'synthetic-id-token' });
      params.readSecret = () => 'synthetic-provider-key'; params.readEnv = () => undefined;
      budget.reserveAiGenerationBudget = async (...args) => { const accepted = await originals.reserve(...args); if (accepted.admitted && boundary === 'before') await revoke(); return accepted; };
      providerHttp.fetch = async url => {
        calls++; assert.ok(String(url).includes('/chat/completions') || String(url).includes('/v1/genai/'));
        if (boundary === 'during') await revoke();
        if (String(url).startsWith('https://openrouter.ai/')) return new Response(JSON.stringify({ model: 'google/gemma-4-31b-it', provider: 'Google AI Studio', usage: { cost: 0 }, choices: [{ message: { content: 'synthetic-generated-result' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        return String(url).includes('/chat/completions')
          ? new Response(JSON.stringify({ model: 'nvidia/nemotron-3-super-120b-a12b', choices: [{ message: { content: 'synthetic-generated-result' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response(JSON.stringify({artifacts: [{base64: providerImage}]}), { status: 200 });
      };
      uid = 'http-closed'; await db.doc(`accountDeletions/${uid}`).set({ v: 1, status: 'complete' });
      for (const handler of [generateTextHandler, generateImageHandler, webResearchHandler]) {
        const res = response(); await handler({ method: 'POST', headers: {}, body: { prompt: 'synthetic prompt', query: 'synthetic query' } }, res);
        assert.equal(res.code, 403); assert.equal(res.body.error, 'account_unavailable');
      }
      assert.equal(calls, 0); assert.equal((await db.collection('rateLimits').get()).empty, true);
      for (const [kind, provider, model, handler] of [['text', 'openrouter', 'openrouter-gemma-4-free', generateTextHandler],
        ['text', 'nvidia', 'nvidia-nemotron', generateTextHandler], ['image', 'nvidia', 'nvidia-image', generateImageHandler]]) {
        // Real release policy for OpenRouter; explicit future fixture for the retained NVIDIA adapters.
        policy.isGenerationProviderEnabled = provider === 'nvidia' ? id => originals.enabled(id, ['nvidia']) : originals.enabled;
        for (boundary of ['live', 'before', 'during']) {
          uid = `http-${provider}-${kind}-${boundary}`; await db.doc(`users/${uid}`).set({}); const startCalls = calls;
          const circuit = db.doc(`providerCircuits/${kind}_${provider}`); const openUntil = Date.now() - 1000;
          await circuit.set({ failures: 3, windowStartedAt: openUntil - 1000, openUntil, leaseUntil: 0, leaseId: null });
          const res = response(); await handler({ method: 'POST', headers: {}, body: { prompt: 'synthetic prompt', model } }, res);
          assert.equal(res.code, boundary === 'live' ? 200 : 403);
          assert.equal(calls - startCalls, boundary === 'before' ? 0 : 1);
          const state = (await circuit.get()).data(); assert.equal(state.leaseId, null); assert.equal(state.leaseUntil, 0);
          if (boundary !== 'live') {
            assert.deepEqual(res.body, { error: 'account_unavailable', detail: 'Conta indisponível.' });
            assert.equal(state.failures, 3); assert.equal(state.openUntil, openUntil);
            assert.equal((await db.collection('aiBudgets').where('uid', '==', uid).get()).empty, true);
            assert.equal((await db.collection('rateLimits').where('clientKey', '==', `uid:${uid}`).get()).empty, true);
          } else { assert.equal(state.failures, 0); assert.equal(state.openUntil, 0); if (provider === 'openrouter') { assert.equal(res.body.inference_cost_usd, 0); assert.equal(res.body.provider, 'openrouter-google-ai-studio'); } }
        }
      }
    } finally {
      policy.isGenerationProviderEnabled = originals.enabled;
      httpAuth.verifyBearerIdToken = originals.verify; params.readSecret = originals.secret; params.readEnv = originals.env;
      providerHttp.fetch = originals.fetch; budget.reserveAiGenerationBudget = originals.reserve;
    }
  });

  test('account role changes serialize with team state, refuse revoked targets and roll back the team on an audit failure', async () => {
    const db = admin.firestore(); await db.doc('users/alice').set({}); await db.doc('users/bob').set({}); await db.doc('users/carol').set({});
    const team = { ownerUid: 'alice', name: 'Synthetic', memberUids: ['alice', 'bob', 'carol'], wrappedKeys: {}, roles: { alice: 'owner', bob: 'member', carol: 'member' } };
    await db.doc('teams/crew').set(team);
    await Promise.all([executeSetMemberRole('alice', { teamId: 'crew', targetUid: 'bob', role: 'admin' }, db, 1000),
      executeSetMemberRole('alice', { teamId: 'crew', targetUid: 'carol', role: 'admin' }, db, 1000)]);
    assert.deepEqual((await db.doc('teams/crew').get()).data().roles, { alice: 'owner', bob: 'admin', carol: 'admin' });
    const collision = db.doc('teamAudit/synthetic-collision'); await collision.set({ action: 'existing' });
    const collidingDb = { doc: db.doc.bind(db), runTransaction: db.runTransaction.bind(db), collection: name => name === 'teamAudit' ? { doc: () => collision } : db.collection(name) };
    await assert.rejects(executeSetMemberRole('alice', { teamId: 'crew', targetUid: 'bob', role: 'member' }, collidingDb, 1001));
    assert.equal((await db.doc('teams/crew').get()).data().roles.bob, 'admin');
    assert.equal((await collision.get()).data().action, 'existing');
    await db.doc('accountDeletions/bob').set({ v: 1, status: 'complete' });
    await assert.rejects(executeSetMemberRole('alice', { teamId: 'crew', targetUid: 'bob', role: 'member' }, db, 1002), { code: 'failed-precondition' });
    await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' });
    await assert.rejects(executeSetMemberRole('alice', { teamId: 'crew', targetUid: 'carol', role: 'member' }, db, 1002), { code: 'failed-precondition' });
    assert.equal((await db.doc('teams/crew').get()).data().roles.carol, 'admin');
  });

  async function invitationFixture() {
    const db = admin.firestore(); const fingerprint = uid => createHash('sha256').update(`synthetic-public-${uid}`).digest('hex');
    const keyId = '12345678-1234-4234-8234-123456789abc';
    const wrap = { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 7).toString('base64') };
    for (const uid of ['alice', 'bob', 'carol']) {
      await db.doc(`users/${uid}`).set({});
      await db.doc(`publicProfiles/${uid}`).set({ uid, displayName: uid, publicKeyPem: `synthetic-public-${uid}`,
        emailHash: createHash('sha256').update(`${uid}@example.com`).digest('hex') });
    }
    await db.doc('teams/crew').set({ name: 'Synthetic', ownerUid: 'alice', memberUids: ['alice'],
      roles: { alice: 'owner' }, wrappedKeys: { alice: wrap }, activeKeyEpoch: 1, activeKeyId: keyId, keyRotationStatus: 'active' });
    await db.doc('teams/crew/keyEpochs/1').set({ epoch: 1, keyId, status: 'active', memberUids: ['alice'],
      wrappedKeys: { alice: wrap }, publicKeyFingerprints: { alice: fingerprint('alice') } });
    const inputFor = uid => ({ teamId: 'crew', email: `${uid}@example.com`, wrappedKey: wrap, expectedUid: 'alice',
      inviteeUid: uid, expectedKeyEpoch: 1, expectedKeyId: keyId, publicKeyFingerprint: fingerprint(uid) });
    const lookup = { getUserByEmail: async email => ({ uid: email.split('@')[0], email, emailVerified: true, disabled: false }) };
    return { db, wrap, keyId, fingerprint, inputFor, lookup };
  }

  test('team email lookup and invitations require a verified matching Auth address before exposing keys or creating wraps',async()=>{
    const f=await invitationFixture();for(const patch of [{emailVerified:false},{emailVerified:undefined},{emailVerified:'true'},{email:'other@example.com'},{disabled:true}]){const lookup={getUserByEmail:async email=>({uid:'bob',email,emailVerified:true,...patch})};await assert.rejects(executeLookupTeamInvitee('bob@example.com',f.db,lookup),{code:'failed-precondition'});await assert.rejects(executeInviteMember('alice',f.inputFor('bob'),f.db,lookup,1000),{code:'failed-precondition'});}
    assert.equal((await f.db.collection('teamInvites').get()).size,0);assert.deepEqual((await f.db.doc('teams/crew').get()).data().memberUids,['alice']);
  });
  test('team email binding is revalidated after the profile read and cannot change UID during invite preparation',async()=>{
    const f=await invitationFixture();for(const patch of [{uid:'carol'},{emailVerified:false},{email:'changed@example.com'}]){let reads=0;const lookup={getUserByEmail:async email=>({uid:'bob',email,emailVerified:true,...(++reads===2?patch:{})})};await assert.rejects(executeInviteMember('alice',f.inputFor('bob'),f.db,lookup,1000),{code:'failed-precondition'});assert.equal(reads,2);}
    assert.equal((await f.db.collection('teamInvites').get()).size,0);assert.equal((await executeLookupTeamInvitee('BOB@example.com',f.db,f.lookup)).uid,'bob');
  });

  test('team invitation inbox exposes only recipient pointers and fresh key reads stop when the team freezes', async () => {
    const f = await invitationFixture(); const made = await executeInviteMember('alice', f.inputFor('bob'), f.db, f.lookup, 1000);
    await f.db.doc(`teamInvites/${made.inviteId}`).update({ expiresAt: Date.now() + 600000 });
    const bob = testEnv.authenticatedContext('bob').firestore(); const carol = testEnv.authenticatedContext('carol').firestore();
    const rows = await assertSucceeds(bob.collection('teamInviteInbox').where('uid', '==', 'bob').get());
    assert.equal(rows.size, 1); assert.deepEqual(rows.docs[0].data(), { v: 1, uid: 'bob', teamId: 'crew', inviteId: made.inviteId });
    await assertFails(carol.doc(`teamInviteInbox/${made.inviteId}`).get());
    await assertFails(bob.doc(`teamInviteInbox/${made.inviteId}`).update({ teamId: 'other' }));
    await assertSucceeds(bob.doc(`teamInvites/${made.inviteId}`).get());
    await executeAcceptInvite('bob', { inviteId: made.inviteId }, f.db, 1001);
    assert.equal((await f.db.doc(`teamInviteInbox/${made.inviteId}`).get()).exists, false);
    const next = await executeInviteMember('alice', f.inputFor('carol'), f.db, f.lookup, 1002);
    await f.db.doc(`teamInvites/${next.inviteId}`).update({ expiresAt: Date.now() + 600000 });
    await assertSucceeds(carol.doc(`teamInvites/${next.inviteId}`).get());
    await f.db.doc('accountDeletions/alice').set({ v: 1, phase: 'objects', status: 'deleting' });
    await assertFails(carol.doc(`teamInvites/${next.inviteId}`).get());
    await f.db.doc('accountDeletions/alice').delete(); // Synthetic fixture reset, never a production rollback.
    await f.db.doc('teams/crew').update({ deletionState: 'deleting', memberUids: [], wrappedKeys: {} });
    await assertSucceeds(carol.collection('teamInviteInbox').where('uid', '==', 'carol').get());
    await assertFails(carol.doc(`teamInvites/${next.inviteId}`).get());
  });

  test('recipient invitation key reads deny terminal, expired, old-epoch and withdrawn issuer authority', async () => {
    const f = await invitationFixture(); const now = Date.now();
    const baseTeam = (await f.db.doc('teams/crew').get()).data();
    await f.db.doc('teams/crew').update({ memberUids: ['alice', 'carol'], roles: { alice: 'owner', carol: 'admin' },
      wrappedKeys: { alice: f.wrap, carol: f.wrap } });
    await f.db.doc('teams/crew/keyEpochs/1').update({ memberUids: ['alice', 'carol'], wrappedKeys: { alice: f.wrap, carol: f.wrap } });
    const made = await executeInviteMember('carol', { ...f.inputFor('bob'), expectedUid: 'carol' }, f.db, f.lookup, now);
    const team = (await f.db.doc('teams/crew').get()).data();
    const invitation = (await f.db.doc(`teamInvites/${made.inviteId}`).get()).data();
    const bob = testEnv.authenticatedContext('bob').firestore();
    const read = () => bob.doc(`teamInvites/${made.inviteId}`).get({ source: 'server' });
    await assertSucceeds(read());
    for (const patch of [{ status: 'accepted' }, { status: 'revoked' }, { status: 'expired' }, { expiresAt: now - 1 },
      { keyEpoch: 0 }, { keyId: 'old-key' }, { publicKeyFingerprint: 'legacy-unverified' }]) {
      await f.db.doc(`teamInvites/${made.inviteId}`).set({ ...invitation, ...patch }); await assertFails(read());
    }
    await f.db.doc(`teamInvites/${made.inviteId}`).set(invitation);
    for (const patch of [{ roles: { alice: 'owner', carol: 'member' } }, { memberUids: ['alice'] },
      { keyRotationStatus: 'rotation_pending' }, { activeKeyEpoch: 2 }, { deletionState: 'deleting' }]) {
      await f.db.doc('teams/crew').set({ ...team, ...patch }); await assertFails(read());
    }
    await f.db.doc('teams/crew').set(team);
    await executeAcceptInvite('bob', { inviteId: made.inviteId }, f.db, now + 1);
    await assertSucceeds(read()); // Current membership grants access; recipient exception is no longer used.
    await f.db.doc('teams/crew').set(baseTeam); await assertFails(read());
    await f.db.doc('teams/crew').set({ ...team, memberUids: ['alice', 'carol', 'bob'] });
    await f.db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' }); await assertFails(read());
  });

  test('inbox migration paginates, leaves ciphertext unchanged, discovers recipients and repeats safely', async () => {
    const f = await invitationFixture();
    const made = await executeInviteMember('alice', f.inputFor('bob'), f.db, f.lookup, 1000);
    await f.db.doc(`teamInvites/${made.inviteId}`).update({ expiresAt: Date.now() + 600000 });
    const original = (await f.db.doc(`teamInvites/${made.inviteId}`).get()).data();
    await f.db.doc(`teamInviteInbox/${made.inviteId}`).delete();
    const batch = f.db.batch();
    for (let i = 0; i < 26; i++) batch.set(f.db.doc(`teamInvites/legacy-${String(i).padStart(2, '0')}`), original);
    batch.delete(f.db.doc(`teamInvites/${made.inviteId}`)); await batch.commit();
    const auth = { getUser: async uid => ({ uid }) };
    const input = { collection: 'teamInvites', afterId: null, limit: 25, apply: false, now: 1001 };
    const dry = await migrateTeamInviteInboxPage(input, f.db, auth);
    assert.equal(dry.scanned, 25); assert.equal(dry.changesNeeded, 25); assert.equal(dry.exhausted, false);
    assert.equal((await f.db.collection('teamInviteInbox').get()).size, 0);
    const first = await migrateTeamInviteInboxPage({ ...input, apply: true }, f.db, auth);
    assert.equal(first.created, 25);
    const second = await migrateTeamInviteInboxPage({ ...input, apply: true, afterId: first.nextAfterId }, f.db, auth);
    assert.equal(second.created, 1); assert.equal(second.exhausted, true);
    const repeat = await migrateTeamInviteInboxPage({ ...input, limit: 100, apply: true }, f.db, auth);
    assert.equal(repeat.created, 0); assert.equal(repeat.changesNeeded, 0); assert.equal(repeat.unresolved, 0);
    assert.deepEqual((await f.db.doc('teamInvites/legacy-00').get()).data(), original);
    const bob = testEnv.authenticatedContext('bob').firestore();
    assert.equal((await assertSucceeds(bob.collection('teamInviteInbox').where('uid', '==', 'bob').get())).size, 26);
    await assertSucceeds(bob.doc('teamInvites/legacy-00').get());
    const alice = testEnv.authenticatedContext('alice').firestore();
    assert.equal((await assertSucceeds(alice.collection('teamInvites').where('teamId', '==', 'crew').get())).size, 26);
  });

  test('inbox migration removes terminal and orphan pointers, reports unverifiable legacy identities and preserves conflicts', async () => {
    const f = await invitationFixture(); const auth = { getUser: async uid => ({ uid }) };
    const made = await executeInviteMember('alice', f.inputFor('bob'), f.db, f.lookup, 1000);
    const original = (await f.db.doc(`teamInvites/${made.inviteId}`).get()).data();
    await f.db.doc(`teamInviteInbox/${made.inviteId}`).delete(); await f.db.doc(`teamInvites/${made.inviteId}`).delete();
    const batch = f.db.batch();
    for (const [id, extra] of [['accepted', { status: 'accepted' }], ['expired', { expiresAt: 1001 }],
      ['legacy', {}], ['conflict', {}]]) {
      const candidate = { ...original, ...extra }; if (id === 'legacy') delete candidate.publicKeyFingerprint;
      batch.set(f.db.doc(`teamInvites/${id}`), candidate);
      batch.set(f.db.doc(`teamInviteInbox/${id}`), { v: 1, uid: id === 'conflict' ? 'carol' : 'bob', teamId: 'crew', inviteId: id });
    }
    batch.set(f.db.doc('teamInviteInbox/orphan'), { v: 1, uid: 'bob', teamId: 'crew', inviteId: 'orphan' }); await batch.commit();
    const input = { collection: 'teamInvites', afterId: null, limit: 100, apply: true, now: 1002 };
    const migrated = await migrateTeamInviteInboxPage(input, f.db, auth);
    assert.equal(migrated.removed, 3); assert.equal(migrated.reasons.reissue, 1); assert.equal(migrated.reasons.conflict, 1);
    assert.equal(migrated.unresolved, 2); assert.equal((await f.db.doc('teamInvites/legacy').get()).data().publicKeyFingerprint, undefined);
    assert.equal((await f.db.doc('teamInviteInbox/conflict').get()).data().uid, 'carol');
    const orphans = await migrateTeamInviteInboxPage({ ...input, collection: 'teamInviteInbox' }, f.db, auth);
    assert.equal(orphans.removed, 1); assert.equal((await f.db.doc('teamInviteInbox/orphan').get()).exists, false);
  });

  test('inbox migration rechecks deletion and identity after Auth admission and survives transaction failure', async () => {
    const f = await invitationFixture();
    const made = await executeInviteMember('alice', f.inputFor('bob'), f.db, f.lookup, 1000);
    await f.db.doc(`teamInviteInbox/${made.inviteId}`).delete();
    const input = { collection: 'teamInvites', afterId: null, limit: 100, apply: true, now: 1001 };
    const disabled = await migrateTeamInviteInboxPage(input, f.db, { getUser: async uid => ({ uid, disabled: uid === 'bob' }) });
    assert.equal(disabled.reasons.unavailable, 1); assert.equal(disabled.created, 0);
    let changed = false;
    const lateAuth = { getUser: async uid => {
      if (!changed) { changed = true; await f.db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' }); }
      return { uid };
    } };
    const denied = await migrateTeamInviteInboxPage(input, f.db, lateAuth);
    assert.equal(denied.reasons.unavailable, 1); assert.equal(denied.created, 0);
    await f.db.doc('accountDeletions/alice').delete(); // Isolated fixture reset only.
    const auth = { getUser: async uid => ({ uid }) };
    const faultyDb = { collection: name => f.db.collection(name), doc: path => f.db.doc(path),
      runTransaction: callback => f.db.runTransaction(tx => callback(new Proxy(tx, { get(target, key) {
        if (key === 'create') return () => { throw new Error('synthetic write failure'); };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } }))) };
    await assert.rejects(migrateTeamInviteInboxPage(input, faultyDb, auth), /synthetic write failure/);
    assert.equal((await f.db.doc(`teamInviteInbox/${made.inviteId}`).get()).exists, false);
    assert.equal((await migrateTeamInviteInboxPage(input, f.db, auth)).created, 1);
    await f.db.doc('publicProfiles/bob').update({ publicKeyPem: 'changed-public-bob' });
    const recheck = await migrateTeamInviteInboxPage(input, f.db, auth);
    assert.equal(recheck.reasons.reissue, 1); assert.equal(recheck.removed, 1);
  });

  test('account invitations serialize duplicates and reject stale epochs, identities and audit failures atomically', async () => {
    const { db, inputFor, lookup } = await invitationFixture();
    const input = inputFor('bob');
    const concurrent = await Promise.allSettled(Array.from({ length: 4 }, () => executeInviteMember('alice', input, db, lookup, 1000)));
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = concurrent.filter(result => result.status === 'rejected');
    assert.equal(rejected.length, 3);
    assert.equal((await db.collection('teamInvites').get()).size, 1);
    assert.equal((await db.collection('teamAudit').get()).size, 1);
    assert.equal((await db.doc('teams/crew').get()).data().inviteRevision, 1);
    for (const result of rejected) {
      if (result.reason.code !== 'already-exists') {
        // The emulator can close a contended query transaction with gRPC INVALID_ARGUMENT;
        // the SDK only retries that code for "transaction has expired". Require this exact
        // infrastructure error, then prove a fresh request still cannot create a duplicate.
        assert.equal(result.reason.code, 3);
        assert.equal(result.reason.details, 'Transaction is invalid or closed.');
        await assert.rejects(executeInviteMember('alice', input, db, lookup, 1000), { code: 'already-exists' });
      }
    }
    assert.equal((await db.collection('teamInvites').get()).size, 1);
    assert.equal((await db.collection('teamInviteInbox').get()).size, 1);
    assert.equal((await db.collection('teamAudit').get()).size, 1);
    assert.equal((await db.doc('teams/crew').get()).data().inviteRevision, 1);
    const carol = inputFor('carol');
    await assert.rejects(executeInviteMember('alice', { ...carol, expectedKeyEpoch: 2 }, db, lookup, 1001), { code: 'failed-precondition' });
    await assert.rejects(executeInviteMember('alice', { ...carol, expectedKeyId: 'other-key' }, db, lookup, 1001), { code: 'failed-precondition' });
    await assert.rejects(executeInviteMember('alice', { ...carol, inviteeUid: 'bob' }, db, lookup, 1001), { code: 'failed-precondition' });
    await db.doc('publicProfiles/carol').update({ publicKeyPem: 'synthetic-new-public-carol' });
    await assert.rejects(executeInviteMember('alice', carol, db, lookup, 1001), { code: 'failed-precondition' });
    await db.doc('publicProfiles/carol').update({ publicKeyPem: 'synthetic-public-carol' });
    const collision = db.doc('teamAudit/synthetic-collision'); await collision.set({ action: 'existing' });
    const collidingDb = { doc: db.doc.bind(db), runTransaction: db.runTransaction.bind(db), collection: name => name === 'teamAudit' ? { doc: () => collision } : db.collection(name) };
    await assert.rejects(executeInviteMember('alice', carol, collidingDb, lookup, 1001));
    assert.equal((await db.collection('teamInvites').get()).size, 1);
    assert.equal((await db.doc('teams/crew').get()).data().inviteRevision, 1);
    assert.equal((await collision.get()).data().action, 'existing');
    const rotatingLookup = { getUserByEmail: async () => {
      await db.doc('teams/crew').update({ keyRotationStatus: 'rotation_pending' }); return { uid: 'carol' };
    } };
    await assert.rejects(executeInviteMember('alice', carol, db, rotatingLookup, 1002), { code: 'failed-precondition' });
    assert.equal((await db.collection('teamInvites').get()).size, 1);
  });

  test('account invitation admission and acceptance deny revoked parties and preserve membership on rollback', async () => {
    const { db, inputFor, lookup, fingerprint } = await invitationFixture();
    const input = inputFor('bob');
    for (const uid of ['alice', 'bob']) {
      await db.doc(`accountDeletions/${uid}`).set({ v: 1, status: 'deleting' });
      await assert.rejects(executeInviteMember('alice', input, db, lookup, 1000), { code: 'failed-precondition' });
      if (uid === 'bob') await assert.rejects(executeLookupTeamInvitee('bob@example.com', db, lookup), { code: 'failed-precondition' });
      await db.doc(`accountDeletions/${uid}`).delete(); // Synthetic fixture only.
    }
    assert.equal((await db.collection('teamInvites').get()).size, 0);
    const invited = await executeInviteMember('alice', input, db, lookup, 1000);
    for (const uid of ['bob', 'alice']) {
      await db.doc(`accountDeletions/${uid}`).set({ v: 1, status: 'complete' });
      await assert.rejects(executeAcceptInvite('bob', { inviteId: invited.inviteId }, db, 1001), { code: 'failed-precondition' });
      assert.deepEqual((await db.doc('teams/crew').get()).data().memberUids, ['alice']);
      assert.equal((await db.doc(`teamInvites/${invited.inviteId}`).get()).data().status, 'pending');
      await db.doc(`accountDeletions/${uid}`).delete();
    }
    await db.doc('publicProfiles/bob').update({ publicKeyPem: 'synthetic-new-public-bob' });
    await assert.rejects(executeAcceptInvite('bob', { inviteId: invited.inviteId }, db, 1001), { code: 'failed-precondition' });
    await db.doc('publicProfiles/bob').update({ publicKeyPem: 'synthetic-public-bob' });
    const collision = db.doc('teamAudit/synthetic-collision'); await collision.set({ action: 'existing' });
    const collidingDb = { doc: db.doc.bind(db), runTransaction: db.runTransaction.bind(db), collection: name => name === 'teamAudit' ? { doc: () => collision } : db.collection(name) };
    await assert.rejects(executeAcceptInvite('bob', { inviteId: invited.inviteId }, collidingDb, 1001));
    assert.deepEqual((await db.doc('teams/crew').get()).data().memberUids, ['alice']);
    assert.deepEqual((await db.doc('teams/crew/keyEpochs/1').get()).data().memberUids, ['alice']);
    assert.equal((await db.doc(`teamInvites/${invited.inviteId}`).get()).data().status, 'pending');
    const accepted = await Promise.allSettled([executeAcceptInvite('bob', { inviteId: invited.inviteId }, db, 1002),
      executeAcceptInvite('bob', { inviteId: invited.inviteId }, db, 1002)]);
    assert.equal(accepted.filter(result => result.status === 'fulfilled').length, 1);
    assert.deepEqual((await db.doc('teams/crew').get()).data().memberUids, ['alice', 'bob']);
    assert.equal((await db.doc('teams/crew/keyEpochs/1').get()).data().publicKeyFingerprints.bob, fingerprint('bob'));
    assert.equal((await db.collection('teamAudit').where('action', '==', 'accepted').get()).size, 1);
  });

  test('account invitation rejects a revoked owner for an active admin and a marker arriving during identity lookup', async () => {
    const { db, inputFor, lookup, wrap } = await invitationFixture();
    await db.doc('teams/crew').update({ memberUids: ['alice', 'carol'], roles: { alice: 'owner', carol: 'admin' }, wrappedKeys: { alice: wrap, carol: wrap } });
    await db.doc('teams/crew/keyEpochs/1').update({ memberUids: ['alice', 'carol'], wrappedKeys: { alice: wrap, carol: wrap } });
    const input = { ...inputFor('bob'), expectedUid: 'carol' };
    const missingAuth = { getUserByEmail: async () => { throw Error('synthetic Auth failure'); } };
    await assert.rejects(executeInviteMember('carol', input, db, missingAuth), { code: 'failed-precondition' });
    await assert.rejects(executeLookupTeamInvitee('bob@example.com', db, missingAuth), { code: 'failed-precondition' });
    await assert.rejects(executeInviteMember('carol', input, db, { getUserByEmail: async () => ({ uid: 'bob', disabled: true }) }), { code: 'failed-precondition' });
    await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' });
    await assert.rejects(executeInviteMember('carol', input, db, lookup), { code: 'failed-precondition' });
    await db.doc('accountDeletions/alice').delete();
    const delayedLookup = { getUserByEmail: async () => {
      await db.doc('accountDeletions/bob').set({ v: 1, status: 'deleting' }); return { uid: 'bob' };
    } };
    await assert.rejects(executeInviteMember('carol', input, db, delayedLookup), { code: 'failed-precondition' });
    assert.equal((await db.collection('teamInvites').get()).size, 0); assert.equal((await db.collection('teamAudit').get()).size, 0);
    assert.equal((await db.doc('teams/crew').get()).data().inviteRevision, undefined);
  });

  test('account rotation requests and supervision never notify revoked admins or accept a revoked caller retry', async () => {
    const { db, wrap } = await invitationFixture();
    const members = ['alice', 'bob', 'carol']; const wraps = { alice: wrap, bob: wrap, carol: wrap };
    await db.doc('teams/crew').update({ memberUids: members, wrappedKeys: wraps, roles: { alice: 'owner', bob: 'admin', carol: 'member' } });
    await db.doc('teams/crew/keyEpochs/1').update({ memberUids: members, wrappedKeys: wraps });
    await db.doc('accountDeletions/bob').set({ v: 1, status: 'deleting', phase: 'objects' });
    await assert.rejects(executeRequestTeamKeyRotation('bob', { teamId: 'crew', reason: 'manual' }, db, 1000), { code: 'failed-precondition' });
    await assert.rejects(executeRequestTeamKeyRotation('alice', { teamId: 'crew', reason: 'member_removed', targetUid: 'bob' }, db, 1000), { code: 'failed-precondition' });
    assert.equal((await db.collection('teamKeyRotations').get()).size, 0);
    const input = { teamId: 'crew', reason: 'manual', idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    const collision = db.doc('teamAudit/synthetic-collision'); await collision.set({ action: 'existing' });
    const collidingDb = { doc: db.doc.bind(db), runTransaction: db.runTransaction.bind(db), collection: name => name === 'teamAudit' ? { doc: () => collision } : db.collection(name) };
    await assert.rejects(executeRequestTeamKeyRotation('alice', input, collidingDb, 1000));
    assert.equal((await db.doc('teams/crew').get()).data().keyRotationStatus, 'active');
    assert.equal((await db.collection('notifications').get()).size, 0);
    assert.equal((await db.collection('teamRotationRequests').get()).size, 0);
    assert.equal((await db.collection('teamKeyRotations').get()).size, 0);
    const requested = await executeRequestTeamKeyRotation('alice', input, db, 1000);
    assert.equal((await db.collection('notifications').where('uid', '==', 'alice').get()).size, 1);
    assert.equal((await db.collection('notifications').where('uid', '==', 'bob').get()).size, 0);
    const supervised = await supervisePendingTeamRotations(db, 1000 + 86_400_001);
    assert.deepEqual(supervised, { scanned: 1, blocked: 1 });
    assert.equal((await db.collection('notifications').where('uid', '==', 'alice').get()).size, 2);
    assert.equal((await db.collection('notifications').where('uid', '==', 'bob').get()).size, 0);
    await db.doc('accountDeletions/alice').set({ v: 1, status: 'complete' });
    await assert.rejects(executeRequestTeamKeyRotation('alice', input, db, 1001), { code: 'failed-precondition' });
    assert.equal((await db.collection('teamRotationRequests').get()).size, 1);
    assert.equal((await db.doc(`teamKeyRotations/${requested.rotationId}`).get()).data().status, 'blocked');
  });

  test('account rotation cleanup requires the documents phase and scheduler skips a revoked owner', async () => {
    const { db, wrap } = await invitationFixture();
    await db.doc('teams/crew').update({ memberUids: ['alice', 'bob'], wrappedKeys: { alice: wrap, bob: wrap },
      roles: { alice: 'owner', bob: 'member' }, nextRotationDueAt: 1 });
    await db.doc('teams/crew/keyEpochs/1').update({ memberUids: ['alice', 'bob'], wrappedKeys: { alice: wrap, bob: wrap } });
    await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting', phase: 'objects' });
    assert.deepEqual(await requestDueTeamKeyRotations(db, 1000), { scanned: 1, requested: 0 });
    assert.equal((await db.collection('notifications').get()).size, 0); assert.equal((await db.collection('teamAudit').get()).size, 0);
    await db.doc('accountDeletions/alice').delete(); // Synthetic fixture only.
    const input = { teamId: 'crew', reason: 'member_left', targetUid: 'bob' };
    await assert.rejects(executeRequestTeamKeyRotation('bob', input, db, 1000, 'account-cleanup'), { code: 'failed-precondition' });
    await db.doc('accountDeletions/bob').set({ v: 1, status: 'deleting', phase: 'objects' });
    await assert.rejects(executeRequestTeamKeyRotation('bob', input, db, 1000, 'account-cleanup'), { code: 'failed-precondition' });
    await db.doc('accountDeletions/bob').update({ phase: 'documents' });
    await assert.rejects(executeRequestTeamKeyRotation('bob', input, db, 1000), { code: 'failed-precondition' });
    await assert.rejects(executeRequestTeamKeyRotation('bob', { ...input, reason: 'manual', targetUid: undefined }, db, 1000, 'account-cleanup'), { code: 'permission-denied' });
    await assert.rejects(executeRequestTeamKeyRotation('system', { teamId: 'crew', reason: 'scheduled' }, db, 1000), { code: 'permission-denied' });
    const cleanup = await purgeUserTeamMemberships('bob', db);
    assert.equal(cleanup, 1); assert.deepEqual((await db.doc('teams/crew').get()).data().memberUids, ['alice']);
    assert.equal((await db.doc('teams/crew').get()).data().keyRotationStatus, 'rotation_pending');
    assert.equal((await db.collection('notifications').where('uid', '==', 'bob').get()).size, 0);
    assert.equal(await purgeUserTeamMemberships('bob', db), 0);
    const rotations = await db.collection('teamKeyRotations').get();
    await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting', phase: 'objects' });
    const due = rotations.docs[0].data().deadlineAt + 1;
    assert.deepEqual(await supervisePendingTeamRotations(db, due), { scanned: 1, blocked: 0 });
    assert.equal((await db.doc(`teamKeyRotations/${rotations.docs[0].id}`).get()).data().status, 'pending');
    assert.equal((await db.collection('notifications').get()).size, 1);
  });

  test('team deletion freezes all members, purges other member objects with retry, and preserves personal data and Auth', async () => {
    const f = await purgeFixture(); const db = f.db;
    const keyId = '88888888-8888-4888-8888-888888888888'; const id = '99999999-9999-4999-8999-999999999999';
    const personalId = '77777777-7777-4777-8777-777777777777';
    await db.doc('users/bob').set({ synthetic: 'preserved' });
    await db.doc('teams/crew').set({ name: 'Synthetic', ownerUid: 'bob', memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} },
      roles: { bob: 'owner', alice: 'member' }, activeKeyEpoch: 1, activeKeyId: keyId, keyRotationStatus: 'active' });
    await db.doc('teams/crew/keyEpochs/1').set({ epoch: 1, keyId, status: 'active', memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} } });
    const file = await f.create(id, true, { kind: 'team', teamId: 'crew', keyEpoch: 1, keyId });
    const personal = await f.create(personalId);
    const note = db.doc('sessions/team-note'); await note.set({ uid: 'alice', teamId: 'crew', keyEpoch: 1, keyId,
      text: '', title: null, timestamp: 1, updatedAt: 1, enc: { v: 2, iv: 'A'.repeat(16), ct: 'B'.repeat(24) }, attachments: [attachmentDescriptor(file)] });
    await note.collection('versions').doc('old').set({ attachments: [attachmentDescriptor(file)], synthetic: true });
    await note.collection('suggestions').doc('old').set({ synthetic: true });
    await db.doc('sessions/personal-note').set({ uid: 'alice', teamId: null, attachments: [attachmentDescriptor(personal)] });
    await db.doc('shares/team-share').set({ sessionId: 'team-note', uid: 'alice' });
    await db.doc('attachmentMutations/synthetic').set({ uid: 'alice', sessionId: 'team-note' });
    await db.doc('memoryUsageReceipts/team-note').set({ uid: 'alice', sessionId: 'team-note' });
    await db.doc('notifications/rotation').set({ uid: 'alice', teamId: 'crew' });
    await db.doc('teamInvites/pending').set({ uid: 'alice', teamId: 'crew', status: 'pending' });
    await db.doc('teamInviteInbox/pending').set({ v: 1, uid: 'alice', inviteId: 'pending', teamId: 'crew' });
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('teamInvites/pending').get());
    await assertSucceeds(alice.collection('teamInviteInbox').where('uid', '==', 'alice').get());
    await db.doc('teamCreationRequests/synthetic').set({ uid: 'bob', teamId: 'crew', digest: 'synthetic' });
    for (const name of ['teamAiBudgets', 'teamAiBudgetWindows', 'teamRevisions', 'teamRevisionBudgets', 'teamRevisionTeamBudgets','memoryEdits','memoryEditEvents','memoryEditBudgets','memoryEditTeamBudgets','teamConnectionChanges','teamConnectionEvents','semanticClusterChanges','semanticClusterEvents','semanticClusterBudgets','semanticClusterTeamBudgets']) {
      await db.doc(`${name}/crew-budget`).set({ teamId: 'crew', ownerUid: 'bob', usage: { requests: 1 } });
      await db.doc(`${name}/other-budget`).set({ teamId: 'another-team', ownerUid: 'bob', usage: { requests: 2 } });
    }
    const deps = { firestore: db, now: f.deps.now, attachments: f.deps }; const input = { teamId: 'crew', expectedUid: 'bob' };
    await assert.rejects(deleteTeam.run(input, { auth: { uid: 'bob' } }), { code: 'failed-precondition' });
    assert.equal((await db.doc('teamDeletions/crew').get()).exists, false);
    await assert.rejects(executeDeleteTeam('alice', { ...input, expectedUid: 'alice' }, deps), { code: 'permission-denied' });
    const first = await executeDeleteTeam('bob', input, deps); assert.equal(first.status, 'pending');
    assert.deepEqual((await db.doc('teams/crew').get()).data().memberUids, []);
    await assertFails(alice.doc('sessions/team-note').get()); await assertFails(alice.doc('teams/crew/keyEpochs/1').get());
    await assertFails(alice.doc('teamInvites/pending').get()); await assertFails(alice.doc('teamDeletions/crew').get());
    await assertFails(alice.collection('teamInvites').where('uid', '==', 'alice').where('status', '==', 'pending').get());
    await assertSucceeds(alice.collection('teamInviteInbox').where('uid', '==', 'alice').get());
    await assertFails(alice.doc('sessions/team-note').update({ updatedAt: 2 }));
    f.setNow(first.retryAt); f.fail(true);
    await assert.rejects(executeDeleteTeam('bob', input, deps));
    assert.equal((await db.doc('teams/crew').get()).exists, true); assert.equal((await note.get()).exists, true);
    assert.equal((await db.doc(`attachmentUploads/${id}`).get()).data().storedQuotaReleased, false);
    f.fail(false); let failure = true;
    const faultyDb = { doc: db.doc.bind(db), collection: db.collection.bind(db), runTransaction: db.runTransaction.bind(db),
      batch: db.batch.bind(db), recursiveDelete: async ref => { if (failure && ref.path.endsWith('/versions')) throw Error('synthetic child failure'); return db.recursiveDelete(ref); } };
    const faultyDeps = { ...deps, firestore: faultyDb, attachments: { ...f.deps, firestore: faultyDb } };
    await assert.rejects(executeDeleteTeam('bob', input, faultyDeps));
    assert.equal((await note.get()).exists, true); assert.equal((await db.doc('teams/crew').get()).exists, true);
    assert.equal((await db.doc('teamDeletions/crew').get()).data().phase, 'documents');
    await accountCreatedSessionUsage(db, 'team-note', 'alice', f.deps.now());
    assert.equal((await db.doc('memoryUsageReceipts/team-note').get()).exists, false);
    failure = false; const done = await executeDeleteTeam('bob', input, faultyDeps); assert.equal(done.status, 'complete');
    for (const path of ['teams/crew', 'teams/crew/keyEpochs/1', 'sessions/team-note', 'sessions/team-note/versions/old',
      'sessions/team-note/suggestions/old', 'shares/team-share', 'attachmentMutations/synthetic', 'notifications/rotation', `attachmentUploads/${id}`]) {
      assert.equal((await db.doc(path).get()).exists, false);
    }
    assert.equal((await db.doc('teamCreationRequests/synthetic').get()).data().status, 'cancelled');
    for (const name of ['teamAiBudgets', 'teamAiBudgetWindows', 'teamRevisions', 'teamRevisionBudgets', 'teamRevisionTeamBudgets','memoryEdits','memoryEditEvents','memoryEditBudgets','memoryEditTeamBudgets','teamConnectionChanges','teamConnectionEvents','semanticClusterChanges','semanticClusterEvents','semanticClusterBudgets','semanticClusterTeamBudgets']) {
      assert.equal((await db.doc(`${name}/crew-budget`).get()).exists, false);
      assert.equal((await db.doc(`${name}/other-budget`).get()).data().usage.requests, 2);
    }
    assert.equal((await db.doc('teamCreationRequests/synthetic').get()).data().teamId, undefined);
    assert.equal((await db.doc(`attachmentUploads/${personalId}`).get()).data().status, 'ready'); assert.equal(f.objects.has(personal.publishedPath), true);
    assert.equal((await db.doc('sessions/personal-note').get()).exists, true);
    assert.deepEqual((await db.doc('users/bob').get()).data(), { synthetic: 'preserved' });
    assert.equal((await db.doc('users/alice').get()).exists, true); assert.equal((await db.doc('accountDeletions/bob').get()).exists, false);
    const marker = (await db.doc('teamDeletions/crew').get()).data();
    assert.deepEqual(Object.keys(marker).sort(), ['completedAt', 'leaseUntil', 'ownerDigest', 'phase', 'status', 'v']);
    assert.deepEqual(await executeDeleteTeam('bob', input, deps), done);
    assert.equal((await getTeamDeletionStatus.run(input, { auth: { uid: 'bob' } })).status, 'complete');
    assert.equal((await deleteTeam.run(input, { auth: { uid: 'bob' } })).status, 'complete');
    await accountCreatedSessionUsage(db, 'team-note', 'alice', f.deps.now()); assert.equal((await db.doc('memoryUsageReceipts/team-note').get()).exists, false);
  });

  test('team deletion resumes after a lost parent-delete ACK, rejects revoked owners and preserves legacy ownership anchors', async () => {
    const f = await purgeFixture(); const db = f.db; const input = { teamId: 'crew', expectedUid: 'alice' };
    await db.doc('teams/crew').set({ name: 'Synthetic', ownerUid: 'alice', memberUids: ['alice'], wrappedKeys: { alice: {} } });
    await db.doc('sessions/legacy-team').set({ uid: 'alice', teamId: 'crew', attachments: [{ url: 'synthetic-legacy' }] });
    const deps = { firestore: db, now: f.deps.now, attachments: f.deps };
    await assert.rejects(executeDeleteTeam('alice', input, deps));
    assert.equal((await db.doc('sessions/legacy-team').get()).exists, true);
    assert.equal((await db.doc('teams/crew').get()).exists, true);
    await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' });
    await assert.rejects(executeDeleteTeam('alice', input, deps), { code: 'failed-precondition' });
    await assert.rejects(inspectTeamDeletion('alice', input, db, 1000), { code: 'failed-precondition' });
    await db.doc('accountDeletions/alice').delete(); await db.doc('sessions/legacy-team').delete();
    let failOnce = true;
    const doc = path => {
      const ref = db.doc(path);
      if (path !== 'teams/crew') return ref;
      return new Proxy(ref, { get: (target, field) => field === 'delete' ? async () => {
        await target.delete(); if (failOnce) { failOnce = false; throw Error('synthetic lost parent ACK'); }
      } : typeof target[field] === 'function' ? target[field].bind(target) : target[field] });
    };
    const faultyDb = { doc, collection: db.collection.bind(db), runTransaction: db.runTransaction.bind(db), batch: db.batch.bind(db), recursiveDelete: db.recursiveDelete.bind(db) };
    const faultyDeps = { ...deps, firestore: faultyDb, attachments: { ...f.deps, firestore: faultyDb } };
    await assert.rejects(executeDeleteTeam('alice', input, faultyDeps));
    assert.equal((await db.doc('teams/crew').get()).exists, false); assert.equal((await db.doc('teamDeletions/crew').get()).data().phase, 'documents');
    assert.equal((await executeDeleteTeam('alice', input, deps)).status, 'complete');
  });

  test('team deletion serializes active worker leases and forbids reuse of a deleted team ID or creation receipt', async () => {
    const { db, keyId, wrap, fingerprint } = await invitationFixture();
    let now = 1000; let entered; let release;
    const enteredPromise = new Promise(resolve => { entered = resolve; }); const held = new Promise(resolve => { release = resolve; });
    let holdOnce = true;
    const wrappedDb = { doc: db.doc.bind(db), runTransaction: db.runTransaction.bind(db), collection: name => {
      if (name === 'attachmentUploads' && holdOnce) { holdOnce = false; entered(); return { where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => { await held; return { empty: true, size: 0, docs: [] }; } }) }) }) }; }
      return db.collection(name);
    }, batch: db.batch.bind(db), recursiveDelete: db.recursiveDelete.bind(db) };
    const deps = { firestore: wrappedDb, now: () => now, attachments: { firestore: wrappedDb, now: () => now, store: () => { throw Error('No objects expected'); } } };
    const input = { teamId: 'crew', expectedUid: 'alice' }; const deleting = executeDeleteTeam('alice', input, deps);
    await Promise.race([enteredPromise, deleting.then(() => { throw Error('Unexpected early completion'); })]);
    try {
      const pending = await executeDeleteTeam('alice', input, deps); assert.equal(pending.status, 'pending'); assert.equal(pending.retryAt, now + 600000);
      assert.equal((await inspectTeamDeletion('alice', input, db, now)).status, 'pending');
    } finally { release(); }
    assert.equal((await deleting).status, 'complete');
    await db.doc('publicProfiles/alice').set({ publicKeyPem: 'synthetic-public-alice' });
    const creationInput = { name: 'Synthetic', wrappedKey: wrap, expectedUid: 'alice', publicKeyFingerprint: fingerprint('alice'), requestId: keyId };
    const forcedIdDb = { doc: db.doc.bind(db), runTransaction: db.runTransaction.bind(db), collection: name => name === 'teams' ? { doc: () => db.doc('teams/crew') } : db.collection(name) };
    await assert.rejects(executeCreateTeam('alice', creationInput, forcedIdDb, now), { code: 'already-exists' });
    const receipt = createHash('sha256').update(JSON.stringify(['alice', keyId])).digest('hex');
    await db.doc(`teamCreationRequests/${receipt}`).set({ uid: 'alice', status: 'cancelled' });
    await assert.rejects(executeCreateTeam('alice', creationInput, db, now), { code: 'failed-precondition' });
    assert.equal((await db.doc('teams/crew').get()).exists, false);
  });

  test('pending team deletion discovery paginates private owner requests after membership and parents disappear', async () => {
    const db = admin.firestore(); await db.doc('users/alice').set({}); await db.doc('users/bob').set({});
    const pending = (uid, teamId) => ({ v: 1, ownerUid: uid, ownerDigest: teamDeletionOwnerDigest(uid, teamId), phase: 'documents', status: 'deleting',
      leaseUntil: 0, nextAttemptAt: 0, startedAt: 1000, updatedAt: 1000 });
    for (let index = 0; index < 26; index++) {
      const teamId = `team-${String(index).padStart(2, '0')}`; await db.doc(`teamDeletions/${teamId}`).set(pending('alice', teamId));
    }
    await db.doc('teamDeletions/bob-team').set(pending('bob', 'bob-team'));
    await db.doc('teamDeletions/completed').set({ v: 1, ownerDigest: teamDeletionOwnerDigest('alice', 'completed'), phase: 'complete', status: 'complete', completedAt: 1000, leaseUntil: 0 });
    const first = await listPendingTeamDeletions('alice', { expectedUid: 'alice', afterTeamId: null }, db, 2000);
    assert.equal(first.requests.length, 25); assert.equal(first.nextAfterTeamId, 'team-24');
    assert.deepEqual(Object.keys(first).sort(), ['nextAfterTeamId', 'requests', 'uid']);
    assert.deepEqual(first.requests[0], { uid: 'alice', teamId: 'team-00', status: 'pending', retryAt: 2000 });
    const second = await listPendingTeamDeletions('alice', { expectedUid: 'alice', afterTeamId: first.nextAfterTeamId }, db, 2000);
    assert.deepEqual(second.requests.map(row => row.teamId), ['team-25']); assert.equal(second.nextAfterTeamId, null);
    assert.deepEqual((await getPendingTeamDeletions.run({ expectedUid: 'bob', afterTeamId: null }, { auth: { uid: 'bob' } })).requests.map(row => row.teamId), ['bob-team']);
    const client = testEnv.authenticatedContext('alice').firestore(); await assertFails(client.collection('teamDeletions').where('ownerUid', '==', 'alice').get());
    await assert.rejects(listPendingTeamDeletions('bob', { expectedUid: 'alice', afterTeamId: null }, db), { code: 'permission-denied' });
    await db.doc('teamDeletions/team-00').update({ ownerDigest: teamDeletionOwnerDigest('bob', 'team-00') });
    await assert.rejects(listPendingTeamDeletions('alice', { expectedUid: 'alice', afterTeamId: null }, db), { code: 'permission-denied' });
    await db.doc('accountDeletions/bob').set({ v: 1, phase: 'complete', status: 'complete' });
    await assert.rejects(listPendingTeamDeletions('bob', { expectedUid: 'bob', afterTeamId: null }, db), { code: 'failed-precondition' });
  });

  test('account API keys enforce the active limit under concurrency and permanent markers deny creation, reads and late updates', async () => {
    const db = admin.firestore(); await db.doc('users/alice').set({}); await db.doc('users/bob').set({});
    const keys = [];
    for (let i = 0; i < 9; i++) keys.push(await executeCreateApiKey('alice', { name: 'Synthetic key' }, db, 1000));
    const parallel = await Promise.allSettled(Array.from({ length: 4 }, () => executeCreateApiKey('alice', { name: 'Synthetic key' }, db, 1001)));
    assert.equal(parallel.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await db.collection('apiKeys').where('uid', '==', 'alice').get()).size, 10);
    assert.equal((await db.doc('users/alice').get()).data().apiKeyRevision, 10);
    assert.equal((await executeListApiKeys('alice', db)).keys.length, 10);
    assert.equal(await verifyApiKeySecret(keys[0].secret, db) != null, true);
    await assert.rejects(executeRevokeApiKey('bob', { keyId: keys[0].id }, db), { code: 'not-found' });
    await executeRevokeApiKey('alice', { keyId: keys[0].id }, db, 1002);
    assert.equal(await verifyApiKeySecret(keys[0].secret, db), null);
    await executeCreateApiKey('alice', { name: 'Replacement' }, db, 1003);
    await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' }); // Even an unchanged existing profile cannot override the marker.
    assert.equal(await verifyApiKeySecret(keys[1].secret, db), null);
    await assert.rejects(executeCreateApiKey('alice', { name: 'Late key' }, db), { code: 'failed-precondition' });
    await assert.rejects(executeListApiKeys('alice', db), { code: 'failed-precondition' });
    await assert.rejects(executeRevokeApiKey('alice', { keyId: keys[1].id }, db), { code: 'failed-precondition' });
    await touchApiKeyLastUsed(keys[1].id, null, 2000);
    assert.equal((await db.doc(`apiKeys/${keys[1].id}`).get()).data().lastUsedAt, null);
    await db.doc(`apiKeys/${keys[1].id}`).delete(); await db.doc('users/alice').delete();
    await touchApiKeyLastUsed(keys[1].id, null, 3000);
    assert.equal((await db.doc(`apiKeys/${keys[1].id}`).get()).exists, false);
    assert.equal((await db.doc('users/alice').get()).exists, false);
    assert.equal((await executeCreateApiKey('bob', { name: 'Other account' }, db)).uid, 'bob');
  });

  test('account marker blocks delayed usage receipts, ledger events and delegation even when an old profile remains', async () => {
    const db = admin.firestore(); await db.doc('users/alice').set({});
    const generated = generateApiKey(1000); const parent = { id: generated.keyHash, uid: 'alice', name: 'Synthetic', scopes: ['memories:read'], createdAt: 1000,
      lastUsedAt: null, revoked: false, keyPrefix: generated.keyPrefix };
    await db.doc(`apiKeys/${parent.id}`).set(parent); await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' });
    await assert.rejects(issueAgentSession(parent, ['memories:read'], db, 1001));
    await assert.rejects(setAgentAccessForTest('alice', true, db), { code: 'failed-precondition' });
    await accountCreatedSessionUsage(db, 'synthetic-session', 'alice', 1001);
    await recordMemoryEvents(db, 'alice', { eventId: 'synthetic-event', memoryId: 'synthetic-session', kinds: ['write'], occurredAt: '2026-10-02T00:00:00Z' });
    const api = createFirestoreMemoryApi(db);
    await assert.rejects(api.list('alice', {}), { name: 'AccountUnavailableError' });
    await assert.rejects(api.get('alice', 'synthetic-session'), { name: 'AccountUnavailableError' });
    await assert.rejects(api.search('alice', {}), { name: 'AccountUnavailableError' });
    assert.equal((await db.doc('users/alice').get()).data().usage, undefined);
    assert.equal((await db.collection('memoryUsageReceipts').get()).empty, true);
    assert.equal((await db.collection('users/alice/memoryEvents').get()).empty, true);
    assert.equal((await db.collection('users/alice/agentEvents').get()).empty, true);
    assert.equal((await db.collection('agentSessions').get()).empty, true);
  });

  test('account monthly hygiene retains current-month usage, skips revoked profiles and cannot recreate deleted profiles', async () => {
    const db = admin.firestore(); const now = new Date('2026-10-01T03:00:00Z');
    await db.doc('users/current').set({ usage: { memoriesThisMonth: 5, periodYear: 2026, periodMonth: 10 } });
    await db.doc('users/stale').set({ usage: { memoriesThisMonth: 8, periodYear: 2026, periodMonth: 9, syntheticCounter: 3 } });
    await db.doc('users/future').set({ usage: { memoriesThisMonth: 7, periodYear: 2026, periodMonth: 11 } });
    await db.doc('users/revoked').set({ usage: { memoriesThisMonth: 9, periodYear: 2026, periodMonth: 9 } });
    await db.doc('accountDeletions/revoked').set({ v: 1, status: 'complete' });
    await db.doc('users/deleting').set({ deletionState: 'deleting', usage: { memoriesThisMonth: 10, periodYear: 2026, periodMonth: 9 } });
    const results = await Promise.all([resetAccountMonthlyUsage(db, 'stale', now), resetAccountMonthlyUsage(db, 'stale', now)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.deepEqual((await db.doc('users/stale').get()).data().usage, { memoriesThisMonth: 0, periodYear: 2026, periodMonth: 10, syntheticCounter: 3, updatedAt: now.getTime() });
    assert.equal(await resetAccountMonthlyUsage(db, 'current', now), false);
    assert.equal(await resetAccountMonthlyUsage(db, 'future', now), false);
    assert.equal(await resetAccountMonthlyUsage(db, 'revoked', now), false);
    assert.equal(await resetAccountMonthlyUsage(db, 'deleting', now), false);
    assert.equal(await resetAccountMonthlyUsage(db, 'missing', now), false);
    assert.equal((await db.doc('users/missing').get()).exists, false);
    await db.doc('users/stale').delete(); assert.equal(await resetAccountMonthlyUsage(db, 'stale', now), false);
    assert.equal((await db.doc('users/stale').get()).exists, false);
  });

  test('account monthly hygiene paginates past unchanged or revoked profiles and reports a bounded incomplete scan', async () => {
    const db = admin.firestore(); const now = new Date('2026-10-01T03:00:00Z'); const batch = db.batch();
    for (let i = 0; i < 100; i++) batch.set(db.doc(`users/a-${String(i).padStart(3, '0')}`), { usage: { memoriesThisMonth: 5, periodYear: 2026, periodMonth: 10 } });
    batch.set(db.doc('users/z-stale'), { usage: { memoriesThisMonth: 8, periodYear: 2026, periodMonth: 9 } }); await batch.commit();
    assert.deepEqual(await resetMonthlyUsagePages(db, now, 1), { reset: 0, scanned: 100, complete: false });
    assert.deepEqual(await resetMonthlyUsagePages(db, now, 2), { reset: 1, scanned: 101, complete: true });
    assert.equal((await db.doc('users/z-stale').get()).data().usage.memoriesThisMonth, 0);
    assert.deepEqual(await resetMonthlyUsagePages(db, now, 2), { reset: 0, scanned: 101, complete: true });
  });

  test('account target revocation closes third-party P2P, transmissions, friend requests and capsule import notices', async () => {
    const db = admin.firestore(); const bob = testEnv.authenticatedContext('bob').firestore(); const anonymous = testEnv.unauthenticatedContext().firestore();
    await db.doc('shares/synthetic-capsule').set(encryptedShare);
    const room = { callerId: 'bob', calleeId: 'alice', callerLabel: 'Synthetic', status: 'offer', offer: {}, createdAt: 1, updatedAt: 1 };
    const transmission = { senderId: 'bob', recipientId: 'alice', encryptedKey: 'synthetic', encryptedPayload: 'synthetic', payloadIv: 'synthetic',
      status: 'sent', hasAttachment: false, attachmentName: null, timestamp: 1 };
    const contact = { fromUid: 'bob', toUid: 'alice', status: 'pending', fromLabel: 'Synthetic', toLabel: 'Synthetic', createdAt: 1, updatedAt: 1 };
    const notice = { importerUid: 'bob', ownerUid: 'alice', shareId: 'synthetic-capsule', read: false };
    await assertFails(bob.doc('p2pRooms/synthetic').set(room));await db.doc('p2pRooms/synthetic').set(room);
    await assertFails(bob.doc('p2pRooms/synthetic/callerCandidates/first').set({ uid: 'bob', candidate: {} }));await db.doc('p2pRooms/synthetic/callerCandidates/first').set({uid:'bob',candidate:{}});
    await assertFails(bob.doc('transmissions/synthetic').set(transmission));await db.doc('transmissions/synthetic').set(transmission);
    await assertFails(bob.doc('friendRequests/synthetic').set(contact));
    await db.doc('friendRequests/synthetic').set(contact);
    await assertFails(bob.doc('capsuleImportNotices/synthetic').set(notice)); await db.doc('capsuleImportNotices/synthetic').set(notice);
    await assertFails(bob.doc('capsuleImportNotices/forged').set({ ...notice, ownerUid: 'charlie' }));
    await assertFails(anonymous.doc('shares/synthetic-capsule').get());
    await assertFails(anonymous.doc('shares/synthetic-capsule').update({ views: 1 }));
    await assertFails(bob.doc('p2pRooms/synthetic').get()); await assertSucceeds(bob.doc('transmissions/synthetic').get()); await assertSucceeds(bob.doc('friendRequests/synthetic').get());
    await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' });
    const refuse = async () => {
      await assertFails(bob.doc('p2pRooms/late').set(room));
      await assertFails(bob.doc('transmissions/late').set(transmission));
      await assertFails(bob.doc('friendRequests/late').set(contact));
      await assertFails(bob.doc('capsuleImportNotices/late').set(notice));
      await assertFails(bob.doc('p2pRooms/synthetic/callerCandidates/late').set({ uid: 'bob', candidate: {} }));
    };
    await refuse(); await assertFails(bob.doc('p2pRooms/synthetic').get()); await assertFails(bob.doc('transmissions/synthetic').get()); await assertFails(bob.doc('friendRequests/synthetic').get());
    await assertFails(bob.doc('p2pRooms/synthetic').update({ status: 'answer', answer: {}, updatedAt: 2 }));
    await assertFails(anonymous.doc('shares/synthetic-capsule').get()); await assertFails(anonymous.doc('shares/synthetic-capsule').update({ views: 2 }));
    await db.doc('p2pRooms/synthetic').delete(); await db.doc('shares/synthetic-capsule').delete(); await db.doc('accountDeletions/alice').update({ status: 'complete' });
    await refuse();
    await assertFails(bob.doc('p2pRooms/other').set({ ...room, calleeId: 'charlie' }));
    await assertFails(bob.doc('transmissions/other').set({ ...transmission, recipientId: 'charlie' }));
    await assertFails(bob.doc('friendRequests/other').set({ ...contact, toUid: 'charlie' }));
  });

  test('capsule notices deny every SDK mutation and expose only owned reads including the bounded unread query', async () => {
    const db=admin.firestore(),data={ownerUid:'alice',shareId:'share',importerUid:'bob',itemCount:2,createdAt:1,read:false,titleHint:null};
    await db.doc('users/alice').set({uid:'alice'});await db.doc('users/bob').set({uid:'bob'});await db.doc('capsuleImportNotices/notice').set(data);
    const alice=testEnv.authenticatedContext('alice').firestore(),bob=testEnv.authenticatedContext('bob').firestore(),anon=testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(alice.doc('capsuleImportNotices/notice').get());
    await assertSucceeds(alice.collection('capsuleImportNotices').where('ownerUid','==','alice').where('read','==',false).limit(40).get());
    await assertFails(alice.collection('capsuleImportNotices').where('ownerUid','==','alice').get());
    await assertFails(alice.collection('capsuleImportNotices').where('ownerUid','==','alice').limit(41).get());
    await assertFails(bob.collection('capsuleImportNotices').where('ownerUid','==','alice').limit(40).get());
    for(const client of[bob,anon])await assertFails(client.doc('capsuleImportNotices/notice').get());
    for(const client of[alice,bob,anon]){
      await assertFails(client.doc('capsuleImportNotices/new').set(data));await assertFails(client.doc('capsuleImportNotices/notice').set(data));
      await assertFails(client.doc('capsuleImportNotices/notice').update({read:false}));await assertFails(client.doc('capsuleImportNotices/notice').update({read:true}));
      await assertFails(client.doc('capsuleImportNotices/notice').delete());
    }
    assert.deepEqual((await db.doc('capsuleImportNotices/notice').get()).data(),data);
  });

  test('capsule notice concurrent server acknowledgements commit once and a lost response retry never rewrites the event', async () => {
    const db=admin.firestore(),ref=db.doc('capsuleImportNotices/notice'),data={ownerUid:'alice',shareId:'share',importerUid:'bob',itemCount:2,createdAt:1,read:false,titleHint:null};
    await db.doc('users/alice').set({uid:'alice'});await ref.set(data);let now=2;
    const deps={firestore:db,auth:{getUser:async uid=>({uid,disabled:false})},admit:async()=>true,now:()=>now};
    const input={v:1,actorUid:'alice',noticeId:'notice',sourceDigest:capsuleNoticeSourceDigest('notice',data)};
    const results=await Promise.all([executeCapsuleNoticeAcknowledgement('alice',input,deps),executeCapsuleNoticeAcknowledgement('alice',input,deps)]);
    assert.equal(results.filter(result=>result.changed).length,1);const committed=await ref.get();assert.deepEqual(committed.data(),{...data,read:true,readAt:2});
    now=90;assert.equal((await executeCapsuleNoticeAcknowledgement('alice',input,deps)).changed,false);assert.ok((await ref.get()).updateTime.isEqual(committed.updateTime));
    await ref.delete();await assert.rejects(executeCapsuleNoticeAcknowledgement('alice',input,deps),{code:'not-found'});assert.equal((await ref.get()).exists,false);
  });

  test('capsule acknowledgement refuses stale event, foreign owner, closed admission and revoked owner without read mutation', async () => {
    const db=admin.firestore(),ref=db.doc('capsuleImportNotices/notice'),data={ownerUid:'alice',shareId:'share',importerUid:'bob',itemCount:2,createdAt:1,read:false,titleHint:null};
    await db.doc('users/alice').set({uid:'alice'});await ref.set(data);
    const deps={firestore:db,auth:{getUser:async uid=>({uid,disabled:false})},admit:async()=>true,now:()=>2};
    const input={v:1,actorUid:'alice',noticeId:'notice',sourceDigest:capsuleNoticeSourceDigest('notice',data)};
    await ref.update({itemCount:3});await assert.rejects(executeCapsuleNoticeAcknowledgement('alice',input,deps),{code:'failed-precondition'});
    await ref.set({...data,ownerUid:'bob'});await assert.rejects(executeCapsuleNoticeAcknowledgement('alice',input,deps),{code:'not-found'});
    await ref.set(data);await assert.rejects(executeCapsuleNoticeAcknowledgement('alice',input,{...deps,admit:async()=>false}),{code:'resource-exhausted'});
    await db.doc('accountDeletions/alice').set({status:'complete'});await assert.rejects(executeCapsuleNoticeAcknowledgement('alice',input,deps),{code:'permission-denied'});
    assert.deepEqual((await ref.get()).data(),data);
  });

  test('capsule notice server maximum accepts 300 and refuses 301 without changing delivery state', async () => {
    const db=admin.firestore(),ref=db.doc('capsuleImportNotices/notice'),data={ownerUid:'alice',shareId:'share',importerUid:'bob',itemCount:300,createdAt:1,read:false,titleHint:null};
    await db.doc('users/alice').set({uid:'alice'});await ref.set(data);
    const deps={firestore:db,auth:{getUser:async uid=>({uid,disabled:false})},admit:async()=>true,now:()=>2};
    const input={v:1,actorUid:'alice',noticeId:'notice',sourceDigest:capsuleNoticeSourceDigest('notice',data)};
    assert.equal((await executeCapsuleNoticeAcknowledgement('alice',input,deps)).changed,true);assert.equal((await ref.get()).data().itemCount,300);
    await ref.set({...data,itemCount:301});await assert.rejects(executeCapsuleNoticeAcknowledgement('alice',input,deps),{code:'failed-precondition'});
    assert.deepEqual((await ref.get()).data(),{...data,itemCount:301});
  });

  async function capsulePublicationFixture(){
    const db=admin.firestore(),state={now:Date.now(),enabled:true},enc={v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)};
    await db.doc('users/alice').set({uid:'alice'});await db.doc('users/bob').set({uid:'bob'});
    for(const id of['pub-a','pub-b'])await db.doc('sessions/'+id).set({uid:'alice',teamId:null,text:'',title:null,enc,timestamp:100,updatedAt:100});
    const deps={firestore:db,now:()=>state.now,enabled:()=>state.enabled,auth:{getUser:async uid=>({uid,disabled:false})}};
    const request=(index=1)=>({v:1,actorUid:'alice',publicationId:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
      sources:[{sessionId:'pub-a',teamId:null,revision:100},{sessionId:'pub-b',teamId:null,revision:100}],
      ciphertext:{v:1,alg:'AES-GCM-PBKDF2',salt:'A'.repeat(22)+'==',iv:'A'.repeat(16),data:'A'.repeat(43)+'='},expiresAt:state.now+86400000});
    return{db,state,deps,request,call:(input,mode='publish')=>executeCapsulePublication('alice',input,mode,deps)};
  }
  test('capsule publication concurrent retries commit one share and quota; all SDK principals are refused for shares and receipts',async()=>{
    const f=await capsulePublicationFixture(),input=f.request(),outcomes=await Promise.all([f.call(input),f.call(input)]);assert(outcomes.every(row=>row.status==='committed'));
    const share=f.db.doc('shares/'+input.publicationId),before=await share.get(),receipt=await f.db.doc('capsulePublications/'+input.publicationId).get();
    f.state.enabled=false;assert.equal((await f.call(input)).status,'committed');assert.ok((await share.get()).updateTime.isEqual(before.updateTime));
    const budget=(await f.db.collection('capsulePublicationBudgets').get()).docs[0];assert.equal(budget.data().operations,1);assert.equal(budget.data().publications,1);
    const wire={...before.data(),retireAt:require('firebase/firestore').Timestamp.fromMillis(before.get('retireAt').toMillis())};
    for(const client of[testEnv.authenticatedContext('alice').firestore(),testEnv.authenticatedContext('bob').firestore(),testEnv.unauthenticatedContext().firestore()]){
      for(const path of[share.path,receipt.ref.path,budget.ref.path]){await assertFails(client.doc(path).get());await assertFails(client.doc(path).set(wire));await assertFails(client.doc(path).delete());}
      await assertFails(client.collection('shares').where('uid','==','alice').limit(40).get());await assertFails(client.doc('shares/forged').set({...wire,uid:'alice'}));
    }
    const owner=await executeGetOwnedCapsules('alice',{v:1,actorUid:'alice',shareId:input.publicationId,after:null},f.deps);assert.equal(owner.rows.length,1);assert(!('ciphertext'in owner.rows[0]));
  });
  test('capsule publication cancellation races leave either one confirmed copy or a terminal cancellation, never both',async()=>{
    const f=await capsulePublicationFixture(),input=f.request();const outcomes=await Promise.all([f.call(input),f.call(input,'cancel')]);
    const receipt=(await f.db.doc('capsulePublications/'+input.publicationId).get()).data(),share=await f.db.doc('shares/'+input.publicationId).get();
    assert(outcomes.every(row=>row.status===receipt.status));assert.equal(share.exists,receipt.status==='committed');
    const budget=(await f.db.collection('capsulePublicationBudgets').get()).docs[0].data();assert.equal(budget.operations,1);assert.equal(budget.publications,share.exists?1:0);
    await f.db.doc('shares/'+input.publicationId).delete();await f.db.doc('capsulePublications/'+input.publicationId).delete();f.state.now=input.expiresAt+86400000;
    assert.equal((await f.call(input)).status,'expired');assert.equal((await f.db.doc('shares/'+input.publicationId).get()).exists,false);
  });
  test('capsule publication quota serializes the final creation slot across distinct IDs and stale secondary sources write nothing',async()=>{
    const f=await capsulePublicationFixture(),day=Math.floor(f.state.now/86400000),budget=f.db.doc(`capsulePublicationBudgets/alice_${day}`);
    await budget.set({v:1,uid:'alice',day,operations:19,publications:CAPSULE_PUBLICATION_LIMITS.publications-1,cipherBytes:4096});
    const outcomes=await Promise.allSettled([f.call(f.request(1)),f.call(f.request(2))]);assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal((await budget.get()).data().publications,20);
    await budget.delete();await f.db.doc('sessions/pub-b').update({updatedAt:101});await assert.rejects(f.call(f.request(3)),{code:'permission-denied'});
    assert.equal((await f.db.doc('shares/'+f.request(3).publicationId).get()).exists,false);assert.equal((await budget.get()).exists,false);
  });
  test('owner metadata projects complete pages and creation-bound withdrawal refuses a replacement without requiring a vault key',async()=>{
    const f=await capsulePublicationFixture();for(let index=0;index<45;index++)await f.db.doc(`shares/a${String(index).padStart(3,'0')}`).set({uid:'alice',text:'SYNTHETIC_PRIVATE_LEGACY',titleHint:'SYNTHETIC_PRIVATE_TITLE',views:0,createdAt:1});
    await f.db.doc('shares/foreign').set({uid:'bob'});const query={v:1,actorUid:'alice',shareId:null,after:null};
    const first=await executeGetOwnedCapsules('alice',query,f.deps),second=await executeGetOwnedCapsules('alice',{...query,after:first.nextAfter},f.deps);
    assert.equal(first.rows.length,40);assert.equal(second.rows.length,5);assert.equal(second.nextAfter,null);assert(!JSON.stringify([first,second]).includes('SYNTHETIC_PRIVATE'));
    const target=first.rows[0],ref=f.db.doc('shares/'+target.shareId),data=(await ref.get()).data();await ref.delete();await ref.set(data);
    const command={v:2,actorUid:'alice',shareId:target.shareId,sourceToken:target.sourceToken};const deps={...f.deps,admitRevoke:async()=>true};
    await assert.rejects(executeRevokePublicCapsule('alice',command,deps),{code:'failed-precondition'});assert.equal((await ref.get()).data().revokedAt,undefined);
    const fresh=(await executeGetOwnedCapsules('alice',{...query,shareId:target.shareId},f.deps)).rows[0];await executeRevokePublicCapsule('alice',{...command,sourceToken:fresh.sourceToken},deps);assert((await ref.get()).data().revokedAt);
    const readBudget=(await f.db.collection('capsuleOwnerReadBudgets').get()).docs[0];for(const client of[testEnv.authenticatedContext('alice').firestore(),testEnv.unauthenticatedContext().firestore()])await assertFails(client.doc(readBudget.ref.path).get());
  });
  test('deleting a secondary memory removes the whole publication and its receipt children before dropping the source anchor',async()=>{
    const f=await capsulePublicationFixture(),input=f.request();await f.call(input);const share=f.db.doc('shares/'+input.publicationId);await share.collection('capsuleOpenings').doc('receipt').set({v:1});
    await purgeSessions(f.db,()=>f.db.collection('sessions').where(admin.firestore.FieldPath.documentId(),'==','pub-b'));
    assert.equal((await f.db.doc('sessions/pub-b').get()).exists,false);assert.equal((await f.db.doc('sessions/pub-a').get()).exists,true);assert.equal((await share.get()).exists,false);assert.equal((await share.collection('capsuleOpenings').get()).size,0);
    assert.equal((await f.call(input)).status,'withdrawn');assert.equal((await share.get()).exists,false);
  });
  async function publicCapsuleFixture() {
    const db=admin.firestore(),state={now:Date.now(),enabled:true,disabled:false};
    await db.doc('users/alice').set({uid:'alice'});await db.doc('shares/public-capsule').set({uid:'alice',sessionId:'private-memory',encrypted:true,
      ciphertext:{v:1,alg:'AES-GCM-PBKDF2',salt:'A'.repeat(22)+'==',iv:'A'.repeat(16),data:'A'.repeat(43)+'='},views:0,importCount:0,createdAt:1,expiresAt:null,
      titleHint:'SYNTHETIC_PRIVATE_TITLE',text:'SYNTHETIC_PRIVATE_LEGACY_FIELD'});
    const deps={firestore:db,now:()=>state.now,enabled:()=>state.enabled,admit:()=>consumePublicCapsuleBudget(db,'synthetic-network',state.now),admitRevoke:async()=>true,
      auth:{getUser:async uid=>({uid,disabled:state.disabled})}};
    const read=()=>executeGetPublicCapsule({v:1,shareId:'public-capsule'},deps);
    const command=source=>({v:1,shareId:'public-capsule',openingId:'n'.repeat(32),sourceDigest:source.sourceDigest,viewDeadline:source.viewDeadline});
    return{db,state,deps,read,command};
  }
  test('public capsule raw documents and receipt trees deny anonymous/foreign reads and all SDK counter/revocation writes',async()=>{
    const f=await publicCapsuleFixture(),alice=testEnv.authenticatedContext('alice').firestore(),bob=testEnv.authenticatedContext('bob').firestore(),anon=testEnv.unauthenticatedContext().firestore();
    await assertFails(alice.doc('shares/public-capsule').get());
    await assertFails(alice.collection('shares').where('uid','==','alice').limit(40).get());
    await assertFails(alice.collection('shares').where('uid','==','alice').get());await assertFails(alice.collection('shares').where('uid','==','alice').limit(41).get());
    for(const client of[bob,anon])await assertFails(client.doc('shares/public-capsule').get());
    for(const client of[alice,bob,anon]){
      for(const patch of[{views:0},{views:1},{importCount:1,lastImportedAt:1},{revokedAt:1}])await assertFails(client.doc('shares/public-capsule').update(patch));
      await assertFails(client.doc('shares/public-capsule').delete());
      await assertFails(client.doc('shares/public-capsule/capsuleOpenings/forged').set({v:1}));
    }
    const source=await f.read();assert(!JSON.stringify(source).includes('SYNTHETIC_PRIVATE'));assert(!('uid'in source));assert(!('sessionId'in source));
    const opening=f.command(source);await executeRecordCapsuleOpening(opening,f.deps);
    const receipt=(await f.db.collection('shares/public-capsule/capsuleOpenings').get()).docs[0];
    for(const client of[alice,bob,anon]){await assertFails(client.doc(receipt.ref.path).get());await assertFails(client.doc(receipt.ref.path).delete());await assertFails(client.collection('publicCapsuleBudgets').limit(1).get());}
  });
  test('public capsule concurrent opening retries increment once and retain exact source after a lost response',async()=>{
    const f=await publicCapsuleFixture(),command=f.command(await f.read());
    const outcomes=await Promise.all([executeRecordCapsuleOpening(command,f.deps),executeRecordCapsuleOpening(command,f.deps)]);
    assert.equal(outcomes.filter(row=>row.changed).length,1);const share=f.db.doc('shares/public-capsule'),before=await share.get();assert.equal(before.data().views,1);
    const receipt=(await f.db.collection('shares/public-capsule/capsuleOpenings').get()).docs[0];f.state.now+=100;
    assert.equal((await executeRecordCapsuleOpening(command,f.deps)).changed,false);assert.ok((await share.get()).updateTime.isEqual(before.updateTime));assert.equal((await f.db.collection('shares/public-capsule/capsuleOpenings').get()).size,1);
    assert.ok((await receipt.ref.get()).updateTime.isEqual(receipt.updateTime));
  });
  test('public capsule replacement and expired replay after receipt removal never recreate a count',async()=>{
    const f=await publicCapsuleFixture(),command=f.command(await f.read()),share=f.db.doc('shares/public-capsule');await executeRecordCapsuleOpening(command,f.deps);
    const data=(await share.get()).data();await share.delete();await share.set({...data,views:0});
    await assert.rejects(executeRecordCapsuleOpening(command,f.deps),{code:'failed-precondition'});assert.equal((await share.get()).data().views,0);
    const next=f.command(await f.read());next.openingId='x'.repeat(32);await executeRecordCapsuleOpening(next,f.deps);
    await f.db.recursiveDelete(share.collection('capsuleOpenings'));f.state.now=next.viewDeadline+86400000;
    await assert.rejects(executeRecordCapsuleOpening(next,f.deps),{code:'failed-precondition'});assert.equal((await share.get()).data().views,1);assert.equal((await share.collection('capsuleOpenings').get()).size,0);
  });
  test('public capsule withdrawal stays available with public access closed and survives retries without removing ciphertext',async()=>{
    const f=await publicCapsuleFixture(),command=f.command(await f.read()),share=f.db.doc('shares/public-capsule'),input={v:2,actorUid:'alice',shareId:'public-capsule',sourceToken:capsuleOwnerSourceToken('public-capsule',await share.get())};f.state.enabled=false;
    assert.equal((await executeRevokePublicCapsule('alice',input,f.deps)).changed,true);const before=await share.get();
    assert.equal((await executeRevokePublicCapsule('alice',input,f.deps)).changed,false);assert.ok((await share.get()).updateTime.isEqual(before.updateTime));assert(before.data().ciphertext);
    f.state.enabled=true;await assert.rejects(f.read(),{code:'not-found'});await assert.rejects(executeRecordCapsuleOpening(command,f.deps),{code:'not-found'});
  });
  test('public capsule global budget serializes its final slot across different network groups',async()=>{
    const f=await publicCapsuleFixture(),day=Math.floor(f.state.now/86400000),ref=f.db.doc(`publicCapsuleBudgets/${day}-global`);
    await ref.set({v:1,day,scope:'global',requests:PUBLIC_CAPSULE_DAILY_REQUESTS-1});
    const admitted=await Promise.all([consumePublicCapsuleBudget(f.db,'network-a',f.state.now),consumePublicCapsuleBudget(f.db,'network-b',f.state.now)]);
    assert.equal(admitted.filter(Boolean).length,1);assert.equal((await ref.get()).data().requests,PUBLIC_CAPSULE_DAILY_REQUESTS);
  });
  test('personal memory deletion recursively removes capsule receipt children before dropping its share anchor',async()=>{
    const f=await publicCapsuleFixture();await f.db.doc('sessions/private-memory').set({uid:'alice',teamId:null});
    await executeRecordCapsuleOpening(f.command(await f.read()),f.deps);
    await purgeSessions(f.db,()=>f.db.collection('sessions').where('uid','==','alice'));
    assert.equal((await f.db.doc('shares/public-capsule').get()).exists,false);assert.equal((await f.db.collection('shares/public-capsule/capsuleOpenings').get()).size,0);
  });
  test('retired account share callbacks never bypass revocation or recreate a removed capsule', async () => {
    const db = admin.firestore(); await db.doc('shares/synthetic-capsule').set(encryptedShare);
    await assert.rejects(recordLiveShareStatistic('bob', { shareId: 'synthetic-capsule' }, 'view', db), { code: 'failed-precondition' });
    await assert.rejects(recordLiveShareStatistic('bob', { shareId: 'synthetic-capsule' }, 'conversion', db), { code: 'failed-precondition' });
    assert.equal((await db.doc('shares/synthetic-capsule').get()).data().views, 0);
    assert.equal((await db.doc('shares/synthetic-capsule').get()).data().conversions, undefined);
    await db.doc('accountDeletions/bob').set({ v: 1, status: 'complete' });
    await assert.rejects(recordLiveShareStatistic('bob', { shareId: 'synthetic-capsule' }, 'view', db), { code: 'failed-precondition' });
    await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' });
    await assert.rejects(recordLiveShareStatistic('charlie', { shareId: 'synthetic-capsule' }, 'conversion', db), { code: 'failed-precondition' });
    assert.equal((await db.doc('shares/synthetic-capsule').get()).data().conversions, undefined);
    await db.doc('shares/synthetic-capsule').delete();
    await assert.rejects(recordLiveShareStatistic('charlie', { shareId: 'synthetic-capsule' }, 'view', db), { code: 'failed-precondition' });
    assert.equal((await db.doc('shares/synthetic-capsule').get()).exists, false);
  });

  test('legacy-reconciliation scans pages and orphan/unknown history with projections and leaves all data unchanged', async () => {
    const db = admin.firestore(); const bucket = 'synthetic-legacy-bucket'; const objectPath = 'attachments/alice/synthetic-file';
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=synthetic-token`;
    const collector = createLegacyAttachmentReconciler(bucket, [{ name: objectPath, size: '10', generation: '100', metadata: { firebaseStorageDownloadTokens: 'synthetic-token' } },
      { name: 'attachments/alice/unobserved', size: '20', generation: '101' }]);
    const original = { uid: 'alice', teamId: null, text: 'synthetic-private-text', title: 'synthetic-private-title', enc: { ct: 'synthetic-private-cipher' }, attachments: [{ url }] };
    for (let index = 0; index < 26; index++) {
      await db.doc(`sessions/note-${String(index).padStart(2, '0')}`).set(original);
      await db.doc(`sessions/note-${String(index).padStart(2, '0')}/versions/old`).set(original);
    }
    await db.doc('sessions/orphan/versions/old').set(original); await db.doc('foreign/place/versions/old').set(original);
    await db.doc('users/alice/memories/old').set({ ...original, uid: 'bob' });
    const projected = { ...collector, observe: context => {
      for (const field of ['text', 'title', 'enc']) { assert.equal(field in context.data, false); if (context.parent) assert.equal(field in context.parent, false); }
      if (context.parent) assert.equal('attachments' in context.parent, false);
      collector.observe(context);
    } };
    for (const source of ['sessions', 'versions', 'memories']) {
      let cursor = null;
      for (let page = 0; page < 5; page++) {
        const result = await reconcileLegacyAttachmentReferencesPage({ source, afterPath: cursor, limit: 25 }, db, projected);
        if (result.exhausted) break; assert.ok(result.nextAfterPath); cursor = result.nextAfterPath;
        if (page === 4) throw Error('synthetic pagination did not finish');
      }
    }
    const result = collector.summary(); assert.equal(result.sources.sessions.scanned, 26); assert.equal(result.sources.versions.scanned, 28);
    assert.equal(result.sources.versions.reasons.orphanVersion, 1); assert.equal(result.sources.versions.reasons.unknownNamespace, 1);
    assert.equal(result.sources.memories.reasons.legacyOwnerMismatch, 1); assert.equal(result.objects.referenced, 1);
    assert.equal(result.objects.notObservedInKnownReferences, 1); assert.equal(result.mappingCoverageComplete, false); assert.equal(result.deletionAuthorized, false);
    assert.equal(result.sources.sessions.references.tokenMatchesMetadata, 26);
    assert.deepEqual((await db.doc('sessions/note-00').get()).data(), original);
    assert.deepEqual((await db.doc('sessions/note-00/versions/old').get()).data(), original);
    for (const privateValue of ['synthetic-token', 'synthetic-private-text', 'synthetic-private-title', 'synthetic-private-cipher', objectPath, url]) assert.equal(JSON.stringify(result).includes(privateValue), false);
  });

  test('account deletion removes membership and freezes team writers before enumerating authored session children', async () => {
    const f = await purgeFixture(); const keyId = '88888888-8888-4888-8888-888888888888';
    const wrap = { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 1).toString('base64') };
    await f.db.doc('users/bob').set({}); await f.db.doc('config/teamSecurity').set({ writesEnabled: true });
    await f.db.doc('teams/crew').set({ ownerUid: 'bob', name: 'Synthetic team', memberUids: ['alice', 'bob'], wrappedKeys: { alice: wrap, bob: wrap },
      keyRotationStatus: 'active', pendingRotationId: null, activeKeyEpoch: 1, activeKeyId: keyId });
    await f.db.doc('teams/crew/keyEpochs/1').set({ epoch: 1, keyId, status: 'active', memberUids: ['alice', 'bob'], wrappedKeys: { alice: wrap, bob: wrap } });
    await f.db.doc('sessions/authored-team').set({ uid: 'alice', teamId: 'crew', keyEpoch: 1, keyId, enc: { v: 2, iv: 'A'.repeat(16), ct: 'B'.repeat(24) }, text: '', title: null, timestamp: 1, updatedAt: 1 });
    await f.db.doc('sessions/authored-team/versions/old').set({ synthetic: true });
    const bob = testEnv.authenticatedContext('bob').firestore();
    const edit = (revision, versionId) => {
      const batch = bob.batch(); batch.update(bob.doc('sessions/authored-team'), { updatedAt: revision, lastVersionId: versionId });
      batch.set(bob.doc(`sessions/authored-team/versions/${versionId}`), { teamId: 'crew', keyEpoch: 1, keyId, text: '', title: null,
        enc: { v: 2, iv: 'A'.repeat(16), ct: 'B'.repeat(24) }, editorUid: 'bob', previousUpdatedAt: revision - 1, createdAt: revision });
      return batch.commit();
    };
    await assertFails(edit(2, 'baseline'));
    const revisionDeps={firestore:f.db,now:f.deps.now},enc={v:2,iv:'A'.repeat(16),ct:'B'.repeat(24)};
    const baselineRequest={operationId:require('node:crypto').randomUUID(),baseline:await prepareTeamRevision('bob',{teamId:'crew',sessionId:'authored-team'},revisionDeps),priorEnc:enc,enc,metadata:{embedding:null,embeddingModel:null,semanticClusterId:null,position:null,importance:.5,processingMethod:'manual:revision'}};
    assert.equal((await executeTeamRevision('bob',baselineRequest,'apply',revisionDeps)).status,'committed');
    const lateRequest={...baselineRequest,operationId:require('node:crypto').randomUUID(),baseline:await prepareTeamRevision('bob',{teamId:'crew',sessionId:'authored-team'},revisionDeps)};
    let enter; let release; const entered = new Promise(resolve => { enter = resolve; }); const held = new Promise(resolve => { release = resolve; });
    const deps = { firestore: f.db, now: f.deps.now, attachments: f.deps, cancelBilling: async () => {}, purgeLegacyObjects: async () => true, deleteAuth: async () => {},
      purgeMemberships: async uid => {
        await purgeUserTeamMemberships(uid, f.db);
        assert.equal((await f.db.doc('sessions/authored-team').get()).exists, true);
        enter(); await held; return 1;
      } };
    const deleting = executeAccountDeletion('alice', { uid: 'alice' }, deps);
    // Race-safe observation: an unexpected early rejection also releases the test's wait.
    await Promise.race([entered, deleting.then(() => { throw Error('unexpected early completion'); })]);
    try {
      const team = (await f.db.doc('teams/crew').get()).data(); assert.deepEqual(team.memberUids, ['bob']); assert.equal(team.keyRotationStatus, 'rotation_pending');
      await assertFails(edit(3, 'late'));
      await assert.rejects(executeTeamRevision('bob',lateRequest,'apply',revisionDeps));
      await assertFails(bob.doc('sessions/authored-team/versions/late').set({ teamId: 'crew', text: '', enc: { v: 2, iv: 'A'.repeat(16), ct: 'B'.repeat(24) }, editorUid: 'bob', createdAt: 2 }));
    } finally { release(); }
    assert.equal((await deleting).status, 'complete');
    assert.equal((await f.db.doc('sessions/authored-team').get()).exists, false); assert.equal((await f.db.doc('sessions/authored-team/versions/old').get()).exists, false);
    assert.equal((await f.db.doc('users/bob').get()).exists, true); assert.equal((await f.db.doc('teams/crew').get()).exists, true);
  });

  test('account deletion marker denies an existing token before and after profile removal without blocking other accounts', async () => {
    const db = admin.firestore(); await db.doc('users/alice').set({}); await db.doc('users/bob').set({});
    const alice = testEnv.authenticatedContext('alice').firestore(); const bob = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(alice.doc('users/alice').get());
    await assert.rejects(deleteUserAccount.run({ uid: 'alice' }, { auth: { uid: 'alice' } }), { code: 'failed-precondition' });
    assert.equal((await db.doc('accountDeletions/alice').get()).exists, false);
    await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' });
    await assertFails(alice.doc('users/alice').get()); await assertFails(alice.doc('accountDeletions/alice').get());
    await db.doc('users/alice').delete(); await assertFails(alice.doc('users/alice').set({ displayName: 'synthetic' }));
    await assertSucceeds(bob.doc('users/bob').get());
  });

  test('account deletion is resumable, prevents false storage success, deletes children and new receipts, and removes Auth only after data gates', async () => {
    const f = await purgeFixture(); const file = await f.create('77777777-7777-4777-8777-777777777777'); let legacyFails = true; let authFails = true; let authCalls = 0;
    await f.db.doc('users/bob').set({ displayName: 'synthetic other account' });
    await f.db.doc('sessions/owned').set({ uid: 'alice', teamId: null, timestamp: 1, updatedAt: 1, attachments: [attachmentDescriptor(file)] });
    await f.db.doc('sessions/owned/versions/old').set({ attachments: [attachmentDescriptor(file)] });
    await f.db.doc('users/alice/otherNested/synthetic').set({ encrypted: 'synthetic' });
    await f.db.doc('p2pRooms/synthetic').set({ callerId: 'alice', calleeId: 'bob' }); await f.db.doc('p2pRooms/synthetic/callerCandidates/nested').set({ candidate: 'synthetic' });
    await f.db.doc('commsContactRemovals/actor').set({actorUid:'alice',peerUid:'bob'});await f.db.doc('commsContactRemovals/peer').set({actorUid:'bob',peerUid:'alice'});await f.db.doc('commsContactRemovals/other').set({actorUid:'bob',peerUid:'carol'});
    await f.db.doc('commsContactPairs/outgoing').set({fromUid:'alice',toUid:'bob'});await f.db.doc('commsContactPairs/incoming').set({fromUid:'bob',toUid:'alice'});await f.db.doc('commsContactPairs/other').set({fromUid:'bob',toUid:'carol'});
    await f.db.doc('commsP2PContentReceipts/outgoing').set({senderUid:'alice',recipientUid:'bob'});await f.db.doc('commsP2PContentReceipts/incoming').set({senderUid:'bob',recipientUid:'alice'});await f.db.doc('commsP2PContentReceipts/other').set({senderUid:'bob',recipientUid:'carol'});await f.db.doc('commsP2PRequests/outgoing').set({callerUid:'alice',calleeUid:'bob'});await f.db.doc('commsP2PRequests/incoming').set({callerUid:'bob',calleeUid:'alice'});await f.db.doc('commsP2PRequests/other').set({callerUid:'bob',calleeUid:'carol'});await f.db.doc('commsP2PBudgets/project-retained').set({uid:null,kind:'project'});await f.db.doc('commsDeliveryRequests/outgoing').set({senderId:'alice',recipientId:'bob'});await f.db.doc('commsDeliveryRequests/incoming').set({senderId:'bob',recipientId:'alice'});await f.db.doc('commsDeliveryRequests/other').set({senderId:'bob',recipientId:'carol'});await f.db.doc('commsDeliveryBudgets/project-retained').set({uid:null,kind:'project'});
    for(const [id,field]of [['caller','callerUid'],['callee','calleeUid'],['owner','ownerUid']])await f.db.doc('commsP2PLegacyReceipts/'+id).set({[field]:'alice'});await f.db.doc('commsP2PLegacyReceipts/other').set({callerUid:'bob',calleeUid:'carol'});
    for (const collection of ['memoryCreationReceipts', 'memoryUsageReceipts', 'personalConnectionChanges', 'commsIdentityRollovers', 'commsIdentityBudgets', 'commsContactBudgets', 'commsDeliveryBudgets', 'commsP2PBudgets', 'personalRevisions', 'personalRevisionBudgets', 'attachmentMutations', 'aiBudgets', 'aiPersonalBudgets', 'aiBudgetWindows', 'agentGrants', 'agentMutationReceipts', 'agentMutationProposals', 'agentMutationBudgets', 'agentMutationReversals', 'agentReversalCancelBudgets', 'mobileSyncPublications', 'mobileSyncPublicationCancellations', 'mobileSyncBudgets', 'obsidianImportBudgets', 'documentImportBudgets']) {
      await f.db.doc(`${collection}/owned`).set({ uid: 'alice' }); await f.db.doc(`${collection}/other`).set({ uid: 'bob' });
    }
    for (const uid of ['alice','bob']) {
      await f.db.doc(`mobileSyncImports/${uid}-owned`).set({uid});
      await f.db.doc(`mobileSyncImports/${uid}-owned/batches/0`).set({uid});
      await f.db.doc(`obsidianImports/${uid}-owned`).set({uid});
      await f.db.doc(`obsidianImports/${uid}-owned/batches/0`).set({uid});
      await f.db.doc(`documentImports/${uid}-owned`).set({uid});
      await f.db.doc(`documentImports/${uid}-owned/batches/0`).set({uid});
    }
    const deps = { firestore: f.db, now: f.deps.now, attachments: f.deps, cancelBilling: async () => {}, purgeMemberships: async () => 0,
      purgeLegacyObjects: async () => { if (legacyFails) throw Error('synthetic storage outage'); return true; },
      deleteAuth: async () => { authCalls++; assert.equal((await f.db.doc('sessions/owned').get()).exists, false);
        assert.equal((await f.db.doc('users/alice').get()).data().deletionState, 'deleting'); if (authFails) throw Error('synthetic Auth outage'); } };
    const first = await executeAccountDeletion('alice', { uid: 'alice' }, deps); assert.equal(first.status, 'pending'); assert.equal(authCalls, 0);
    f.setNow(first.retryAt); await assert.rejects(executeAccountDeletion('alice', { uid: 'alice' }, deps));
    assert.equal((await f.db.doc('sessions/owned').get()).exists, true); assert.equal(authCalls, 0);
    legacyFails = false; await assert.rejects(executeAccountDeletion('alice', { uid: 'alice' }, deps)); assert.equal(authCalls, 1);
    assert.equal((await f.db.doc('accountDeletions/alice').get()).data().phase, 'auth');
    authFails = false; assert.equal((await executeAccountDeletion('alice', { uid: 'alice' }, deps)).status, 'complete');
    assert.equal(authCalls, 2); assert.equal((await executeAccountDeletion('alice', { uid: 'alice' }, deps)).status, 'complete'); assert.equal(authCalls, 2);
    for (const path of ['users/alice', 'users/alice/otherNested/synthetic', 'sessions/owned', 'sessions/owned/versions/old', 'p2pRooms/synthetic/callerCandidates/nested']) assert.equal((await f.db.doc(path).get()).exists, false);
    for(const id of ['actor','peer'])assert.equal((await f.db.doc('commsContactRemovals/'+id).get()).exists,false);assert.equal((await f.db.doc('commsContactRemovals/other').get()).exists,true);
    for(const path of ['commsContactPairs/outgoing','commsContactPairs/incoming'])assert.equal((await f.db.doc(path).get()).exists,false);assert.equal((await f.db.doc('commsContactPairs/other').get()).exists,true);
    for(const id of ['caller','callee','owner'])assert.equal((await f.db.doc('commsP2PLegacyReceipts/'+id).get()).exists,false);assert.equal((await f.db.doc('commsP2PLegacyReceipts/other').get()).exists,true);
    for(const path of ['commsP2PContentReceipts/outgoing','commsP2PContentReceipts/incoming'])assert.equal((await f.db.doc(path).get()).exists,false);assert.equal((await f.db.doc('commsP2PContentReceipts/other').get()).exists,true);
    for(const path of ['commsP2PRequests/outgoing','commsP2PRequests/incoming'])assert.equal((await f.db.doc(path).get()).exists,false);assert.equal((await f.db.doc('commsP2PRequests/other').get()).exists,true);assert.equal((await f.db.doc('commsP2PBudgets/project-retained').get()).exists,true);
    for(const path of ['commsDeliveryRequests/outgoing','commsDeliveryRequests/incoming'])assert.equal((await f.db.doc(path).get()).exists,false);assert.equal((await f.db.doc('commsDeliveryRequests/other').get()).exists,true);assert.equal((await f.db.doc('commsDeliveryBudgets/project-retained').get()).exists,true);
    assert.equal((await f.db.doc('users/bob').get()).exists, true);
    for (const collection of ['memoryCreationReceipts', 'memoryUsageReceipts', 'personalConnectionChanges', 'commsIdentityRollovers', 'commsIdentityBudgets', 'commsContactBudgets', 'commsDeliveryBudgets', 'commsP2PBudgets', 'personalRevisions', 'personalRevisionBudgets', 'attachmentMutations', 'aiBudgets', 'aiPersonalBudgets', 'aiBudgetWindows', 'agentGrants', 'agentMutationReceipts', 'agentMutationProposals', 'agentMutationBudgets', 'agentMutationReversals', 'agentReversalCancelBudgets', 'mobileSyncPublications', 'mobileSyncPublicationCancellations', 'mobileSyncBudgets', 'obsidianImportBudgets', 'documentImportBudgets']) {
      assert.equal((await f.db.doc(`${collection}/owned`).get()).exists, false); assert.equal((await f.db.doc(`${collection}/other`).get()).exists, true);
    }
    for (const suffix of ['', '/batches/0']) {
      assert.equal((await f.db.doc(`mobileSyncImports/alice-owned${suffix}`).get()).exists,false);
      assert.equal((await f.db.doc(`mobileSyncImports/bob-owned${suffix}`).get()).exists,true);
      assert.equal((await f.db.doc(`obsidianImports/alice-owned${suffix}`).get()).exists,false);
      assert.equal((await f.db.doc(`obsidianImports/bob-owned${suffix}`).get()).exists,true);
      assert.equal((await f.db.doc(`documentImports/alice-owned${suffix}`).get()).exists,false);
      assert.equal((await f.db.doc(`documentImports/bob-owned${suffix}`).get()).exists,true);
    }
    assert.equal((await f.db.doc('accountDeletions/alice').get()).data().status, 'complete');
    assert.deepEqual(await getAccountDeletionStatus.run({ uid: 'alice' }, { auth: { uid: 'alice' } }), { uid: 'alice', status: 'complete', retryAt: null });
    assert.deepEqual(await deleteUserAccount.run({ uid: 'alice' }, { auth: { uid: 'alice' } }), { uid: 'alice', status: 'complete', retryAt: null });
  });

  test('account-receipt survives lost Auth ACK, supports only status and finishes through the trusted final-phase worker', async () => {
    const f = await purgeFixture(); const token = 'ab'.repeat(32); let authGone = false; let authCalls = 0;
    const forbidden = async () => { throw Error('synthetic: data phases must not run in the repair worker'); };
    const deps = { firestore: f.db, now: f.deps.now, attachments: f.deps, cancelBilling: forbidden, purgeLegacyObjects: forbidden,
      purgeMemberships: forbidden, deleteAuth: async () => { authCalls++; if (!authGone) { authGone = true; throw Error('synthetic lost Auth ACK'); }
        throw Object.assign(Error('synthetic absent'), { code: 'auth/user-not-found' }); } };
    // The authenticated request registers its receipt with the initial durable marker, even if a provider fails.
    await assert.rejects(executeAccountDeletion('alice', { uid: 'alice', recoveryToken: token }, deps));
    let data = (await f.db.doc('accountDeletions/alice').get()).data();
    assert.deepEqual(data.recoveryHashes, [accountDeletionRecoveryDigest('alice', token)]); assert.equal(JSON.stringify(data).includes(token), false);
    assert.equal((await inspectAccountDeletionRecovery({ uid: 'alice', recoveryToken: token }, f.db, f.deps.now())).status, 'pending');
    await assert.rejects(executeAccountDeletion('alice', { uid: 'alice' }, deps, true), { code: 'failed-precondition' }); assert.equal(authCalls, 0);
    await assert.rejects(executeAccountDeletion('bob', { uid: 'bob' }, deps, true), { code: 'failed-precondition' });
    assert.equal((await f.db.doc('accountDeletions/bob').get()).exists, false);
    for (const input of [{ uid: 'bob', recoveryToken: token }, { uid: 'alice', recoveryToken: 'cd'.repeat(32) }])
      await assert.rejects(inspectAccountDeletionRecovery(input, f.db), { code: 'permission-denied' });
    assert.equal((await f.db.doc('users/alice').get()).exists, true);
    // Synthetic fixture stands for a durable request whose verified data phases are already complete.
    await f.db.doc('accountDeletions/alice').update({ phase: 'auth', leaseUntil: f.deps.now() + 60000 });
    assert.equal((await finishInterruptedAccountAuthDeletions(deps)).busy, 1); assert.equal(authCalls, 0);
    await f.db.doc('accountDeletions/alice').update({ leaseUntil: 0 });
    assert.equal((await finishInterruptedAccountAuthDeletions(deps)).failed, 1); assert.equal(authGone, true);
    assert.equal((await inspectAccountDeletionRecovery({ uid: 'alice', recoveryToken: token }, f.db)).status, 'pending');
    assert.equal((await finishInterruptedAccountAuthDeletions(deps)).completed, 1); assert.equal(authCalls, 2);
    assert.equal((await f.db.doc('users/alice').get()).exists, false);
    assert.deepEqual(await getAccountDeletionRecoveryStatus.run({ uid: 'alice', recoveryToken: token }, { rawRequest: { ip: 'synthetic-recovery-device' } }),
      { uid: 'alice', status: 'complete', retryAt: null });
    assert.equal((await finishInterruptedAccountAuthDeletions(deps)).scanned, 0); assert.equal(authCalls, 2);
  });

  test('account-receipt registration on a busy request is bounded, idempotent and cannot replace older device receipts', async () => {
    const f = await purgeFixture(); const tokens = Array.from({ length: 9 }, (_, index) => index.toString(16).padStart(64, '0'));
    const noRemote = async () => { throw Error('synthetic: live worker must retain its lease'); };
    const deps = { firestore: f.db, now: f.deps.now, attachments: f.deps, cancelBilling: noRemote, purgeLegacyObjects: noRemote,
      purgeMemberships: noRemote, deleteAuth: noRemote };
    await f.db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting', phase: 'objects', worker: 'live-worker', leaseUntil: f.deps.now() + 60000 });
    for (const recoveryToken of tokens.slice(0, 8)) assert.equal((await executeAccountDeletion('alice', { uid: 'alice', recoveryToken }, deps)).status, 'pending');
    assert.equal((await executeAccountDeletion('alice', { uid: 'alice', recoveryToken: tokens[0] }, deps)).status, 'pending');
    await assert.rejects(executeAccountDeletion('alice', { uid: 'alice', recoveryToken: tokens[8] }, deps), { code: 'resource-exhausted' });
    const data = (await f.db.doc('accountDeletions/alice').get()).data(); assert.equal(data.recoveryHashes.length, 8); assert.equal(data.worker, 'live-worker');
    for (const recoveryToken of tokens.slice(0, 8)) assert.equal((await inspectAccountDeletionRecovery({ uid: 'alice', recoveryToken }, f.db)).status, 'pending');
    await f.db.doc('accountDeletions/alice').update({ recoveryHashes: ['malformed'] });
    await assert.rejects(inspectAccountDeletionRecovery({ uid: 'alice', recoveryToken: tokens[0] }, f.db), { code: 'permission-denied' });
  });

  test('account-receipt anonymous attempts are rate limited before lookup and store a hashed platform IP, ignoring XFF', async () => {
    const db = admin.firestore(); const input = { uid: 'absent-account', recoveryToken: 'ab'.repeat(32) };
    for (let attempt = 0; attempt < 20; attempt++) await assert.rejects(getAccountDeletionRecoveryStatus.run(input,
      { rawRequest: { ip: 'synthetic-platform-ip', headers: { 'x-forwarded-for': `synthetic-spoof-${attempt}` } } }), { code: 'permission-denied' });
    await assert.rejects(getAccountDeletionRecoveryStatus.run(input, { rawRequest: { ip: 'synthetic-platform-ip' } }), { code: 'resource-exhausted' });
    const rows = await db.collection('rateLimits').get(); assert.equal(rows.size, 1);
    assert.match(rows.docs[0].data().clientKey, /^recovery-ip:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(rows.docs[0].data()).includes('synthetic-platform-ip'), false);
    assert.equal((await db.doc('accountDeletions/absent-account').get()).exists, false);
  });

  test('account-receipt repair cursor progresses past failures and bounded pages without starting earlier phases', async () => {
    const f = await purgeFixture(); const events = [];
    const forbidden = async () => { throw Error('synthetic earlier phase must not execute'); };
    const deps = { firestore: f.db, now: f.deps.now, attachments: f.deps, cancelBilling: forbidden, purgeLegacyObjects: forbidden,
      purgeMemberships: forbidden, deleteAuth: async uid => { events.push(uid); if (uid === 'account-00') throw Error('synthetic provider failure'); } };
    for (let index = 0; index < 21; index++) await f.db.doc(`accountDeletions/account-${String(index).padStart(2, '0')}`).set({ v: 1, phase: 'auth', status: 'deleting', leaseUntil: 0 });
    await f.db.doc('accountDeletions/earlier').set({ v: 1, phase: 'documents', status: 'deleting', leaseUntil: 0 });
    const first = await finishInterruptedAccountAuthDeletions(deps); assert.equal(first.completed, 19); assert.equal(first.failed, 1); assert.equal(first.exhausted, true);
    assert.equal((await f.db.doc('maintenanceCursors/account-deletion-auth-v1').get()).data().after, 'account-19');
    const second = await finishInterruptedAccountAuthDeletions(deps); assert.equal(second.completed, 1); assert.equal(second.failed, 0);
    assert.equal((await f.db.doc('maintenanceCursors/account-deletion-auth-v1').get()).data().after, null);
    assert.equal((await finishInterruptedAccountAuthDeletions(deps)).failed, 1); assert.equal(events.filter(uid => uid === 'account-00').length, 2);
    assert.equal((await f.db.doc('accountDeletions/earlier').get()).data().phase, 'documents');
    await f.db.doc('maintenanceCursors/account-deletion-auth-v1').update({ leaseUntil: f.deps.now() + 60000 });
    assert.equal((await finishInterruptedAccountAuthDeletions(deps)).workerBusy, true);
    assert.equal(events.length, 22);
    await f.db.doc('users/bob').set({}); const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('maintenanceCursors/account-deletion-auth-v1').get());
    await assertFails(bob.doc('maintenanceCursors/account-deletion-auth-v1').set({ v: 1, after: null, leaseUntil: 0 }));
    await assertFails(bob.doc('maintenanceCursors/account-deletion-auth-v1').delete());
  });

  test('account deletion leases exclude concurrent workers and delayed billing events cannot recreate a deleted profile', async () => {
    const f = await purgeFixture(); let release; const wait = new Promise(resolve => { release = resolve; }); let entered; const started = new Promise(resolve => { entered = resolve; }); let authCalls = 0;
    const deps = { firestore: f.db, now: f.deps.now, attachments: f.deps, cancelBilling: async () => { entered(); await wait; }, purgeLegacyObjects: async () => true,
      purgeMemberships: async () => 0, deleteAuth: async () => { authCalls++; } };
    const first = executeAccountDeletion('alice', { uid: 'alice' }, deps); await started;
    const second = await executeAccountDeletion('alice', { uid: 'alice' }, deps); assert.equal(second.status, 'pending'); assert.equal(authCalls, 0);
    assert.equal(await writeLiveBillingAccount('alice', { subscription: { tier: 'pro' } }, { effectiveTier: 'pro' }, { id: 'late', data: { uid: 'alice' } }, f.db), false);
    release(); assert.equal((await first).status, 'complete'); assert.equal(authCalls, 1);
    assert.equal(await writeLiveBillingAccount('alice', { subscription: {} }, { effectiveTier: 'pro' }, undefined, f.db), false);
    assert.equal((await f.db.doc('users/alice').get()).exists, false); assert.equal((await f.db.doc('entitlements/alice').get()).exists, false); assert.equal((await f.db.doc('notifications/late').get()).exists, false);
    await f.db.doc('users/bob').set({}); assert.equal(await writeLiveBillingAccount('bob', { subscription: { tier: 'pro' } }, { effectiveTier: 'pro' }, undefined, f.db), true);
  });

  test('deleting a team owner freezes every member, removes other members uploads and historical keys, then deletes Auth', async () => {
    const f = await purgeFixture(); const keyId = '88888888-8888-4888-8888-888888888888'; const id = '99999999-9999-4999-8999-999999999999';
    await f.db.doc('users/bob').set({}); await f.db.doc('teams/crew').set({ ownerUid: 'bob', memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} },
      keyRotationStatus: 'active', pendingRotationId: null, activeKeyEpoch: 1, activeKeyId: keyId });
    await f.db.doc('teams/crew/keyEpochs/1').set({ epoch: 1, keyId, status: 'active', memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} } });
    const file = await f.create(id, true, { kind: 'team', teamId: 'crew', keyEpoch: 1, keyId });
    await f.db.doc('sessions/team-note').set({ uid: 'alice', teamId: 'crew', attachments: [attachmentDescriptor(file)] });
    await f.db.doc('sessions/team-note/versions/old').set({ attachments: [attachmentDescriptor(file)] });
    await f.db.doc('teamKeyRotations/synthetic').set({ teamId: 'crew' });
    let auth = 0; const deps = { firestore: f.db, now: f.deps.now, attachments: f.deps, cancelBilling: async () => {}, purgeLegacyObjects: async () => true,
      purgeMemberships: async () => 0, deleteAuth: async () => { auth++; assert.equal((await f.db.doc('teams/crew/keyEpochs/1').get()).exists, false); } };
    const first = await executeAccountDeletion('bob', { uid: 'bob' }, deps); assert.equal(first.status, 'pending'); assert.equal(auth, 0);
    assert.deepEqual((await f.db.doc('teams/crew').get()).data().memberUids, []);
    f.setNow(first.retryAt); assert.equal((await executeAccountDeletion('bob', { uid: 'bob' }, deps)).status, 'complete');
    assert.equal(auth, 1); for (const path of ['teams/crew', 'sessions/team-note', 'sessions/team-note/versions/old', 'teamKeyRotations/synthetic', `attachmentUploads/${id}`]) assert.equal((await f.db.doc(path).get()).exists, false);
    assert.equal((await f.db.doc('users/alice').get()).exists, true);
    const quotas = await f.db.collection('attachmentQuotas').get(); assert.equal(quotas.size, 1); assert.equal(quotas.docs[0].data().storedBytes, 0);
  });

  test('legacy team file ownership without a registry preserves the deletion request and Auth for migration review', async () => {
    const f = await purgeFixture(); await f.db.doc('teams/legacy').set({ ownerUid: 'alice', memberUids: ['alice'], wrappedKeys: { alice: {} } });
    await f.db.doc('sessions/legacy-team-note').set({ uid: 'bob', teamId: 'legacy', attachments: [{ url: 'https://synthetic.invalid/file' }] }); let auth = 0;
    const deps = { firestore: f.db, now: f.deps.now, attachments: f.deps, cancelBilling: async () => {}, purgeLegacyObjects: async () => true, purgeMemberships: async () => 0, deleteAuth: async () => { auth++; } };
    await assert.rejects(executeAccountDeletion('alice', { uid: 'alice' }, deps), { code: 'failed-precondition' }); assert.equal(auth, 0);
    assert.equal((await f.db.doc('sessions/legacy-team-note').get()).exists, true); assert.equal((await f.db.doc('accountDeletions/alice/teams/legacy').get()).exists, true);
  });

  test('account deletion takes over an interrupted team deletion and recovers a lost parent ACK using the object-completion anchor', async () => {
    const f = await purgeFixture(); await f.db.doc('users/bob').set({});
    await f.db.doc('teams/crew').set({ ownerUid: 'bob', memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} } });
    await f.db.doc('sessions/legacy-note').set({ uid: 'alice', teamId: 'crew', attachments: [{ url: 'https://synthetic.invalid/legacy' }] });
    await assert.rejects(executeDeleteTeam('bob', { teamId: 'crew', expectedUid: 'bob' }, { firestore: f.db, now: f.deps.now, attachments: f.deps }));
    assert.equal((await f.db.doc('teamDeletions/crew').get()).data().phase, 'documents');
    await f.db.doc('sessions/legacy-note').delete(); let loseAck = true; let authCalls = 0;
    const faultyDb = new Proxy(f.db, { get(target, property) {
      if (property === 'doc') return name => {
        const ref = target.doc(name); if (name !== 'teams/crew') return ref;
        return new Proxy(ref, { get(doc, field) {
          if (field === 'delete') return async () => { await doc.delete(); if (loseAck) { loseAck = false; throw Error('synthetic lost parent ACK'); } };
          const value = Reflect.get(doc, field, doc); return typeof value === 'function' ? value.bind(doc) : value;
        } });
      };
      const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const deps = { firestore: faultyDb, now: f.deps.now, attachments: { ...f.deps, firestore: faultyDb }, cancelBilling: async () => {},
      purgeLegacyObjects: async () => true, purgeMemberships: async () => 0, deleteAuth: async () => { authCalls++; } };
    await assert.rejects(executeAccountDeletion('bob', { uid: 'bob' }, deps));
    assert.equal(authCalls, 0); assert.equal((await f.db.doc('teams/crew').get()).exists, false);
    assert.equal((await f.db.doc('accountDeletions/bob/teams/crew').get()).data().objectsComplete, true);
    // An unproven old anchor must retain Auth even though the parent is absent.
    await f.db.doc('accountDeletions/bob/teams/crew').update({ objectsComplete: false });
    await assert.rejects(executeAccountDeletion('bob', { uid: 'bob' }, { ...deps, firestore: f.db, attachments: f.deps })); assert.equal(authCalls, 0);
    await f.db.doc('accountDeletions/bob/teams/crew').update({ objectsComplete: true });
    assert.equal((await executeAccountDeletion('bob', { uid: 'bob' }, { ...deps, firestore: f.db, attachments: f.deps })).status, 'complete');
    assert.equal(authCalls, 1); const complete = (await f.db.doc('teamDeletions/crew').get()).data();
    assert.equal(complete.phase, 'complete'); assert.equal(complete.ownerUid, undefined); assert.equal(complete.worker, undefined);
    assert.equal((await f.db.doc('users/alice').get()).exists, true);
  });

  test('historical account wraps are removed without relabelling an epoch or changing other members wrappers', async () => {
    const db = admin.firestore();
    for (const epoch of [1, 2]) await db.doc(`teams/crew/keyEpochs/${epoch}`).set({ epoch, keyId: 'synthetic', status: epoch === 1 ? 'historical' : 'active',
      memberUids: ['alice', 'bob'], wrappedKeys: { alice: { ct: 'synthetic-alice' }, bob: { ct: 'synthetic-bob' } } });
    await purgeHistoricalAccountWraps('bob', db); await purgeHistoricalAccountWraps('bob', db);
    for (const epoch of [1, 2]) {
      const value = (await db.doc(`teams/crew/keyEpochs/${epoch}`).get()).data(); assert.equal(value.epoch, epoch);
      assert.deepEqual(value.memberUids, ['alice']); assert.deepEqual(value.wrappedKeys, { alice: { ct: 'synthetic-alice' } });
      assert.equal(value.status, epoch === 1 ? 'historical' : 'active');
    }
  });

  test('a deleting personal author blocks shared reads, shared updates and orphan version creation by another live account', async () => {
    const db = admin.firestore(); await db.doc('users/alice').set({}); await db.doc('users/bob').set({});
    await db.doc('sessions/shared-deleting').set({ uid: 'alice', teamId: null, sharedWithIds: ['bob'], enc: { v: 1, iv: 'synthetic', ct: 'synthetic-cipher' }, text: '', timestamp: 1 });
    const bob = testEnv.authenticatedContext('bob').firestore(); await assertSucceeds(bob.doc('sessions/shared-deleting').get());
    await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' });
    await assertFails(bob.doc('sessions/shared-deleting').get()); await assertFails(bob.doc('sessions/shared-deleting').update({ updatedAt: 2 }));
    await assertFails(bob.doc('sessions/shared-deleting/versions/orphan').set({ enc: { v: 1, iv: 'synthetic', ct: 'synthetic-cipher' }, editorUid: 'bob', createdAt: 2, previousUpdatedAt: 1, text: '' }));
  });

  const encryptedShare = {
    uid: 'alice',
    encrypted: true,
    ciphertext: {
      v: 1,
      alg: 'AES-GCM-PBKDF2',
      salt: 'salt-value-long',
      iv: 'iv-value-long',
      data: 'ciphertext-payload-xx',
    },
    sessionId: 'sess-1',
    views: 0,
    importCount: 0,
  };

  test('initial team creates one consistent active epoch and rolls back all writes on an audit collision', async () => {
    const db = admin.firestore();
    const { generateKeyPairSync, publicEncrypt, privateDecrypt, randomBytes, constants } = require('node:crypto');
    const identity = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = identity.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const raw = randomBytes(32);
    const wrap = { v: 1, alg: 'RSA-OAEP', ct: publicEncrypt({ key: identity.publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, raw).toString('base64') };
    const input = { name: 'Synthetic team', expectedUid: 'alice', wrappedKey: wrap, requestId: '12345678-1234-4234-8234-123456789abc',
      publicKeyFingerprint: createHash('sha256').update(pem.trim()).digest('hex') };
    await db.doc('users/alice').set({ uid: 'alice' });
    await db.doc('publicProfiles/alice').set({ publicKeyPem: pem });
    const creations = await Promise.all([executeCreateTeam('alice', input, db, 1000), executeCreateTeam('alice', input, db, 1000)]);
    const result = creations[0];
    assert.equal(creations[1].teamId, result.teamId);
    assert.equal(creations.filter(value => value.alreadyCreated).length, 1);
    const team = (await db.doc(`teams/${result.teamId}`).get()).data();
    const epoch = (await db.doc(`teams/${result.teamId}/keyEpochs/1`).get()).data();
    assert.equal(team.activeKeyEpoch, 1); assert.equal(team.activeKeyId, epoch.keyId);
    assert.equal(team.keyRotationStatus, 'active'); assert.equal(team.pendingRotationId, null);
    assert.deepEqual(epoch.memberUids, ['alice']); assert.deepEqual(epoch.wrappedKeys, team.wrappedKeys);
    assert.equal(privateDecrypt({ key: identity.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256' }, Buffer.from(epoch.wrappedKeys.alice.ct, 'base64')).equals(raw), true);
    const { doc, getDoc, setDoc } = require('firebase/firestore');
    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(getDoc(doc(alice, `teams/${result.teamId}/keyEpochs/1`)));
    await assertFails(getDoc(doc(bob, `teams/${result.teamId}/keyEpochs/1`)));
    await assertFails(setDoc(doc(alice, `teams/${result.teamId}/keyEpochs/2`), epoch));
    const receipts = await db.collection('teamCreationRequests').get();
    assert.equal(receipts.size, 1);
    await assertFails(getDoc(doc(alice, `teamCreationRequests/${receipts.docs[0].id}`)));
    await assertFails(setDoc(doc(alice, 'teamCreationRequests/synthetic'), { uid: 'alice' }));
    const audits = await db.collection('teamAudit').where('teamId', '==', result.teamId).get();
    assert.equal(audits.size, 1); assert.equal(audits.docs[0].data().action, 'created');
    // Force the final transaction create to collide in the real emulator.
    const collision = db.doc('teamAudit/synthetic-collision');
    await collision.set({ action: 'existing' });
    const collidingDb = { runTransaction: db.runTransaction.bind(db), collection: name =>
      name === 'teamAudit' ? { doc: () => collision } : db.collection(name) };
    await assert.rejects(executeCreateTeam('alice', { ...input, requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, collidingDb, 1001));
    assert.equal((await db.collection('teams').get()).size, 1);
    assert.equal((await db.collectionGroup('keyEpochs').get()).size, 1);
    assert.equal((await collision.get()).data().action, 'existing');
    await db.doc('publicProfiles/alice').update({ publicKeyPem: 'changed' });
    await assert.rejects(executeCreateTeam('alice', { ...input, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, db, 1002));
    assert.equal((await db.collection('teams').get()).size, 1);
    await db.doc(`teams/${result.teamId}`).delete();
    await assert.rejects(executeCreateTeam('alice', input, db, 1003));
    assert.equal((await db.collection('teams').get()).size, 0);
  });

  test('creation cancellation serializes with concurrent creation and permanently rejects delayed retries', async () => {
    const db = admin.firestore();
    await db.doc('users/alice').set({ uid: 'alice' }); await db.doc('users/bob').set({ uid: 'bob' });
    await db.doc('publicProfiles/alice').set({ publicKeyPem: 'synthetic-profile' });
    const requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const input = { name: 'Synthetic', expectedUid: 'alice', requestId,
      publicKeyFingerprint: createHash('sha256').update('synthetic-profile').digest('hex'),
      wrappedKey: { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 8).toString('base64') } };
    const cancel = { expectedUid: 'alice', confirmed: true, requestId };
    const attempts = await Promise.allSettled([executeCreateTeam('alice', input, db), executeCancelTeamCreation('alice', cancel, db)]);
    assert.equal(attempts[1].status, 'fulfilled');
    await assert.rejects(executeCreateTeam('alice', input, db));
    assert.equal((await db.collection('teamCreationRequests').get()).size, 1);
    const count = (await db.collection('teams').get()).size; assert.equal(count <= 1, true);
    await executeCancelTeamCreation('alice', cancel, db); assert.equal((await db.collection('teams').get()).size, count);
    // Same request ID under Bob cannot invalidate Alice's separate request namespace.
    const separate = { ...input, requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
    const created = await executeCreateTeam('alice', separate, db);
    await executeCancelTeamCreation('bob', { expectedUid: 'bob', confirmed: true, requestId: separate.requestId }, db);
    assert.equal((await executeCreateTeam('alice', separate, db)).teamId, created.teamId);
    await db.doc('users/alice').update({ deletionState: 'deleting' });
    await assert.rejects(executeCreateTeam('alice', separate, db)); await assert.rejects(executeCancelTeamCreation('alice', cancel, db));
  });

  test('agent reversal restores exact metadata absence and learning, archives the applied state and commits once', async () => {
    const f = await seedAgentMutationFixture(); const ref = f.db.doc('sessions/' + f.target.sessionId);
    await ref.update({ category: null, learning: { dueAt: 9000, score: 2 } });
    f.request.baseline = await agentMutations.executePrepareAgentMutation(f.key, f.target, f.deps); f.request.metadata = { tags: ['synthetic-changed'], category: 'new', color: '#112233' };
    const admitted = await f.propose(); await agentMutations.executeApproveAgentMutation('alice', f.decision(admitted), f.deps); f.setNow(2000);
    const deps = { firestore: f.db, now: f.deps.now, enabled: () => true }, target = { expectedUid: 'alice', request: { proposalId: f.request.operationId } };
    const preparation = await agentReversals.executePrepareAgentReversal('alice', target, deps);
    assert.deepEqual(preparation.sourceLearning, { dueAt: 9000, score: 2 }); assert.equal(preparation.sourceLearningPresent, true); assert.equal('color' in preparation.sourceMetadata, false);
    const request = { operationId: '42345678-1234-4234-8234-123456789012', baseline: preparation.baseline, enc: { ...preparation.sourceEnc, ct: 'D'.repeat(32) } };
    const command = { expectedUid: 'alice', request, reviewDigest: createHash('sha256').update(reversalContract.agentReversalRequestBytes(request)).digest('hex'), confirmed: true };
    const [first, second] = await Promise.all([agentReversals.executeAgentReversal('alice', command, 'apply', deps), agentReversals.executeAgentReversal('alice', command, 'apply', deps)]);
    assert.deepEqual(first, second); assert.equal(first.status, 'committed');
    const restored = (await ref.get()).data(); assert.equal('color' in restored, false); assert.equal('category' in restored, true); assert.equal(restored.category, null);
    assert.deepEqual(restored.tags, ['synthetic']); assert.deepEqual(restored.learning, { dueAt: 9000, score: 2 }); assert.deepEqual(restored.enc, request.enc);
    assert.equal((await ref.collection('versions').get()).size, 2); assert.deepEqual((await ref.collection('versions').doc('agent-reversal-' + request.operationId).get()).data().enc, f.request.enc);
    assert.equal((await f.db.collection('agentMutationReversals').get()).size, 1); assert.equal((await f.get()).receipt.status, 'reverted');
    assert.equal((await f.db.collection('users/alice/agentEvents').where('kind', '==', 'mutation-reverted').get()).size, 1);
    const supersessions=(await f.db.collection('users/alice/memoryEvents').where('kind','==','supersede').get()).docs.map(doc=>doc.data());
    assert.equal(supersessions.length,2);const reversal=supersessions.find(row=>row.source==='agent-reversal');assert(reversal);assert.equal(reversal.memoryId,ref.id);assert.equal(reversal.revision,first.revision);assert.equal(reversal.versionId,'agent-reversal-'+request.operationId);
    assert.equal((await f.db.collection('memoryEditBudgets').get()).docs[0].data().operations, 2);
    assert.equal((await agentMutations.executeApproveAgentMutation('alice', f.decision(admitted), f.deps)).status, 'reverted');
    assert.deepEqual((await ref.get()).data().enc, request.enc);
  });
  test('agent reversal restores a tombstone after the agent expires, is revoked and is stopped', async () => {
    const f = await appliedAgentReversalFixture('personal', 'delete'); f.setNow(999999);
    await executeRevokeAgentGrant('alice', { expectedUid: 'alice', grantId: f.key.id }, f.db); await setAgentAccessForTest('alice', true, f.db);
    const preparation = await f.prepare(); assert.equal(preparation.deleted, true); const request = f.input(preparation);
    const result = await agentReversals.executeAgentReversal('alice', f.command(request), 'apply', f.deps); assert.equal(result.status, 'committed');
    const restored = (await f.db.doc('sessions/' + f.target.sessionId).get()).data(); assert.equal('deletedAt' in restored, false); assert.equal('learning' in restored, false);
    assert.equal((await f.status(request)).status, 'committed'); assert.equal((await f.get()).receipt.status, 'reverted');
  });
  test('agent reversal accepts historical source keys while requiring the active team epoch for the restored envelope', async () => {
    const f = await appliedAgentReversalFixture('team:crew'), nextId = '52345678-1234-4234-8234-123456789012';
    await f.db.doc('teams/crew/keyEpochs/1').update({ status: 'retired' });
    await f.db.doc('teams/crew/keyEpochs/2').set({ epoch: 2, keyId: nextId, status: 'active', memberUids: f.team.memberUids, wrappedKeys: f.team.wrappedKeys });
    await f.db.doc('teams/crew').update({ activeKeyEpoch: 2, activeKeyId: nextId });
    const preparation = await f.prepare(); assert.equal(preparation.baseline.sourceKeyEpoch, 1); assert.equal(preparation.baseline.currentKeyEpoch, 1); assert.equal(preparation.baseline.keyEpoch, 2);
    const request = f.input(preparation); await agentReversals.executeAgentReversal('alice', f.command(request), 'apply', f.deps);
    const restored = (await f.db.doc('sessions/' + f.target.sessionId).get()).data(); assert.equal(restored.keyEpoch, 2); assert.equal(restored.keyId, nextId); assert.equal(restored.enc.v, 2);
  });
  test('agent reversal snapshot ABA on memory, source version or team retires a prepared confirmation', async () => {
    for (const change of ['memory', 'source', 'team']) {
      await testEnv.clearFirestore(); const f = await appliedAgentReversalFixture('team:crew'), preparation = await f.prepare(), request = f.input(preparation);
      const ref = change === 'memory' ? f.db.doc('sessions/' + f.target.sessionId) : change === 'source' ? f.db.doc('sessions/' + f.target.sessionId + '/versions/' + preparation.baseline.versionId) : f.db.doc('teams/crew');
      const before = (await ref.get()).data(); await ref.update(change === 'team' ? { name: 'Transient name' } : { color: '#112233' }); await ref.set(before);
      await assert.rejects(agentReversals.executeAgentReversal('alice', f.command(request), 'apply', f.deps), { code: 'aborted' });
      assert.equal((await f.db.collection('agentMutationReversals').get()).size, 0); assert.equal((await f.get()).receipt.status, 'applied');
      const cancel = await agentReversals.executeAgentReversal('alice', { expectedUid: 'alice', request }, 'cancel', { ...f.deps, enabled: () => false }); assert.equal(cancel.status, 'cancelled');
      await assert.rejects(agentReversals.executeAgentReversal('alice', f.command(request), 'apply', f.deps));
    }
  });
  test('agent reversal apply versus cancellation has one outcome and a lost ACK recovers with admission closed', async () => {
    const f = await appliedAgentReversalFixture(), request = f.input(await f.prepare());
    await Promise.allSettled([agentReversals.executeAgentReversal('alice', f.command(request), 'apply', f.deps), agentReversals.executeAgentReversal('alice', { expectedUid: 'alice', request }, 'cancel', f.deps)]);
    const result = await f.status(request); assert.ok(['committed', 'cancelled'].includes(result.status));
    assert.equal((await f.db.collection('sessions/' + f.target.sessionId + '/versions').get()).size, result.status === 'committed' ? 2 : 1);
    await testEnv.clearFirestore(); const g = await appliedAgentReversalFixture(), next = g.input(await g.prepare()); let lost = false;
    const db = new Proxy(g.db, { get(target, name) { if (name === 'runTransaction') return async callback => { const response = await target.runTransaction(callback); if (!lost && response?.status === 'committed') { lost = true; throw Error('Synthetic lost reversal acknowledgement'); } return response; }; const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value; } });
    await assert.rejects(agentReversals.executeAgentReversal('alice', g.command(next), 'apply', { ...g.deps, firestore: db })); assert.equal(lost, true);
    assert.equal((await agentReversals.executeAgentReversal('alice', { expectedUid: 'alice', request: next }, 'status', { ...g.deps, enabled: () => false })).status, 'committed');
    assert.equal((await g.db.collection('sessions/' + g.target.sessionId + '/versions').get()).size, 2);
  });
  test('agent reversal quota and final gate failures leave the original applied memory, archive and receipt untouched', async () => {
    const f = await appliedAgentReversalFixture(), request = f.input(await f.prepare()); let checks = 0;
    await assert.rejects(agentReversals.executeAgentReversal('alice', f.command(request), 'apply', { ...f.deps, enabled: () => ++checks < 2 })); assert.equal(checks, 2);
    const budget = (await f.db.collection('memoryEditBudgets').get()).docs[0]; assert.equal(budget.data().operations, 1);
    await budget.ref.update({ operations: require('../lib/memoryEdits').MEMORY_EDIT_DAILY_LIMITS.operations });
    await assert.rejects(agentReversals.executeAgentReversal('alice', f.command(request), 'apply', f.deps), { code: 'resource-exhausted' });
    assert.equal((await f.db.collection('agentMutationReversals').get()).size, 0); assert.equal((await f.get()).receipt.status, 'applied');
    assert.deepEqual((await f.db.doc('sessions/' + f.target.sessionId).get()).data().enc, f.request.enc);
  });
  test('agent reversal membership, account and team deletion deny recovery writes without resurrecting metadata', async () => {
    for (const change of ['member', 'author', 'team']) {
      await testEnv.clearFirestore(); const f = await appliedAgentReversalFixture('team:crew'), request = f.input(await f.prepare());
      if (change === 'member') await f.db.doc('teams/crew').update({ memberUids: ['owner', 'bob'] });
      if (change === 'author') await f.db.doc('accountDeletions/alice').set({ status: 'deleting' });
      if (change === 'team') await f.db.doc('teamDeletions/crew').set({ status: 'deleting' });
      await assert.rejects(agentReversals.executeAgentReversal('alice', f.command(request), 'apply', f.deps));
      if (change === 'author') await assert.rejects(f.status(request), { code: 'permission-denied' }); else assert.equal((await f.status(request)).status, 'revoked');
      assert.equal((await f.db.collection('agentMutationReversals').get()).size, 0);
    }
  });
  test('agent reversal cancellation cap retires all outstanding payloads without unbounded receipts or later resurrection', async () => {
    const f = await appliedAgentReversalFixture(), request = f.input(await f.prepare());
    const day = '1970-01-01', budgetRef = f.db.doc('agentReversalCancelBudgets/' + createHash('sha256').update('alice').digest('hex') + '_' + day);
    await budgetRef.set({ v: 1, uid: 'alice', day, cancellations: agentReversals.AGENT_REVERSAL_DAILY_CANCELLATIONS - 1 });
    const first = { expectedUid: 'alice', request };
    assert.equal((await agentReversals.executeAgentReversal('alice', first, 'cancel', f.deps)).status, 'cancelled');
    assert.equal((await agentReversals.executeAgentReversal('alice', first, 'cancel', f.deps)).status, 'cancelled');
    assert.equal((await budgetRef.get()).data().cancellations, agentReversals.AGENT_REVERSAL_DAILY_CANCELLATIONS);
    const next = { ...request, operationId: '62345678-1234-4234-8234-123456789012' }, concurrent = { ...request, operationId: '72345678-1234-4234-8234-123456789012' };
    const results = await Promise.all([next, concurrent].map(input => agentReversals.executeAgentReversal('alice', { expectedUid: 'alice', request: input }, 'cancel', f.deps)));
    assert.equal(results.every(row => row.status === 'revoked'), true); assert.equal((await f.db.collection('agentMutationReversals').get()).size, 1);
    const profile = (await f.db.doc('users/alice').get()).data(); assert.equal(profile.agentReversalEpoch, 1); assert.equal(profile.agentReversalPausedUntil, 86_400_000);
    await assert.rejects(f.prepare(), { code: 'resource-exhausted' });
    assert.equal((await f.db.collection('users/alice/agentEvents').where('kind', '==', 'mutation-reversal-budget-closed').get()).size, 1);
    f.setNow(86_400_001); const fresh = await f.prepare(); assert.equal(fresh.baseline.reversalEpoch, 1);
    assert.equal((await f.status(next)).status, 'revoked'); await assert.rejects(agentReversals.executeAgentReversal('alice', f.command(next), 'apply', f.deps), { code: 'permission-denied' });
    const current = { ...next, operationId: '82345678-1234-4234-8234-123456789012', baseline: fresh.baseline }; assert.equal((await agentReversals.executeAgentReversal('alice', f.command(current), 'apply', f.deps)).status, 'committed');
  });
  test('agent reversal cannot attach receipts to an unrelated owner or resurrect a deleted original author', async () => {
    const f = await appliedAgentReversalFixture('team:crew', 'edit', { sessionId: 'crew-one' }), request = f.input(await f.prepare());
    assert.equal(request.baseline.authorUid, 'bob');
    const wrong = { ...request, baseline: { ...request.baseline, ownerUid: 'outsider' } };
    assert.equal((await f.status(wrong)).status, 'revoked');
    assert.equal((await agentReversals.executeAgentReversal('alice', { expectedUid: 'alice', request: wrong }, 'cancel', f.deps)).status, 'revoked');
    await f.db.doc('accountDeletions/bob').set({ status: 'deleting' });
    await assert.rejects(agentReversals.executeAgentReversal('alice', f.command(request), 'apply', f.deps), { code: 'permission-denied' });
    assert.equal((await f.status(request)).status, 'revoked');
    assert.equal((await agentReversals.executeAgentReversal('alice', { expectedUid: 'alice', request }, 'cancel', f.deps)).status, 'revoked');
    assert.equal((await f.db.collection('agentMutationReversals').get()).size, 0); assert.equal((await f.db.collection('agentReversalCancelBudgets').get()).size, 0);
  });
  test('agent reversal restores a team tombstone only while the confirming actor remains the current owner', async () => {
    const f = await appliedAgentReversalFixture('team:crew', 'delete', { teamOwner: true }), request = f.input(await f.prepare());
    assert.equal((await agentReversals.executeAgentReversal('alice', f.command(request), 'apply', f.deps)).status, 'committed');
    assert.equal('deletedAt' in (await f.db.doc('sessions/' + f.target.sessionId).get()).data(), false);
    await testEnv.clearFirestore(); const g = await appliedAgentReversalFixture('team:crew', 'delete', { teamOwner: true }), stale = g.input(await g.prepare());
    await g.db.doc('teams/crew').update({ ownerUid: 'owner', roles: { owner: 'owner', alice: 'admin', bob: 'member' } });
    await assert.rejects(agentReversals.executeAgentReversal('alice', g.command(stale), 'apply', g.deps), { code: 'permission-denied' });
    await assert.rejects(g.prepare(), { code: 'permission-denied' }); assert.equal((await g.status(stale)).status, 'revoked');
  });
  test('agent reversal preserves Firestore timestamps across independently read memory and archive snapshots', async () => {
    const f = await appliedAgentReversalFixture('personal', 'edit', { timestamps: true }), request = f.input(await f.prepare());
    assert.equal(request.baseline.originalRevision, 1002);
    assert.equal((await agentReversals.executeAgentReversal('alice', f.command(request), 'apply', f.deps)).status, 'committed');
    const memory = await f.db.doc('sessions/' + f.target.sessionId).get(); assert.equal(memory.data().timestamp.toMillis(), 1000);
    assert.equal((await memory.ref.collection('versions').doc('memory-edit-' + f.request.operationId).get()).data().timestamp.toMillis(), 1000);
    assert.equal((await memory.ref.collection('versions').doc('agent-reversal-' + request.operationId).get()).data().timestamp.toMillis(), 1000);
  });
  test('agent reversal receipts deny raw client reads and writes', async () => {
    const f = await appliedAgentReversalFixture(), request = f.input(await f.prepare()); await agentReversals.executeAgentReversal('alice', f.command(request), 'apply', f.deps);
    for (const context of [testEnv.authenticatedContext('alice'), testEnv.authenticatedContext('bob'), testEnv.unauthenticatedContext()]) {
      for (const collection of ['agentMutationReversals', 'agentReversalCancelBudgets']) {
        const ref = context.firestore().doc(collection + '/' + request.operationId); await assertFails(ref.get()); await assertFails(ref.set({ uid: 'alice', status: 'committed' }));
      }
      await assertFails(context.firestore().doc('users/alice').update({ agentReversalEpoch: 0, agentReversalPausedUntil: 0 }));
    }
  });
  test('agent mutation proposal is ciphertext-only and duplicate admission consumes one budget without changing the memory', async () => {
    const f = await seedAgentMutationFixture(), before = await f.db.doc('sessions/' + f.target.sessionId).get();
    const [first, replay] = await Promise.all([f.propose(), f.propose()]); assert.deepEqual(first, replay); assert.equal(first.status, 'pending');
    assert.deepEqual((await f.db.doc(before.ref.path).get()).data(), before.data());
    assert.equal((await f.db.collection('memoryEdits').get()).size, 0); assert.equal((await before.ref.collection('versions').get()).size, 0);
    assert.equal((await f.db.collection('agentMutationBudgets').get()).docs[0].data().proposals, 1);
    assert.equal((await f.db.collection('users/alice/agentEvents').where('kind', '==', 'mutation-proposed').get()).size, 1);
    assert.equal((await f.get()).reviewState, 'ready');
    const body = (await f.db.doc('agentMutationProposals/' + first.proposalId).get()).data();
    assert.deepEqual(body.request, f.request); assert.equal(JSON.stringify(body).includes('Synthetic private text'), false);
    await assert.rejects(agentMutations.executeProposeAgentMutation(f.key, { ...f.request, enc: { ...f.request.enc, ct: 'D'.repeat(32) } }, f.deps), { code: 'already-exists' });
  });
  test('agent mutation explicit owner approval commits memory, archive, receipt and audit atomically exactly once', async () => {
    const f = await seedAgentMutationFixture('team:crew'), receipt = await f.propose();
    const command = f.decision(receipt);
    await assert.rejects(agentMutations.executeApproveAgentMutation('bob', command, f.deps), { code: 'permission-denied' });
    await assert.rejects(agentMutations.executeApproveAgentMutation('alice', { ...command, reviewDigest: 'e'.repeat(64) }, f.deps), { code: 'permission-denied' });
    const results = await Promise.all([agentMutations.executeApproveAgentMutation('alice', command, f.deps), agentMutations.executeApproveAgentMutation('alice', command, f.deps)]);
    assert.deepEqual(results[0], results[1]); assert.equal(results[0].status, 'applied');
    const memory = await f.db.doc('sessions/' + f.target.sessionId).get(); assert.deepEqual(memory.data().enc, f.request.enc); assert.deepEqual(memory.data().tags, f.request.metadata.tags);
    assert.equal((await memory.ref.collection('versions').get()).size, 1); assert.equal((await f.db.collection('memoryEdits').get()).size, 1);
    assert.equal((await f.db.collection('memoryEditEvents').get()).size, 1); assert.equal((await f.db.collection('agentMutationProposals').get()).size, 0);
    assert.equal((await f.db.collection('users/alice/agentEvents').where('kind', '==', 'mutation-applied').get()).size, 1);
    const ledger = (await f.db.doc('agentMutationReceipts/' + receipt.proposalId).get()).data(); assert.equal(ledger.afterStateDigest, syncStateHash(memory.data()));
    const aggregate = (await f.db.collection('agentMutationTeamBudgets').get()).docs[0].data();
    assert.deepEqual(Object.keys(aggregate).sort(), ['bytes', 'day', 'proposals', 'teamId', 'v']);
    f.setNow(receipt.expiresAt + 1); assert.deepEqual((await f.get()).receipt, results[0]);
    assert.deepEqual(await agentMutations.executeApproveAgentMutation('alice', command, f.deps), results[0]);
  });
  test('agent mutation approve versus reject cannot apply after a terminal rejection', async () => {
    const f = await seedAgentMutationFixture(), receipt = await f.propose(), command = f.decision(receipt);
    const attempts = await Promise.allSettled([agentMutations.executeApproveAgentMutation('alice', command, f.deps), agentMutations.executeRejectAgentMutation('alice', command, f.deps)]);
    assert.equal(attempts[1].status, 'fulfilled'); const final = (await f.get()).receipt;
    assert.ok(['applied', 'rejected'].includes(final.status));
    assert.equal((await f.db.collection('memoryEdits').get()).size, final.status === 'applied' ? 1 : 0);
    assert.deepEqual(await agentMutations.executeApproveAgentMutation('alice', command, f.deps), final);
    assert.equal((await f.db.collection('agentMutationProposals').get()).size, 0);
  });
  test('agent mutation stale memory, revoked grant, stopped agents and changed vault never apply', async () => {
    for (const change of ['memory', 'grant', 'stop', 'team']) {
      await testEnv.clearFirestore(); const f = await seedAgentMutationFixture('team:crew'), receipt = await f.propose();
      if (change === 'memory') await f.db.doc('sessions/' + f.target.sessionId).update({ tags: ['changed-remotely'] });
      if (change === 'grant') await executeRevokeAgentGrant('alice', { expectedUid: 'alice', grantId: f.key.id }, f.db);
      if (change === 'stop') await setAgentAccessForTest('alice', true, f.db);
      if (change === 'team') await f.db.doc('teams/crew').update({ name: 'Changed team state' });
      const view = await f.get(); assert.equal(view.reviewState, 'unavailable'); assert.equal('request' in view, false);
      await assert.rejects(agentMutations.executeApproveAgentMutation('alice', f.decision(receipt), f.deps));
      assert.equal((await f.db.collection('memoryEdits').get()).size, 0);
      assert.equal((await agentMutations.executeRejectAgentMutation('alice', f.decision(receipt), { ...f.deps, enabled: false })).status, 'rejected');
    }
  });
  test('agent mutation expiry discards ciphertext and pending slot without applying', async () => {
    const f = await seedAgentMutationFixture(), receipt = await f.propose(); f.setNow(receipt.expiresAt);
    const rows = await agentMutations.executeListAgentMutations('alice', { expectedUid: 'alice', mode: 'pending', cursor: null }, { ...f.deps, enabled: false });
    assert.deepEqual(rows, { receipts: [], nextCursor: null }); assert.equal((await f.get()).receipt.status, 'expired');
    assert.equal((await f.db.collection('agentMutationProposals').get()).size, 0); assert.equal((await f.db.collection('memoryEdits').get()).size, 0);
  });
  test('agent mutation final admission failure rolls back queued memory, version, receipt and budget writes', async () => {
    const f = await seedAgentMutationFixture(), receipt = await f.propose(); let checks = 0;
    await assert.rejects(agentMutations.executeApproveAgentMutation('alice', f.decision(receipt), { ...f.deps, memoryWritesEnabled: () => ++checks < 3 }));
    assert.equal(checks, 3); assert.equal((await f.get()).receipt.status, 'pending');
    assert.deepEqual((await f.db.doc('sessions/' + f.target.sessionId).get()).data().enc, f.request.priorEnc);
    for (const name of ['memoryEdits', 'memoryEditEvents', 'memoryEditBudgets']) assert.equal((await f.db.collection(name).get()).size, 0);
    assert.equal((await f.db.collection('sessions/' + f.target.sessionId + '/versions').get()).size, 0);
  });
  test('agent mutation pending cap survives concurrent proposals and quotas refuse new data atomically', async () => {
    const f = await seedAgentMutationFixture();
    const request = index => ({ ...f.request, operationId: `32345678-1234-4234-8234-${String(index).padStart(12, '0')}` });
    for (let index = 0; index < 9; index++) await agentMutations.executeProposeAgentMutation(f.key, request(index), f.deps);
    const results = await Promise.allSettled([9, 10].map(index => agentMutations.executeProposeAgentMutation(f.key, request(index), f.deps)));
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.equal((await f.db.collection('agentMutationProposals').get()).size, 10);
    const budget = (await f.db.collection('agentMutationBudgets').get()).docs[0]; assert.equal(budget.data().proposals, 10);
    const receipt = (await agentMutations.executeListAgentMutations('alice', { expectedUid: 'alice', mode: 'pending', cursor: null }, f.deps)).receipts[0];
    await agentMutations.executeRejectAgentMutation('alice', f.decision(receipt), f.deps); await budget.ref.update({ proposals: 50 });
    await assert.rejects(agentMutations.executeProposeAgentMutation(f.key, request(12), f.deps), { code: 'resource-exhausted' });
    assert.equal((await f.db.collection('agentMutationProposals').get()).size, 9); assert.equal((await budget.ref.get()).data().proposals, 50);
  });
  test('agent mutation ciphertext and receipts deny raw owner, stranger and unauthenticated reads or writes', async () => {
    const f = await seedAgentMutationFixture(), receipt = await f.propose();
    for (const context of [testEnv.authenticatedContext('alice'), testEnv.authenticatedContext('bob'), testEnv.unauthenticatedContext()]) {
      for (const name of ['agentMutationProposals', 'agentMutationReceipts', 'agentMutationBudgets', 'agentMutationTeamBudgets']) {
        const ref = context.firestore().doc(name + '/' + receipt.proposalId);
        await assertFails(ref.get()); await assertFails(ref.set({ uid: 'alice', status: 'applied' }));
      }
    }
  });
  test('agent mutation delete preserves the encrypted prior version and team non-owner deletion fails', async () => {
    const f = await seedAgentMutationFixture('personal', 'delete'), receipt = await f.propose();
    assert.equal((await agentMutations.executeApproveAgentMutation('alice', f.decision(receipt), f.deps)).status, 'applied');
    const memory = await f.db.doc('sessions/' + f.target.sessionId).get(); assert.ok(memory.data().deletedAt); assert.deepEqual(memory.data().enc, f.request.priorEnc);
    assert.deepEqual((await memory.ref.collection('versions').get()).docs[0].data().enc, f.request.priorEnc);
    await testEnv.clearFirestore(); const team = await seedAgentMutationFixture('team:crew', 'delete'), pending = await team.propose();
    await assert.rejects(agentMutations.executeApproveAgentMutation('alice', team.decision(pending), team.deps), { code: 'permission-denied' });
    assert.equal((await team.db.collection('memoryEdits').get()).size, 0);
  });
  test('agent mutation equal-time history pagination returns each receipt exactly once with admission closed', async () => {
    const f = await seedAgentMutationFixture();
    for (let index = 0; index < 23; index++) {
      const request = { ...f.request, operationId: `42345678-1234-4234-8234-${String(index).padStart(12, '0')}` };
      const row = await agentMutations.executeProposeAgentMutation(f.key, request, f.deps);
      await agentMutations.executeRejectAgentMutation('alice', f.decision(row), f.deps);
    }
    const deps = { ...f.deps, enabled: false }, list = cursor => agentMutations.executeListAgentMutations('alice', { expectedUid: 'alice', mode: 'history', cursor }, deps);
    const first = await list(null), second = await list(first.nextCursor);
    assert.equal(first.receipts.length, 20); assert.equal(second.receipts.length, 3); assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.receipts, ...second.receipts].map(row => row.proposalId)).size, 23);
    await assert.rejects(agentMutations.executeListAgentMutations('bob', { expectedUid: 'bob', mode: 'history', cursor: first.nextCursor }, deps));
  });
  test('agent mutation lost approval acknowledgement reconciles from the owner receipt without applying twice', async () => {
    const f = await seedAgentMutationFixture(), receipt = await f.propose(); let lost = false;
    const db = new Proxy(f.db, { get(target, name) {
      if (name === 'runTransaction') return async callback => { const result = await target.runTransaction(callback); if (!lost && result?.status === 'committed') { lost = true; throw Error('Synthetic lost approval acknowledgement'); } return result; };
      const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(agentMutations.executeApproveAgentMutation('alice', f.decision(receipt), { ...f.deps, firestore: db })); assert.equal(lost, true);
    const recovered = (await f.get()).receipt; assert.equal(recovered.status, 'applied');
    assert.deepEqual(await agentMutations.executeApproveAgentMutation('alice', f.decision(receipt), f.deps), recovered);
    assert.equal((await f.db.collection('sessions/' + f.target.sessionId + '/versions').get()).size, 1);
    assert.equal((await f.db.collection('memoryEditEvents').get()).size, 1);
  });
  test('agent mutation team quota rejects admission without consuming user budget or storing a body', async () => {
    const f = await seedAgentMutationFixture('team:crew'); const day = '1970-01-01';
    const ref = f.db.doc('agentMutationTeamBudgets/' + createHash('sha256').update('crew').digest('hex') + '_' + day);
    await ref.set({ v: 1, teamId: 'crew', ownerUid: 'owner', day, proposals: 500, bytes: 0 });
    await assert.rejects(f.propose(), { code: 'resource-exhausted' });
    assert.equal((await f.db.collection('agentMutationBudgets').get()).size, 0); assert.equal((await f.db.collection('agentMutationProposals').get()).size, 0);
    assert.equal((await ref.get()).data().proposals, 500);
  });
  test('agent vault OAuth isolates personal and two team grants across REST and MCP', async () => {
    const f = await seedAgentVaultFixture(), { db } = f;
    const { vaultTypes: _types, ...legacyClient } = f.client;
    await db.doc('agentClients/' + f.input.client_id).set(legacyClient);
    await assert.rejects(executePreviewAgentAuthorization('alice', f.input, db));
    await db.doc('agentClients/' + f.input.client_id).set(f.client);
    await assert.rejects(executePreviewAgentAuthorization('outsider', f.input, db));
    const personal = await f.issue('personal'), crew = await f.issue(), other = await f.issue('team:other');
    assert.equal(new Set([personal.key.id, crew.key.id, other.key.id]).size, 3);
    assert.deepEqual((await executeListAgentGrants('alice', db)).grants.map(row => row.vault).sort(), ['personal', 'team:crew', 'team:other']);
    for (const [issued, expected] of [[personal, ['personal-note']], [crew, ['crew-one', 'crew-two']], [other, ['other-note']]]) {
      const response = await f.http(issued.token, '/api/v1/memories'); assert.equal(response.statusCode, 200);
      assert.deepEqual(response.body.memories.map(row => row.id).sort(), expected);
      assert.ok(response.body.memories.every(row => !('text' in row) && !('title' in row) && !('wrappedKeys' in row)));
    }
    const api = createTeamAgentMemoryApi(crew.key, db), page = await api.list('alice', { limit: 1 });
    assert.equal(page.memories.length, 1); assert.equal(page.memories[0].enc.v, 2);
    assert.equal(page.memories[0].teamId, 'crew'); assert.equal(page.memories[0].keyId, f.keyId);
    const next = await api.list('alice', { limit: 1, startAfter: page.nextStartAfter }); assert.equal(next.memories.length, 1);
    assert.notEqual(page.memories[0].id, next.memories[0].id); assert.equal(next.nextStartAfter, null);
    for (const id of ['personal-note', 'other-note']) assert.equal((await f.http(crew.token, '/api/v1/memories/' + id)).statusCode, 404);
    await assert.rejects(api.list('alice', { startAfter: 'other-note' })); await assert.rejects(api.list('bob', {})); await assert.rejects(api.create('alice', {}));
    const search = await api.search('alice', { embedding: [1, 0], embeddingModel: 'synthetic-model-a' });
    assert.deepEqual(search.results.map(row => row.id), ['crew-one']);
    const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_memories', arguments: { teamId: 'other', vault: 'personal' } } };
    const mcp = await f.http(crew.token, '/api/v1/mcp', rpc); assert.equal(mcp.statusCode, 200);
    assert.deepEqual(JSON.parse(mcp.body.result.content[0].text).memories.map(row => row.id).sort(), ['crew-one', 'crew-two']);
    await executeRevokeAgentGrant('alice', { grantId: crew.key.id }, db);
    assert.equal(await verifyAgentSession(crew.token.access_token, db, 1002), null);
    assert.ok(await verifyAgentSession(personal.token.access_token, db, 1002)); assert.ok(await verifyAgentSession(other.token.access_token, db, 1002));
  });

  test('agent vault team ABA, membership and key epoch changes retire previews, codes and sessions', async () => {
    const f = await seedAgentVaultFixture(), { db } = f;
    const team = db.doc('teams/crew'), epoch = db.doc('teams/crew/keyEpochs/1');
    const preview = await executePreviewAgentAuthorization('alice', f.input, db);
    await team.update({ syntheticChange: true }); await team.update({ syntheticChange: admin.firestore.FieldValue.delete() });
    await assert.rejects(executeAuthorizeAgentClient('alice', { ...f.input, expectedUid: 'alice', confirmed: true, consentDigest: preview.consentDigest }, db, 1000));
    assert.equal((await db.collection('agentGrants').get()).size, 0);
    let issued = await f.issue();
    await team.update({ memberUids: ['owner', 'bob'] }); assert.equal(await verifyAgentSession(issued.token.access_token, db, 1002), null);
    await team.update({ memberUids: f.team.memberUids }); assert.equal(await verifyAgentSession(issued.token.access_token, db, 1002), null);
    const pending = await f.code();
    await epoch.update({ syntheticChange: true }); await epoch.update({ syntheticChange: admin.firestore.FieldValue.delete() });
    await assert.rejects(redeemAgentAuthorizationCode(pending, db, 1001));
    issued = await f.issue();
    await team.update({ keyRotationStatus: 'pending', pendingRotationId: 'synthetic-rotation' });
    assert.equal(await verifyAgentSession(issued.token.access_token, db, 1002), null); await assert.rejects(executePreviewAgentAuthorization('alice', f.input, db));
    await team.update({ keyRotationStatus: 'active', pendingRotationId: null }); assert.equal(await verifyAgentSession(issued.token.access_token, db, 1002), null);
    issued = await f.issue();
    const keyId = '22345678-1234-4234-8234-123456789012';
    await db.doc('teams/crew/keyEpochs/2').set({ epoch: 2, keyId, status: 'active', memberUids: f.team.memberUids, wrappedKeys: f.team.wrappedKeys });
    await team.update({ activeKeyEpoch: 2, activeKeyId: keyId }); assert.equal(await verifyAgentSession(issued.token.access_token, db, 1002), null);
    const renewed = await f.issue(); assert.equal(renewed.key.vault.keyEpoch, 2);
    await db.doc('agentClients/' + f.input.client_id).update({ vaultTypes: ['personal'] });
    assert.equal(await verifyAgentSession(renewed.token.access_token, db, 1002), null);
  });

  test('agent vault deletion markers and missing current key membership deny access', async () => {
    for (const path of ['accountDeletions/alice', 'accountDeletions/owner', 'teamDeletions/crew', 'missing-current-wrap']) {
      await testEnv.clearFirestore(); const f = await seedAgentVaultFixture(), issued = await f.issue();
      if (path === 'missing-current-wrap') await f.db.doc('teams/crew/keyEpochs/1').update({ 'wrappedKeys.alice': admin.firestore.FieldValue.delete() });
      else await f.db.doc(path).set({ status: 'deleting' });
      assert.equal(await verifyAgentSession(issued.token.access_token, f.db, 1002), null);
      await assert.rejects(executePreviewAgentAuthorization('alice', f.input, f.db));
      await assert.rejects(createTeamAgentMemoryApi(issued.key, f.db).list('alice', {}));
    }
  });

  test('agent vault in-flight team reads are discarded after membership revocation', async () => {
    const f = await seedAgentVaultFixture(), issued = await f.issue(); let intercepted = false;
    const wrap = query => new Proxy(query, { get(target, property) {
      if (property === 'get') return async () => { const snapshot = await target.get(); if (!intercepted) { intercepted = true; await f.db.doc('teams/crew').update({ memberUids: ['owner', 'bob'] }); } return snapshot; };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? (...args) => { const result = value.apply(target, args); return ['where', 'orderBy', 'limit', 'startAfter'].includes(property) ? wrap(result) : result; } : value;
    } });
    const database = new Proxy(f.db, { get(target, property) {
      if (property === 'collection') return name => name === 'sessions' ? wrap(target.collection(name)) : target.collection(name);
      const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(createTeamAgentMemoryApi(issued.key, database).list('alice', {})); assert.equal(intercepted, true);
  });

  test('agent vault legacy personal grants cannot be promoted by changing session authority', async () => {
    const f = await seedAgentVaultFixture(), exchange = await f.code('personal');
    const grant = (await f.db.collection('agentGrants').get()).docs[0], code = (await f.db.collection('agentAuthorizationCodes').get()).docs[0];
    await grant.ref.update({ vault: admin.firestore.FieldValue.delete() }); await code.ref.update({ vault: admin.firestore.FieldValue.delete() });
    const token = await redeemAgentAuthorizationCode(exchange, f.db, 1001), session = (await f.db.collection('agentSessions').get()).docs[0];
    await session.ref.update({ vault: admin.firestore.FieldValue.delete() });
    assert.deepEqual((await verifyAgentSession(token.access_token, f.db, 1002)).vault, { kind: 'personal' });
    const team = await f.issue();
    await session.ref.update({ vault: team.key.vault }); assert.equal(await verifyAgentSession(token.access_token, f.db, 1002), null);
    assert.ok(await verifyAgentSession(team.token.access_token, f.db, 1002));
  });

  test('agent vault team codes and tokens cannot use legacy personal prefixes', async () => {
    const f = await seedAgentVaultFixture(), exchange = await f.code(), hash = value => createHash('sha256').update(value).digest('hex');
    assert.equal(exchange.code.startsWith('mne_vault_code_'), true);
    const code = await f.db.doc('agentAuthorizationCodes/' + hash(exchange.code)).get();
    const legacyCode = exchange.code.replace('mne_vault_code_', 'mne_code_');
    await f.db.doc('agentAuthorizationCodes/' + hash(legacyCode)).set(code.data());
    await assert.rejects(redeemAgentAuthorizationCode({ ...exchange, code: legacyCode }, f.db, 1001));
    const token = await redeemAgentAuthorizationCode(exchange, f.db, 1001);
    assert.equal(token.access_token.startsWith('mne_vault_'), true);
    const session = await f.db.doc('agentSessions/' + hash(token.access_token)).get();
    const legacyToken = token.access_token.replace('mne_vault_', 'mne_agent_');
    await f.db.doc('agentSessions/' + hash(legacyToken)).set(session.data());
    assert.equal(await verifyAgentSession(legacyToken, f.db, 1002), null);
    assert.ok(await verifyAgentSession(token.access_token, f.db, 1002));
  });

  test('agent vault byte limits preserve pagination and bound large encrypted search results', async () => {
    const f = await seedAgentVaultFixture();
    for (let i = 0; i < 18; i++) await f.db.doc('sessions/large-team-' + i).set({ ...f.note, timestamp: 2000 + i, enc: { ...f.note.enc, ct: 'A'.repeat(600_000) } });
    const issued = await f.issue(), api = createTeamAgentMemoryApi(issued.key, f.db), ids = []; let cursor;
    do {
      const page = await api.list('alice', { limit: 100, startAfter: cursor });
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < AGENT_TEAM_RESULT_BYTES + 1024);
      ids.push(...page.memories.map(row => row.id)); cursor = page.nextStartAfter;
      assert.ok(ids.length <= 20);
    } while (cursor);
    assert.equal(ids.length, 20); assert.equal(new Set(ids).size, 20);
    const searched = await api.search('alice', { limit: 20 });
    assert.ok(Buffer.byteLength(JSON.stringify(searched)) < AGENT_TEAM_RESULT_BYTES + 2048);
    assert.equal(searched.results.length, 5); assert.match(searched.tradeoff, /8 MiB/);
  });

  test('OAuth PKCE binds consent, one-use code, client, redirect, verifier and current revocation', async () => {
    const db = admin.firestore();
    const verifier = 'v'.repeat(43);
    const input = { response_type: 'code', client_id: 'synthetic-client', redirect_uri: 'https://client.example/callback',
      scope: 'memories:read memories:search', state: 'synthetic-state-0123456789',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' };
    const client = { name: 'Synthetic integration', enabled: true, redirectUris: [input.redirect_uri], scopes: ['memories:read', 'memories:search'] };
    await db.doc('users/alice').set({ displayName: 'Alice' });
    await db.doc('users/bob').set({ displayName: 'Bob' });
    await db.doc('agentClients/synthetic-client').set(client);
    const preview = await executePreviewAgentAuthorization('alice', input, db);
    await assert.rejects(executePreviewAgentAuthorization('alice', { ...input, redirect_uri: input.redirect_uri + '/' }, db));
    const consent = { ...input, confirmed: true, expectedUid: 'alice', consentDigest: preview.consentDigest };
    await assert.rejects(executeAuthorizeAgentClient('alice', { ...consent, confirmed: false }, db, 1000));
    await assert.rejects(executeAuthorizeAgentClient('bob', consent, db, 1000));
    await db.doc('agentClients/synthetic-client').update({ name: 'Changed identity' });
    await assert.rejects(executeAuthorizeAgentClient('alice', consent, db, 1000));
    await db.doc('agentClients/synthetic-client').set(client);
    const issued = await executeAuthorizeAgentClient('alice', consent, db, 1000);
    const callback = new URL(issued.redirectUrl);
    assert.equal(callback.searchParams.get('state'), input.state);
    assert.equal(callback.searchParams.get('iss'), 'https://mnemosyne-one.web.app');
    const code = callback.searchParams.get('code');
    const exchange = { grant_type: 'authorization_code', client_id: input.client_id, redirect_uri: input.redirect_uri, code, code_verifier: verifier };
    for (const change of [{ code_verifier: 'w'.repeat(43) }, { client_id: 'different-client' }, { redirect_uri: input.redirect_uri + '/' }]) {
      await assert.rejects(redeemAgentAuthorizationCode({ ...exchange, ...change }, db, 1001));
    }
    const results = await Promise.allSettled([redeemAgentAuthorizationCode(exchange, db, 1001), redeemAgentAuthorizationCode(exchange, db, 1001)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await db.collection('agentAuthorizationCodes').get()).size, 0);
    const token = results.find(r => r.status === 'fulfilled').value;
    assert.equal(token.expires_in, 900);
    const verified = await verifyAgentSession(token.access_token, db, 1002);
    assert.equal(verified.credentialKind, 'agent-grant');
    assert.equal((await db.collection('apiKeys').get()).size, 0);
    const grantId = verified.id;
    assert.equal((await executeListAgentGrants('bob', db)).grants.length, 0);
    assert.equal((await executeListAgentGrants('alice', db)).grants[0].id, grantId);
    await assert.rejects(executeRevokeAgentGrant('bob', { grantId }, db));
    const alice = testEnv.authenticatedContext('alice').firestore();
    for (const collection of ['agentClients', 'agentGrants', 'agentSessions']) {
      const doc = (await db.collection(collection).get()).docs[0];
      await assertFails(alice.doc(doc.ref.path).get());
      await assertFails(alice.doc(doc.ref.path).update({ revoked: false }));
    }
    const sessions = await db.collection('agentSessions').get();
    const events = await db.collection('users/alice/agentEvents').get();
    const stored = JSON.stringify([...sessions.docs, ...events.docs].map(doc => doc.data()));
    assert.equal(stored.includes(token.access_token), false);
    assert.equal(stored.includes(verifier), false);
    assert.equal(stored.includes(code), false);
    await executeRevokeAgentGrant('alice', { grantId }, db);
    assert.equal(await verifyAgentSession(token.access_token, db, 1003), null);
    // New explicit consent is required; old token remains invalid after re-consent.
    const issueNext = async (at) => {
      const p = await executePreviewAgentAuthorization('alice', input, db);
      const r = await executeAuthorizeAgentClient('alice', { ...consent, consentDigest: p.consentDigest }, db, at);
      return { ...exchange, code: new URL(r.redirectUrl).searchParams.get('code') };
    };
    const next = await issueNext(2000);
    const nextToken = await redeemAgentAuthorizationCode(next, db, 2001);
    assert.equal(await verifyAgentSession(token.access_token, db, 2002), null);
    assert.ok(await verifyAgentSession(nextToken.access_token, db, 2002));
    await db.doc('agentClients/synthetic-client').update({ scopes: ['memories:read'] });
    assert.equal(await verifyAgentSession(nextToken.access_token, db, 2002), null);
    await db.doc('agentClients/synthetic-client').set(client);
    await setAgentAccessForTest('alice', true, db);
    await assert.rejects(executePreviewAgentAuthorization('alice', input, db));
    await setAgentAccessForTest('alice', false, db);
    assert.equal(await verifyAgentSession(nextToken.access_token, db, 2002), null);
    const expiring = await issueNext(3000);
    await assert.rejects(redeemAgentAuthorizationCode(expiring, db, 3000 + AGENT_AUTHORIZATION_LIFETIME_MS));
    const revokedCode = await issueNext(4000);
    await executeRevokeAgentGrant('alice', { grantId }, db);
    await assert.rejects(redeemAgentAuthorizationCode(revokedCode, db, 4001));
    const codeBeforeStop = await issueNext(5000);
    await setAgentAccessForTest('alice', true, db);
    await setAgentAccessForTest('alice', false, db);
    await assert.rejects(redeemAgentAuthorizationCode(codeBeforeStop, db, 5001));
    const clientDisabled = await issueNext(6000);
    await db.doc('agentClients/synthetic-client').update({ enabled: false });
    await assert.rejects(redeemAgentAuthorizationCode(clientDisabled, db, 6001));
    await db.doc('agentClients/synthetic-client').set(client);
    const beforeDeletion = await issueNext(7000);
    const liveToken = await redeemAgentAuthorizationCode(beforeDeletion, db, 7001);
    assert.ok(await verifyAgentSession(liveToken.access_token, db, 7002));
    const eventCount = (await db.collection('users/alice/agentEvents').get()).size;
    await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' });
    assert.equal(await verifyAgentSession(liveToken.access_token, db, 7002), null);
    await assert.rejects(executePreviewAgentAuthorization('alice', input, db));
    await assert.rejects(executeListAgentGrants('alice', db));
    await assert.rejects(executeRevokeAgentGrant('alice', { grantId }, db));
    await assert.rejects(setAgentAccessForTest('alice', true, db), { code: 'failed-precondition' });
    assert.equal((await db.collection('users/alice/agentEvents').get()).size, eventCount);
    await db.doc('users/alice').update({ deletionState: 'deleting' });
    await assert.rejects(redeemAgentAuthorizationCode(clientDisabled, db, 6001));
    const pendingCodes = await db.collection('agentAuthorizationCodes').get();
    await assertFails(alice.doc(pendingCodes.docs[0].ref.path).get());
  });

  test('OAuth consent cap is atomic and revoked history cannot hide active applications', async () => {
    const db = admin.firestore();
    await db.doc('users/alice').set({ displayName: 'Alice' });
    const { MAX_ACTIVE_AGENT_GRANTS } = require('../lib/agentOAuth');
    const batch = db.batch();
    for (let i = 0; i < MAX_ACTIVE_AGENT_GRANTS - 1; i++) {
      batch.set(db.doc(`agentGrants/${'0'.repeat(61)}${String(i).padStart(3, '0')}`), { uid: 'alice', revoked: false,
        name: 'Synthetic existing', clientId: `existing-${i}`, scopes: ['memories:read'], createdAt: 1 });
    }
    for (let i = 0; i < 110; i++) {
      batch.set(db.doc(`agentGrants/revoked-history-${i}`), { uid: 'alice', revoked: true });
    }
    const requests = ['synthetic-limit-a', 'synthetic-limit-b'].map(client_id => ({ client_id, response_type: 'code',
      redirect_uri: 'https://client.example/callback', scope: 'memories:read', state: 'synthetic-state-0123456789',
      code_challenge: createHash('sha256').update('v'.repeat(43)).digest('base64url'), code_challenge_method: 'S256' }));
    for (const r of requests) batch.set(db.doc(`agentClients/${r.client_id}`), { name: 'Synthetic', enabled: true,
      redirectUris: [r.redirect_uri], scopes: ['memories:read'] });
    await batch.commit();
    const previews = await Promise.all(requests.map(r => executePreviewAgentAuthorization('alice', r, db)));
    const attempts = await Promise.allSettled(requests.map((r, i) => executeAuthorizeAgentClient('alice', {
      ...r, confirmed: true, expectedUid: 'alice', consentDigest: previews[i].consentDigest }, db, 1000)));
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(r => r.status === 'rejected').reason.code, 'resource-exhausted');
    const listed = (await executeListAgentGrants('alice', db)).grants;
    assert.equal(listed.length, MAX_ACTIVE_AGENT_GRANTS);
    assert.ok(listed.some(g => g.clientId.startsWith('synthetic-limit')));
  });

  test('supersession ledger commits with the archive, deduplicates concurrent replay and denies foreign SDK reads',async()=>{
    const f=await revisionFixture();await Promise.all([f.call('apply'),f.call('apply')]);
    const events=await f.db.collection('users/alice/memoryEvents').get();assert.equal(events.size,1);const event=events.docs[0].data();
    assert.equal(event.kind,'supersede');assert.equal(event.source,'personal-revision');assert.equal(event.previousRevision,10);assert.equal(event.revision,1000);
    assert((await f.ref.collection('versions').doc(event.versionId).get()).exists);assert.deepEqual(Object.keys(event).sort(),['schemaVersion','kind','memoryId','previousRevision','revision','versionId','occurredAt','recordedAt','source'].sort());
    const alice=testEnv.authenticatedContext('alice').firestore(),bob=testEnv.authenticatedContext('bob').firestore(),p=events.docs[0].ref.path;
    await assertSucceeds(alice.doc(p).get());await assertFails(bob.doc(p).get());await assertFails(alice.doc(p).update({revision:2000}));await assertFails(alice.doc(p).delete());
    await f.db.doc('accountDeletions/alice').set({status:'complete'});await assert.rejects(f.call('apply'),{code:'permission-denied'});assert.equal((await f.db.collection('users/alice/memoryEvents').get()).size,1);
  });

  test('supersession collision aborts archive, receipt, budget and memory atomically',async()=>{
    const f=await revisionFixture(),id=createHash('sha256').update(JSON.stringify(['supersede-v1','personal-revision',f.input.operationId,f.input.baseline.sessionId])).digest('hex');
    await f.db.doc('users/alice/memoryEvents/'+id).set({occupied:true});const before=(await f.ref.get()).data();await assert.rejects(f.call('apply'));
    assert.deepEqual((await f.ref.get()).data(),before);assert.equal((await f.ref.collection('versions').get()).size,0);assert.equal((await f.db.collection('personalRevisions').get()).size,0);assert.equal((await f.db.collection('personalRevisionBudgets').get()).size,0);
  });

  test('team and generic editor supersessions reference their exact archived versions',async()=>{
    const f=await teamRevisionFixture();await Promise.all([f.call('apply'),f.call('apply')]);let events=(await f.db.collection('users/alice/memoryEvents').get()).docs.map(doc=>doc.data());assert.equal(events.length,1);assert.equal(events[0].source,'team-revision');assert((await f.ref.collection('versions').doc(events[0].versionId).get()).exists);
    const g=await memoryEditorFixture();await g.call('apply');events=(await g.db.collection('users/alice/memoryEvents').get()).docs.map(doc=>doc.data());const edited=events.filter(row=>row.source==='memory-edit');assert.equal(edited.length,1);assert.equal(edited[0].memoryId,g.ref.id);assert((await g.ref.collection('versions').doc(edited[0].versionId).get()).exists);
  });


  test('memory ledger is private, immutable, deduplicated and stops at account deletion', async () => {
    const db = admin.firestore();
    await db.doc('users/alice').set({ displayName: 'Alice' });
    const input = { eventId: 'event-1', occurredAt: '2026-09-26T10:00:00Z', memoryId: 'm1', kinds: ['write'] };
    await Promise.all([recordMemoryEvents(db, 'alice', input), recordMemoryEvents(db, 'alice', input)]);
    const events = await db.collection('users/alice/memoryEvents').get();
    assert.equal(events.size, 1);
    const eventPath = events.docs[0].ref.path;
    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(alice.doc(eventPath).get());
    await assertFails(bob.doc(eventPath).get());
    await assertFails(alice.doc(eventPath).update({ kind: 'delete' }));
    await assertFails(alice.doc(eventPath).delete());
    await assertFails(alice.doc('users/alice/memoryEvents/forged').set({ kind: 'write' }));
    await db.doc('users/alice').update({ deletionState: 'deleting' });
    await recordMemoryEvents(db, 'alice', { ...input, eventId: 'event-2' });
    await events.docs[0].ref.delete();
    await db.doc('users/alice').delete();
    await recordMemoryEvents(db, 'alice', { ...input, eventId: 'event-3' });
    assert.equal((await db.collection('users/alice/memoryEvents').get()).size, 0);
  });

  test('gateway stop blocks keys and sessions; resume never resurrects old sessions', async () => {
    const db = admin.firestore();
    const generated = generateApiKey(1000);
    const parent = { id: generated.keyHash, uid: 'alice', name: 'synthetic', scopes: ['memories:read'],
      createdAt: 1000, revoked: false, lastUsedAt: null, keyPrefix: generated.keyPrefix };
    await db.doc(`apiKeys/${parent.id}`).set(parent);
    await db.doc('users/alice').set({ displayName: 'Alice' });
    await db.doc('users/bob').set({ displayName: 'Bob' });
    const session = await issueAgentSession(parent, undefined, db, 1001);
    assert.ok(await verifyApiKeySecret(generated.secret, db));
    await assert.rejects(setAgentAccess.run({ disabled: true }, {}), { code: 'unauthenticated' });
    await assert.rejects(executeSetAgentAccess('alice', 'true', db), { code: 'invalid-argument' });
    // A delayed Alice command must not bind to Bob's newer Firebase token.
    await assert.rejects(setAgentAccess.run({ expectedUid: 'alice', disabled: true,
      baseline: { disabled: false, epoch: 0 } }, { auth: { uid: 'bob' } }), { code: 'failed-precondition' });
    assert.equal((await db.doc('users/bob').get()).data().agentAccessDisabled, undefined);
    assert.equal((await db.collection('users/bob/agentEvents').get()).size, 0);
    assert.ok(await verifyApiKeySecret(generated.secret, db));
    await setAgentAccessForTest('alice', true, db);
    assert.equal(await verifyApiKeySecret(generated.secret, db), null);
    assert.equal(await verifyAgentSession(session.access_token, db, 1002), null);
    await assert.rejects(issueAgentSession(parent, undefined, db, 1002));
    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(alice.doc('users/alice').update({ agentAccessDisabled: false }));
    await assertFails(alice.doc('users/alice').update({ agentAccessEpoch: 0 }));
    await assertFails(alice.doc('users/alice').delete());
    await assertFails(bob.doc('users/alice').get());
    await setAgentAccessForTest('alice', false, db);
    const events = await db.collection('users/alice/agentEvents').get();
    assert.deepEqual(events.docs.map(doc => doc.data().kind).sort(), ['access-resumed', 'access-stopped', 'session-issued']);
    assert.equal(JSON.stringify(events.docs.map(doc => doc.data())).includes(generated.secret), false);
    const eventPath = events.docs[0].ref.path;
    await assertSucceeds(alice.doc(eventPath).get());
    await assertFails(bob.doc(eventPath).get());
    await assertFails(alice.doc(eventPath).delete());
    assert.ok(await verifyApiKeySecret(generated.secret, db));
    assert.equal(await verifyAgentSession(session.access_token, db, 1003), null);
    const newSession = await issueAgentSession(parent, undefined, db, 1003);
    assert.ok(await verifyAgentSession(newSession.access_token, db, 1004));
    await db.doc('users/alice').update({ deletionState: 'deleting' });
    assert.equal(await verifyApiKeySecret(generated.secret, db), null);
    await assert.rejects(setAgentAccessForTest('alice', true, db), { code: 'failed-precondition' });
  });

  test('agent account stale resume cannot reopen a newer stop and concurrent commands commit once', async () => {
    const db = admin.firestore(); await db.doc('users/alice').set({});
    const stop = { expectedUid: 'alice', disabled: true, baseline: { disabled: false, epoch: 0 } };
    const race = await Promise.allSettled([executeSetAgentAccess('alice', stop, db), executeSetAgentAccess('alice', stop, db)]);
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(race.find(result => result.status === 'rejected').reason.code, 'failed-precondition');
    assert.equal((await db.collection('users/alice/agentEvents').get()).size, 1);
    const resume = { expectedUid: 'alice', disabled: false, baseline: { disabled: true, epoch: 1 } };
    await executeSetAgentAccess('alice', resume, db);
    await setAgentAccessForTest('alice', true, db);
    await assert.rejects(executeSetAgentAccess('alice', resume, db), { code: 'failed-precondition' });
    const profile = (await db.doc('users/alice').get()).data();
    assert.equal(profile.agentAccessDisabled, true); assert.equal(profile.agentAccessEpoch, 2);
    const events = await db.collection('users/alice/agentEvents').get(); assert.equal(events.size, 3);
    assert.deepEqual(events.docs.map(row => row.data().accessEpoch).sort(), [1, 1, 2]);
    assert.ok(events.docs.every(row => row.data().schemaVersion === 2));
  });

  test('agent account corrupt state and epoch overflow cannot alter the profile or ledger', async () => {
    const db = admin.firestore();
    for (const epoch of [null, -1, '1', Number.MAX_SAFE_INTEGER]) {
      await db.doc('users/alice').set({ agentAccessDisabled: false, agentAccessEpoch: epoch });
      const baseline = { disabled: false, epoch: typeof epoch === 'number' && epoch >= 0 ? epoch : 0 };
      await assert.rejects(executeSetAgentAccess('alice', { expectedUid: 'alice', disabled: true, baseline }, db), { code: 'failed-precondition' });
      assert.equal((await db.doc('users/alice').get()).data().agentAccessEpoch, epoch);
    }
    assert.equal((await db.collection('users/alice/agentEvents').get()).size, 0);
  });

  test('agent sessions expire, narrow scopes, inherit revocation and are inaccessible to clients', async () => {
    const db = admin.firestore();
    const parent = { id: 'a'.repeat(64), uid: 'alice', name: 'test', scopes: ['memories:read'], createdAt: 1,
      revoked: false, lastUsedAt: null, keyPrefix: 'mne_live_test' };
    await db.doc(`apiKeys/${parent.id}`).set(parent);
    await db.doc('users/alice').set({ displayName: 'Alice' });
    await assert.rejects(issueAgentSession(parent, ['memories:search'], db, 1000));
    await assert.rejects(issueAgentSession(parent, ['memories:write'], db, 1000));
    const issued = await issueAgentSession(parent, ['memories:read'], db, 1000);
    assert.equal(issued.expires_in, 900);
    const records = await db.collection('agentSessions').get();
    assert.equal(records.size, 1);
    assert.equal(JSON.stringify(records.docs[0].data()).includes(issued.access_token), false);
    const authorized = await verifyAgentSession(issued.access_token, db, 1001);
    assert.equal(authorized.id, parent.id);
    assert.deepEqual(authorized.scopes, ['memories:read']);
    assert.equal(await verifyAgentSession(issued.access_token, db, 1000 + AGENT_TOKEN_LIFETIME_MS), null);
    await assert.rejects(issueAgentSession(authorized, ['memories:read'], db, 1001));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc(records.docs[0].ref.path).get());
    await assertFails(alice.doc(records.docs[0].ref.path).update({ expiresAt: 9999999999999 }));
    await db.doc('users/alice').update({ agentAccessDisabled: true });
    assert.equal(await verifyAgentSession(issued.access_token, db, 1001), null);
    await assert.rejects(issueAgentSession(parent, ['memories:read'], db, 1001));
    await db.doc('users/alice').update({ agentAccessDisabled: false });
    await db.doc(`apiKeys/${parent.id}`).update({ revoked: true });
    assert.equal(await verifyAgentSession(issued.access_token, db, 1001), null);
    await db.doc(`apiKeys/${parent.id}`).update({ revoked: false, scopes: ['memories:search'] });
    assert.equal(await verifyAgentSession(issued.access_token, db, 1001), null);
  });

  test('API retrieval ledger records only operation and result count, including empty and forbidden results', async () => {
    const db = admin.firestore();
    await db.doc('users/alice').set({ displayName: 'Alice' });
    await db.doc('sessions/personal').set({ uid: 'alice', teamId: null, timestamp: 1, tags: ['private-tag'] });
    await db.doc('sessions/team').set({ uid: 'alice', teamId: 'crew', timestamp: 2 });
    const api = createFirestoreMemoryApi(db);
    await api.list('alice', {});
    assert.equal(await api.get('alice', 'team'), null);
    await api.get('alice', 'personal');
    await api.search('alice', { tags: ['missing-private-query'] });
    const events = (await db.collection('users/alice/memoryEvents').get()).docs.map(doc => doc.data());
    assert.equal(events.length, 4);
    assert.deepEqual(events.map(event => `${event.operation}:${event.resultCount}`).sort(), ['get:0', 'get:1', 'list:1', 'search:0']);
    for (const event of events) {
      assert.equal(event.kind, 'retrieve');
      assert.deepEqual(Object.keys(event).sort(), ['schemaVersion', 'kind', 'operation', 'resultCount', 'occurredAt', 'recordedAt', 'source'].sort());
    }
    await db.doc('users/alice').update({ deletionState: 'deleting' });
    await assert.rejects(api.list('alice', {}), { name: 'AccountUnavailableError' });
    assert.equal((await db.collection('users/alice/memoryEvents').get()).size, 4);
  });

  test("SDK session creation is closed for both plaintext and encrypted payloads", async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('sessions/plain').set({
      uid: 'alice',
      teamId: null,
      text: 'hello',
    }));
    await assertFails(alice.doc('sessions/cipher').set({
      uid: 'alice',
      teamId: null,
      text: '',
      title: null,
      enc: { v: 1, iv: 'abc', ct: 'xyz' },
    }));
    await assertFails(alice.doc('sessions/bad-enc').set({
      uid: 'alice',
      teamId: null,
      text: '',
      title: null,
      enc: { foo: 'bar' },
    }));
    for (const invalidEnc of [
      { v: 2, iv: 'abc', ct: 'xyz' },
      { v: 1, iv: '', ct: 'xyz' },
      { v: 1, iv: 'abc', ct: '' },
    ]) {
      await assertFails(alice.collection('sessions').add({
        uid: 'alice', teamId: null, text: '', title: null, enc: invalidEnc,
      }));
    }
    await assertFails(alice.doc('sessions/enc-with-leak').set({
      uid: 'alice',
      teamId: null,
      text: 'still plaintext',
      title: null,
      enc: { v: 1, iv: 'abc', ct: 'xyz' },
    }));
    for (const leakedField of [
      { title: 'private title' },
      { generatedPrompt: 'private prompt' },
      { generatedImagePrompt: 'private image prompt' },
      { webResearch: { query: 'private search' } },
      { webResearch: { keyConcepts: ['private concept'] } },
      { webResearch: { sources: [{ url: 'https://example.com/?q=private' }] } },
      { attachments: [{ url: 'data:text/plain,private' }] },
    ]) {
      await assertFails(alice.collection('sessions').add({
        uid: 'alice', teamId: null, text: '', title: null,
        enc: { v: 1, iv: 'abc', ct: 'xyz' },
        ...leakedField,
      }));
    }
  });

  test("owner cannot bypass the server migration archive by replacing legacy plaintext directly", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('sessions/legacy-migrate').set({
        uid: 'alice', teamId: null, text: 'synthetic legacy', title: 'synthetic title', updatedAt: 1,
      });
    });
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('sessions/legacy-migrate').update({
      text: '', title: null, enc: { v: 1, iv: 'iv', ct: 'ct' },
    }));
    await assertFails(alice.doc('sessions/legacy-migrate').update({
      enc: { v: 1, iv: '', ct: 'ct' },
    }));
    const migrated = await assertSucceeds(alice.doc('sessions/legacy-migrate').get());
    assert.equal(migrated.data().text, 'synthetic legacy');
    assert.equal(migrated.data().title, 'synthetic title');
    assert.equal(migrated.data().updatedAt, 1);
  });

  test("legacy shared editors may read but cannot mutate content embeddings or ownership by SDK", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('sessions/shared').set({
        uid: 'alice',
        teamId: null,
        text: 'hello',
        sharedWithIds: ['bob'],
      });
    });

    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('sessions/shared').update({
      text: '',
      title: null,
      enc: { v: 1, iv: 'iv', ct: 'ct' },
      updatedAt: 2,
    }));
    await assertFails(bob.doc('sessions/shared').update({
      embedding: [1, 0],
      embeddingModel: 'Xenova/all-MiniLM-L6-v2@legacy-main',
    }));
    await assertFails(bob.doc('sessions/shared').update({ text: 'plaintext leak' }));
    await assertFails(bob.doc('sessions/shared').update({ generatedImagePrompt: 'plaintext prompt' }));
    await assertFails(bob.doc('sessions/shared').update({ webResearch: { query: 'plaintext search' } }));
    await assertFails(bob.doc('sessions/shared').update({
      uid: 'bob',
    }));
  });

  test('sync-conflict encrypted resolution archives and tombstones atomically; plaintext, foreign owners and late deletion fail', async () => {
    const f=await syncDecisionFixture(),alice=testEnv.authenticatedContext('alice').firestore();
    const unsafe=alice.batch();unsafe.update(alice.doc('sessions/o'),{text:'Synthetic plaintext',title:'Synthetic title'});unsafe.delete(alice.doc('sessions/c'));await assertFails(unsafe.commit());
    const sdk=alice.batch();sdk.set(alice.doc('sessions/o/versions/forged'),{enc:f.before[0].enc,text:'',title:null,editorUid:'alice',createdAt:1000});sdk.update(alice.doc('sessions/o'),{enc:f.before[1].enc,updatedAt:1000});sdk.update(alice.doc('sessions/c'),{deletedAt:1000,updatedAt:1000});await assertFails(sdk.commit());
    assert.deepEqual((await f.db.doc('sessions/o').get()).data(),f.before[0]);assert.deepEqual((await f.db.doc('sessions/c').get()).data(),f.before[1]);assert.equal((await f.db.doc('sessions/o/versions/forged').get()).exists,false);
    assert.equal((await f.call('apply')).status,'committed');
    const archive=(await f.db.doc('sessions/o/versions/sync-conflict-'+f.request.operationId).get()).data();assert.deepEqual(archive.enc,f.before[0].enc);assert.deepEqual(archive.attachments,f.before[0].attachments);
    const result=(await f.db.doc('sessions/o').get()).data();assert.equal(result.text,'');assert.equal(result.title,null);assert.deepEqual(result.enc,f.before[1].enc);assert.deepEqual(result.attachments,f.before[0].attachments);assert.equal((await f.db.doc('sessions/c').get()).data().deletedAt,1000);
    for(const mode of ['plaintext','foreign','late']){
      const rejected=await syncDecisionFixture();
      if(mode==='plaintext')await rejected.db.doc('sessions/c').update({text:'Synthetic plaintext'});
      if(mode==='foreign')await rejected.db.doc('sessions/c').update({uid:'bob'});
      if(mode==='late')await rejected.db.doc('accountDeletions/alice').set({status:'deleting'});
      await assert.rejects(rejected.call('apply'));
      assert.deepEqual((await rejected.db.doc('sessions/o').get()).data(),rejected.before[0]);assert.equal((await rejected.db.doc('sessions/o/versions/sync-conflict-'+rejected.request.operationId).get()).exists,false);assert.equal((await rejected.db.doc('sessions/c').get()).data().deletedAt,undefined);
    }
  });

  test("SDK cannot create either encrypted or plaintext history outside a server revision", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('sessions/s1').set({
        uid: 'alice',
        teamId: null,
        text: 'hello',
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('sessions/s1/versions/v1').set({
      text: '',
      title: null,
      enc: { v: 1, iv: 'iv', ct: 'ct' },
      embedding: [1, 0],
      embeddingModel: 'Xenova/all-MiniLM-L6-v2@legacy-main',
      previousUpdatedAt: 1,
      createdAt: 2,
      editorUid: 'alice',
    }));
    await assertFails(alice.doc('sessions/s1/versions/v2').set({
      text: 'plain',
      previousUpdatedAt: 1,
      createdAt: 2,
      editorUid: 'alice',
    }));
    await assertFails(alice.doc('sessions/s1/versions/v3').set({
      text: { v: 1, iv: 'abc', ct: 'xyz' },
      previousUpdatedAt: 1,
      createdAt: 2,
      editorUid: 'alice',
    }));
    await assertFails(alice.doc('sessions/s1/versions/v4').set({
      text: '', title: null,
      enc: { v: 2, iv: 'iv', ct: 'ct' },
      previousUpdatedAt: 1,
      createdAt: 2,
      editorUid: 'alice',
    }));
  });

  test('shares SDK counters are closed even on encrypted capsules', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('shares/enc').set(encryptedShare);
      await ctx.firestore().doc('shares/plain').set({
        uid: 'alice',
        encrypted: false,
        sessionId: 'sess-1',
        views: 0,
        text: 'leaked',
      });
    });

    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(anon.doc('shares/enc').update({ views: 1 }));
    await assertFails(anon.doc('shares/plain').update({ views: 1 }));
    await assertFails(anon.doc('shares/enc').update({ views: 2, importCount: 9 }));
  });

  test('publicProfiles allow authenticated get but deny list', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('publicProfiles/bob').set({
        uid: 'bob',
        displayName: 'Bob',
        emailHash: 'abc',
        publicKeyPem: 'pem',
        publicKeyUpdatedAt: 1,
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('publicProfiles/bob').get());
    await assertFails(alice.collection('publicProfiles').get());
    await assertFails(testEnv.unauthenticatedContext().firestore().doc('publicProfiles/bob').get());
  });

  test('config/monetization is readable by auth and never writable by clients', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('config/monetization').set({ mode: 'free-first' });
      await ctx.firestore().doc('config/other').set({ secret: true });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('config/monetization').get());
    await assertFails(alice.doc('config/monetization').set({ mode: 'paid' }));
    await assertFails(alice.doc('config/other').get());
    await assertFails(testEnv.unauthenticatedContext().firestore().doc('config/monetization').get());
  });

  test('apiKeys owner can get own doc, cannot list or write', async () => {
    const aliceId = 'a'.repeat(64);
    const bobId = 'b'.repeat(64);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`apiKeys/${aliceId}`).set({
        uid: 'alice',
        name: 'ci',
        keyHash: aliceId,
        scopes: ['memories:read'],
        createdAt: 1,
        lastUsedAt: null,
        revoked: false,
        keyPrefix: 'mne_live_abcd',
      });
      await ctx.firestore().doc(`apiKeys/${bobId}`).set({
        uid: 'bob',
        name: 'other',
        keyHash: bobId,
        scopes: ['memories:read'],
        createdAt: 1,
        lastUsedAt: null,
        revoked: false,
        keyPrefix: 'mne_live_bbbb',
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(alice.doc(`apiKeys/${aliceId}`).get());
    await assertFails(alice.doc(`apiKeys/${bobId}`).get());
    await assertFails(alice.collection('apiKeys').where('uid', '==', 'alice').get());
    await assertFails(alice.doc(`apiKeys/${'c'.repeat(64)}`).set({
      uid: 'alice',
      name: 'forged',
    }));
    await assertFails(alice.doc(`apiKeys/${aliceId}`).update({ revoked: true }));
    await assertFails(bob.doc(`apiKeys/${aliceId}`).get());
  });

  test('entitlements are client-read-own and never client-writable', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('entitlements/alice').set({
        effectiveTier: 'pro',
        canUploadAttachments: true,
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(alice.doc('entitlements/alice').get());
    await assertFails(bob.doc('entitlements/alice').get());
    await assertFails(alice.doc('entitlements/alice').set({ effectiveTier: 'sovereign' }));
  });

  test('paid mode blocks free users after 30 memories this period', async () => {
    const now = new Date();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('config/monetization').set({ mode: 'paid' });
      await ctx.firestore().doc('users/alice').set({
        usage: {
          memoriesThisMonth: 30,
          periodYear: now.getUTCFullYear(),
          periodMonth: now.getUTCMonth() + 1,
        },
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('sessions/over').set({ uid: 'alice', text: 'nope' }));
  });

  test('storage: legacy paths deny uploads, raw reads and deletion even for the uploader', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.storage().ref('attachments/alice/old.png').put(Buffer.from('old-png'), {
        contentType: 'image/png',
      });
    });
    const alice = testEnv.authenticatedContext('alice');
    const file = alice.storage().ref('attachments/alice/pic.png');
    await assertFails(file.put(Buffer.from('png-bytes'), { contentType: 'image/png' }));
    await assertFails(alice.storage().ref('attachments/alice/old.png').getDownloadURL());
    await assertFails(testEnv.authenticatedContext('bob').storage().ref('attachments/alice/old.png').getDownloadURL());
    await assertFails(alice.storage().ref('attachments/alice/old.png').delete());
  });

  test('legacy-liveness refuses a new read for another author when the path namespace account is deleting or permanently revoked', async () => {
    const db = admin.firestore(); const bucket = 'synthetic.appspot.com'; const objectPath = 'attachments/alice/synthetic.pdf';
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=synthetic`;
    await db.doc('users/alice').set({}); await db.doc('users/bob').set({});
    await db.doc('sessions/other-author').set({ uid: 'bob', teamId: null, attachments: [{ url }] });
    const read = () => authorizeAttachmentRead('bob', objectPath, 'other-author', db, bucket);
    await read(); await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' });
    await assert.rejects(read(), { code: 'permission-denied' });
    await db.doc('accountDeletions/alice').update({ status: 'complete' }); await db.doc('users/alice').delete();
    await assert.rejects(read(), { code: 'permission-denied' });
    await db.doc('accountDeletions/alice').delete(); await db.doc('users/alice').set({ deletionState: 'deleting' });
    await assert.rejects(read(), { code: 'permission-denied' });
  });

  test('legacy-liveness refuses a team owner marker before membership freeze, a team deletion marker and a late signing result', async () => {
    const db = admin.firestore(); const bucket = 'synthetic.appspot.com'; const objectPath = 'attachments/alice/synthetic.pdf';
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=synthetic`;
    for (const uid of ['alice', 'bob', 'charlie']) await db.doc(`users/${uid}`).set({});
    await db.doc('teams/crew').set({ ownerUid: 'charlie', memberUids: ['bob', 'charlie'] });
    await db.doc('sessions/team-note').set({ uid: 'bob', teamId: 'crew', attachments: [{ url }] });
    const read = () => authorizeAttachmentRead('bob', objectPath, 'team-note', db, bucket);
    await read(); await db.doc('accountDeletions/charlie').set({ v: 1, status: 'deleting' });
    await assert.rejects(read(), { code: 'permission-denied' });
    await db.doc('accountDeletions/charlie').delete(); await db.doc('teamDeletions/crew').set({ v: 1, status: 'deleting' });
    await assert.rejects(read(), { code: 'permission-denied' }); await db.doc('teamDeletions/crew').delete();
    await db.doc('teams/crew').update({ ownerUid: admin.firestore.FieldValue.delete() });
    await assert.rejects(read(), { code: 'permission-denied' }); await db.doc('teams/crew').update({ ownerUid: 'charlie' });
    let signed = 0;
    const { mintAttachmentReadForUid } = require('../lib/attachmentAccess');
    await assert.rejects(mintAttachmentReadForUid({ sessionId: 'team-note', objectPath }, 'bob', { bucket, now: () => 1000,
      consumeRate: async () => true, exists: async () => true, authorize: async () => read(),
      sign: async () => { signed++; await db.doc('accountDeletions/alice').set({ v: 1, status: 'deleting' }); return 'synthetic-late-url'; } }), { code: 'permission-denied' });
    assert.equal(signed, 1); assert.equal((await db.doc('sessions/team-note').get()).exists, true);
  });

  test('attachment authorization binds the session and exact bucket/path, and uploader cannot bypass removal or tombstone', async () => {
    const db = admin.firestore(); const bucket = 'synthetic.appspot.com'; const objectPath = 'attachments/alice/synthetic.pdf';
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=synthetic`;
    await db.doc('users/alice').set({}); await db.doc('users/bob').set({});
    await db.doc('teams/crew').set({ ownerUid: 'bob', memberUids: ['bob'] });
    await db.doc('sessions/team-file').set({ uid: 'alice', teamId: 'crew', sharedWithIds: ['alice'], attachments: [{ url }] });
    const authorize = (uid, session = 'team-file') => authorizeAttachmentRead(uid, objectPath, session, db, bucket);
    await assert.rejects(authorize('alice'), { code: 'permission-denied' }); // uploader and original author removed
    await authorize('bob');
    await db.doc('teams/crew').update({ memberUids: [] }); await assert.rejects(authorize('bob'), { code: 'permission-denied' });
    await db.doc('teams/crew').update({ memberUids: ['bob'] });
    await db.doc('sessions/team-file').update({ deletedAt: 1 }); await assert.rejects(authorize('bob'), { code: 'permission-denied' });
    await db.doc('sessions/personal-file').set({ uid: 'alice', teamId: null, sharedWithIds: ['bob'], attachments: [{ url }] });
    await authorize('alice', 'personal-file'); await authorize('bob', 'personal-file');
    await assert.rejects(authorizeAttachmentRead('alice', 'attachments/alice/unreferenced.pdf', 'personal-file', db, bucket), { code: 'permission-denied' });
    await assert.rejects(authorizeAttachmentRead('alice', objectPath, 'personal-file', db, 'other-bucket'), { code: 'permission-denied' });
    await assert.rejects(authorize('alice', 'missing'), { code: 'permission-denied' });
    await db.doc('users/alice').update({ deletionState: 'deleting' }); await assert.rejects(authorize('alice', 'personal-file'), { code: 'permission-denied' });
    await db.doc('users/bob').delete(); await assert.rejects(authorize('bob', 'personal-file'), { code: 'permission-denied' });
  });

  test('storage: paid mode denies uploads without entitlements (missing == free)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('config/monetization').set({ mode: 'paid' });
    });

    const alice = testEnv.authenticatedContext('alice');
    const file = alice.storage().ref('attachments/alice/pic.png');
    await assertFails(file.put(Buffer.from('png-bytes'), { contentType: 'image/png' }));
  });

  test('encrypted attachment reservations are atomic, exact retries are free, cancellation holds quota until confirmed cleanup', async () => {
    const db = admin.firestore(); let now = 1000;
    const id = '11111111-1111-4111-8111-111111111111'; const otherId = '22222222-2222-4222-8222-222222222222';
    const header = { v: 1, id, uid: 'alice', scope: { kind: 'personal', uid: 'alice' }, category: 'document',
      plainBytes: 10, metadataBytes: 20, cipherBytes: 50, iv: 'A'.repeat(16), wrappedKey: { iv: 'B'.repeat(16), ct: 'C'.repeat(64) } };
    const size = encodeAttachmentHeader(header).length + header.cipherBytes; const deleted = [];
    await db.doc('users/alice').set({});
    await db.doc('config/attachmentSecurity').set({ writesEnabled: true, bucket: 'synthetic-private-bucket', userQuotaBytes: size * 2, teamQuotaBytes: size * 2 });
    const store = { signPost: async () => ({ url: 'synthetic-post', fields: {} }), removeExpiredPath: async path => { deleted.push(path); }, assertPathAbsent: async () => {} };
    const deps = { firestore: db, now: () => now, store: () => store };
    const concurrent = await Promise.allSettled([reserveAttachmentUpload('alice', header, deps), reserveAttachmentUpload('alice', { ...header, id: otherId }, deps)]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    const record = concurrent.find(result => result.status === 'fulfilled').value;
    await reserveAttachmentUpload('alice', record.header, deps);
    const quotas = await db.collection('attachmentQuotas').get(); assert.equal(quotas.size, 1);
    assert.equal(quotas.docs[0].data().reservedBytes, record.bytes * 2); assert.equal(quotas.docs[0].data().reservedFiles, 1);
    await assert.rejects(reserveAttachmentUpload('alice', { ...record.header, wrappedKey: { iv: 'C'.repeat(16), ct: 'D'.repeat(64) } }, deps));
    await assert.rejects(cancelAttachmentReservation('bob', record.header.id, deps), { code: 'permission-denied' });
    await db.doc('config/attachmentSecurity').update({ writesEnabled: false });
    assert.deepEqual(await cancelAttachmentReservation('alice', record.header.id, deps), { status: 'cancelled' });
    assert.equal((await quotas.docs[0].ref.get()).data().reservedBytes, record.bytes * 2);
    assert.equal(await cleanupAttachmentReservation(record.header.id, deps), false); assert.equal(deleted.length, 0);
    now += 181000;
    assert.equal(await cleanupAttachmentReservation(record.header.id, deps), true); assert.equal(await cleanupAttachmentReservation(record.header.id, deps), false);
    assert.equal((await quotas.docs[0].ref.get()).data().reservedBytes, 0); assert.equal(deleted.length, 2);
    await db.doc('config/attachmentSecurity').update({ writesEnabled: true });
    await assert.rejects(reserveAttachmentUpload('alice', record.header, deps)); // durable tombstone cannot resurrect
    const stranger = testEnv.authenticatedContext('alice').firestore();
    await assertFails(stranger.doc(`attachmentUploads/${record.header.id}`).get());
    await assertFails(stranger.doc(`attachmentUploads/${record.header.id}`).update({ status: 'ready' }));
    await assertFails(stranger.doc(`attachmentQuotas/${quotas.docs[0].id}`).get());
  });

  test('attachment quarantine binds actual envelope/size/generation, commits quota once, and refuses removed members or late publication', async () => {
    const db = admin.firestore(); let now = 1000; let copies = 0; let removes = 0;
    const id = '33333333-3333-4333-8333-333333333333'; const keyId = '44444444-4444-4444-8444-444444444444';
    const header = { v: 1, id, uid: 'bob', scope: { kind: 'team', teamId: 'crew', keyEpoch: 2, keyId }, category: 'image',
      plainBytes: 8, metadataBytes: 100, cipherBytes: 128, iv: 'A'.repeat(16), wrappedKey: { iv: 'B'.repeat(16), ct: 'C'.repeat(64) } };
    const prefix = encodeAttachmentHeader(header); const size = prefix.length + header.cipherBytes;
    await db.doc('users/bob').set({}); await db.doc('config/attachmentSecurity').set({ writesEnabled: true, bucket: 'synthetic-private-bucket' });
    await db.doc('teams/crew').set({ memberUids: ['bob'], wrappedKeys: { bob: {} }, keyRotationStatus: 'active', activeKeyEpoch: 2, activeKeyId: keyId });
    await db.doc('teams/crew/keyEpochs/2').set({ status: 'active', keyId, memberUids: ['bob'], wrappedKeys: { bob: {} } });
    const inspection = { generation: '100', size, contentType: 'application/octet-stream', prefix };
    let beforePromote = async () => {}; let failCleanup = false;
    const store = { signPost: async () => ({ url: 'synthetic-post', fields: {} }), inspect: async () => inspection,
      promote: async () => { copies++; await beforePromote(); return '200'; }, removeQuarantine: async () => {},
      removeExpiredPath: async () => { if (failCleanup) throw Error('synthetic'); removes++; }, assertPathAbsent: async () => {} };
    const deps = { firestore: db, now: () => now, store: () => store };
    await reserveAttachmentUpload('bob', header, deps);
    inspection.size++;
    await assert.rejects(finalizeAttachmentUpload('bob', id, deps)); assert.equal(copies, 0);
    inspection.size--; inspection.prefix = prefix.slice(); inspection.prefix[0] = 0;
    await assert.rejects(finalizeAttachmentUpload('bob', id, deps)); assert.equal(copies, 0); inspection.prefix = prefix;
    await db.doc('teams/crew').update({ memberUids: [] }); await assert.rejects(finalizeAttachmentUpload('bob', id, deps)); assert.equal(copies, 0);
    await db.doc('teams/crew').update({ memberUids: ['bob'] });
    await finalizeAttachmentUpload('bob', id, deps); await finalizeAttachmentUpload('bob', id, deps); assert.equal(copies, 1);
    const ready = (await db.doc(`attachmentUploads/${id}`).get()).data(); assert.equal(ready.status, 'ready'); assert.equal(ready.validation, 'encrypted-envelope-only');
    const quotas = await db.collection('attachmentQuotas').get(); assert.equal(quotas.size, 2);
    for (const item of quotas.docs) { assert.equal(item.data().reservedBytes, 0); assert.equal(item.data().storedBytes, size); assert.equal(item.data().cleanupBytes, size); }
    assert.deepEqual(await cancelAttachmentReservation('bob', id, deps), { status: 'ready' });
    now += 241000; failCleanup = true;
    await assert.rejects(cleanupAttachmentReservation(id, deps)); for (const item of quotas.docs) assert.equal((await item.ref.get()).data().cleanupBytes, size);
    failCleanup = false; assert.equal(await cleanupAttachmentReservation(id, deps), true); assert.equal(removes, 1);
    for (const item of quotas.docs) { assert.equal((await item.ref.get()).data().storedBytes, size); assert.equal((await item.ref.get()).data().cleanupBytes, 0); }
    const lateId = '55555555-5555-4555-8555-555555555555'; await reserveAttachmentUpload('bob', { ...header, id: lateId }, deps);
    const latePrefix = encodeAttachmentHeader({ ...header, id: lateId }); inspection.prefix = latePrefix; inspection.size = latePrefix.length + header.cipherBytes;
    beforePromote = async () => { await db.doc('teams/crew').update({ keyRotationStatus: 'rotation_pending' }); };
    await assert.rejects(finalizeAttachmentUpload('bob', lateId, deps)); assert.equal((await db.doc(`attachmentUploads/${lateId}`).get()).data().status, 'verifying');
    await cancelAttachmentReservation('bob', lateId, deps); now += 241000; await cleanupAttachmentReservation(lateId, deps);
    await db.doc('teams/crew').update({ keyRotationStatus: 'active' });
    const signedId = '66666666-6666-4666-8666-666666666666';
    store.signPost = async () => { await cancelAttachmentReservation('bob', signedId, deps); return { url: 'synthetic-post', fields: {} }; };
    await assert.rejects(issueAttachmentPost('bob', { ...header, id: signedId }, deps)); // late grant not returned after cancellation
    const expiresId = '77777777-7777-4777-8777-777777777777'; await reserveAttachmentUpload('bob', { ...header, id: expiresId }, deps);
    now += 901000; const swept = await sweepAttachmentReservations(deps); assert.equal(swept.expired, 1);
    now += 61000; const second = await sweepAttachmentReservations(deps); assert.equal(second.cleaned >= 1, true);
  });

  test('encrypted attachment read binds a ready registry, live personal/team session and historical epoch access with late revocation checks', async () => {
    const db = admin.firestore(); const id = '88888888-8888-4888-8888-888888888888'; const teamId = '99999999-9999-4999-8999-999999999999';
    const keyId = '44444444-4444-4444-8444-444444444444';
    const header = { v: 1, id, uid: 'alice', scope: { kind: 'personal', uid: 'alice' }, category: 'document',
      plainBytes: 10, metadataBytes: 20, cipherBytes: 50, iv: 'A'.repeat(16), wrappedKey: { iv: 'B'.repeat(16), ct: 'C'.repeat(64) } };
    let currentHeader = header;
    const store = { inspect: async () => ({ generation: '100', size: encodeAttachmentHeader(currentHeader).length + currentHeader.cipherBytes,
      contentType: 'application/octet-stream', prefix: encodeAttachmentHeader(currentHeader) }), promote: async () => '200', removeQuarantine: async () => {} };
    const deps = { firestore: db, now: () => 1000, store: () => store };
    await db.doc('users/alice').set({}); await db.doc('users/bob').set({});
    await db.doc('config/attachmentSecurity').set({ writesEnabled: true, readsEnabled: true, bucket: 'synthetic-private-bucket' });
    const note = db.doc('sessions/note'); await note.set({ uid: 'alice', teamId: null, attachments: [{ url: `mnemosyne-attachment:v1:${id}` }], sharedWithIds: ['bob'] });
    await reserveAttachmentUpload('alice', header, deps); await assert.rejects(authorizeEncryptedAttachmentRead('alice', id, 'note', db));
    await finalizeAttachmentUpload('alice', id, deps); assert.equal((await authorizeEncryptedAttachmentRead('alice', id, 'note', db)).storageGeneration, '200');
    await assert.rejects(authorizeEncryptedAttachmentRead('bob', id, 'note', db)); // no personal key sharing
    await note.update({ teamId: 'crew' }); await assert.rejects(authorizeEncryptedAttachmentRead('alice', id, 'note', db));
    await note.update({ teamId: null, deletedAt: 2 }); await assert.rejects(authorizeEncryptedAttachmentRead('alice', id, 'note', db));
    await note.update({ deletedAt: admin.firestore.FieldValue.delete(), attachments: [] }); await assert.rejects(authorizeEncryptedAttachmentRead('alice', id, 'note', db));
    currentHeader = { ...header, id: teamId, scope: { kind: 'team', teamId: 'crew', keyEpoch: 2, keyId } };
    const team = db.doc('teams/crew'); await team.set({ memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} }, keyRotationStatus: 'active', activeKeyEpoch: 2, activeKeyId: keyId });
    const epoch = db.doc('teams/crew/keyEpochs/2'); await epoch.set({ epoch: 2, status: 'active', keyId, memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} } });
    await reserveAttachmentUpload('alice', currentHeader, deps); await finalizeAttachmentUpload('alice', teamId, deps);
    await note.update({ teamId: 'crew', attachments: [{ url: `mnemosyne-attachment:v1:${teamId}` }] });
    await team.update({ activeKeyEpoch: 3, activeKeyId: id }); // historical file remains readable with valid historical wrap
    await authorizeEncryptedAttachmentRead('bob', teamId, 'note', db);
    await epoch.update({ memberUids: ['alice'] }); await assert.rejects(authorizeEncryptedAttachmentRead('bob', teamId, 'note', db));
    await epoch.update({ memberUids: ['alice', 'bob'] });
    const readerDeps = { now: () => 1000, consumeRate: async () => true, authorize: (uid, id, sessionId) => authorizeEncryptedAttachmentRead(uid, id, sessionId, db),
      sign: async () => { await team.update({ memberUids: ['bob'] }); return 'synthetic'; } };
    await assert.rejects(mintEncryptedAttachmentReadForUid({ id: teamId, sessionId: 'note' }, 'alice', readerDeps), { code: 'permission-denied' });
    await db.doc('config/attachmentSecurity').update({ readsEnabled: false }); await assert.rejects(authorizeEncryptedAttachmentRead('bob', teamId, 'note', db));
  });

  test('attachment association atomically archives exact state, binds CAS/list/scope and deduplicates late ACK after gate closure', async () => {
    const db = admin.firestore(); let now = 1000;
    const id = '11111111-1111-4111-8111-111111111111'; const secondId = '22222222-2222-4222-8222-222222222222'; const op = '33333333-3333-4333-8333-333333333333';
    const otherOp = '44444444-4444-4444-8444-444444444444';
    const header = { v: 1, id, uid: 'alice', scope: { kind: 'personal', uid: 'alice' }, category: 'document', plainBytes: 10, metadataBytes: 20, cipherBytes: 50,
      iv: 'A'.repeat(16), wrappedKey: { iv: 'B'.repeat(16), ct: 'C'.repeat(64) } };
    let currentHeader = header;
    const store = { inspect: async () => ({ generation: '100', size: encodeAttachmentHeader(currentHeader).length + currentHeader.cipherBytes,
      contentType: 'application/octet-stream', prefix: encodeAttachmentHeader(currentHeader) }), promote: async () => '200', removeQuarantine: async () => {} };
    const uploadDeps = { firestore: db, now: () => now, store: () => store }; const deps = { firestore: db, now: () => now, teamWritesEnabled: true };
    await db.doc('users/alice').set({}); await db.doc('users/bob').set({}); await db.doc('config/attachmentSecurity').set({ writesEnabled: true, readsEnabled: true, bucket: 'synthetic-private' });
    for (const fileId of [id, secondId]) { currentHeader = { ...header, id: fileId }; await reserveAttachmentUpload('alice', currentHeader, uploadDeps); await finalizeAttachmentUpload('alice', fileId, uploadDeps); }
    const note = db.doc('sessions/note'); const original = { uid: 'alice', teamId: null, timestamp: 1, updatedAt: 1, text: '', title: null,
      enc: { v: 1, iv: 'synthetic-iv', ct: 'synthetic-cipher' }, attachments: null, tags: ['synthetic-tag'], connections: ['other'] };
    await note.set(original);
    const request = { operationId: op, sessionId: 'note', action: 'add', ids: [id], expectedRevision: 1,
      expectedStateDigest: createHash('sha256').update(attachmentSessionStateBytes('note', original)).digest('hex') };
    await assert.rejects(executeAttachmentMutation('bob', request, deps), { code: 'permission-denied' });
    await assert.rejects(executeAttachmentMutation('alice', { ...request, expectedStateDigest: 'a'.repeat(64) }, deps), { code: 'aborted' });
    const competing = await Promise.allSettled([executeAttachmentMutation('alice', request, deps), executeAttachmentMutation('alice', { ...request, operationId: otherOp, ids: [secondId] }, deps)]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    const winning = competing.find(result => result.status === 'fulfilled').value; const winnerRequest = winning.operationId === op ? request : { ...request, operationId: otherOp, ids: [secondId] };
    const current = (await note.get()).data(); const history = (await note.collection('versions').doc(winning.versionId).get()).data();
    assert.deepEqual(history.enc, original.enc); assert.deepEqual(history.attachments, original.attachments); assert.deepEqual(history.tags, original.tags); assert.deepEqual(history.connections, original.connections);
    assert.deepEqual(current.enc, original.enc); assert.equal(current.uid, 'alice'); assert.equal(current.timestamp, 1); assert.equal(current.attachments[0].name, 'Anexo cifrado');
    await db.doc('config/attachmentSecurity').update({ writesEnabled: false });
    assert.deepEqual(await executeAttachmentMutation('alice', winnerRequest, deps), winning); assert.deepEqual(await attachmentMutationStatus('alice', winning.operationId, deps), winning);
    assert.equal((await note.collection('versions').get()).size, 1); await assert.rejects(executeAttachmentMutation('alice', { ...winnerRequest, ids: [id, secondId] }, deps));
    const client = testEnv.authenticatedContext('alice').firestore(); await assertFails(client.doc(`attachmentMutations/${winning.operationId}`).get()); await assertFails(client.doc(`attachmentMutations/${winning.operationId}`).update({ status: 'unknown' }));
    await db.doc('config/attachmentSecurity').update({ writesEnabled: true });
    const removeOp = '55555555-5555-4555-8555-555555555555'; now++;
    const remove = { operationId: removeOp, sessionId: 'note', action: 'remove', ids: winnerRequest.ids, expectedRevision: current.updatedAt,
      expectedStateDigest: createHash('sha256').update(attachmentSessionStateBytes('note', current)).digest('hex') };
    await note.update({ attachments: [] }); // changing only attachments with same cipher/revision still defeats stale CAS
    await assert.rejects(executeAttachmentMutation('alice', remove, deps), { code: 'aborted' }); await note.update({ attachments: current.attachments });
    await note.collection('versions').doc(removeOp).set({ syntheticCollision: true });
    await assert.rejects(executeAttachmentMutation('alice', remove, deps)); assert.deepEqual((await note.get()).data().attachments, current.attachments); assert.equal((await db.doc(`attachmentMutations/${removeOp}`).get()).exists, false);
    await note.collection('versions').doc(removeOp).delete(); await executeAttachmentMutation('alice', remove, deps);
    assert.deepEqual((await note.get()).data().attachments, []); assert.equal((await db.doc(`attachmentUploads/${winnerRequest.ids[0]}`).get()).data().status, 'ready');
    await note.update({ deletedAt: now }); await assert.rejects(attachmentMutationStatus('alice', winning.operationId, deps), { code: 'permission-denied' });
  });

  test('team attachment association binds active epoch and ready scope, rejects pending rotation and checks access on receipt recovery', async () => {
    const db = admin.firestore(); const now = 1000;
    const id = '11111111-1111-4111-8111-111111111111'; const foreignId = '22222222-2222-4222-8222-222222222222';
    const op = '33333333-3333-4333-8333-333333333333'; const keyId = '44444444-4444-4444-8444-444444444444';
    const header = { v: 1, id, uid: 'alice', scope: { kind: 'team', teamId: 'crew', keyEpoch: 2, keyId }, category: 'document',
      plainBytes: 10, metadataBytes: 20, cipherBytes: 50, iv: 'A'.repeat(16), wrappedKey: { iv: 'B'.repeat(16), ct: 'C'.repeat(64) } };
    let currentHeader = header;
    const store = { inspect: async () => ({ generation: '100', size: encodeAttachmentHeader(currentHeader).length + currentHeader.cipherBytes,
      contentType: 'application/octet-stream', prefix: encodeAttachmentHeader(currentHeader) }), promote: async () => '200', removeQuarantine: async () => {} };
    const uploadDeps = { firestore: db, now: () => now, store: () => store }; const deps = { firestore: db, now: () => now, teamWritesEnabled: true };
    await db.doc('users/alice').set({}); await db.doc('users/bob').set({});
    await db.doc('config/attachmentSecurity').set({ writesEnabled: true, bucket: 'synthetic-private' });
    await db.doc('config/teamSecurity').set({ writesEnabled: true });
    const team = db.doc('teams/crew'); await team.set({ memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} },
      keyRotationStatus: 'active', pendingRotationId: null, activeKeyEpoch: 2, activeKeyId: keyId });
    const epoch = db.doc('teams/crew/keyEpochs/2'); await epoch.set({ epoch: 2, status: 'active', keyId, memberUids: ['alice', 'bob'], wrappedKeys: { alice: {}, bob: {} } });
    await reserveAttachmentUpload('alice', currentHeader, uploadDeps); await finalizeAttachmentUpload('alice', id, uploadDeps);
    currentHeader = { ...header, id: foreignId, scope: { kind: 'personal', uid: 'alice' } };
    await reserveAttachmentUpload('alice', currentHeader, uploadDeps); await finalizeAttachmentUpload('alice', foreignId, uploadDeps);
    const note = db.doc('sessions/team-note'); const original = { uid: 'alice', teamId: 'crew', timestamp: 1, updatedAt: 1,
      text: '', title: null, enc: { v: 2, iv: 'synthetic-iv', ct: 'synthetic-cipher' }, keyEpoch: 2, keyId, attachments: null };
    await note.set(original);
    const request = { operationId: op, sessionId: 'team-note', action: 'add', ids: [id], expectedRevision: 1,
      expectedStateDigest: createHash('sha256').update(attachmentSessionStateBytes('team-note', original)).digest('hex') };
    await assert.rejects(executeAttachmentMutation('bob', { ...request, ids: [foreignId] }, deps), { code: 'permission-denied' });
    await team.update({ keyRotationStatus: 'rotation_pending' }); await assert.rejects(executeAttachmentMutation('bob', request, deps), { code: 'permission-denied' });
    await team.update({ keyRotationStatus: 'active' });
    await epoch.update({ epoch: 3 }); await assert.rejects(executeAttachmentMutation('bob', request, deps), { code: 'permission-denied' }); await epoch.update({ epoch: 2 });
    await db.doc('config/monetization').set({ mode: 'paid' }); await assert.rejects(executeAttachmentMutation('bob', request, deps), { code: 'permission-denied' });
    await db.doc('entitlements/bob').set({ canUploadAttachments: true });
    await db.doc(`attachmentUploads/${id}`).update({ status: 'verifying' }); await assert.rejects(executeAttachmentMutation('bob', request, deps));
    await db.doc(`attachmentUploads/${id}`).update({ status: 'ready' });
    const committed = await executeAttachmentMutation('bob', request, deps);
    const history = (await note.collection('versions').doc(op).get()).data(); assert.equal(history.keyEpoch, 2); assert.equal(history.keyId, keyId); assert.deepEqual(history.enc, original.enc);
    const current = (await note.get()).data();
    const noOp = { ...request, operationId: '55555555-5555-4555-8555-555555555555', expectedRevision: current.updatedAt,
      expectedStateDigest: createHash('sha256').update(attachmentSessionStateBytes('team-note', current)).digest('hex') };
    await db.doc('entitlements/bob').delete(); // Retrying an existing association consumes no upload entitlement.
    assert.equal((await executeAttachmentMutation('bob', noOp, deps)).changed, false); assert.equal((await note.collection('versions').get()).size, 1);
    await team.update({ memberUids: ['alice'] }); await assert.rejects(executeAttachmentMutation('bob', request, deps), { code: 'permission-denied' });
    await assert.rejects(attachmentMutationStatus('bob', op, deps), { code: 'permission-denied' });
    await team.update({ memberUids: ['alice', 'bob'], keyRotationStatus: 'rotation_pending' });
    assert.deepEqual(await executeAttachmentMutation('bob', request, { ...deps, teamWritesEnabled: false }), committed); // receipt recovery never changes data
    await db.doc('users/bob').update({ deletionState: 'deleting' }); await assert.rejects(attachmentMutationStatus('bob', op, deps), { code: 'permission-denied' });
    await assert.rejects(attachmentMutationStatus('alice', op, deps), { code: 'permission-denied' });
  });

  test('attachment mutation cancellation serializes with commit and permanently rejects delayed retry when gates reopen', async () => {
    const db = admin.firestore(); const id = '11111111-1111-4111-8111-111111111111'; const op = '22222222-2222-4222-8222-222222222222';
    const header = { v: 1, id, uid: 'alice', scope: { kind: 'personal', uid: 'alice' }, category: 'document', plainBytes: 10, metadataBytes: 20, cipherBytes: 50,
      iv: 'A'.repeat(16), wrappedKey: { iv: 'B'.repeat(16), ct: 'C'.repeat(64) } };
    const store = { inspect: async () => ({ generation: '100', size: encodeAttachmentHeader(header).length + header.cipherBytes,
      contentType: 'application/octet-stream', prefix: encodeAttachmentHeader(header) }), promote: async () => '200', removeQuarantine: async () => {} };
    const deps = { firestore: db, now: () => 1000, teamWritesEnabled: true };
    await db.doc('users/alice').set({}); await db.doc('users/bob').set({}); await db.doc('config/attachmentSecurity').set({ writesEnabled: true, bucket: 'synthetic-private' });
    const uploadDeps = { firestore: db, now: () => 1000, store: () => store };
    await reserveAttachmentUpload('alice', header, uploadDeps); await finalizeAttachmentUpload('alice', id, uploadDeps);
    const original = { uid: 'alice', teamId: null, text: '', title: null, enc: { v: 1, iv: 'synthetic', ct: 'synthetic-cipher' }, timestamp: 1, attachments: null };
    await db.doc('sessions/note').set(original);
    const request = { operationId: op, sessionId: 'note', action: 'add', ids: [id], expectedRevision: 1,
      expectedStateDigest: createHash('sha256').update(attachmentSessionStateBytes('note', original)).digest('hex') };
    const concurrent = await Promise.allSettled([executeAttachmentMutation('alice', request, deps), cancelAttachmentMutation('alice', request, deps)]);
    const cancelled = concurrent[1].value; assert.equal(concurrent[1].status, 'fulfilled');
    const receipt = await attachmentMutationStatus('alice', op, deps); assert.deepEqual(cancelled, receipt);
    const versions = await db.collection('sessions/note/versions').get(); assert.equal(versions.size, receipt.status === 'committed' ? 1 : 0);
    if (receipt.status === 'committed') assert.deepEqual(await executeAttachmentMutation('alice', request, deps), receipt);
    else await assert.rejects(executeAttachmentMutation('alice', request, deps));
    const other = { ...request, operationId: '33333333-3333-4333-8333-333333333333' };
    await db.doc('config/attachmentSecurity').update({ writesEnabled: false });
    const tombstone = await cancelAttachmentMutation('alice', other, deps); assert.equal(tombstone.status, 'cancelled');
    await db.doc('config/attachmentSecurity').update({ writesEnabled: true }); await assert.rejects(executeAttachmentMutation('alice', other, deps));
    assert.deepEqual(await cancelAttachmentMutation('alice', other, deps), tombstone);
    await assert.rejects(cancelAttachmentMutation('bob', other, deps), { code: 'permission-denied' });
    await assert.rejects(cancelAttachmentMutation('alice', { ...other, ids: ['44444444-4444-4444-8444-444444444444'] }, deps));
    assert.equal((await db.collection('sessions/note/versions').get()).size, versions.size);
  });

  async function readyAttachmentForCreation(scope = { kind: 'personal', uid: 'alice' }) {
    const db = admin.firestore(); const id = '11111111-1111-4111-8111-111111111111'; const now = Date.parse('2026-10-01T12:00:00Z');
    const header = { v: 1, id, uid: 'alice', scope, category: 'document', plainBytes: 10, metadataBytes: 20, cipherBytes: 50,
      iv: 'A'.repeat(16), wrappedKey: { iv: 'B'.repeat(16), ct: 'C'.repeat(64) } };
    await db.doc('users/alice').set({}); await db.doc('users/bob').set({}); await db.doc('config/attachmentSecurity').set({ writesEnabled: true, bucket: 'synthetic-private' });
    if (scope.kind === 'team') {
      await db.doc('teams/crew').set({ ownerUid: 'alice', memberUids: ['alice', 'bob'], wrappedKeys: { alice: { ct: 'synthetic' }, bob: { ct: 'synthetic' } },
        activeKeyEpoch: scope.keyEpoch, activeKeyId: scope.keyId, keyRotationStatus: 'active', pendingRotationId: null });
      await db.doc(`teams/crew/keyEpochs/${scope.keyEpoch}`).set({ epoch: scope.keyEpoch, keyId: scope.keyId, status: 'active', memberUids: ['alice', 'bob'],
        wrappedKeys: { alice: { ct: 'synthetic' }, bob: { ct: 'synthetic' } } }); await db.doc('config/teamSecurity').set({ writesEnabled: true });
    }
    const store = { inspect: async () => ({ generation: '100', size: encodeAttachmentHeader(header).length + header.cipherBytes,
      contentType: 'application/octet-stream', prefix: encodeAttachmentHeader(header) }), promote: async () => '200', removeQuarantine: async () => {} };
    const uploadDeps = { firestore: db, now: () => now, store: () => store }; await reserveAttachmentUpload('alice', header, uploadDeps); await finalizeAttachmentUpload('alice', id, uploadDeps);
    const request = { sessionId: '22222222-2222-4222-8222-222222222222', teamId: scope.kind === 'team' ? scope.teamId : null,
      keyEpoch: scope.kind === 'team' ? scope.keyEpoch : null, keyId: scope.kind === 'team' ? scope.keyId : null,
      enc: { v: scope.kind === 'team' ? 2 : 1, iv: 'D'.repeat(16), ct: 'E'.repeat(32) }, attachmentIds: [id], metadata: { connections: [], tags: ['synthetic'], processingMethod: 'synthetic' } };
    return { db, now, id, request, deps: { firestore: db, now: () => now, teamWritesEnabled: true } };
  }
  async function teamTextCreationFixture(){
    const db=admin.firestore(),now=Date.parse('2026-10-13T12:00:00Z'),keyId='77777777-7777-4777-8777-777777777777';for(const uid of ['alice','bob','foreign'])await db.doc('users/'+uid).set({});
    await db.doc('teams/crew').set({ownerUid:'alice',memberUids:['alice','bob'],wrappedKeys:{alice:{ct:'synthetic'},bob:{ct:'synthetic'}},activeKeyEpoch:2,activeKeyId:keyId,keyRotationStatus:'active',pendingRotationId:null});
    await db.doc('teams/crew/keyEpochs/2').set({epoch:2,keyId,status:'active',memberUids:['alice','bob'],wrappedKeys:{alice:{ct:'synthetic'},bob:{ct:'synthetic'}}});await db.doc('config/teamSecurity').set({writesEnabled:true});
    const request={sessionId:'22222222-2222-4222-8222-222222222222',teamId:'crew',keyEpoch:2,keyId,enc:{v:2,iv:'A'.repeat(16),ct:'B'.repeat(32)},attachmentIds:[],metadata:{tags:['synthetic'],connections:[],learning:{schemaVersion:1,source:'text-generation',modality:'text',learnedAt:now,batchId:null,attachmentCount:0}}};return{db,request,deps:{firestore:db,now:()=>now,teamWritesEnabled:true}};
  }
  test('team text creation admits one v2 memory receipt usage without any attachment configuration and survives a lost ACK',async()=>{
    const {db,request,deps}=await teamTextCreationFixture(),command={actorUid:'bob',request};await db.doc('config/monetization').set({mode:'paid'});await db.doc('entitlements/bob').set({effectiveTier:'free',canUploadAttachments:false});await db.doc('users/bob').update({usage:{periodYear:2026,periodMonth:10,memoriesThisMonth:29}});
    for(const mode of ['team-create','status','cancel'])await assert.rejects(executeAttachedMemoryCall('alice',mode,command,deps),{code:'permission-denied'});
    const results=await Promise.all(Array.from({length:4},()=>executeAttachedMemoryCall('bob','team-create',command,deps)));for(const result of results)assert.deepEqual(result,results[0]);const memory=(await db.doc(`sessions/${request.sessionId}`).get()).data();assert.equal(memory.uid,'bob');assert.equal(memory.teamId,'crew');assert.deepEqual(memory.enc,request.enc);assert.equal(memory.timestamp,deps.now());assert.deepEqual(memory.attachments,[]);assert.deepEqual(memory.learning,request.metadata.learning);assert.equal(memory.text,'');assert.equal(memory.title,null);assert.equal((await db.collection('attachmentUploads').get()).size,0);assert.equal((await db.doc('users/bob').get()).data().usage.memoriesThisMonth,30);
    const another={...request,sessionId:'33333333-3333-4333-8333-333333333333'};await assert.rejects(executeAttachedMemoryCall('bob','team-create',{actorUid:'bob',request:another},deps),{code:'resource-exhausted'});await db.doc('teams/crew').update({memberUids:['alice'],keyRotationStatus:'rotation_pending'});assert.deepEqual(await executeAttachedMemoryCall('bob','status',command,{...deps,teamWritesEnabled:false}),results[0]);assert.deepEqual(await executeAttachedMemoryCall('bob','team-create',command,{...deps,teamWritesEnabled:false}),results[0]);assert.equal((await db.collection('sessions').get()).size,1);assert.equal((await db.doc('users/bob').get()).data().usage.memoriesThisMonth,30);await assert.rejects(executeAttachedMemoryCall('bob','personal-create',command,deps),{code:'invalid-argument'});
  });
  test('team text creation refuses stale epoch rotation closed admission and revoked actors without partial state; cancellation is permanent',async()=>{
    const {db,request,deps}=await teamTextCreationFixture(),call=(body=request,options=deps)=>executeAttachedMemoryCall('bob','team-create',{actorUid:'bob',request:body},options);
    await assert.rejects(call({...request,keyEpoch:1}),{code:'permission-denied'});await assert.rejects(call(request,{...deps,teamWritesEnabled:false}),{code:'permission-denied'});await db.doc('config/teamSecurity').update({writesEnabled:false});await assert.rejects(call(),{code:'permission-denied'});await db.doc('config/teamSecurity').update({writesEnabled:true});await db.doc('teams/crew').update({keyRotationStatus:'rotation_pending'});await assert.rejects(call(),{code:'permission-denied'});await db.doc('teams/crew').update({keyRotationStatus:'active'});
    await db.doc('accountDeletions/alice').set({uid:'alice'});await assert.rejects(call(),{code:'permission-denied'});assert.equal((await inspectOrCancelAttachedMemory('bob',request,true,deps)).status,'revoked');assert.equal((await db.collection('memoryCreationReceipts').get()).size,0);await db.doc('accountDeletions/alice').delete();await db.doc('accountDeletions/bob').set({uid:'bob'});await assert.rejects(call(),{code:'permission-denied'});await db.doc('accountDeletions/bob').delete();
    assert.equal((await db.collection('sessions').get()).size,0);assert.equal((await db.collection('memoryUsageReceipts').get()).size,0);assert.equal((await db.doc('users/bob').get()).data().usage,undefined);
    const cancelled=await executeAttachedMemoryCall('bob','cancel',{actorUid:'bob',request},{...deps,teamWritesEnabled:false});assert.equal(cancelled.status,'cancelled');await assert.rejects(call());assert.equal((await db.collection('sessions').get()).size,0);await db.doc(`memoryCreationReceipts/${request.sessionId}`).delete();await db.doc('teamDeletions/crew').set({status:'complete'});await db.doc('teams/crew').delete();assert.equal((await inspectOrCancelAttachedMemory('bob',request,false,deps)).status,'revoked');assert.equal((await db.collection('memoryCreationReceipts').get()).size,0);
  });
  test('personal text creation needs no attachment config or entitlement and concurrent ACK recovery charges exactly once', async () => {
    const db=admin.firestore();const now=Date.parse('2026-10-01T12:00:00Z');await db.doc('users/alice').set({});await db.doc('users/bob').set({});
    await db.doc('config/monetization').set({mode:'paid'});await db.doc('entitlements/alice').set({effectiveTier:'free',canUploadAttachments:false});
    const request={sessionId:'22222222-2222-4222-8222-222222222222',teamId:null,keyEpoch:null,keyId:null,
      enc:{v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)},attachmentIds:[],metadata:{tags:['synthetic'],connections:[],learning:{schemaVersion:1,source:'text-generation',modality:'text',learnedAt:now,batchId:null,attachmentCount:0}}};
    const deps={firestore:db,now:()=>now,teamWritesEnabled:false};
    for(const mode of ['personal-create','status','cancel'])await assert.rejects(executeAttachedMemoryCall('bob',mode,{actorUid:'alice',request},deps),{code:'permission-denied'});
    assert.equal((await db.doc(`sessions/${request.sessionId}`).get()).exists,false);assert.equal((await db.doc(`memoryCreationReceipts/${request.sessionId}`).get()).exists,false);assert.equal((await db.doc('users/alice').get()).data().usage,undefined);assert.equal((await db.doc('users/bob').get()).data().usage,undefined);
    const results=await Promise.all(Array.from({length:4},()=>executeCreateAttachedMemory('alice',request,deps)));
    for(const result of results)assert.deepEqual(result,results[0]);
    const memory=(await db.doc(`sessions/${request.sessionId}`).get()).data();assert.deepEqual(memory.enc,request.enc);assert.deepEqual(memory.attachments,[]);
    assert.equal(memory.text,'');assert.equal(memory.title,null);assert.equal(memory.teamId,null);assert.equal(memory.uid,'alice');
    assert.equal((await db.collection('sessions').get()).size,1);assert.equal((await db.collection('attachmentUploads').get()).size,0);
    await Promise.all([accountCreatedSessionUsage(db,request.sessionId,'alice',now),accountCreatedSessionUsage(db,request.sessionId,'alice',now)]);
    assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth,1);
    assert.deepEqual(await inspectOrCancelAttachedMemory('alice',request,true,deps),results[0]);
    await assert.rejects(inspectOrCancelAttachedMemory('bob',request,false,deps),{code:'permission-denied'});
    await assert.rejects(executeCreateAttachedMemory('alice',{...request,enc:{...request.enc,ct:'C'.repeat(32)}},deps),{code:'permission-denied'});
    await db.doc(`sessions/${request.sessionId}`).delete();assert.deepEqual(await executeCreateAttachedMemory('alice',request,deps),results[0]);
    assert.equal((await db.collection('sessions').get()).size,0);
    await db.doc('users/alice').update({deletionState:'deleting'});await assert.rejects(inspectOrCancelAttachedMemory('alice',request,false,deps),{code:'permission-denied'});
  });
  test('personal research creation retains bounded mode metadata but stores query/summary/sources only inside the supplied cipher',async()=>{
    const db=admin.firestore();const now=Date.parse('2026-10-01T12:00:00Z');await db.doc('users/alice').set({});
    const request={sessionId:'22222222-2222-4222-8222-222222222222',teamId:null,keyEpoch:null,keyId:null,enc:{v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)},attachmentIds:[],
      metadata:{connections:[],category:'Pesquisa web',webResearch:{mode:'private-local',savedAt:now}}};
    const deps={firestore:db,now:()=>now,teamWritesEnabled:false};const receipt=await executeCreateAttachedMemory('alice',request,deps);
    const session=(await db.doc(`sessions/${request.sessionId}`).get()).data();assert.deepEqual(session.webResearch,request.metadata.webResearch);assert.deepEqual(session.enc,request.enc);assert.equal(session.text,'');assert.equal(session.title,null);
    for(const field of ['query','summary','sources'])assert.equal(Object.hasOwn(session,field),false);
    assert.deepEqual(await inspectOrCancelAttachedMemory('alice',request,false,deps),receipt);
    await assert.rejects(executeCreateAttachedMemory('alice',{...request,metadata:{...request.metadata,webResearch:{mode:'contextual',savedAt:now}}},deps),{code:'permission-denied'});
    assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth,1);
  });
  test('personal text quota serializes new IDs and cancellation or foreign parent cannot leave partial sessions or usage',async()=>{
    const db=admin.firestore();const now=Date.parse('2026-10-01T12:00:00Z');await db.doc('users/alice').set({usage:{periodYear:2026,periodMonth:10,memoriesThisMonth:29}});
    await db.doc('config/monetization').set({mode:'paid'});await db.doc('entitlements/alice').set({effectiveTier:'free',canUploadAttachments:false});
    const request={sessionId:'22222222-2222-4222-8222-222222222222',teamId:null,keyEpoch:null,keyId:null,enc:{v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)},attachmentIds:[],metadata:{connections:[]}};
    const deps={firestore:db,now:()=>now,teamWritesEnabled:false};
    const cancelled=await inspectOrCancelAttachedMemory('alice',request,true,deps);assert.equal(cancelled.status,'cancelled');
    await assert.rejects(executeCreateAttachedMemory('alice',request,deps));assert.equal((await db.doc(`sessions/${request.sessionId}`).get()).exists,false);
    const attempts=await Promise.allSettled(['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'].map(sessionId=>executeCreateAttachedMemory('alice',{...request,sessionId},deps)));
    assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);assert.equal(attempts.filter(result=>result.status==='rejected'&&result.reason.code==='resource-exhausted').length,1);
    assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth,30);
    await db.doc('entitlements/alice').update({effectiveTier:'pro'});await db.doc('sessions/foreign-parent').set({uid:'bob',teamId:null});
    const invalid={...request,sessionId:'55555555-5555-4555-8555-555555555555',metadata:{parentId:'foreign-parent'}};
    await assert.rejects(executeCreateAttachedMemory('alice',invalid,deps),{code:'permission-denied'});
    assert.equal((await db.doc(`sessions/${invalid.sessionId}`).get()).exists,false);assert.equal((await db.doc(`memoryCreationReceipts/${invalid.sessionId}`).get()).exists,false);
    assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth,30);
  });
  test('attached memory creation commits references/usage/receipt atomically and recovers ACK without a second memory or trigger charge', async () => {
    const { db, request, deps, now, id } = await readyAttachmentForCreation();
    const results = await Promise.all(Array.from({ length: 4 }, () => executeCreateAttachedMemory('alice', request, deps)));
    for (const result of results) assert.deepEqual(result, results[0]);
    const memory = (await db.doc(`sessions/${request.sessionId}`).get()).data(); assert.equal(memory.attachments[0].url, `mnemosyne-attachment:v1:${id}`);
    assert.deepEqual(memory.enc, request.enc); assert.equal(memory.text, ''); assert.equal(memory.title, null); assert.equal((await db.collection('sessions').get()).size, 1);
    assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth, 1);
    await Promise.all([accountCreatedSessionUsage(db, request.sessionId, 'alice', now), accountCreatedSessionUsage(db, request.sessionId, 'alice', now)]);
    assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth, 1);
    await db.doc('config/attachmentSecurity').update({ writesEnabled: false }); assert.deepEqual(await executeCreateAttachedMemory('alice', request, deps), results[0]);
    assert.deepEqual(await inspectOrCancelAttachedMemory('alice', request, true, deps), results[0]);
    await assert.rejects(executeCreateAttachedMemory('alice', { ...request, metadata: { tags: ['changed'] } }, deps), { code: 'permission-denied' });
    await assert.rejects(inspectOrCancelAttachedMemory('bob', request, false, deps), { code: 'permission-denied' });
    const client = testEnv.authenticatedContext('alice').firestore();
    for (const collection of ['memoryCreationReceipts', 'memoryUsageReceipts']) {
      await assertFails(client.doc(`${collection}/${request.sessionId}`).get()); await assertFails(client.doc(`${collection}/${request.sessionId}`).set({ uid: 'alice' }));
    }
    await db.doc(`sessions/${request.sessionId}`).delete();
    await assertFails(client.doc(`sessions/${request.sessionId}`).set({ uid: 'alice', teamId: null, text: '', title: null, enc: request.enc }));
    assert.deepEqual(await executeCreateAttachedMemory('alice', request, deps), results[0]); assert.equal((await db.collection('sessions').get()).size, 0);
    await db.doc('users/alice').update({ deletionState: 'deleting' }); await assert.rejects(inspectOrCancelAttachedMemory('alice', request, false, deps), { code: 'permission-denied' });
  });
  test('attached creation cancellation wins against delayed retries, plan limits serialize concurrent creates and failed binding rolls back usage', async () => {
    const { db, request, deps } = await readyAttachmentForCreation();
    const race = await Promise.allSettled([executeCreateAttachedMemory('alice', request, deps), inspectOrCancelAttachedMemory('alice', request, true, deps)]);
    assert.equal(race[1].status, 'fulfilled'); const terminal = race[1].value;
    assert.equal((await db.doc(`sessions/${request.sessionId}`).get()).exists, terminal.status === 'committed');
    if (terminal.status === 'cancelled') await assert.rejects(executeCreateAttachedMemory('alice', request, deps));
    const cancelled = { ...request, sessionId: '33333333-3333-4333-8333-333333333333' };
    await db.doc('config/attachmentSecurity').update({ writesEnabled: false }); assert.equal((await inspectOrCancelAttachedMemory('alice', cancelled, true, deps)).status, 'cancelled');
    await db.doc('config/attachmentSecurity').update({ writesEnabled: true }); await assert.rejects(executeCreateAttachedMemory('alice', cancelled, deps));
    await db.doc('config/monetization').set({ mode: 'paid' }); await db.doc('entitlements/alice').set({ canUploadAttachments: true, effectiveTier: 'free' });
    await db.doc('users/alice').update({ usage: { periodYear: 2026, periodMonth: 10, memoriesThisMonth: 29 } });
    const attempts = await Promise.allSettled(['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'].map(sessionId => executeCreateAttachedMemory('alice', { ...request, sessionId }, deps)));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1); assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth, 30);
    await db.doc('entitlements/alice').update({ effectiveTier: 'pro' });
    const invalid = { ...request, sessionId: '66666666-6666-4666-8666-666666666666', metadata: { parentId: 'foreign-note' } };
    await db.doc('sessions/foreign-note').set({ uid: 'bob', teamId: null }); await assert.rejects(executeCreateAttachedMemory('alice', invalid, deps), { code: 'permission-denied' });
    assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth, 30); assert.equal((await db.doc(`memoryCreationReceipts/${invalid.sessionId}`).get()).exists, false);
  });
  test('team initial attachment creation binds fresh epoch and owned terminal recovery survives removal without a new write', async () => {
    const keyId = '77777777-7777-4777-8777-777777777777';
    const { db, request, deps } = await readyAttachmentForCreation({ kind: 'team', teamId: 'crew', keyEpoch: 2, keyId });
    await assert.rejects(executeCreateAttachedMemory('bob', request, { ...deps, teamWritesEnabled: false }), { code: 'permission-denied' });
    await db.doc('teams/crew').update({ keyRotationStatus: 'rotation_pending' }); await assert.rejects(executeCreateAttachedMemory('bob', request, deps), { code: 'permission-denied' });
    await db.doc('teams/crew').update({ keyRotationStatus: 'active' }); await db.doc('teams/crew/keyEpochs/2').update({ epoch: 3 });
    await assert.rejects(executeCreateAttachedMemory('bob', request, deps), { code: 'permission-denied' }); await db.doc('teams/crew/keyEpochs/2').update({ epoch: 2 });
    const result = await executeCreateAttachedMemory('bob', request, deps); assert.equal(result.status, 'committed'); assert.equal((await db.doc(`sessions/${request.sessionId}`).get()).data().uid, 'bob');
    await db.doc('teams/crew').update({ activeKeyEpoch: 3 }); assert.deepEqual(await executeCreateAttachedMemory('bob', request, { ...deps, teamWritesEnabled: false }), result);
    await db.doc('teams/crew').update({ memberUids: ['alice'] }); assert.deepEqual(await inspectOrCancelAttachedMemory('bob', request, false, deps),result);
    assert.deepEqual(await executeCreateAttachedMemory('bob',request,deps),result);
    const unknown={...request,sessionId:'88888888-8888-4888-8888-888888888888'};
    for(const cancel of [false,true])assert.equal((await inspectOrCancelAttachedMemory('bob',unknown,cancel,deps)).status,'revoked');
    await assert.rejects(executeCreateAttachedMemory('bob',unknown,deps),{code:'permission-denied'});
    await assert.rejects(executeAttachedMemoryCall('alice','status',{actorUid:'bob',request},deps),{code:'permission-denied'});
    await db.doc(`memoryCreationReceipts/${request.sessionId}`).delete();await db.doc('teamDeletions/crew').set({teamId:'crew'});await db.doc('teams/crew').delete();
    assert.equal((await inspectOrCancelAttachedMemory('bob',request,true,deps)).status,'revoked');
    assert.equal((await db.doc(`memoryCreationReceipts/${request.sessionId}`).get()).exists,false);
    assert.equal((await db.doc(`memoryCreationReceipts/${unknown.sessionId}`).get()).exists,false);
    assert.equal((await db.doc(`sessions/${unknown.sessionId}`).get()).exists,false);
    assert.equal((await db.doc('users/bob').get()).data().usage.memoriesThisMonth,1);
    await db.doc('accountDeletions/bob').set({uid:'bob'});await assert.rejects(inspectOrCancelAttachedMemory('bob',request,false,deps),{code:'permission-denied'});
  });
  test('usage trigger redelivery is idempotent and never recreates a missing or deleting profile', async () => {
    const db = admin.firestore(); const now = Date.parse('2026-10-01T12:00:00Z'); await db.doc('users/alice').set({});
    await db.doc('sessions/synthetic-note').set({ uid: 'alice', teamId: null });
    await Promise.all(Array.from({ length: 4 }, () => accountCreatedSessionUsage(db, 'synthetic-note', 'alice', now)));
    assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth, 1);
    await accountCreatedSessionUsage(db, 'other-note', 'missing', now); assert.equal((await db.doc('users/missing').get()).exists, false);
    await db.doc('users/alice').update({ deletionState: 'deleting' }); await accountCreatedSessionUsage(db, 'late-note', 'alice', now);
    assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth, 1); assert.equal((await db.doc('memoryUsageReceipts/late-note').get()).exists, false);
  });

  test('usage accounting ignores deleted notes, revoked team scopes and delayed events for a recreated document', async () => {
    const db = admin.firestore(); const now = Date.parse('2026-10-01T12:00:00Z'); await db.doc('users/alice').set({});
    const ref = db.doc('sessions/synthetic-note'); await ref.set({ uid: 'alice', teamId: null });
    const old = (await ref.get()).createTime; await ref.delete();
    await accountCreatedSessionUsage(db, ref.id, 'alice', now, old);
    assert.equal((await db.doc(`memoryUsageReceipts/${ref.id}`).get()).exists, false);
    await ref.set({ uid: 'alice', teamId: null }); const fresh = (await ref.get()).createTime;
    assert.notEqual(fresh.toMillis(), old.toMillis());
    await accountCreatedSessionUsage(db, ref.id, 'alice', now, old);
    assert.equal((await db.doc('users/alice').get()).data().usage, undefined);
    await ref.update({ deletedAt: now }); await accountCreatedSessionUsage(db, ref.id, 'alice', now, fresh);
    assert.equal((await db.doc(`memoryUsageReceipts/${ref.id}`).get()).exists, false);
    await ref.update({ deletedAt: null }); await accountCreatedSessionUsage(db, ref.id, 'alice', now, fresh);
    assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth, 1);
    for (const [teamId, members, deleting] of [['missing-team', null, false], ['revoked-team', ['bob'], false],
      ['frozen-team', ['alice'], true], ['invalid-members', 'alice', false]]) {
      if (members !== null) await db.doc(`teams/${teamId}`).set({ memberUids: members, ...(deleting ? { deletionState: 'deleting' } : {}) });
      await db.doc(`sessions/${teamId}`).set({ uid: 'alice', teamId });
      await accountCreatedSessionUsage(db, teamId, 'alice', now, (await db.doc(`sessions/${teamId}`).get()).createTime);
      assert.equal((await db.doc(`memoryUsageReceipts/${teamId}`).get()).exists, false);
    }
    assert.equal((await db.doc('users/alice').get()).data().usage.memoriesThisMonth, 1);
  });

  test('upload recovery binds the exact header, survives closed gates and serializes missing-reservation cancellation with delayed begin', async () => {
    const db = admin.firestore(); const id = '11111111-1111-4111-8111-111111111111'; let now = 1000;
    const header = { v: 1, id, uid: 'alice', scope: { kind: 'personal', uid: 'alice' }, category: 'document', plainBytes: 10, metadataBytes: 20, cipherBytes: 50,
      iv: 'A'.repeat(16), wrappedKey: { iv: 'B'.repeat(16), ct: 'C'.repeat(64) } };
    let currentHeader = header;
    const store = { inspect: async () => ({ generation: '100', size: encodeAttachmentHeader(currentHeader).length + currentHeader.cipherBytes,
      contentType: 'application/octet-stream', prefix: encodeAttachmentHeader(currentHeader) }), promote: async () => '200', removeQuarantine: async () => {} };
    const deps = { firestore: db, now: () => now }; const uploadDeps = { ...deps, store: () => store };
    await db.doc('users/alice').set({}); await db.doc('users/bob').set({}); await db.doc('config/attachmentSecurity').set({ writesEnabled: true, bucket: 'synthetic-private' });
    assert.equal((await inspectAttachmentUpload('alice', { header }, deps)).status, 'unknown');
    const race = await Promise.allSettled([reserveAttachmentUpload('alice', header, uploadDeps), cancelPendingAttachmentUpload('alice', { header }, deps)]);
    assert.equal(race[1].status, 'fulfilled'); assert.equal(race[1].value.status, 'cancelled');
    await assert.rejects(reserveAttachmentUpload('alice', header, uploadDeps)); assert.equal((await inspectAttachmentUpload('alice', { header }, deps)).status, 'cancelled');
    await assert.rejects(inspectAttachmentUpload('bob', { header }, deps), { code: 'permission-denied' });
    await assert.rejects(inspectAttachmentUpload('alice', { header: { ...header, iv: 'D'.repeat(16) } }, deps), { code: 'permission-denied' });
    const client = testEnv.authenticatedContext('alice').firestore(); await assertFails(client.doc(`attachmentUploadCancellations/${id}`).get());
    await assertFails(client.doc(`attachmentUploadCancellations/${id}`).delete());
    currentHeader = { ...header, id: '22222222-2222-4222-8222-222222222222' }; await reserveAttachmentUpload('alice', currentHeader, uploadDeps);
    assert.equal((await inspectAttachmentUpload('alice', { header: currentHeader }, deps)).status, 'reserved');
    now += 901000; assert.equal((await inspectAttachmentUpload('alice', { header: currentHeader }, deps)).status, 'expired');
    await db.doc('config/attachmentSecurity').update({ writesEnabled: false });
    assert.equal((await cancelPendingAttachmentUpload('alice', { header: currentHeader }, deps)).status, 'cancelled');
    await db.doc('config/attachmentSecurity').update({ writesEnabled: true });
    currentHeader = { ...header, id: '33333333-3333-4333-8333-333333333333' }; await reserveAttachmentUpload('alice', currentHeader, uploadDeps); await finalizeAttachmentUpload('alice', currentHeader.id, uploadDeps);
    await db.doc('config/attachmentSecurity').update({ writesEnabled: false }); await db.doc('config/monetization').set({ mode: 'paid' });
    assert.equal((await inspectAttachmentUpload('alice', { header: currentHeader }, deps)).status, 'ready');
    assert.equal((await cancelPendingAttachmentUpload('alice', { header: currentHeader }, deps)).status, 'ready');
    assert.equal((await db.doc(`attachmentUploadCancellations/${currentHeader.id}`).get()).exists, false);
    await db.doc('users/alice').update({ deletionState: 'deleting' }); await assert.rejects(inspectAttachmentUpload('alice', { header: currentHeader }, deps), { code: 'permission-denied' });
  });

  test('team upload recovery requires current membership and historical epoch wrap, including after ready and rotation', async () => {
    const db = admin.firestore(); const keyId = '44444444-4444-4444-8444-444444444444'; const id = '55555555-5555-4555-8555-555555555555';
    const header = { v: 1, id, uid: 'alice', scope: { kind: 'team', teamId: 'crew', keyEpoch: 2, keyId }, category: 'document',
      plainBytes: 10, metadataBytes: 20, cipherBytes: 50, iv: 'A'.repeat(16), wrappedKey: { iv: 'B'.repeat(16), ct: 'C'.repeat(64) } };
    await db.doc('users/alice').set({}); await db.doc('config/attachmentSecurity').set({ writesEnabled: true, bucket: 'synthetic-private' });
    const team = db.doc('teams/crew'); const epoch = db.doc('teams/crew/keyEpochs/2');
    await team.set({ memberUids: ['alice'], wrappedKeys: { alice: {} }, keyRotationStatus: 'active', activeKeyEpoch: 2, activeKeyId: keyId });
    await epoch.set({ epoch: 2, status: 'active', keyId, memberUids: ['alice'], wrappedKeys: { alice: {} } });
    const deps = { firestore: db, now: () => 1000 }; const store = { inspect: async () => ({ generation: '100', size: encodeAttachmentHeader(header).length + header.cipherBytes,
      contentType: 'application/octet-stream', prefix: encodeAttachmentHeader(header) }), promote: async () => '200', removeQuarantine: async () => {} };
    const uploadDeps = { ...deps, store: () => store }; await reserveAttachmentUpload('alice', header, uploadDeps); await finalizeAttachmentUpload('alice', id, uploadDeps);
    await team.update({ activeKeyEpoch: 3, activeKeyId: '66666666-6666-4666-8666-666666666666' }); await epoch.update({ status: 'historical' });
    await db.doc('config/attachmentSecurity').update({ writesEnabled: false }); assert.equal((await inspectAttachmentUpload('alice', { header }, deps)).status, 'ready');
    await epoch.update({ wrappedKeys: {} }); await assert.rejects(inspectAttachmentUpload('alice', { header }, deps), { code: 'permission-denied' });
    await epoch.update({ wrappedKeys: { alice: {} }, epoch: 3 }); await assert.rejects(inspectAttachmentUpload('alice', { header }, deps), { code: 'permission-denied' });
    await epoch.update({ epoch: 2 }); await team.update({ memberUids: [] });
    await assert.rejects(inspectAttachmentUpload('alice', { header }, deps), { code: 'permission-denied' });
    await assert.rejects(cancelPendingAttachmentUpload('alice', { header }, deps), { code: 'permission-denied' });
    assert.equal((await db.doc(`attachmentUploads/${id}`).get()).data().status, 'ready');
  });

  test('storage: entitlement does not bypass the personal launch upload freeze', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('config/monetization').set({ mode: 'paid' });
      await ctx.firestore().doc('entitlements/alice').set({
        effectiveTier: 'pro',
        canUploadAttachments: true,
      });
    });

    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      alice.storage().ref('attachments/alice/ok.png').put(Buffer.from('png-bytes'), {
        contentType: 'image/png',
      }),
    );

    const tooBig = Buffer.alloc(25 * 1024 * 1024);
    await assertFails(
      alice.storage().ref('attachments/alice/big.png').put(tooBig, {
        contentType: 'image/png',
      }),
    );
  });

  test('storage: document MIME and extension cannot bypass the upload freeze', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      alice.storage().ref('attachments/alice/notes.MD').put(Buffer.from('# hello'), {
        contentType: 'application/octet-stream',
      }),
    );
    await assertFails(
      alice.storage().ref('attachments/alice/app.ts').put(Buffer.from('export {}'), {
        contentType: 'text/plain',
      }),
    );
    await assertFails(
      alice.storage().ref('attachments/alice/MNEMOSYNE_TECHNICAL_ARCHITECTURE.md').put(
        Buffer.from('# architecture'),
        { contentType: 'text/plain' },
      ),
    );
    await assertFails(
      alice.storage().ref('attachments/alice/readme.md').put(Buffer.from('# hi'), {
        contentType: 'text/markdown',
      }),
    );
  });

  test('teams are readable by members only; clients cannot write wrappedKeys', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('teams/crew').set({
        name: 'Crew',
        ownerUid: 'alice',
        createdAt: 1,
        memberUids: ['alice', 'bob'],
        wrappedKeys: {
          alice: { v: 1, alg: 'RSA-OAEP', ct: 'cipher-alice-wrap-xxxx' },
        },
      });
      await ctx.firestore().doc('teamInvites/inv1').set({
        teamId: 'crew',
        teamName: 'Crew',
        fromUid: 'alice',
        uid: 'carol',
        emailHash: 'abc',
        wrappedKey: { v: 1, alg: 'RSA-OAEP', ct: 'cipher-carol-wrap-xxxx' },
        status: 'pending',
        createdAt: 1,
        expiresAt: Date.now() + 600000,
        keyEpoch: 1, keyId: null, publicKeyFingerprint: 'e'.repeat(64),
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    const carol = testEnv.authenticatedContext('carol').firestore();

    await assertSucceeds(alice.doc('teams/crew').get());
    await assertSucceeds(bob.doc('teams/crew').get());
    await assertFails(carol.doc('teams/crew').get());
    await assertFails(alice.doc('teams/crew').set({ name: 'Hijack', ownerUid: 'alice', memberUids: ['alice'] }));
    await assertFails(alice.doc('teams/crew').update({
      wrappedKeys: { alice: { v: 1, alg: 'RSA-OAEP', ct: 'forged' }, mallory: { v: 1, alg: 'RSA-OAEP', ct: 'stolen' } },
    }));
    await assertFails(alice.doc('teams/forged').set({
      name: 'Forged',
      ownerUid: 'alice',
      createdAt: 1,
      memberUids: ['alice'],
      wrappedKeys: {},
    }));

    await assertSucceeds(carol.doc('teamInvites/inv1').get());
    await assertSucceeds(alice.doc('teamInvites/inv1').get());
    await assertFails(carol.doc('teamInvites/inv1').update({ status: 'accepted' }));
    await assertFails(alice.doc('teamInvites/forged').set({
      teamId: 'crew',
      uid: 'bob',
      status: 'pending',
    }));
  });

  test('teamAudit is readable by members; clients cannot write', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('teams/crew').set({
        name: 'Crew',
        ownerUid: 'alice',
        createdAt: 1,
        memberUids: ['alice', 'bob'],
        roles: { alice: 'owner', bob: 'member' },
        wrappedKeys: {
          alice: { v: 1, alg: 'RSA-OAEP', ct: 'cipher-alice-wrap-xxxx' },
        },
      });
      await ctx.firestore().doc('teamAudit/evt1').set({
        teamId: 'crew',
        at: 1,
        actorUid: 'alice',
        action: 'created',
        targetUid: 'alice',
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    const carol = testEnv.authenticatedContext('carol').firestore();

    await assertSucceeds(alice.doc('teamAudit/evt1').get());
    await assertSucceeds(bob.doc('teamAudit/evt1').get());
    await assertFails(carol.doc('teamAudit/evt1').get());
    await assertFails(alice.doc('teamAudit/evt1').update({ action: 'deleted' }));
    await assertFails(alice.doc('teamAudit/forged').set({
      teamId: 'crew',
      at: 2,
      actorUid: 'alice',
      action: 'created',
      targetUid: 'alice',
    }));
  });

  test('key epochs require both current membership and an epoch wrap; rotation details require admin', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('teams/crew').set({
        name: 'Crew', ownerUid: 'alice', memberUids: ['alice', 'carol', 'dave'],
        roles: { alice: 'owner', carol: 'admin', dave: 'member' },
        activeKeyEpoch: 2, activeKeyId: 'key-2', keyRotationStatus: 'active',
      });
      await ctx.firestore().doc('teams/crew/keyEpochs/1').set({
        epoch: 1, keyId: 'key-1', status: 'retired', memberUids: ['alice', 'bob'],
        wrappedKeys: { alice: { v: 1, alg: 'RSA-OAEP', ct: 'synthetic-wrap-alice' } },
      });
      await ctx.firestore().doc('teams/crew/keyEpochs/2').set({
        epoch: 2, keyId: 'key-2', status: 'active', memberUids: ['alice', 'carol', 'dave'],
        wrappedKeys: { alice: { v: 1, alg: 'RSA-OAEP', ct: 'synthetic-wrap-alice' } },
      });
      await ctx.firestore().doc('teamKeyRotations/rotation-1').set({
        teamId: 'crew', oldEpoch: 1, newEpoch: 2, status: 'committed',
      });
    });
    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    const carol = testEnv.authenticatedContext('carol').firestore();
    const dave = testEnv.authenticatedContext('dave').firestore();
    await assertSucceeds(alice.doc('teams/crew/keyEpochs/1').get());
    await assertFails(bob.doc('teams/crew/keyEpochs/1').get());
    await assertFails(carol.doc('teams/crew/keyEpochs/1').get());
    await assertSucceeds(carol.doc('teams/crew/keyEpochs/2').get());
    await assertFails(alice.doc('teams/crew/keyEpochs/2').update({ keyId: 'forged' }));
    await assertSucceeds(alice.doc('teamKeyRotations/rotation-1').get());
    await assertSucceeds(carol.doc('teamKeyRotations/rotation-1').get());
    await assertFails(dave.doc('teamKeyRotations/rotation-1').get());
    await assertFails(bob.doc('teamKeyRotations/rotation-1').get());
    await assertFails(alice.doc('teamKeyRotations/rotation-2').set({ teamId: 'crew' }));
  });

  test('team epoch metadata migration is dry-run first and idempotent', async () => {
    const wrap = { v: 1, alg: 'RSA-OAEP', ct: 'synthetic-ciphertext-long' };
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('teams/valid').set({
        name: 'Synthetic', ownerUid: 'alice', memberUids: ['alice', 'bob'],
        wrappedKeys: { alice: wrap, bob: wrap },
      });
      await ctx.firestore().doc('teams/invalid').set({
        name: 'Synthetic', ownerUid: 'alice', memberUids: ['alice', 'bob'],
        wrappedKeys: { alice: wrap },
      });
    });
    const db = admin.firestore();
    const now = 1_800_000_000_000;
    const dry = await migrateLegacyTeamEpochs(db, { pageSize: 1, now });
    assert.deepEqual(dry, { scanned: 2, eligible: 1, migrated: 0, skipped: 0, failed: 1 });
    assert.equal((await db.doc('teams/valid/keyEpochs/1').get()).exists, false);
    const applied = await migrateLegacyTeamEpochs(db, { apply: true, pageSize: 1, now });
    assert.deepEqual(applied, { scanned: 2, eligible: 1, migrated: 1, skipped: 0, failed: 1 });
    const team = (await db.doc('teams/valid').get()).data();
    const epoch = (await db.doc('teams/valid/keyEpochs/1').get()).data();
    assert.equal(team.activeKeyEpoch, 1);
    assert.equal(team.activeKeyId, epoch.keyId);
    assert.equal(epoch.status, 'active');
    assert.deepEqual(Object.keys(epoch.wrappedKeys).sort(), ['alice', 'bob']);
    const repeat = await migrateLegacyTeamEpochs(db, { apply: true, pageSize: 1, now });
    assert.deepEqual(repeat, { scanned: 2, eligible: 0, migrated: 0, skipped: 1, failed: 1 });
  });

  test('team epoch migration refuses deletion fences and rechecks before activation', async () => {
    const db = admin.firestore();
    const wrap = { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 9).toString('base64') };
    const legacyTeam = (ownerUid, memberUid) => ({
      name: 'Synthetic legacy team', ownerUid, memberUids: [ownerUid, memberUid],
      wrappedKeys: { [ownerUid]: wrap, [memberUid]: wrap },
    });
    const batch = db.batch();
    batch.set(db.doc('teams/team-marker'), legacyTeam('alice', 'bob'));
    batch.set(db.doc('teamDeletions/team-marker'), { status: 'completed' });
    batch.set(db.doc('teams/owner-marker'), legacyTeam('removed-owner', 'bob'));
    batch.set(db.doc('accountDeletions/removed-owner'), { status: 'completed' });
    batch.set(db.doc('teams/member-marker'), legacyTeam('alice', 'removed-member'));
    batch.set(db.doc('accountDeletions/removed-member'), { status: 'completed' });
    batch.set(db.doc('teams/team-deleting'), { ...legacyTeam('alice', 'bob'), deletionState: 'deleting' });
    batch.set(db.doc('teams/profile-deleting'), legacyTeam('alice', 'departing'));
    batch.set(db.doc('users/departing'), { deletionState: 'deleting' });
    batch.set(db.doc('teams/racing-team'), legacyTeam('alice', 'bob'));
    await batch.commit();

    const dry = await migrateLegacyTeamEpochs(db, { pageSize: 2 });
    assert.deepEqual(dry, { scanned: 6, eligible: 1, migrated: 0, skipped: 0, failed: 5 });
    let marked = false;
    const migrationDb = new Proxy(db, {
      get(target, property) {
        if (property === 'runTransaction') return async (...args) => {
          assert.equal(marked, false);
          await target.doc('teamDeletions/racing-team').set({ status: 'pending' });
          marked = true;
          return target.runTransaction(...args);
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const applied = await migrateLegacyTeamEpochs(migrationDb, { apply: true, pageSize: 2 });
    assert.equal(marked, true);
    assert.deepEqual(applied, { scanned: 6, eligible: 1, migrated: 0, skipped: 0, failed: 6 });
    for (const team of (await db.collection('teams').get()).docs) {
      assert.equal(team.data().activeKeyEpoch, undefined);
      assert.equal((await team.ref.collection('keyEpochs').doc('1').get()).exists, false);
    }
  });

  test('team epoch cutover command stays read-only unless an apply preflight passes', async () => {
    const db = admin.firestore();
    const team = db.doc('teams/legacy-cutover');
    const wrap = { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 7).toString('base64') };
    await team.set({ name: 'Synthetic', ownerUid: 'alice', memberUids: ['alice'], wrappedKeys: { alice: wrap } });
    const run = (...args) => spawnSync(process.execPath, [
      path.join(root, 'scripts/backfill-team-epochs.js'), `--project=${PROJECT_ID}`, ...args,
    ], { cwd: root, env: process.env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    const epoch = team.collection('keyEpochs').doc('1');
    const dry = run();
    assert.equal(dry.status, 0);
    assert.equal(JSON.parse(dry.stdout).eligible, 1);
    assert.equal(run('--require-complete').status, 1);
    assert.equal(run('--apply', '--expected=1').status, 2);
    assert.equal(run('--apply', '--expected=2', '--backup-uri=gs://demo-team-backup/fixture').status, 1);
    assert.equal((await epoch.get()).exists, false);

    const applied = run('--apply', '--expected=1', '--backup-uri=gs://demo-team-backup/fixture');
    assert.equal(applied.status, 0);
    const reports = applied.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.deepEqual(reports.map(row => row.mode), ['dry-run', 'apply', 'verification']);
    assert.equal(reports[1].migrated, 1);
    assert.equal(reports[2].eligible, 0);
    assert.equal((await epoch.get()).data().keyId, (await team.get()).data().activeKeyId);
    assert.equal(run('--require-complete').status, 0);
  });

  test('member removal and rekey commit are atomic on real Firestore transactions', async () => {
    const oldWrap = { v: 1, alg: 'RSA-OAEP', ct: 'synthetic-old-wrap-long' };
    const newWrap = { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 9).toString('base64') };
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('teams/crew').set({
        name: 'Crew', ownerUid: 'alice', memberUids: ['alice', 'bob'],
        roles: { alice: 'owner', bob: 'member' },
        wrappedKeys: { alice: oldWrap, bob: oldWrap },
      });
    });
    const db = admin.firestore();
    const leaveInput = {
      teamId: 'crew', reason: 'member_left', targetUid: 'bob',
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174010', // gitleaks:allow -- Synthetic replay nonce; this field is not an access credential.
    };
    const request = await executeRequestTeamKeyRotation('bob', leaveInput, db, 100);
    assert.deepEqual(await executeRequestTeamKeyRotation('bob', leaveInput, db, 101), request);
    const pending = (await db.doc('teams/crew').get()).data();
    assert.equal(pending.keyRotationStatus, 'rotation_pending');
    assert.deepEqual(pending.memberUids, ['alice']);
    assert.equal((await db.doc(`teamKeyRotations/${request.rotationId}`).get()).data().status, 'pending');
    const escalation = await supervisePendingTeamRotations(db, 100 + 86_400_001, 1);
    assert.deepEqual(escalation, { scanned: 1, blocked: 1 });
    assert.equal((await db.doc('teams/crew').get()).data().keyRotationStatus, 'rotation_blocked');
    assert.equal((await db.doc(`teamKeyRotations/${request.rotationId}`).get()).data().status, 'blocked');
    const repeatEscalation = await supervisePendingTeamRotations(db, 100 + 86_400_002, 1);
    assert.deepEqual(repeatEscalation, { scanned: 0, blocked: 0 });
    const ownerNotifications = await db.collection('notifications').where('uid', '==', 'alice').get();
    assert.equal(ownerNotifications.size, 2);
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('teams/crew').get());
    await assertFails(bob.doc('teams/crew/keyEpochs/1').get());
    const requestDocs = await db.collection('teamRotationRequests').get();
    assert.equal(requestDocs.size, 1);
    await assertFails(bob.doc(`teamRotationRequests/${requestDocs.docs[0].id}`).get());
    await db.doc('publicProfiles/alice').set({ publicKeyPem: 'synthetic-public-alice' });
    const commit = await executeCommitTeamKeyRotation('alice', {
      rotationId: request.rotationId, expectedOldEpoch: 1,
      newKeyId: '123e4567-e89b-42d3-a456-426614174000', wrappedKeys: { alice: newWrap },
      publicKeyFingerprints: { alice: createHash('sha256').update('synthetic-public-alice').digest('hex') },
    }, db, 100 + 86_400_003);
    assert.equal(commit.alreadyCommitted, false);
    assert.equal((await db.doc('teams/crew').get()).data().activeKeyEpoch, 2);
    assert.equal((await db.doc('teams/crew/keyEpochs/1').get()).data().status, 'retired');
    assert.deepEqual((await db.doc('teams/crew/keyEpochs/2').get()).data().memberUids, ['alice']);
    assert.deepEqual(await executeRequestTeamKeyRotation('bob', leaveInput, db, 100 + 86_400_004), request);
    await assertFails(bob.doc('teams/crew/keyEpochs/2').get());
    const audit = await db.collection('teamAudit').where('rotationId', '==', request.rotationId).get();
    assert.equal(audit.size, 3);
    const scheduledAt = 100 + 86_400_003 + 90 * 86_400_000 + 1;
    assert.deepEqual(await requestDueTeamKeyRotations(db, scheduledAt, 1), { scanned: 1, requested: 1 });
    assert.equal((await db.doc('teams/crew').get()).data().keyRotationStatus, 'rotation_pending');
    assert.deepEqual(await requestDueTeamKeyRotations(db, scheduledAt, 1), { scanned: 0, requested: 0 });
  });

  test('invitation joins active epoch and cannot cross a later rotation', async () => {
    const oldWrap = { v: 1, alg: 'RSA-OAEP', ct: 'synthetic-old-wrap-long' };
    const newWrap = { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 7).toString('base64') };
    const db = admin.firestore();
    await db.doc('teams/crew').set({
      name: 'Crew', ownerUid: 'alice', memberUids: ['alice'],
      roles: { alice: 'owner' }, wrappedKeys: { alice: oldWrap },
      activeKeyEpoch: 1, activeKeyId: 'key-one', keyRotationStatus: 'active',
    });
    await db.doc('teams/crew/keyEpochs/1').set({
      epoch: 1, keyId: 'key-one', status: 'active', memberUids: ['alice'],
      wrappedKeys: { alice: oldWrap },
    });
    const makeInvite = (uid) => buildInviteDocument({
      teamId: 'crew', teamName: 'Crew', fromUid: 'alice', uid,
      emailHash: 'synthetic-hash', wrappedKey: oldWrap,
      keyEpoch: 1, keyId: 'key-one', now: 1, ttlMs: 1_000,
    });
    await db.doc('teamInvites/bob').set(makeInvite('bob'));
    await db.doc('teamInvites/carol').set(makeInvite('carol'));
    await executeAcceptInvite('bob', { inviteId: 'bob' }, db, 2);
    assert.deepEqual((await db.doc('teams/crew/keyEpochs/1').get()).data().memberUids, ['alice', 'bob']);
    const request = await executeRequestTeamKeyRotation('alice', {
      teamId: 'crew', reason: 'manual',
    }, db, 3);
    await db.doc('publicProfiles/alice').set({ publicKeyPem: 'synthetic-public-alice' });
    await db.doc('publicProfiles/bob').set({ publicKeyPem: 'synthetic-public-bob' });
    const payload = {
      rotationId: request.rotationId, expectedOldEpoch: 1,
      newKeyId: '123e4567-e89b-42d3-a456-426614174000',
      wrappedKeys: { alice: newWrap, bob: newWrap },
      publicKeyFingerprints: { alice: createHash('sha256').update('synthetic-public-alice').digest('hex'),
        bob: createHash('sha256').update('synthetic-public-bob').digest('hex') },
    };
    await db.doc('publicProfiles/bob').update({ publicKeyPem: 'synthetic-changed-public-bob' });
    await assert.rejects(executeCommitTeamKeyRotation('alice', payload, db, 4), { code: 'failed-precondition' });
    assert.equal((await db.doc('teams/crew').get()).data().keyRotationStatus, 'rotation_pending');
    assert.equal((await db.doc('teams/crew/keyEpochs/2').get()).exists, false);
    await db.doc('publicProfiles/bob').update({ publicKeyPem: 'synthetic-public-bob' });
    for (const uid of ['alice', 'bob']) {
      await db.doc(`accountDeletions/${uid}`).set({ status: 'deleting' });
      await assert.rejects(executeCommitTeamKeyRotation('alice', payload, db, 4), { code: 'failed-precondition' });
      assert.equal((await db.doc('teams/crew/keyEpochs/2').get()).exists, false);
      assert.equal((await db.doc('teams/crew').get()).data().keyRotationStatus, 'rotation_pending');
      await db.doc(`accountDeletions/${uid}`).delete();
    }
    await executeCommitTeamKeyRotation('alice', payload, db, 4);
    await db.doc('accountDeletions/bob').set({ status: 'complete' });
    await assert.rejects(executeCommitTeamKeyRotation('alice', payload, db, 4), { code: 'failed-precondition' });
    await db.doc('accountDeletions/bob').delete();
    await assert.rejects(() => executeAcceptInvite('carol', { inviteId: 'carol' }, db, 5),
      (error) => error.code === 'failed-precondition');
    assert.equal((await db.doc('teamInvites/carol').get()).data().status, 'revoked');
    assert.deepEqual((await db.doc('teams/crew').get()).data().memberUids, ['alice', 'bob']);
    assert.deepEqual((await db.doc('teams/crew/keyEpochs/2').get()).data().memberUids, ['alice', 'bob']);
  });

  test("server team creation and revision preserve epoch isolation while SDK cannot publish or pair history", async () => {
    const db = admin.firestore();
    const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
    const oldKey = randomBytes(32), newKey = randomBytes(32);
    const encode = (key, epoch, keyId) => {
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(JSON.stringify({ teamId: 'crew', keyEpoch: epoch, keyId })));
      const ct = Buffer.concat([cipher.update(JSON.stringify({ text: 'synthetic-only', title: null })), cipher.final(), cipher.getAuthTag()]);
      return { v: 2, iv: iv.toString('base64'), ct: ct.toString('base64') };
    };
    const wrap = { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 5).toString('base64') };
    await db.doc('config/teamSecurity').set({ writesEnabled: true });
    for (const uid of ['alice', 'bob', 'carol']) { await db.doc(`users/${uid}`).set({ uid });
      await db.doc(`publicProfiles/${uid}`).set({ publicKeyPem: `synthetic-${uid}` }); }
    await db.doc('teams/crew').set({ name: 'Crew', ownerUid: 'alice', memberUids: ['alice', 'bob', 'carol'],
      roles: { alice: 'owner', bob: 'admin', carol: 'member' }, wrappedKeys: { alice: wrap, bob: wrap, carol: wrap },
      activeKeyEpoch: 1, activeKeyId: '11111111-1111-4111-8111-111111111111', keyRotationStatus: 'active', pendingRotationId: null });
    await db.doc('teams/crew/keyEpochs/1').set({ epoch: 1, keyId: '11111111-1111-4111-8111-111111111111', status: 'active', memberUids: ['alice', 'bob', 'carol'],
      wrappedKeys: { alice: wrap, bob: wrap, carol: wrap } });
    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    const carol = testEnv.authenticatedContext('carol').firestore();
    const initial = { uid: 'alice', teamId: 'crew', timestamp: 1, updatedAt: 1, text: '', title: null,
      keyEpoch: 1, keyId: '11111111-1111-4111-8111-111111111111', enc: encode(oldKey, 1, '11111111-1111-4111-8111-111111111111') };
    await assertFails(alice.doc('sessions/team-active').set(initial)); await db.doc('sessions/team-active').set(initial);
    await assertFails(bob.doc('sessions/forged-author').set({ ...initial, uid: 'alice' }));
    await assertFails(alice.doc('sessions/legacy-new').set({ ...initial, enc: { v: 1, iv: 'iv', ct: 'ct' } }));
    await assertFails(alice.doc('sessions/plain-new').set({ ...initial, text: 'synthetic-only' }));
    await assertFails(alice.doc('sessions/unknown-field').set({ ...initial, mnemonic: 'synthetic-forbidden' }));
    await assertFails(bob.doc('config/teamSecurity').set({ writesEnabled: true }));
    await assertFails(bob.doc('users/bob').update({ deletionState: 'active' }));
    const rotation = await executeRequestTeamKeyRotation('alice', { teamId: 'crew', reason: 'member_removed', targetUid: 'carol' }, db, 2);
    await assertFails(bob.doc('sessions/during-rotation').set({ ...initial, uid: 'bob' }));
    const keyId = '12345678-1234-4234-8234-123456789abc';
    await executeCommitTeamKeyRotation('alice', { rotationId: rotation.rotationId, expectedOldEpoch: 1, newKeyId: keyId,
      wrappedKeys: { alice: wrap, bob: wrap }, publicKeyFingerprints: {
        alice: createHash('sha256').update('synthetic-alice').digest('hex'), bob: createHash('sha256').update('synthetic-bob').digest('hex'),
      } }, db, 3);
    const future = { ...initial, uid: 'bob', updatedAt: 4, keyEpoch: 2, keyId, enc: encode(newKey, 2, keyId) };
    await assertFails(bob.doc('sessions/66666666-6666-4666-8666-666666666666').set(future));
    await executeAttachedMemoryCall('bob','team-create',{actorUid:'bob',request:{sessionId:'66666666-6666-4666-8666-666666666666',teamId:'crew',keyEpoch:2,keyId,enc:future.enc,attachmentIds:[],metadata:{}}},{firestore:db,now:()=>4,teamWritesEnabled:true});
    await assertFails(carol.doc('sessions/66666666-6666-4666-8666-666666666666').get());
    await assertFails(carol.doc('sessions/removed-write').set({ ...future, uid: 'carol' }));
    await assertFails(bob.doc('sessions/stale-key').set({ ...initial, uid: 'bob' }));
    const bytes = Buffer.from((await db.doc('sessions/66666666-6666-4666-8666-666666666666').get()).data().enc.ct, 'base64');
    const decrypt = key => { const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(future.enc.iv, 'base64'));
      decipher.setAAD(Buffer.from(JSON.stringify({ teamId: 'crew', keyEpoch: 2, keyId }))); decipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]); };
    assert.throws(() => decrypt(oldKey)); assert.equal(JSON.parse(decrypt(newKey).toString()).text === 'synthetic-only', true);
    // Bob edits Alice's old memory under the new active epoch. Archive the exact old envelope atomically.
    const replacement = { enc: encode(newKey, 2, keyId), keyEpoch: 2, keyId, updatedAt: 5, lastVersionId: 'archive-1' };
    const version = { text: '', title: null, teamId: 'crew', keyEpoch: 1, keyId: '11111111-1111-4111-8111-111111111111', enc: initial.enc,
      previousUpdatedAt: 1, createdAt: 5, editorUid: 'bob' };
    await assertFails(bob.doc('sessions/team-active').update(replacement));
    await assertFails(bob.doc('sessions/team-active/versions/archive-1').set(version));
    const pair = async (patch = {}, archivePatch = {}) => {
      const batch = bob.batch(); batch.update(bob.doc('sessions/team-active'), { ...replacement, ...patch });
      batch.set(bob.doc('sessions/team-active/versions/archive-1'), { ...version, ...archivePatch }); return batch.commit();
    };
    await assertFails(pair({ uid: 'bob' })); await assertFails(pair({ teamId: null })); await assertFails(pair({ updatedAt: 1 }));
    await assertFails(pair({}, { enc: future.enc })); await assertFails(pair({}, { keyEpoch: 2, keyId }));
    await assertFails(pair({}, { tags: ['forged-history-metadata'] }));
    await assertFails(pair());
    const deps={firestore:db,now:()=>5},baseline=await prepareTeamRevision('bob',{sessionId:'team-active',teamId:'crew'},deps);
    const outcome=await executeTeamRevision('bob',{operationId:'77777777-7777-4777-8777-777777777777',baseline,priorEnc:initial.enc,enc:replacement.enc,metadata:{embedding:null,embeddingModel:null,semanticClusterId:null,position:null,importance:0.5,processingMethod:'synthetic-server-revision'}},'apply',deps);
    assert.equal(outcome.status,'committed');const current=(await db.doc('sessions/team-active').get()).data();version.serverVersionId=current.lastVersionId;
    assert.equal((await db.doc('sessions/team-active').get()).data().uid, 'alice');
    assert.deepEqual((await db.doc('sessions/team-active/versions/'+version.serverVersionId).get()).data().enc, initial.enc);
    await assertFails(bob.doc('sessions/team-active/versions/'+version.serverVersionId).update({ enc: future.enc }));
    await assertFails(carol.doc('sessions/team-active/versions/'+version.serverVersionId).get());
    await db.doc('config/teamSecurity').update({ writesEnabled: false });
    await assertFails(bob.doc('sessions/after-stop').set(future));
    await db.doc('config/teamSecurity').update({ writesEnabled: true });
    await db.doc('users/bob').update({ deletionState: 'deleting' });
    await assertFails(bob.doc('sessions/deleting-account').set(future));
  });

  test('personal launch keeps team sessions readable but denies all team writes', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('teams/crew').set({
        name: 'Crew',
        ownerUid: 'alice',
        createdAt: 1,
        memberUids: ['alice', 'bob'],
        wrappedKeys: {
          alice: { v: 1, alg: 'RSA-OAEP', ct: 'cipher-alice-wrap-xxxx' },
        },
      });
      await ctx.firestore().doc('sessions/team-mem').set({
        uid: 'alice', text: '', title: null, teamId: 'crew',
        enc: { v: 1, iv: 'iv', ct: 'ct' },
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    const carol = testEnv.authenticatedContext('carol').firestore();

    await assertFails(alice.doc('sessions/team-new').set({
      uid: 'alice',
      text: '',
      title: null,
      teamId: 'crew',
      enc: { v: 1, iv: 'iv', ct: 'ct' },
    }));
    await assertSucceeds(bob.doc('sessions/team-mem').get());
    await assertSucceeds(alice.doc('sessions/team-mem').get());
    await assertFails(carol.doc('sessions/team-mem').get());
    await assertFails(carol.doc('sessions/outsider').set({
      uid: 'carol',
      text: '',
      title: null,
      teamId: 'crew',
      enc: { v: 1, iv: 'iv', ct: 'ct' },
    }));
    await assertFails(bob.doc('sessions/team-mem').update({
      enc: { v: 1, iv: 'iv2', ct: 'ct2' },
      updatedAt: 2,
    }));
    await assertFails(alice.doc('sessions/team-mem').update({ updatedAt: 3 }));
    await assertFails(alice.doc('sessions/team-mem/versions/v2').set({
      uid: 'alice', editorUid: 'alice', text: '', candidate: {},
    }));
    await assertFails(bob.doc('sessions/team-mem').update({ uid: 'bob' }));
  });

  test('team membership overrides author and share for documents, versions and actual queries', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc('teams/crew').set({
        ownerUid: 'alice', memberUids: ['alice', 'bob'],
      });
      await db.doc('sessions/team-mem').set({
        uid: 'alice', teamId: 'crew', sharedWithIds: ['alice'],
        text: '', title: null, timestamp: 2, enc: { v: 1, iv: 'iv', ct: 'ct' },
      });
      await db.doc('sessions/personal-mem').set({
        uid: 'alice', teamId: null, text: '', title: null, timestamp: 1,
        enc: { v: 1, iv: 'iv', ct: 'ct' },
      });
      await db.doc('sessions/team-mem/versions/v1').set({
        text: '', title: null, enc: { v: 1, iv: 'iv', ct: 'ct' },
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(alice.doc('sessions/team-mem').get());
    await assertSucceeds(bob.doc('sessions/team-mem').get());

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('teams/crew').update({ memberUids: ['bob'] });
    });

    await assertFails(alice.doc('sessions/team-mem').get());
    await assertFails(alice.doc('sessions/team-mem/versions/v1').get());
    await assertFails(alice.doc('sessions/team-mem').delete());
    await assertSucceeds(bob.doc('sessions/team-mem').get());
    await assertFails(alice.collection('sessions').where('uid', '==', 'alice').get());
    await assertFails(alice.collection('sessions').where('sharedWithIds', 'array-contains', 'alice').get());
    await assertFails(alice.collection('sessions').where('teamId', '==', 'crew').get());
    const ownedQuery = await assertSucceeds(alice.collection('sessions')
      .where('uid', '==', 'alice').where('teamId', '==', null).orderBy('timestamp', 'desc').get());
    assert.deepEqual(ownedQuery.docs.map((doc) => doc.id), ['personal-mem']);
    const teamQuery = await assertSucceeds(bob.collection('sessions').where('teamId', '==', 'crew').get());
    assert.deepEqual(teamQuery.docs.map(doc => doc.id), ['team-mem']);
  });

  test('team membership queries admit only the authenticated member filter', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const batch = db.batch();
      batch.set(db.doc('teams/crew'), { ownerUid: 'alice', memberUids: ['alice', 'bob'] });
      batch.set(db.doc('teams/foreign'), { ownerUid: 'other', memberUids: ['other'] });
      batch.set(db.doc('teams/malformed'), { ownerUid: 'alice', memberUids: { alice: true } });
      batch.set(db.doc('teams/deleted-account'), { ownerUid: 'deleted', memberUids: ['deleted'] });
      batch.set(db.doc('accountDeletions/deleted'), { status: 'completed' });
      await batch.commit();
    });

    const teams = uid => testEnv.authenticatedContext(uid).firestore().collection('teams');
    const alice = teams('alice');
    const bob = teams('bob');
    for (const [uid, collection] of [['alice', alice], ['bob', bob]]) {
      const result = await assertSucceeds(collection.where('memberUids', 'array-contains', uid).get());
      assert.deepEqual(result.docs.map(doc => doc.id), ['crew']);
    }
    await assertFails(teams('other').doc('crew').get());
    await assertFails(teams('other').where('memberUids', 'array-contains', 'alice').get());
    await assertFails(alice.get());
    await assertFails(alice.where('memberUids', 'array-contains-any', ['alice', 'other']).get());
    await assertFails(alice.doc('malformed').get());
    await assertFails(alice.where('memberUids', '==', { alice: true }).get());
    await assertFails(teams('deleted').where('memberUids', 'array-contains', 'deleted').get());
    await assertFails(testEnv.unauthenticatedContext().firestore().collection('teams')
      .where('memberUids', 'array-contains', 'alice').get());

    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx.firestore().doc('teams/crew').update({ memberUids: ['alice'] });
    });
    await assertFails(bob.doc('crew').get());
    const afterRemoval = await assertSucceeds(bob.where('memberUids', 'array-contains', 'bob').get());
    assert.equal(afterRemoval.empty, true);
  });

  test('public API queries personal scope without omitting pages', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const batch = ctx.firestore().batch();
      for (let index = 0; index < 12; index += 1) {
        batch.set(ctx.firestore().doc(`sessions/team-${String(index).padStart(2, '0')}`), {
          uid: 'alice', teamId: 'crew', timestamp: 100 - index,
          text: '', title: null, enc: { v: 1, iv: 'iv', ct: 'ct' },
        });
      }
      for (let index = 0; index < 3; index += 1) {
        batch.set(ctx.firestore().doc(`sessions/personal-${index}`), {
          uid: 'alice', teamId: null, timestamp: 10 - index,
          embedding: [1, 0], tags: [`tag-${index}`], category: 'note',
          text: '', title: null, enc: { v: 1, iv: 'iv', ct: 'ct' },
        });
      }
      await batch.commit();
    });

    await admin.firestore().doc('users/alice').set({});
    const api = createFirestoreMemoryApi(admin.firestore());
    const first = await api.list('alice', { limit: 2 });
    assert.deepEqual(first.memories.map((memory) => memory.id), ['personal-0', 'personal-1']);
    assert.equal(first.nextStartAfter, 'personal-1');
    const second = await api.list('alice', { limit: 2, startAfter: first.nextStartAfter });
    assert.deepEqual(second.memories.map((memory) => memory.id), ['personal-2']);
    assert.equal(second.nextStartAfter, null);

    const search = await api.search('alice', { ids: ['personal-2'], limit: 2 });
    assert.deepEqual(search.results.map((memory) => memory.id), ['personal-2']);
    const vectorSearch = await api.search('alice', {
      embedding: [1, 0], ids: ['personal-2'], tags: ['tag-2'], q: 'cat:note', limit: 1,
    });
    assert.deepEqual(vectorSearch.results.map((memory) => memory.id), ['personal-2']);
    const excluded = await api.search('alice', {
      embedding: [1, 0], ids: ['personal-2'], tags: ['tag-1'], limit: 1,
    });
    assert.deepEqual(excluded.results, []);
  });

  test('personal scope cutover omits unmigrated documents and rejects old writers', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc('sessions/old-personal').set({ uid: 'alice', timestamp: 3 });
      await db.doc('sessions/new-personal').set({ uid: 'alice', teamId: null, timestamp: 2 });
      await db.doc('sessions/team').set({ uid: 'alice', teamId: 'crew', timestamp: 1 });
      const scoped = await db.collection('sessions')
        .where('uid', '==', 'alice')
        .where('teamId', '==', null)
        .orderBy('timestamp', 'desc')
        .get();
      assert.deepEqual(scoped.docs.map((doc) => doc.id), ['new-personal']);
    });
    const alice = testEnv.authenticatedContext('alice').firestore();
    const scoped = await assertSucceeds(alice.collection('sessions').where('uid', '==', 'alice')
      .where('teamId', '==', null).orderBy('timestamp', 'desc').get());
    assert.deepEqual(scoped.docs.map(doc => doc.id), ['new-personal']);
    const gate = require('node:child_process').spawnSync(process.execPath,
      [path.join(root, 'scripts/backfill-personal-scope.js'), `--project=${PROJECT_ID}`, '--require-complete'],
      { cwd: root, env: process.env, encoding: 'utf8', timeout: 20000 });
    assert.equal(gate.status, 1);
    assert.match(gate.stderr, /Corte bloqueado/);
    assert.equal(Object.hasOwn((await admin.firestore().doc('sessions/old-personal').get()).data(), 'teamId'), false);
    await assertFails(alice.doc('sessions/missing-scope').set({ uid: 'alice', text: '', title: null,
      enc: { v: 1, iv: 'iv', ct: 'ct' } }));
    await admin.firestore().doc('sessions/old-personal').update({ teamId: null });
    const migrated = await assertSucceeds(alice.collection('sessions').where('uid', '==', 'alice')
      .where('teamId', '==', null).orderBy('timestamp', 'desc').get());
    assert.deepEqual(migrated.docs.map(doc => doc.id), ['old-personal', 'new-personal']);
  });

  test('AI budget reservations remain atomic under concurrent calls', async () => {
    const uid = 'budget-concurrency';
    await admin.firestore().doc(`users/${uid}`).set({});
    const now = new Date('2026-09-23T00:00:00Z');
    const charge = {
      requests: 1,
      inputBytes: 1,
      reservedOutputTokens: 0,
      images: 0,
      costUnits: 100,
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => reserveAiBudget(uid, charge, now)),
    );
    const accepted = results.filter(Boolean).length;
    const snapshot = await admin.firestore().collection('aiBudgets').doc(`${uid}_2026-09`).get();

    assert.ok(accepted > 0 && accepted <= 2);
    assert.equal(snapshot.data().usage.requests, accepted);
    assert.equal(snapshot.data().usage.costUnits, accepted * 100);
  });

  function syncRetentionFixture(id='env',status='pulled'){
    const day=86400000,now=100*day,encryptedPayload={iv:'A'.repeat(16),data:'B'.repeat(32)};
    const envelope={ownerUid:'alice',deviceId:'phone',direction:'desktop-to-mobile',payloadType:'memory-delta',status,senderPublicKeyJwk:{kty:'EC'},encryptedPayload,
      memoryCount:1,tombstoneIds:['note'],expiresAt:3*day,createdAt:admin.firestore.Timestamp.fromMillis(day),updatedAt:admin.firestore.Timestamp.fromMillis(2*day),pulledAt:2*day};
    const progress={v:1,uid:'alice',envelopeId:id,deviceId:'phone',direction:'desktop-to-mobile',payloadDigest:syncStateHash(encryptedPayload),memoryCount:1,cursor:1,imported:1,conflicts:0,status:'complete',startedAt:day,updatedAt:2*day};
    return{now,envelope,progress,deps:{firestore:admin.firestore(),now:()=>now,id:()=>require('node:crypto').randomUUID()}};
  }
  test('sync retention deletes only current receipt-bound ciphertext and preserves memory tombstones, history and receipts',async()=>{
    const db=admin.firestore(),f=syncRetentionFixture();await db.doc('users/alice').set({});
    await db.doc('sessions/note').set({uid:'alice',teamId:null,deletedAt:86400000,enc:{preserved:true}});await db.doc('sessions/note/versions/v1').set({enc:{preserved:true}});
    for(const id of ['good','legacy','changed','revoked']){const fixture=syncRetentionFixture(id);await db.doc('mobileSyncEnvelopes/'+id).set(fixture.envelope);if(id!=='legacy')await db.doc('mobileSyncImports/'+id).set(fixture.progress);}
    await db.doc('mobileSyncEnvelopes/changed').update({encryptedPayload:{iv:'A'.repeat(16),data:'C'.repeat(32)}});
    assert.equal(await purgeTerminalSyncEnvelope('legacy',f.deps),false);assert.equal(await purgeTerminalSyncEnvelope('changed',f.deps),false);
    assert.equal(await purgeTerminalSyncEnvelope('good',f.deps),true);assert.equal(await purgeTerminalSyncEnvelope('good',f.deps),false);
    for(const path of ['sessions/note','sessions/note/versions/v1','mobileSyncImports/good','mobileSyncEnvelopes/legacy','mobileSyncEnvelopes/changed'])assert.equal((await db.doc(path).get()).exists,true);
    await db.doc('accountDeletions/alice').set({state:'deleting'});assert.equal(await purgeTerminalSyncEnvelope('revoked',f.deps),false);
  });
  test('sync retention cursor passes fifty retained envelopes, resumes and remains private to server code',async()=>{
    const db=admin.firestore(),f=syncRetentionFixture();await db.doc('users/alice').set({});const batch=db.batch();
    for(let i=0;i<60;i++){const id='e'+String(i).padStart(3,'0'),fixture=syncRetentionFixture(id,i<50?'queued':'pulled');batch.set(db.doc('mobileSyncEnvelopes/'+id),fixture.envelope);if(i>=50)batch.set(db.doc('mobileSyncImports/'+id),fixture.progress);}await batch.commit();
    const first=await runMobileSyncRetentionPage(f.deps);assert.equal(first.scanned,50);assert.equal(first.retained,50);assert.equal(first.more,true);assert.equal(first.tombstonesDeleted,0);
    const second=await runMobileSyncRetentionPage(f.deps);assert.equal(second.scanned,10);assert.equal(second.deleted,10);assert.equal(second.more,false);assert.equal((await db.doc('mobileSyncCleanup/state').get()).data().after,null);
    const sdk=testEnv.authenticatedContext('alice').firestore();await assertFails(sdk.doc('mobileSyncCleanup/state').get());await assertFails(sdk.doc('mobileSyncCleanup/state').set({after:null}));
    assert.equal((await db.collection('mobileSyncEnvelopes').get()).size,50);assert.equal((await db.collection('mobileSyncImports').get()).size,10);
  });
  test('v2 cancellation receipts survive envelope purge and continue to prevent publication replay',async()=>{
    const db=admin.firestore(),day=86400000,key={kty:'EC',crv:'P-256',x:'A'.repeat(43),y:'B'.repeat(43),ext:true,key_ops:[]};let now=day;
    await db.doc('users/alice').set({});const device={ownerUid:'alice',deviceId:'phone',status:'active',publicKeyJwk:key,desktopPublicKeyJwk:key};await db.doc('trustedDevices/phone').set(device);
    const input={envelopeId:'cancelled',deviceId:'phone',direction:'desktop-to-mobile',payloadType:'memory-delta',senderPublicKeyJwk:key,encryptedPayload:{iv:'A'.repeat(16),data:'B'.repeat(32)},memoryCount:1,tombstoneIds:[],expiresAt:3*day,expectedDeviceHash:syncStateHash(syncDeviceState(device,'alice','phone'))};
    const deps={firestore:db,now:()=>now};await executeSyncPublication('alice',input,'publish',deps);now=2*day;await executeSyncPublication('alice',input,'cancel',deps);
    assert.equal((await db.doc('mobileSyncPublications/cancelled').get()).data().v,2);assert.equal((await db.doc('mobileSyncPublicationCancellations/cancelled').get()).data().payloadDigest,syncStateHash(input.encryptedPayload));
    now=100*day;assert.equal(await purgeTerminalSyncEnvelope('cancelled',{...deps,id:()=>require('node:crypto').randomUUID()}),true);
    assert.equal((await executeSyncPublication('alice',input,'status',deps)).delivery,'cancelled');await assert.rejects(executeSyncPublication('alice',input,'publish',deps));
    for(const name of ['mobileSyncPublications','mobileSyncPublicationCancellations']){assert.equal((await db.doc(name+'/cancelled').get()).exists,true);await assertFails(testEnv.authenticatedContext('alice').firestore().doc(name+'/cancelled').get());}
  });
  test('provider circuit opens, admits one recovery probe, and closes only after its success', async () => {
    const channel = 'text_huggingface';
    const startedAt = 1_800_000_000_000;
    const ref = admin.firestore().collection('providerCircuits').doc(channel);
    for (let i = 0; i < 3; i += 1) {
      const attempt = await beginProviderAttempt(channel, startedAt + i * 1000);
      assert.ok(attempt);
      await finishProviderAttempt(attempt, false, startedAt + i * 1000);
    }
    assert.equal(await beginProviderAttempt(channel, startedAt + 3000), null);

    const probeAt = startedAt + 2000 + CIRCUIT_COOLDOWN_MS;
    const probes = await Promise.all(Array.from({ length: 6 }, () => beginProviderAttempt(channel, probeAt)));
    const admitted = probes.filter(Boolean);
    assert.equal(admitted.length, 1);
    assert.ok(admitted[0].leaseId);
    await releaseProviderAttempt(admitted[0]);
    const retryProbe = await beginProviderAttempt(channel, probeAt + 1000);
    assert.ok(retryProbe?.leaseId);
    await finishProviderAttempt(retryProbe, true, probeAt + 1000);
    assert.equal((await ref.get()).data().openUntil, 0);
    assert.ok(await beginProviderAttempt(channel, probeAt + 1001));

    const clientDb = testEnv.authenticatedContext('alice').firestore();
    await assertFails(clientDb.collection('providerCircuits').doc(channel).get());
    await assertFails(clientDb.collection('providerCircuits').doc(channel).set({ openUntil: 0 }));
  });
}

// Keep the file a valid test module even when skipped.
assert.ok(true);

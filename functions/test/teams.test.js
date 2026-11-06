process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG || JSON.stringify({
  projectId: 'demo-mnemosyne-test',
});

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const {
  MAX_TEAM_MEMBERS,
  assertCanAddMember,
  parseWrappedKeyEnvelope,
  wrappedKeyLeaksPlaintext,
  assertWrappedKeyDoesNotLeak,
  parseCreateTeamInput,
  parseInviteMemberInput,
  buildTeamDocument,
  buildInviteDocument,
  hashEmail,
  executeCreateTeam,
  executeCancelTeamCreation,
  executeInviteMember,
  resolveInviteeProfile,
  executeDeleteTeam,
  executeSetMemberRole,
  executeLeaveTeam,
  executeRequestTeamKeyRotation,
  executeCommitTeamKeyRotation,
  purgeUserTeamMemberships,
  executeAcceptInvite,
  backfillTeamRoles,
  canInviteMembers,
  TEAM_AUDIT_COLLECTION,
  assertTeamWritesEnabled,
  TEAM_WRITES_ENABLED,
} = require('../lib/teams.js');

test('personal launch rejects team writes at the callable boundary', () => {
  assert.equal(TEAM_WRITES_ENABLED, false);
  assert.throws(() => assertTeamWritesEnabled(),
    (error) => httpsCode(error) === 'failed-precondition');
});

const OWNER_WRAP = { v: 1, alg: 'RSA-OAEP', ct: 'cipher-owner-wrap-aaaaaaaa' };
const INITIAL_WRAP = { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 7).toString('base64') };
const INITIAL_PEM = 'synthetic-public-identity';
const INITIAL_FINGERPRINT = createHash('sha256').update(INITIAL_PEM).digest('hex');
const initialInput = { name: 'Crew', wrappedKey: INITIAL_WRAP, expectedUid: 'alice', publicKeyFingerprint: INITIAL_FINGERPRINT,
  requestId: '12345678-1234-4234-8234-123456789abc' };
const initialProfiles = { 'users/alice': { uid: 'alice' }, 'publicProfiles/alice': { publicKeyPem: INITIAL_PEM } };
const MEMBER_WRAP = { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 8).toString('base64') };
const INVITEE_PEM = '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----';
const inviteContext = (expectedUid = 'alice', inviteeUid = 'bob', expectedKeyEpoch = 1, expectedKeyId = null) => ({
  expectedUid, inviteeUid, expectedKeyEpoch, expectedKeyId,
  publicKeyFingerprint: createHash('sha256').update(INVITEE_PEM).digest('hex'),
});
const TEAM_KEY_PLAIN = 'this-is-the-raw-team-key-base64==';

function httpsCode(error) {
  return error && (error.code || error.httpErrorCode?.canonicalName);
}

function makeDb(seed = {}) {
  const docs = { ...seed };

  const docRef = (col, id) => {
    const autoId = id || `auto_${Math.random().toString(36).slice(2, 10)}`;
    const path = `${col}/${autoId}`;
    return {
      id: autoId,
      path,
      collection(child) {
        return { doc(childId) { return docRef(`${path}/${child}`, childId); } };
      },
      async get() {
        const data = docs[path];
        return { exists: data !== undefined, id: autoId, data: () => data, ref: docRef(col, autoId) };
      },
      async set(data) {
        docs[path] = JSON.parse(JSON.stringify(data));
      },
      async update(data) {
        if (docs[path] === undefined) throw new Error(`missing ${path}`);
        docs[path] = { ...docs[path], ...JSON.parse(JSON.stringify(data)) };
      },
      async delete() {
        delete docs[path];
      },
    };
  };

  const queryFor = (col, predicates = []) => ({
    where(field, op, value) {
      return queryFor(col, [...predicates, { field, op, value }]);
    },
    limit(n) {
      const q = queryFor(col, predicates);
      q._limit = n;
      return q;
    },
    async get() {
      let rows = Object.entries(docs)
        .filter(([key]) => key.startsWith(`${col}/`) && !key.slice(col.length + 1).includes('/'))
        .map(([key, data]) => ({ id: key.slice(col.length + 1), data }));
      for (const pred of predicates) {
        rows = rows.filter((row) => {
          const current = row.data[pred.field];
          if (pred.op === '==') return current === pred.value;
          if (pred.op === 'array-contains') return Array.isArray(current) && current.includes(pred.value);
          return false;
        });
      }
      const limited = rows.slice(0, this._limit || rows.length);
      return {
        empty: limited.length === 0,
        size: limited.length,
        docs: limited.map((row) => ({
          id: row.id,
          data: () => row.data,
          ref: docRef(col, row.id),
        })),
      };
    },
  });

  return {
    _docs: docs,
    doc(path) { const offset = path.lastIndexOf('/'); return docRef(path.slice(0, offset), path.slice(offset + 1)); },
    collection(name) {
      return {
        doc(id) {
          return docRef(name, id);
        },
        where(field, op, value) {
          return queryFor(name, [{ field, op, value }]);
        },
      };
    },
    batch() {
      const ops = [];
      return {
        delete(ref) {
          ops.push(() => delete docs[ref.path]);
        },
        async commit() {
          ops.forEach((op) => op());
        },
      };
    },
    async runTransaction(fn) {
      const ops = [];
      const tx = {
        get: (ref) => ref.get(),
        getAll: (...refs) => Promise.all(refs.map(ref => ref.get())),
        set: (ref, data) => ops.push(() => ref.set(data)),
        create: (ref, data) => ops.push(async () => {
          if ((await ref.get()).exists) throw new Error(`already exists ${ref.path}`);
          await ref.set(data);
        }),
        update: (ref, data) => ops.push(() => ref.update(data)),
        delete: (ref) => ops.push(() => ref.delete()),
      };
      const result = await fn(tx);
      for (const op of ops) await op();
      return result;
    },
  };
}

test('createTeam member cap is 10 (Sovereign)', () => {
  assert.equal(MAX_TEAM_MEMBERS, 10);
  assert.doesNotThrow(() => assertCanAddMember(['owner']));
  assert.doesNotThrow(() => assertCanAddMember(Array.from({ length: 9 }, (_, i) => `u${i}`)));
  assert.throws(
    () => assertCanAddMember(Array.from({ length: 10 }, (_, i) => `u${i}`)),
    (error) => httpsCode(error) === 'resource-exhausted',
  );
});

test('wrappedKey envelope rejects plaintext teamKey fields', () => {
  const ok = parseWrappedKeyEnvelope(OWNER_WRAP);
  assert.equal(ok.alg, 'RSA-OAEP');
  assert.equal(ok.v, 1);
  assert.equal(wrappedKeyLeaksPlaintext(ok, TEAM_KEY_PLAIN), false);
  assert.doesNotThrow(() => assertWrappedKeyDoesNotLeak(ok, TEAM_KEY_PLAIN));

  assert.throws(
    () => parseWrappedKeyEnvelope({ v: 1, alg: 'RSA-OAEP', ct: 'cipher-ok-ok-ok-ok', teamKey: TEAM_KEY_PLAIN }),
    (error) => httpsCode(error) === 'invalid-argument',
  );
  assert.throws(
    () => parseWrappedKeyEnvelope({ teamKey: TEAM_KEY_PLAIN }),
    (error) => httpsCode(error) === 'invalid-argument',
  );
  assert.throws(
    () => parseCreateTeamInput({ name: 'Crew', wrappedKey: { v: 1, alg: 'RSA-OAEP', ct: 'x', key: TEAM_KEY_PLAIN } }),
    (error) => httpsCode(error) === 'invalid-argument',
  );

  const leaked = { v: 1, alg: 'RSA-OAEP', ct: TEAM_KEY_PLAIN };
  assert.equal(wrappedKeyLeaksPlaintext(leaked, TEAM_KEY_PLAIN), true);
  assert.throws(
    () => assertWrappedKeyDoesNotLeak(leaked, TEAM_KEY_PLAIN),
    (error) => httpsCode(error) === 'invalid-argument',
  );
});

test('invite payload requires email + wrap, never a raw teamKey', () => {
  const parsed = parseInviteMemberInput({
    ...inviteContext(),
    teamId: 't1',
    email: 'bob@example.com',
    wrappedKey: MEMBER_WRAP,
  });
  assert.equal(parsed.email, 'bob@example.com');
  assert.equal(parsed.wrappedKey.ct.includes('teamKey'), false);
  assert.throws(
    () => parseInviteMemberInput({ ...inviteContext(), teamId: 't1', email: 'bob@example.com', wrappedKey: { teamKey: TEAM_KEY_PLAIN } }),
  );
});

test('hashEmail is lowercase SHA-256 hex', () => {
  const hash = hashEmail('Alice@Example.COM');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, hashEmail('alice@example.com'));
  assert.notEqual(hash, hashEmail('bob@example.com'));
});

test('new invitation context rejects legacy, path, fractional epoch and unbound envelopes', () => {
  const valid = { ...inviteContext(), teamId: 'crew', email: 'bob@example.com', wrappedKey: MEMBER_WRAP };
  for (const invalid of [
    { ...valid, expectedUid: undefined }, { ...valid, inviteeUid: 'bob/nested' }, { ...valid, teamId: '../crew' },
    { ...valid, expectedKeyEpoch: 1.5 }, { ...valid, expectedKeyId: undefined },
    { ...valid, publicKeyFingerprint: 'missing' }, { ...valid, unknown: true },
    { ...valid, wrappedKey: OWNER_WRAP },
  ]) assert.throws(() => parseInviteMemberInput(invalid), error => httpsCode(error) === 'invalid-argument');
});

test('invitation identity lookup fails closed on Auth failure or disabled identity without a public-profile fallback', async () => {
  let reads = 0; const db = { collection: () => { reads++; throw Error('Unexpected profile fallback'); } };
  for (const auth of [
    { getUserByEmail: async () => { throw Error('synthetic Auth failure'); } },
    { getUserByEmail: async () => ({ uid: 'bob', disabled: true }) },
    { getUserByEmail: async () => ({ uid: 'bob/nested' }) },
    { getUserByEmail: async () => ({ uid: 'bob', email: 'bob@example.com', emailVerified: false }) },
    { getUserByEmail: async () => ({ uid: 'bob', email: 'bob@example.com' }) },
    { getUserByEmail: async () => ({ uid: 'bob', email: 'bob@example.com', emailVerified: 'true' }) },
    { getUserByEmail: async () => ({ uid: 'bob', email: 'other@example.com', emailVerified: true }) },
  ]) await assert.rejects(resolveInviteeProfile('bob@example.com', db, auth), error => httpsCode(error) === 'failed-precondition');
  assert.equal(reads, 0);
});
test('team recipient lookup confirms the same verified Auth UID again after loading the profile',async()=>{
  const profile={uid:'bob',displayName:'Synthetic Bob',publicKeyPem:'Synthetic existing key',emailHash:hashEmail('bob@example.com')};
  for(const patch of [{uid:'carol'},{emailVerified:false},{email:'changed@example.com'},{disabled:true}]){const db=makeDb({'publicProfiles/bob':profile}),before=JSON.stringify(db._docs);let reads=0;const auth={getUserByEmail:async email=>({uid:'bob',email,emailVerified:true,...(++reads===2?patch:{})})};await assert.rejects(resolveInviteeProfile('bob@example.com',db,auth),error=>httpsCode(error)==='failed-precondition');assert.equal(reads,2);assert.equal(JSON.stringify(db._docs),before);}
});
test('verified team recipient lookup accepts normalized email but returns only the captured profile UID and key',async()=>{
  const profile={uid:'bob',displayName:'Synthetic Bob',publicKeyPem:'Synthetic existing key',emailHash:hashEmail('bob@example.com')},db=makeDb({'publicProfiles/bob':profile});let reads=0;
  const result=await resolveInviteeProfile(' BOB@example.com ',db,{getUserByEmail:async email=>{reads++;assert.equal(email,'bob@example.com');return{uid:'bob',email:'Bob@EXAMPLE.COM',emailVerified:true};}});assert.equal(reads,2);assert.equal(result.uid,'bob');assert.equal(result.publicKeyPem,profile.publicKeyPem);
});

test('permanent markers refuse creation and cancellation even when a valid profile remains', async () => {
  const db = makeDb({ ...initialProfiles, 'accountDeletions/alice': { status: 'complete' } });
  await assert.rejects(executeCreateTeam('alice', initialInput, db), error => httpsCode(error) === 'failed-precondition');
  await assert.rejects(executeCancelTeamCreation('alice', { expectedUid: 'alice', requestId: initialInput.requestId, confirmed: true }, db),
    error => httpsCode(error) === 'failed-precondition');
  assert.equal(Object.keys(db._docs).some(path => path.startsWith('teams/') || path.startsWith('teamCreationRequests/')), false);
});

test('buildTeamDocument stores only wrapped blobs for the owner', () => {
  const team = buildTeamDocument('alice', 'Sovereign', OWNER_WRAP, 1_700_000_000_000);
  assert.deepEqual(team.memberUids, ['alice']);
  assert.equal(team.ownerUid, 'alice');
  assert.equal(team.wrappedKeys.alice.ct, OWNER_WRAP.ct);
  assert.equal('teamKey' in team, false);
  assert.equal('teamKey' in team.wrappedKeys.alice, false);
  const invite = buildInviteDocument({
    teamId: 't1',
    teamName: 'Sovereign',
    fromUid: 'alice',
    uid: 'bob',
    emailHash: 'abc',
    wrappedKey: MEMBER_WRAP,
    now: 10,
    ttlMs: 100,
  });
  assert.equal(invite.status, 'pending');
  assert.equal(invite.expiresAt, 110);
  assert.equal('teamKey' in invite, false);
});

test('executeCreateTeam writes wrappedKeys only', async () => {
  const db = makeDb(initialProfiles);
  const created = await executeCreateTeam('alice', { ...initialInput, name: '  Crew  ' }, db, 42);
  assert.ok(created.teamId);
  assert.equal(created.memberUids.length, 1);
  const stored = Object.values(db._docs).find((doc) => doc.ownerUid === 'alice');
  assert.equal(stored.name, 'Crew');
  assert.deepEqual(Object.keys(stored.wrappedKeys), ['alice']);
  assert.equal(JSON.stringify(stored).includes(TEAM_KEY_PLAIN), false);
  assert.equal(stored.teamKey, undefined);
  const epoch = db._docs[`teams/${created.teamId}/keyEpochs/1`];
  assert.equal(stored.activeKeyEpoch, 1);
  assert.equal(stored.activeKeyId, created.activeKeyId);
  assert.equal(stored.pendingRotationId, null);
  assert.equal(stored.keyRotationStatus, 'active');
  assert.equal(stored.nextRotationDueAt, 42 + 90 * 24 * 60 * 60 * 1000);
  assert.equal(epoch.keyId, created.activeKeyId);
  assert.equal(epoch.status, 'active');
  assert.equal(epoch.reason, 'team_created');
  assert.deepEqual(epoch.wrappedKeys, stored.wrappedKeys);
  assert.deepEqual(epoch.publicKeyFingerprints, { alice: INITIAL_FINGERPRINT });
});

test('initial team refuses changed account, unpublished identity, invalid wraps and plaintext fields before writing', async () => {
  for (const input of [{ ...initialInput, expectedUid: 'bob' }, { ...initialInput, publicKeyFingerprint: 'a'.repeat(64) },
    { ...initialInput, wrappedKey: OWNER_WRAP }, { ...initialInput, publicKeyFingerprint: undefined },
    { ...initialInput, teamKey: TEAM_KEY_PLAIN }, { ...initialInput, requestId: undefined }, { ...initialInput, requestId: 'invalid' }]) {
    const db = makeDb(initialProfiles);
    await assert.rejects(executeCreateTeam('alice', input, db));
    assert.equal(Object.keys(db._docs).some(path => path.startsWith('teams/') || path.startsWith('teamAudit/')), false);
  }
  for (const profiles of [{}, { ...initialProfiles, 'users/alice': { deletionState: 'deleting' } },
    { 'users/alice': { uid: 'alice' } }]) {
    const db = makeDb(profiles);
    await assert.rejects(executeCreateTeam('alice', initialInput, db), error => httpsCode(error) === 'failed-precondition');
    assert.equal(Object.keys(db._docs).some(path => path.startsWith('teams/')), false);
  }
});

test('initial creation retry is bound to the same payload and never resurrects a deleted team', async () => {
  const db = makeDb(initialProfiles);
  const first = await executeCreateTeam('alice', initialInput, db, 42);
  const retry = await executeCreateTeam('alice', initialInput, db, 99);
  assert.equal(first.alreadyCreated, false); assert.equal(retry.alreadyCreated, true);
  assert.equal(first.teamId, retry.teamId); assert.equal(first.activeKeyId, retry.activeKeyId);
  assert.equal(Object.keys(db._docs).filter(path => path.startsWith('teamAudit/')).length, 1);
  for (const changed of [{ name: 'Other' }, { wrappedKey: { ...INITIAL_WRAP, ct: Buffer.alloc(256, 9).toString('base64') } },
    { publicKeyFingerprint: 'b'.repeat(64) }]) {
    await assert.rejects(executeCreateTeam('alice', { ...initialInput, ...changed }, db), error => httpsCode(error) === 'already-exists');
  }
  db._docs[`teams/${first.teamId}`].activeKeyEpoch = 2;
  db._docs[`teams/${first.teamId}`].activeKeyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  db._docs[`teams/${first.teamId}/keyEpochs/2`] = { status: 'active', keyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', wrappedKeys: { alice: INITIAL_WRAP } };
  assert.equal((await executeCreateTeam('alice', initialInput, db)).activeKeyEpoch, 2);
  delete db._docs[`teams/${first.teamId}`];
  await assert.rejects(executeCreateTeam('alice', initialInput, db), error => httpsCode(error) === 'failed-precondition');
  assert.equal(Object.keys(db._docs).filter(path => /^teams\/[^/]+$/.test(path)).length, 0);
});
test('confirmed cancellation invalidates a late creation but does not delete an already-created team', async () => {
  const cancel = { requestId: initialInput.requestId, expectedUid: 'alice', confirmed: true };
  for (const before of [true, false]) {
    const db = makeDb(initialProfiles); if (!before) await executeCreateTeam('alice', initialInput, db);
    await executeCancelTeamCreation('alice', cancel, db, 42); await executeCancelTeamCreation('alice', cancel, db, 99);
    assert.equal(Object.values(db._docs).find(doc => doc.status === 'cancelled').cancelledAt, 42);
    await assert.rejects(executeCreateTeam('alice', initialInput, db), error => httpsCode(error) === 'failed-precondition');
    assert.equal(Object.keys(db._docs).filter(path => /^teams\/[^/]+$/.test(path)).length, before ? 0 : 1);
  }
  await assert.rejects(executeCancelTeamCreation('alice', { ...cancel, confirmed: false }, makeDb(initialProfiles)));
  await assert.rejects(executeCancelTeamCreation('bob', cancel, makeDb(initialProfiles)));
});

test('executeInviteMember enforces owner, 10-member cap, and wrap-only storage', async () => {
  const ten = Array.from({ length: 10 }, (_, i) => (i === 0 ? 'alice' : `u${i}`));
  const fullTeam = buildTeamDocument('alice', 'Full', OWNER_WRAP, 1);
  fullTeam.memberUids = ten;

  const dbFull = makeDb({
    'users/alice': {}, 'users/bob': {},
    'teams/full': fullTeam,
    'publicProfiles/bob': {
      uid: 'bob',
      displayName: 'Bob',
      emailHash: hashEmail('bob@example.com'),
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----',
    },
  });
  const auth = { getUserByEmail: async email => ({ uid: 'bob', email, emailVerified: true }) };

  await assert.rejects(
    () => executeInviteMember('alice', {
      ...inviteContext(),
      teamId: 'full',
      email: 'bob@example.com',
      wrappedKey: MEMBER_WRAP,
    }, dbFull, auth, 50),
    (error) => httpsCode(error) === 'resource-exhausted',
  );

  const openTeam = buildTeamDocument('alice', 'Open', OWNER_WRAP, 1);
  const db = makeDb({
    'teams/open': openTeam,
    'users/alice': {}, 'users/bob': {}, 'users/mallory': {},
    'publicProfiles/bob': {
      uid: 'bob',
      displayName: 'Bob',
      emailHash: hashEmail('bob@example.com'),
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----',
    },
  });

  await assert.rejects(
    () => executeInviteMember('mallory', {
      ...inviteContext('mallory'),
      teamId: 'open',
      email: 'bob@example.com',
      wrappedKey: MEMBER_WRAP,
    }, db, auth, 50),
    (error) => httpsCode(error) === 'permission-denied',
  );

  const invited = await executeInviteMember('alice', {
    ...inviteContext(),
    teamId: 'open',
    email: 'bob@example.com',
    wrappedKey: MEMBER_WRAP,
  }, db, auth, 50);
  assert.equal(invited.inviteeUid, 'bob');
  const inviteDoc = Object.values(db._docs).find((doc) => doc.uid === 'bob' && doc.teamId === 'open');
  assert.equal(inviteDoc.wrappedKey.ct, MEMBER_WRAP.ct);
  assert.equal(inviteDoc.teamKey, undefined);
  assert.equal(JSON.stringify(inviteDoc).includes(TEAM_KEY_PLAIN), false);

  await assert.rejects(
    () => executeInviteMember('alice', {
      ...inviteContext(),
      teamId: 'open',
      email: 'bob@example.com',
      wrappedKey: { v: 1, alg: 'RSA-OAEP', ct: 'cipher-dup-wrap-xxxxxxxx', teamKey: TEAM_KEY_PLAIN },
    }, db, auth, 51),
    (error) => httpsCode(error) === 'invalid-argument',
  );
});

test('createTeam writes owner role and a created audit event (no plaintext)', async () => {
  const db = makeDb(initialProfiles);
  const created = await executeCreateTeam('alice', initialInput, db, 42);
  const stored = Object.values(db._docs).find((doc) => doc.ownerUid === 'alice');
  assert.equal(stored.roles.alice, 'owner');
  const audit = Object.values(db._docs).find((doc) => doc.action === 'created' && doc.teamId === created.teamId);
  assert.equal(audit.actorUid, 'alice');
  assert.equal(audit.targetUid, 'alice');
  assert.equal('text' in audit, false);
  assert.equal('title' in audit, false);
  assert.equal('enc' in audit, false);
});

test('backfill treats missing roles map as owner + members', () => {
  const roles = backfillTeamRoles('alice', ['alice', 'bob'], undefined);
  assert.equal(roles.alice, 'owner');
  assert.equal(roles.bob, 'member');
  const team = buildTeamDocument('alice', 'Crew', OWNER_WRAP, 1);
  team.memberUids = ['alice', 'bob'];
  team.roles = { alice: 'owner', bob: 'admin' };
  assert.equal(canInviteMembers(team, 'alice'), true);
  assert.equal(canInviteMembers(team, 'bob'), true);
  team.roles.bob = 'member';
  assert.equal(canInviteMembers(team, 'bob'), false);
});

test('admin can invite; member cannot; deleteTeam is owner-only', async () => {
  const profile = {
    uid: 'carol',
    displayName: 'Carol',
    emailHash: hashEmail('carol@example.com'),
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----',
  };
  const team = buildTeamDocument('alice', 'Crew', OWNER_WRAP, 1);
  team.memberUids = ['alice', 'bob'];
  team.wrappedKeys.bob = MEMBER_WRAP;
  team.roles = { alice: 'owner', bob: 'admin' };

  const db = makeDb({
    'teams/crew': team,
    'publicProfiles/carol': profile,
    'users/alice': {}, 'users/bob': {}, 'users/carol': {},
  });
  const auth = { getUserByEmail: async email => ({ uid: 'carol', email, emailVerified: true }) };

  const invited = await executeInviteMember('bob', {
    ...inviteContext('bob', 'carol'),
    teamId: 'crew',
    email: 'carol@example.com',
    wrappedKey: MEMBER_WRAP,
  }, db, auth, 80);
  assert.equal(invited.inviteeUid, 'carol');
  const invitedAudit = Object.values(db._docs).find((doc) => doc.action === 'invited' && doc.targetUid === 'carol');
  assert.equal(invitedAudit.actorUid, 'bob');

  const memberTeam = buildTeamDocument('alice', 'Crew2', OWNER_WRAP, 1);
  memberTeam.memberUids = ['alice', 'dave'];
  memberTeam.roles = { alice: 'owner', dave: 'member' };
  const dbMember = makeDb({
    'teams/crew2': memberTeam,
    'publicProfiles/carol': profile,
    'users/alice': {}, 'users/dave': {}, 'users/carol': {},
  });
  await assert.rejects(
    () => executeInviteMember('dave', {
      ...inviteContext('dave', 'carol'),
      teamId: 'crew2',
      email: 'carol@example.com',
      wrappedKey: MEMBER_WRAP,
    }, dbMember, auth, 81),
    (error) => httpsCode(error) === 'permission-denied',
  );

  await assert.rejects(executeDeleteTeam('alice', { teamId: 'crew' }, { firestore: db }),
    error => httpsCode(error) === 'invalid-argument');
  assert.ok(db._docs['teams/crew']); // Old clients cannot run the retired parent-only deletion.
});

test('setMemberRole is owner-only and writes role_changed audit', async () => {
  const team = buildTeamDocument('alice', 'Crew', OWNER_WRAP, 1);
  team.memberUids = ['alice', 'bob'];
  team.wrappedKeys.bob = MEMBER_WRAP;
  team.roles = { alice: 'owner', bob: 'member' };
  const db = makeDb({ 'teams/crew': team });

  await assert.rejects(
    () => executeSetMemberRole('bob', { teamId: 'crew', targetUid: 'bob', role: 'admin' }, db, 90),
    (error) => httpsCode(error) === 'permission-denied',
  );
  await assert.rejects(
    () => executeSetMemberRole('alice', { teamId: 'crew', targetUid: 'alice', role: 'admin' }, db, 91),
    (error) => httpsCode(error) === 'failed-precondition',
  );

  const promoted = await executeSetMemberRole('alice', {
    teamId: 'crew',
    targetUid: 'bob',
    role: 'admin',
  }, db, 92);
  assert.equal(promoted.role, 'admin');
  assert.equal(db._docs['teams/crew'].roles.bob, 'admin');
  const audit = Object.values(db._docs).find((doc) => doc.action === 'role_changed' && doc.targetUid === 'bob');
  assert.equal(audit.actorUid, 'alice');
  assert.equal(audit.teamId, 'crew');
  await assert.rejects(executeSetMemberRole('alice', { teamId: 'crew/keyEpochs/1', targetUid: 'bob', role: 'member' }, db, 93), error => httpsCode(error) === 'invalid-argument');
  db._docs['accountDeletions/bob'] = { v: 1, status: 'complete' };
  await assert.rejects(executeSetMemberRole('alice', { teamId: 'crew', targetUid: 'bob', role: 'member' }, db, 93), error => httpsCode(error) === 'failed-precondition');
  assert.equal(db._docs['teams/crew'].roles.bob, 'admin');
});

test('acceptInvite stores member role; leaveTeam strips it and audits', async () => {
  const team = buildTeamDocument('alice', 'Crew', OWNER_WRAP, 1);
  const invite = buildInviteDocument({
    teamId: 'crew',
    teamName: 'Crew',
    fromUid: 'alice',
    uid: 'bob',
    emailHash: 'abc',
    wrappedKey: MEMBER_WRAP,
    now: 10,
    ttlMs: 10_000,
  });
  const db = makeDb({
    'teams/crew': team,
    'teamInvites/inv1': invite,
  });

  const accepted = await executeAcceptInvite('bob', { inviteId: 'inv1' }, db, 50);
  assert.equal(accepted.teamId, 'crew');
  assert.equal(db._docs['teams/crew'].roles.bob, 'member');
  assert.equal(db._docs['teams/crew'].memberUids.includes('bob'), true);
  const acceptedAudit = Object.values(db._docs).find((doc) => doc.action === 'accepted' && doc.actorUid === 'bob');
  assert.ok(acceptedAudit);

  await executeLeaveTeam('bob', { teamId: 'crew' }, db);
  assert.equal(db._docs['teams/crew'].memberUids.includes('bob'), false);
  assert.equal(db._docs['teams/crew'].roles.bob, undefined);
  const leftAudit = Object.values(db._docs).find((doc) => doc.action === 'left' && doc.actorUid === 'bob');
  assert.ok(leftAudit);
  assert.equal(TEAM_AUDIT_COLLECTION, 'teamAudit');
  assert.equal(db._docs['teams/crew'].keyRotationStatus, 'rotation_pending');
  const rotation = Object.values(db._docs).find((doc) => doc.status === 'pending' && doc.teamId === 'crew' && doc.oldEpoch === 1);
  assert.equal(rotation.targetUid, 'bob');
  assert.equal(rotation.newEpoch, 2);
  const oldEpoch = db._docs['teams/crew/keyEpochs/1'];
  assert.equal(oldEpoch.keyId, db._docs['teams/crew'].activeKeyId);
  assert.deepEqual(oldEpoch.memberUids, ['alice', 'bob']);
});

test('acceptInvite updates the active epoch with the same membership transaction', async () => {
  const team = buildTeamDocument('alice', 'Crew', OWNER_WRAP, 1);
  team.activeKeyEpoch = 1;
  team.activeKeyId = 'epoch-one';
  team.keyRotationStatus = 'active';
  const invite = buildInviteDocument({
    teamId: 'crew', teamName: 'Crew', fromUid: 'alice', uid: 'bob',
    emailHash: 'abc', wrappedKey: MEMBER_WRAP, keyEpoch: 1,
    keyId: 'epoch-one', now: 1, ttlMs: 1_000,
  });
  const db = makeDb({
    'teams/crew': team,
    'teams/crew/keyEpochs/1': {
      epoch: 1, keyId: 'epoch-one', status: 'active', memberUids: ['alice'],
      wrappedKeys: { alice: OWNER_WRAP },
    },
    'teamInvites/inv1': invite,
  });
  await executeAcceptInvite('bob', { inviteId: 'inv1' }, db, 2);
  assert.deepEqual(db._docs['teams/crew'].memberUids, ['alice', 'bob']);
  assert.deepEqual(db._docs['teams/crew/keyEpochs/1'].memberUids, ['alice', 'bob']);
  assert.deepEqual(db._docs['teams/crew/keyEpochs/1'].wrappedKeys.bob, MEMBER_WRAP);
  assert.equal(db._docs['teamInvites/inv1'].status, 'accepted');
  assert.equal(Object.values(db._docs).filter((doc) => doc.action === 'accepted').length, 1);
  await executeRequestTeamKeyRotation('bob', {
    teamId: 'crew', reason: 'member_left', targetUid: 'bob',
  }, db, 3);
  assert.equal(db._docs['teams/crew'].keyRotationStatus, 'rotation_pending');
});

test('acceptInvite refuses an old epoch and a team awaiting rotation', async () => {
  const team = buildTeamDocument('alice', 'Crew', OWNER_WRAP, 1);
  team.activeKeyEpoch = 2;
  team.activeKeyId = 'epoch-two';
  team.keyRotationStatus = 'active';
  const invite = buildInviteDocument({
    teamId: 'crew', teamName: 'Crew', fromUid: 'alice', uid: 'bob',
    emailHash: 'abc', wrappedKey: MEMBER_WRAP, keyEpoch: 1,
    keyId: 'epoch-one', now: 1, ttlMs: 1_000,
  });
  const db = makeDb({
    'teams/crew': team,
    'teams/crew/keyEpochs/2': {
      epoch: 2, keyId: 'epoch-two', status: 'active', memberUids: ['alice'],
      wrappedKeys: { alice: OWNER_WRAP },
    },
    'teamInvites/inv1': invite,
  });
  await assert.rejects(() => executeAcceptInvite('bob', { inviteId: 'inv1' }, db, 2),
    (error) => httpsCode(error) === 'failed-precondition');
  assert.equal(db._docs['teamInvites/inv1'].status, 'revoked');
  assert.deepEqual(db._docs['teams/crew'].memberUids, ['alice']);
  db._docs['publicProfiles/bob'] = {
    uid: 'bob', displayName: 'Bob', emailHash: hashEmail('bob@example.com'),
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----',
  };
  db._docs['users/alice'] = {}; db._docs['users/bob'] = {};
  const fresh = await executeInviteMember('alice', {
    ...inviteContext('alice', 'bob', 2, 'epoch-two'),
    teamId: 'crew', email: 'bob@example.com', wrappedKey: MEMBER_WRAP,
  }, db, { getUserByEmail: async email => ({ uid: 'bob', email, emailVerified: true }) }, 3);
  assert.equal(db._docs[`teamInvites/${fresh.inviteId}`].keyEpoch, 2);
  assert.equal(db._docs[`teamInvites/${fresh.inviteId}`].keyId, 'epoch-two');
  db._docs['teams/crew'].keyRotationStatus = 'rotation_pending';
  await assert.rejects(() => executeAcceptInvite('bob', { inviteId: fresh.inviteId }, db, 4),
    (error) => httpsCode(error) === 'failed-precondition');
});

test('rotation freezes membership, validates exact wraps, and commits only once', async () => {
  const team = buildTeamDocument('alice', 'Crew', OWNER_WRAP, 1);
  team.memberUids = ['alice', 'bob', 'carol'];
  team.wrappedKeys.bob = MEMBER_WRAP;
  team.wrappedKeys.carol = { v: 1, alg: 'RSA-OAEP', ct: 'cipher-carol-wrap-cccccccc' };
  team.roles = { alice: 'owner', bob: 'member', carol: 'admin' };
  const pemAlice = 'synthetic-public-alice';
  const pemCarol = 'synthetic-public-carol';
  const db = makeDb({ 'teams/crew': team,
    'publicProfiles/alice': { publicKeyPem: pemAlice }, 'publicProfiles/carol': { publicKeyPem: pemCarol } });
  const requested = await executeRequestTeamKeyRotation('alice', {
    teamId: 'crew', reason: 'member_removed', targetUid: 'bob',
  }, db, 100);
  assert.equal(db._docs['teams/crew'].memberUids.includes('bob'), false);
  assert.equal(db._docs['teams/crew'].keyRotationStatus, 'rotation_pending');
  const newKeyId = '123e4567-e89b-42d3-a456-426614174000';
  const wrapAlice = { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 1).toString('base64') };
  const wrapCarol = { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 2).toString('base64') };
  const input = { rotationId: requested.rotationId, expectedOldEpoch: 1, newKeyId,
    wrappedKeys: { alice: wrapAlice, carol: wrapCarol }, publicKeyFingerprints: {
      alice: createHash('sha256').update(pemAlice).digest('hex'), carol: createHash('sha256').update(pemCarol).digest('hex') } };
  await assert.rejects(() => executeCommitTeamKeyRotation('bob', input, db, 110),
    (error) => httpsCode(error) === 'permission-denied');
  await assert.rejects(() => executeCommitTeamKeyRotation('carol', { ...input, wrappedKeys: { alice: wrapAlice } }, db, 110),
    (error) => httpsCode(error) === 'failed-precondition');
  await assert.rejects(() => executeCommitTeamKeyRotation('carol', { ...input, wrappedKeys: { ...input.wrappedKeys, bob: MEMBER_WRAP } }, db, 110),
    (error) => httpsCode(error) === 'failed-precondition');
  await assert.rejects(() => executeCommitTeamKeyRotation('carol', { ...input, teamKey: TEAM_KEY_PLAIN }, db, 110),
    (error) => httpsCode(error) === 'invalid-argument');
  assert.equal(db._docs['teams/crew'].keyRotationStatus, 'rotation_pending');
  await assert.rejects(() => executeCommitTeamKeyRotation('carol', { ...input, publicKeyFingerprints: undefined }, db, 110),
    (error) => httpsCode(error) === 'invalid-argument');
  db._docs['publicProfiles/carol'].publicKeyPem = 'synthetic-changed-public-key';
  await assert.rejects(() => executeCommitTeamKeyRotation('carol', input, db, 110),
    (error) => httpsCode(error) === 'failed-precondition');
  assert.equal(db._docs['teams/crew'].keyRotationStatus, 'rotation_pending');
  assert.equal(db._docs['teams/crew/keyEpochs/2'], undefined);
  db._docs['publicProfiles/carol'].publicKeyPem = pemCarol;
  db._docs['accountDeletions/alice'] = { status: 'deleting' };
  await assert.rejects(executeCommitTeamKeyRotation('carol', input, db, 110), error => httpsCode(error) === 'failed-precondition');
  assert.equal(db._docs['teams/crew/keyEpochs/2'], undefined); delete db._docs['accountDeletions/alice'];
  const committed = await executeCommitTeamKeyRotation('carol', input, db, 111);
  assert.deepEqual(committed, { ok: true, teamId: 'crew', newEpoch: 2, alreadyCommitted: false });
  assert.equal(db._docs['teams/crew'].keyRotationStatus, 'active');
  assert.equal(db._docs['teams/crew/keyEpochs/1'].status, 'retired');
  assert.deepEqual(db._docs['teams/crew/keyEpochs/2'].memberUids, ['alice', 'carol']);
  assert.equal(db._docs['teams/crew/keyEpochs/2'].wrappedKeys.bob, undefined);
  assert.equal((await executeCommitTeamKeyRotation('carol', input, db, 112)).alreadyCommitted, true);
  db._docs['accountDeletions/carol'] = { status: 'complete' };
  await assert.rejects(executeCommitTeamKeyRotation('carol', input, db, 112), error => httpsCode(error) === 'failed-precondition');
  delete db._docs['accountDeletions/carol'];
  await assert.rejects(() => executeCommitTeamKeyRotation('carol', { ...input,
    publicKeyFingerprints: { ...input.publicKeyFingerprints, carol: 'a'.repeat(64) } }, db, 112),
    (error) => httpsCode(error) === 'already-exists');
  await assert.rejects(() => executeCommitTeamKeyRotation('carol', {
    ...input, newKeyId: '123e4567-e89b-42d3-a456-426614174001',
  }, db, 113), (error) => httpsCode(error) === 'already-exists');
  assert.equal(Object.values(db._docs).filter((doc) => doc.action === 'rotation_committed').length, 1);
});

test('rotation requests are idempotent across member removal and pending updates', async () => {
  const team = buildTeamDocument('alice', 'Crew', OWNER_WRAP, 1);
  team.memberUids = ['alice', 'bob', 'carol'];
  team.wrappedKeys.bob = MEMBER_WRAP;
  team.wrappedKeys.carol = { v: 1, alg: 'RSA-OAEP', ct: 'cipher-carol-wrap-cccccccc' };
  team.roles = { alice: 'owner', bob: 'member', carol: 'member' };
  const db = makeDb({ 'teams/crew': team });
  const firstKey = '123e4567-e89b-42d3-a456-426614174000';
  const secondKey = '123e4567-e89b-42d3-a456-426614174001';
  const firstInput = {
    teamId: 'crew', reason: 'member_removed', targetUid: 'bob', idempotencyKey: firstKey,
  };
  const first = await executeRequestTeamKeyRotation('alice', firstInput, db, 100);
  assert.deepEqual(await executeRequestTeamKeyRotation('alice', firstInput, db, 101), first);
  assert.equal(Object.values(db._docs).filter((doc) => doc.action === 'member_removed').length, 1);

  const secondInput = {
    teamId: 'crew', reason: 'member_removed', targetUid: 'carol', idempotencyKey: secondKey,
  };
  const second = await executeRequestTeamKeyRotation('alice', secondInput, db, 102);
  assert.deepEqual(second, first);
  assert.deepEqual(await executeRequestTeamKeyRotation('alice', secondInput, db, 103), first);
  assert.deepEqual(db._docs['teams/crew'].memberUids, ['alice']);
  assert.equal(Object.values(db._docs).filter((doc) => doc.action === 'member_removed').length, 2);
  await assert.rejects(() => executeRequestTeamKeyRotation('alice', {
    ...firstInput, targetUid: 'carol',
  }, db, 104), (error) => httpsCode(error) === 'already-exists');
  await assert.rejects(() => executeRequestTeamKeyRotation('alice', {
    ...firstInput, idempotencyKey: 'invalid',
  }, db, 105), (error) => httpsCode(error) === 'invalid-argument');
});

test('account deletion requests rotation for every remaining team', async () => {
  const team = buildTeamDocument('alice', 'Crew', OWNER_WRAP, 1);
  team.memberUids = ['alice', 'bob'];
  team.wrappedKeys.bob = MEMBER_WRAP;
  team.roles = { alice: 'owner', bob: 'member' };
  const db = makeDb({ 'teams/one': team, 'teams/two': { ...team, name: 'Second' },
    'accountDeletions/bob': { v: 1, status: 'deleting', phase: 'documents' } });
  const touched = await purgeUserTeamMemberships('bob', db);
  assert.equal(touched, 2);
  for (const id of ['one', 'two']) {
    assert.deepEqual(db._docs[`teams/${id}`].memberUids, ['alice']);
    assert.equal(db._docs[`teams/${id}`].keyRotationStatus, 'rotation_pending');
  }
  assert.equal(Object.values(db._docs).filter((doc) => doc.status === 'pending' && doc.oldEpoch === 1).length, 2);
});

test('account membership cleanup preserves an owned team until its object and child purge is completed', async () => {
  const db = makeDb({ 'teams/crew': buildTeamDocument('alice', 'Crew', OWNER_WRAP, 1),
    'teams/crew/keyEpochs/1': { synthetic: true }, 'accountDeletions/alice': { v: 1, status: 'deleting', phase: 'documents' } });
  await assert.rejects(purgeUserTeamMemberships('alice', db), error => httpsCode(error) === 'failed-precondition');
  assert.ok(db._docs['teams/crew']); assert.ok(db._docs['teams/crew/keyEpochs/1']);
});

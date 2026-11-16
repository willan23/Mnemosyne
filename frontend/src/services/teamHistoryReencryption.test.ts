import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { cancelTeamHistoryReencryption, rewriteTeamHistoryEntry, runTeamHistoryReencryption, type TeamHistoryCheckpoint, type TeamHistoryControl, type TeamHistoryDeps } from './teamHistoryReencryption';
import { decryptMemoryEnvelope, encryptMemoryFields, setMemoryCryptoKeyForTests } from './memoryCrypto';
import { decryptTeamMemoryEnvelope, decryptTeamMemoryPayload, recipherTeamMemoryEnvelope, encryptLegacyTeamMemoryFields, generateTeamKey } from './teamVault';
import type { TeamRecord } from './teamsService';
import type { StoredTeamHistoryChange } from './teamHistoryChangeStore';
import { teamHistoryChangeRequestBytes, type TeamHistoryChangeRequest } from '../../../functions/src/teamHistoryChangeContract';
import { canonicalSyncState } from '../../../functions/src/mobileSyncImportContract';
import { cancelTeamHistoryChangeWithinJob, recoverTeamHistoryChangeWithinJob } from './teamHistoryChangeRecovery';
const state = vi.hoisted(() => ({ enabled: true, docs: {} as Record<string, Record<string, unknown>>, commits: 0,
  beforeRead: () => undefined as void, afterCommit: () => undefined as void }));
vi.mock('../firebase', () => ({ default: {}, auth: { currentUser: { uid: 'alice' } }, db: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: () => () => {} }));
vi.mock('../config/releaseGates', () => ({ get TEAM_HISTORY_REENCRYPTION_ENABLED() { return state.enabled; } }));
vi.mock('firebase/firestore', async original => ({ ...await original<typeof import('firebase/firestore')>(),
  doc: (...args: Array<string | { path?: string }>) => ({ path: args.map(item => typeof item === 'string' ? item : item.path).filter(Boolean).join('/') }),
  runTransaction: async (_db: unknown, work: (tx: unknown) => Promise<unknown>) => {
    state.beforeRead(); const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
    const result = await work({ get: async (ref: { path: string }) => ({ exists: () => Boolean(state.docs[ref.path]), data: () => structuredClone(state.docs[ref.path]) }),
      update: (ref: { path: string }, data: Record<string, unknown>) => writes.push({ path: ref.path, data }) });
    for (const write of writes) { Object.assign(state.docs[write.path], write.data); state.commits++; }
    state.afterCommit(); return result;
  } }));
const words = Array.from({ length: 12 }, () => 'synthetic');
const keyId = '11111111-1111-4111-8111-111111111111';
const wrap = { v: 1 as const, alg: 'RSA-OAEP' as const, ct: 'synthetic-wrap' };
let oldKey: CryptoKey; let activeKey: CryptoKey;
beforeEach(async () => { state.enabled = true; state.commits = 0; state.beforeRead = () => undefined; state.afterCommit = () => undefined;
  oldKey = await generateTeamKey(); activeKey = await generateTeamKey(); setMemoryCryptoKeyForTests(await generateTeamKey()); });
afterEach(() => { setMemoryCryptoKeyForTests(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup(uid = 'alice') {
  let actor = uid; let generation = 0; let cryptoChanged = () => undefined as void; let control: TeamHistoryControl = 'run';
  let team: TeamRecord = { id: 'crew', name: 'Synthetic', ownerUid: 'alice', createdAt: 1, memberUids: ['alice', 'bob'],
    roles: { alice: 'owner', bob: 'admin' }, wrappedKeys: { alice: wrap, bob: wrap }, activeKeyEpoch: 2, activeKeyId: keyId, keyRotationStatus: 'active', pendingRotationId: null };
  const enc = await encryptLegacyTeamMemoryFields(oldKey, { text: 'Synthetic historical text', title: 'Synthetic title' });
  state.docs = { 'teams/crew': structuredClone(team), 'teams/crew/keyEpochs/2': { status: 'active', keyId, memberUids: ['alice', 'bob'], wrappedKeys: { alice: wrap, bob: wrap } },
    'sessions/a': { teamId: 'crew', uid: 'alice', timestamp: 1, updatedAt: 10, text: '', title: null, enc, deletedAt: 20, tags: ['synthetic'] },
    'sessions/a/versions/1': { editorUid: 'alice', createdAt: 8, previousUpdatedAt: 7, text: '', title: null, enc },
    'sessions/a/versions/2': { teamId: 'crew', keyEpoch: 1, keyId: null, editorUid: 'bob', createdAt: 10, previousUpdatedAt: 8, text: '', title: null, enc },
    'sessions/b': { teamId: 'crew', uid: 'bob', timestamp: 2, updatedAt: 11, text: '', title: null, enc } };
  const storage = new Map<string, string>(); const progress: TeamHistoryCheckpoint[] = [];
  const deps: TeamHistoryDeps = { firestore: {} as Firestore, currentUid: () => actor, cryptoReady: () => true, cacheGeneration: () => generation,
    subscribeCrypto: cb => { cryptoChanged = cb; return vi.fn(); }, now: () => 50,
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } },
    exclusive: async (_name, work) => work(), loadTeam: vi.fn(async () => structuredClone(team)),
    loadSession: async sessionId => ({ sessionId, data: structuredClone(state.docs[`sessions/${sessionId}`]) }),
    page: vi.fn(async (_teamId, sessionId, after, size) => Object.keys(state.docs).filter(path => sessionId ? path.startsWith(`sessions/${sessionId}/versions/`) : path.startsWith('sessions/') && path.split('/').length === 2)
      .sort().filter(path => (path.split('/').at(-1)!) > (after ?? '')).slice(0, size).map(path => ({ sessionId: sessionId ?? path.split('/')[1],
        ...(sessionId ? { versionId: path.split('/').at(-1)! } : {}), data: structuredClone(state.docs[path]) }))),
    encryptCheckpoint: encryptMemoryFields, decryptCheckpoint: decryptMemoryEnvelope,
    unlock: vi.fn(async (_team, _uid, _words, options) => options?.epoch === 1 ? oldKey : activeKey),
    rewrite: (entry, team, uid, jobId, words, guard, confirmed) => rewriteTeamHistoryEntry(entry, team, uid, jobId, words, guard, deps, confirmed),
    cancelEntry: cancelTeamHistoryChangeWithinJob, recoverEntry: recoverTeamHistoryChangeWithinJob };
  // Synthetic transport only: the actual server executor and transactions have separate emulator coverage.
  const journals = new Map<string, StoredTeamHistoryChange>(), receipts = new Map<string, unknown>();
  const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(typeof value === 'string' ? value : canonicalSyncState(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
  deps.changeClient = { enabled: () => state.enabled, jobStorage: deps.storage, store: {
    get: async (_uid, teamId) => journals.get(teamId), teams: async () => [...journals.keys()],
    compareExchange: async (_uid, teamId, expected, next, guard) => { guard(); expect(journals.has(teamId) ? JSON.stringify(journals.get(teamId)) : null).toBe(expected); if (next) journals.set(teamId, next); else journals.delete(teamId); },
  }, id: () => crypto.randomUUID(), exclusive: deps.exclusive, generation: () => deps.cacheGeneration(), observe: () => () => {},
    encrypt: encryptMemoryFields, decrypt: decryptMemoryEnvelope, readTeam: async () => structuredClone(state.docs['teams/crew']),
    readParent: async id => structuredClone(state.docs[`sessions/${id}`]), unlock: (...args) => deps.unlock(...args), recipher: recipherTeamMemoryEnvelope,
    openPayload: decryptTeamMemoryPayload, mutation: { uid: () => deps.currentUid(), ready: () => deps.cryptoReady(), subscribe: () => () => {} },
    call: async (mode, command) => {
      if (mode === 'prepare') {
        const target = command.request as TeamHistoryChangeRequest['baseline'], path = `sessions/${target.sessionId}${target.versionId ? `/versions/${target.versionId}` : ''}`;
        const data = state.docs[path], parent = state.docs[`sessions/${target.sessionId}`];
        if (target.viewDigest !== await hash(data) || target.parentViewDigest !== await hash(parent) || target.teamViewDigest !== await hash(state.docs['teams/crew'])) throw Error('Stale view');
        const alreadyTarget = (data.enc as { v: number }).v === 2 && data.keyEpoch === 2 && data.keyId === keyId;
        return { ...target, actorUid: uid, ownerUid: 'alice', stateHash: await hash(data), parentHash: await hash(parent), teamHash: await hash(state.docs['teams/crew']),
          epochHash: await hash(state.docs['teams/crew/keyEpochs/2']), priorEpochHash: 'd'.repeat(64), priorEpoch: data.keyEpoch ?? 1,
          priorKeyId: (data.enc as { v: number }).v === 1 ? null : data.keyId, rekeyRevision: data.rekeyRevision ?? 0, alreadyTarget };
      }
      const request = command.request as TeamHistoryChangeRequest, b = request.baseline;
      const result = { operationId: request.operationId, teamId: b.teamId, jobId: b.jobId, sessionId: b.sessionId, versionId: b.versionId,
        digest: await hash(teamHistoryChangeRequestBytes(request)), status: 'unknown', result: null, changed: null, rekeyRevision: null, createdAt: null };
      if (receipts.has(request.operationId)) return receipts.get(request.operationId);
      if (mode === 'status') return result;
      if (mode === 'cancel') { const receipt = { ...result, status: 'cancelled', createdAt: 1000 }; receipts.set(request.operationId, receipt); return receipt; }
      state.beforeRead(); const path = `sessions/${b.sessionId}${b.versionId ? `/versions/${b.versionId}` : ''}`, data = state.docs[path];
      if (b.stateHash !== await hash(data) || b.parentHash !== await hash(state.docs[`sessions/${b.sessionId}`]) || b.teamHash !== await hash(state.docs['teams/crew']) || b.epochHash !== await hash(state.docs['teams/crew/keyEpochs/2'])) throw Error('Stale baseline');
      if (!b.alreadyTarget) { Object.assign(data, { enc: request.enc, teamId: b.teamId, keyEpoch: b.targetEpoch, keyId: b.targetKeyId,
        rekeyRevision: b.rekeyRevision + 1, rekeyJobId: b.jobId, rekeyedByUid: uid }); state.commits++; }
      const receipt = { ...result, status: 'committed', result: !b.alreadyTarget || data.rekeyJobId === b.jobId ? 'rewritten' : 'already-target',
        changed: !b.alreadyTarget, rekeyRevision: b.rekeyRevision + (b.alreadyTarget ? 0 : 1), createdAt: 1000 };
      receipts.set(request.operationId, receipt); state.afterCommit(); return receipt;
    } };
  const input = { uid, teamId: 'crew', mnemonic: words, confirmed: true as const, control: () => control, onProgress: (job: TeamHistoryCheckpoint) => progress.push(job) };
  return { deps, input, storage, progress, pause: () => { control = 'pause'; }, resume: () => { control = 'run'; }, cancel: () => { control = 'cancel'; },
    changeUid: () => { actor = 'other'; }, changeGeneration: () => { generation++; }, changeCrypto: () => cryptoChanged(),
    setTeam: (value: Partial<TeamRecord>) => { team = { ...team, ...value }; state.docs['teams/crew'] = structuredClone(team); }, team: () => team };
}
it('reciphers parents, tombstones and legacy versions without changing semantic metadata or duplicating history', async () => {
  const sample = await setup('bob'); const before = structuredClone(state.docs);
  const result = await runTeamHistoryReencryption(sample.input, sample.deps);
  expect(result).toMatchObject({ status: 'complete', scanned: 4, rewritten: 4, alreadyTarget: 0 });
  expect(Object.keys(state.docs).length).toBe(Object.keys(before).length);
  for (const path of Object.keys(state.docs).filter(path => path.startsWith('sessions/'))) {
    const data = state.docs[path]; expect(data.keyEpoch).toBe(2); expect(data.rekeyedByUid).toBe('bob');
    const context = { teamId: 'crew', keyEpoch: 2, keyId };
    expect((await decryptTeamMemoryEnvelope(activeKey, data.enc as Parameters<typeof decryptTeamMemoryEnvelope>[1], context)).text === 'Synthetic historical text').toBe(true);
    await expect(decryptTeamMemoryEnvelope(oldKey, data.enc as Parameters<typeof decryptTeamMemoryEnvelope>[1], context)).rejects.toBeTruthy();
    for (const key of ['uid', 'timestamp', 'updatedAt', 'deletedAt', 'createdAt', 'previousUpdatedAt', 'editorUid', 'tags']) expect(data[key]).toEqual(before[path][key]);
  }
  const stored = [...sample.storage.values()][0]; expect(Object.keys(JSON.parse(stored)).sort()).toEqual(['ct', 'iv', 'v']);
  expect(stored.includes('Synthetic historical text') || stored.includes('"sessionCursor"')).toBe(false);
  expect(sample.progress[0].scanned).toBe(0); expect(state.commits).toBe(4);
});
it('compares ciphertext values independently of Firestore map property ordering', async () => {
  const sample = await setup(); const load = sample.deps.loadSession;
  sample.deps.loadSession = async id => { const entry = await load(id); const enc = entry.data.enc as { v: number; iv: string; ct: string };
    return { ...entry, data: { ...entry.data, enc: { ct: enc.ct, iv: enc.iv, v: enc.v } } };
  };
  await expect(runTeamHistoryReencryption(sample.input, sample.deps)).resolves.toMatchObject({ status: 'complete', rewritten: 4 });
});
it('pauses within version pagination, resumes exact cursor and does not duplicate writes', async () => {
  const sample = await setup(); const rewrite = sample.deps.rewrite;
  sample.deps.rewrite = async (...args) => { const result = await rewrite(...args); if (args[0].versionId === '1') sample.pause(); return result; };
  const paused = await runTeamHistoryReencryption(sample.input, sample.deps);
  expect(paused).toMatchObject({ status: 'paused', currentSession: 'a', versionCursor: '1', scanned: 2 });
  sample.resume(); await expect(runTeamHistoryReencryption(sample.input, sample.deps)).resolves.toMatchObject({ status: 'complete', rewritten: 4 });
  expect(state.commits).toBe(4);
});
it('walks multiple bounded version pages with one write in flight and counts already-current data separately', async () => {
  const sample = await setup(); const template = state.docs['sessions/a/versions/1'];
  for (let index = 0; index < 25; index++) state.docs[`sessions/a/versions/v${String(index).padStart(2, '0')}`] = structuredClone(template);
  let active = 0; let maximum = 0; const rewrite = sample.deps.rewrite;
  sample.deps.rewrite = async (...args) => { active++; maximum = Math.max(maximum, active); try { return await rewrite(...args); } finally { active--; } };
  await expect(runTeamHistoryReencryption(sample.input, sample.deps)).resolves.toMatchObject({ status: 'complete', rewritten: 29 });
  expect(maximum).toBe(1);
  expect(vi.mocked(sample.deps.page).mock.calls.some(call => call[1] === 'a' && call[2] !== null)).toBe(true);
  expect(vi.mocked(sample.deps.page).mock.calls.every(call => call[3] <= 10)).toBe(true);
  const commits = state.commits;
  await expect(runTeamHistoryReencryption({ ...sample.input, newScan: true }, sample.deps)).resolves.toMatchObject({ status: 'complete', rewritten: 0, alreadyTarget: 29 });
  expect(state.commits).toBe(commits);
});
it('suppresses an acknowledgement after account change and resumes the durable cursor without a second rewrite', async () => {
  const sample = await setup(); state.afterCommit = () => { state.afterCommit = () => undefined; sample.changeUid(); };
  await expect(runTeamHistoryReencryption(sample.input, sample.deps)).rejects.toMatchObject({ reason: 'access-changed' });
  expect(sample.progress.at(-1)!.scanned).toBe(0); expect(state.commits).toBe(1);
  sample.deps.currentUid = () => 'alice';
  await expect(runTeamHistoryReencryption(sample.input, sample.deps)).resolves.toMatchObject({ status: 'complete', rewritten: 4 });
  expect(state.commits).toBe(4);
});
it('recovers a lost ACK and a checkpoint failure after commit without rewriting or miscounting the acknowledged operation', async () => {
  for (const mode of ['ack', 'storage'] as const) {
    const sample = await setup(); state.commits = 0;
    if (mode === 'ack') state.afterCommit = () => { state.afterCommit = () => undefined; throw new Error('Synthetic lost acknowledgement'); };
    else { const save = sample.deps.storage.setItem; sample.deps.storage.setItem = (key, value) => {
      if (state.commits === 1) { sample.deps.storage.setItem = save; throw new Error('Synthetic storage failure'); } save(key, value);
    }; }
    await expect(runTeamHistoryReencryption(sample.input, sample.deps)).rejects.toBeTruthy();
    await expect(runTeamHistoryReencryption(sample.input, sample.deps)).resolves.toMatchObject({ status: 'complete', rewritten: 4 });
    expect(state.commits).toBe(4);
  }
});
it('cancels locally even after epoch change or release closure; a fresh scan requires a terminal checkpoint', async () => {
  const sample = await setup(); sample.pause(); await runTeamHistoryReencryption(sample.input, sample.deps);
  await expect(runTeamHistoryReencryption({ ...sample.input, newScan: true }, sample.deps)).rejects.toMatchObject({ reason: 'invalid' });
  sample.setTeam({ activeKeyEpoch: 3 }); state.enabled = false;
  await expect(cancelTeamHistoryReencryption('alice', 'crew', sample.deps)).resolves.toMatchObject({ status: 'cancelled' });
  expect(state.commits).toBe(0); state.enabled = true; sample.setTeam({ activeKeyEpoch: 2 }); sample.resume();
  await expect(runTeamHistoryReencryption({ ...sample.input, newScan: true }, sample.deps)).resolves.toMatchObject({ status: 'complete' });
});
it('stops on stale ciphertext, pending rotation or changed account/vault/cache before commit', async () => {
  for (const mode of ['cipher', 'pending', 'uid', 'crypto', 'generation'] as const) {
    const sample = await setup(); const unlock = sample.deps.unlock;
    sample.deps.unlock = async (...args) => { const key = await unlock(...args);
      if (mode === 'cipher') state.docs['sessions/a'].updatedAt = 11;
      if (mode === 'pending') sample.setTeam({ keyRotationStatus: 'rotation_pending' });
      if (mode === 'uid') sample.changeUid(); if (mode === 'crypto') sample.changeCrypto(); if (mode === 'generation') sample.changeGeneration();
      return key;
    };
    await expect(runTeamHistoryReencryption(sample.input, sample.deps)).rejects.toBeTruthy(); expect(state.commits).toBe(0);
  }
});
it('refuses member/removed accounts, unreadable checkpoints, unavailable storage, a closed gate and lock failures', async () => {
  for (const mode of ['member', 'removed', 'invalid', 'storage', 'closed', 'busy'] as const) {
    const sample = await setup('bob');
    if (mode === 'member') sample.setTeam({ roles: { alice: 'owner', bob: 'member' } });
    if (mode === 'removed') sample.setTeam({ memberUids: ['alice'] });
    if (mode === 'invalid') sample.storage.set('mnemosyne:team-history:v1:bob:crew', 'invalid');
    if (mode === 'storage') sample.deps.storage.setItem = () => { throw new Error('Synthetic storage failure'); };
    if (mode === 'closed') state.enabled = false;
    if (mode === 'busy') sample.deps.exclusive = async () => { throw new Error('Synthetic busy lock'); };
    await expect(runTeamHistoryReencryption(sample.input, sample.deps)).rejects.toBeTruthy(); expect(state.commits).toBe(0); state.enabled = true;
  }
});
it('fails closed on platforms without Web Locks and on an occupied browser lock', async () => {
  const sample = await setup(); vi.stubGlobal('navigator', { locks: undefined });
  await expect(runTeamHistoryReencryption(sample.input)).rejects.toMatchObject({ reason: 'unsupported' });
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, work: (lock: null) => Promise<void>) => work(null) } });
  await expect(runTeamHistoryReencryption(sample.input)).rejects.toMatchObject({ reason: 'busy' });
  expect(state.commits).toBe(0);
});

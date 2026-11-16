import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
vi.mock('../firebase', () => ({ default: {}, auth: {}, db: {} }));
import { buildEncryptedMemoryFields, decryptMemoryEnvelope, encryptMemoryFields, isMemoryCryptoReady, recipherMemoryEnvelope, setMemoryCryptoMnemonic } from './memoryCrypto';
import { decryptTeamMemoryEnvelope, encryptTeamMemoryFields, recipherTeamMemoryEnvelope } from './teamVault';
import { memoryEditStateDigest, type MemoryEditDeps } from './memoryEditRecovery';
import { agentReversalCheckpointKey, previewAgentReversal, confirmAgentReversal, recoverAgentReversal, cancelAgentReversal, type AgentReversalClientDeps } from './agentReversalRecovery';
import { agentReversalRequestBytes, type AgentReversalBaseline, type AgentReversalOutcome, type AgentReversalPreparation, type AgentReversalRequest } from '../../../functions/src/agentReversalContract';
import { canonicalSyncState } from '../../../functions/src/mobileSyncImportContract';
const words = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident'];
const proposalId = '32345678-1234-4234-8234-123456789012', operationId = '42345678-1234-4234-8234-123456789012';
const oldId = '12345678-1234-4234-8234-123456789012', nextId = '52345678-1234-4234-8234-123456789012';
const sourceFields = { text: 'Synthetic archived body', title: 'Synthetic archived title' }, currentFields = { text: 'Synthetic applied body', title: 'Synthetic applied title' };
const checkpoint = agentReversalCheckpointKey('alice');
let deps: AgentReversalClientDeps, uid: string, enabled: boolean, team: boolean, generation: number, stamp: number, sourceStamp: number;
let current: Record<string, unknown>, sourceEnc: AgentReversalRequest['enc'], oldKey: CryptoKey, activeKey: CryptoKey, receipt: AgentReversalOutcome | undefined;
let storage: Map<string, string>, listeners: Set<() => void>, teamListeners: Set<() => void>, failStatus: boolean, loseAck: boolean, failStorage: boolean, failRemoval: boolean, revoked: boolean;
let modeChanged: (mode: string) => void;
const rpc = vi.fn(), id = vi.fn(), recipherPersonal = vi.fn(recipherMemoryEnvelope), recipherTeam = vi.fn(recipherTeamMemoryEnvelope);
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
async function preparation(): Promise<AgentReversalPreparation> {
  const baseline: AgentReversalBaseline = { proposalId, sessionId: 'note', teamId: team ? 'crew' : null, authorUid: 'alice', ownerUid: team ? 'owner' : 'alice', originalDigest: 'a'.repeat(64), originalRevision: 1002, revision: 1002, reversalEpoch: 0,
    stateHash: await hash(canonicalSyncState([current, stamp])), stateDigest: await memoryEditStateDigest(current), versionId: 'memory-edit-' + proposalId, versionHash: await hash(canonicalSyncState([sourceEnc, sourceStamp])),
    teamStateHash: team ? 'e'.repeat(64) : null, epochStateHash: team ? 'f'.repeat(64) : null, keyEpoch: team ? 2 : null, keyId: team ? nextId : null,
    currentKeyEpoch: team ? 1 : null, currentKeyId: team ? oldId : null, sourceKeyEpoch: team ? 1 : null, sourceKeyId: team ? oldId : null };
  return { baseline, currentEnc: structuredClone(current.enc as AgentReversalRequest['enc']), sourceEnc: structuredClone(sourceEnc), currentMetadata: { tags: ['changed'], category: 'new', color: '#112233' },
    sourceMetadata: { tags: ['original'], category: null }, currentLearning: { score: 2, revisedAt: 1002 }, sourceLearning: { score: 2 }, currentLearningPresent: true, sourceLearningPresent: true, deleted: current.deletedAt != null };
}
beforeEach(async () => {
  setMemoryCryptoMnemonic(words); uid = 'alice'; enabled = true; team = false; generation = 1; stamp = 1; sourceStamp = 1; receipt = undefined; storage = new Map(); listeners = new Set(); teamListeners = new Set();
  failStatus = false; loseAck = false; failStorage = false; failRemoval = false; revoked = false; modeChanged = () => {};
  oldKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); activeKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  sourceEnc = (await buildEncryptedMemoryFields(sourceFields.text, sourceFields.title)).enc;
  current = { uid: 'alice', teamId: null, timestamp: 1, updatedAt: 1002, ...await buildEncryptedMemoryFields(currentFields.text, currentFields.title), tags: ['changed'], color: '#112233', category: 'new', learning: { score: 2, revisedAt: 1002 }, lastVersionId: 'memory-edit-' + proposalId };
  id.mockReset(); id.mockReturnValue(operationId); recipherPersonal.mockClear(); recipherTeam.mockClear(); rpc.mockReset();
  const cryptoDeps: MemoryEditDeps = { enabled: () => enabled, storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (failStorage) throw Error('Synthetic storage full'); storage.set(key, value); }, removeItem: key => { if (failRemoval) throw Error('Synthetic removal failure'); storage.delete(key); } } as Storage,
    id, exclusive: async (_key, work) => work(), read: async () => structuredClone(current), key: async (base, prior, guard) => { guard(); return team ? (prior ? base.priorKeyEpoch : base.keyEpoch) === 1 ? oldKey : activeKey : null; },
    encryptJournal: encryptMemoryFields, decryptJournal: decryptMemoryEnvelope, encryptPersonal: buildEncryptedMemoryFields, decryptPersonal: decryptMemoryEnvelope,
    encryptTeam: encryptTeamMemoryFields, decryptTeam: decryptTeamMemoryEnvelope, call: async () => { throw Error('Ordinary editor must not handle an agent reversal'); }, generation: () => generation,
    observe: (_uid, changed) => { teamListeners.add(changed); return () => { teamListeners.delete(changed); }; }, mutation: { uid: () => uid, ready: isMemoryCryptoReady, subscribe: changed => { listeners.add(changed); return () => { listeners.delete(changed); }; } } };
  rpc.mockImplementation(async (mode: string, command: { expectedUid: string; request: AgentReversalRequest; reviewDigest?: string; confirmed?: boolean }) => {
    expect(command.expectedUid).toBe('alice'); modeChanged(mode);
    if (mode === 'prepare') return preparation();
    const request = command.request, digest = await hash(agentReversalRequestBytes(request));
    const unknown: AgentReversalOutcome = { operationId: request.operationId, proposalId, sessionId: 'note', teamId: request.baseline.teamId, digest, status: 'unknown', revision: null, createdAt: null };
    if (mode === 'status') { if (failStatus) throw Error('Synthetic status failure'); return receipt ?? { ...unknown, status: revoked ? 'revoked' : 'unknown' }; }
    if (receipt) { if (receipt.digest !== digest) throw Error('Synthetic digest mismatch'); if (mode === 'apply' && receipt.status !== 'committed') throw Error('Synthetic cancelled'); return receipt; }
    if (mode === 'cancel') { receipt = { ...unknown, status: 'cancelled', createdAt: 2000 }; return receipt; }
    expect(command.confirmed).toBe(true); expect(command.reviewDigest).toBe(digest); expect(storage.has(checkpoint)).toBe(true);
    if (canonicalSyncState((await preparation()).baseline) !== canonicalSyncState(request.baseline)) throw Error('Synthetic changed baseline');
    receipt = { ...unknown, status: 'committed', revision: 2000, createdAt: 2000 };
    current = { ...current, enc: request.enc, updatedAt: 2000, tags: ['original'], category: null, learning: { score: 2 }, ...(team ? { keyEpoch: 2, keyId: nextId } : {}) }; delete current.color; delete current.deletedAt; stamp++;
    if (loseAck) throw Error('Synthetic lost acknowledgement'); return receipt;
  });
  deps = { crypto: cryptoDeps, recipherPersonal, recipherTeam, call: rpc };
});
afterEach(() => { setMemoryCryptoMnemonic(null); expect(listeners.size).toBe(0); expect(teamListeners.size).toBe(0); });
async function useTeam() {
  team = true; sourceEnc = await encryptTeamMemoryFields(oldKey, sourceFields, { teamId: 'crew', keyEpoch: 1, keyId: oldId });
  current = { ...current, teamId: 'crew', keyEpoch: 1, keyId: oldId, enc: await encryptTeamMemoryFields(oldKey, currentFields, { teamId: 'crew', keyEpoch: 1, keyId: oldId }) };
}
it.each(['personal', 'team'] as const)('reviews and reciphers %s archive independently before explicit confirmation, without plaintext RPC or journal', async scope => {
  if (scope === 'team') await useTeam(); const before = structuredClone(current), old = structuredClone(sourceEnc);
  const preview = await previewAgentReversal('alice', proposalId, () => {}, deps);
  expect(preview.before).toMatchObject({ ...currentFields, metadata: { color: '#112233', learning: { revisedAt: 1002 } } }); expect(preview.after).toMatchObject({ ...sourceFields, metadata: { category: null, learning: { score: 2 } } }); expect('color' in preview.after.metadata).toBe(false);
  expect(preview.request.enc.iv).not.toBe(old.iv); expect(current).toEqual(before); expect(storage.size).toBe(0); expect(rpc.mock.calls.every(row => row[0] === 'prepare')).toBe(true);
  expect((await confirmAgentReversal('alice', preview, () => {}, deps)).status).toBe('committed'); expect(storage.size).toBe(0);
  if (scope === 'team') { expect(await decryptTeamMemoryEnvelope(activeKey, current.enc as Parameters<typeof decryptTeamMemoryEnvelope>[1], { teamId: 'crew', keyEpoch: 2, keyId: nextId }, { strictPayload: true })).toEqual(sourceFields); await expect(decryptTeamMemoryEnvelope(oldKey, preview.request.enc, { teamId: 'crew', keyEpoch: 1, keyId: oldId })).rejects.toThrow(); expect(recipherTeam).toHaveBeenCalledOnce(); }
  else { expect(await decryptMemoryEnvelope(current.enc as Parameters<typeof decryptMemoryEnvelope>[0])).toEqual(sourceFields); expect(recipherPersonal).toHaveBeenCalledOnce(); }
  expect(JSON.stringify(rpc.mock.calls)).not.toContain('Synthetic archived body'); expect(JSON.stringify(rpc.mock.calls)).not.toContain('Synthetic applied body');
});
it('lost acknowledgement recovers from the terminal receipt with writes closed and no source/key access', async () => {
  await useTeam(); const preview = await previewAgentReversal('alice', proposalId, () => {}, deps); loseAck = true;
  await expect(confirmAgentReversal('alice', preview, () => {}, deps)).rejects.toThrow('acknowledgement'); const raw = storage.get(checkpoint)!; expect(raw).not.toContain(sourceFields.text); expect(raw).not.toContain('baseline');
  enabled = false; deps.crypto.read = async () => { throw Error('Must not read source'); }; deps.crypto.key = async () => { throw Error('Must not read keys'); }; rpc.mockClear();
  expect(await recoverAgentReversal('alice', () => {}, deps)).toEqual({ state: 'terminal', outcome: receipt }); expect(rpc.mock.calls.map(row => row[0])).toEqual(['status', 'status']); expect(id).toHaveBeenCalledOnce(); expect(storage.size).toBe(0);
});
it('unknown recovery only reconstructs the same reviewed request and never applies automatically', async () => {
  const preview = await previewAgentReversal('alice', proposalId, () => {}, deps); failStatus = true;
  await expect(confirmAgentReversal('alice', preview, () => {}, deps)).rejects.toThrow(); const raw = storage.get(checkpoint); failStatus = false; rpc.mockClear();
  const recovery = await recoverAgentReversal('alice', () => {}, deps); expect(recovery.state).toBe('review'); expect(rpc.mock.calls.some(row => row[0] === 'apply')).toBe(false); expect(storage.get(checkpoint)).toBe(raw);
  if (recovery.state !== 'review') throw Error('Missing review'); expect(recovery.preview).toEqual(preview);
  expect((await confirmAgentReversal('alice', recovery.preview, () => {}, deps)).status).toBe('committed'); expect(id).toHaveBeenCalledOnce(); expect(recipherPersonal).toHaveBeenCalledOnce();
});
it('a stale unknown request can be cancelled with writes closed and without decrypting historical team keys', async () => {
  await useTeam(); const preview = await previewAgentReversal('alice', proposalId, () => {}, deps); failStatus = true;
  await expect(confirmAgentReversal('alice', preview, () => {}, deps)).rejects.toThrow(); failStatus = false; enabled = false; stamp++; current.tags = ['changed remotely']; deps.crypto.key = async () => { throw Error('No historical key'); };
  expect((await cancelAgentReversal('alice', () => {}, deps)).status).toBe('cancelled'); expect(storage.size).toBe(0); expect(receipt?.status).toBe('cancelled'); expect(rpc.mock.calls.some(row => row[0] === 'apply')).toBe(false);
});
it.each(['account', 'vault', 'team', 'outer', 'storage'] as const)('observed %s ABA during confirmation keeps the pending ciphertext and discards the response', async change => {
  const preview = await previewAgentReversal('alice', proposalId, () => {}, deps); let active = true;
  modeChanged = mode => { if (mode !== 'apply') return; if (change === 'account') { uid = 'bob'; listeners.forEach(callback => callback()); uid = 'alice'; } if (change === 'vault') { setMemoryCryptoMnemonic(null); listeners.forEach(callback => callback()); setMemoryCryptoMnemonic(words); } if (change === 'team') teamListeners.forEach(callback => callback()); if (change === 'outer') active = false; if (change === 'storage') { const raw = storage.get(checkpoint)!; storage.set(checkpoint, 'foreign'); window.dispatchEvent(new StorageEvent('storage', { key: checkpoint })); storage.set(checkpoint, raw); } };
  await expect(confirmAgentReversal('alice', preview, () => { if (!active) throw Error('Outer review changed'); }, deps)).rejects.toThrow(); expect(storage.has(checkpoint)).toBe(true);
});
it.each(['memory', 'source', 'cipher', 'preview'] as const)('a changed %s cannot produce an approval dispatch', async change => {
  const preview = await previewAgentReversal('alice', proposalId, () => {}, deps);
  if (change === 'memory') stamp++; if (change === 'source') sourceStamp++; if (change === 'cipher') preview.request.enc = (await buildEncryptedMemoryFields('Synthetic substituted content', null)).enc; if (change === 'preview') preview.after.text = 'Substituted visible diff';
  await expect(confirmAgentReversal('alice', preview, () => {}, deps)).rejects.toThrow(); expect(storage.size).toBe(0); expect(rpc.mock.calls.some(row => row[0] === 'apply')).toBe(false);
});
it('historical key absence or wrong team AAD refuses review without a journal or writes', async () => {
  await useTeam(); sourceEnc = await encryptTeamMemoryFields(oldKey, sourceFields, { teamId: 'other', keyEpoch: 1, keyId: oldId });
  await expect(previewAgentReversal('alice', proposalId, () => {}, deps)).rejects.toThrow(); expect(storage.size).toBe(0);
  sourceEnc = await encryptTeamMemoryFields(oldKey, sourceFields, { teamId: 'crew', keyEpoch: 1, keyId: oldId }); deps.crypto.key = async () => null;
  await expect(previewAgentReversal('alice', proposalId, () => {}, deps)).rejects.toThrow(); expect(rpc.mock.calls.every(row => row[0] === 'prepare')).toBe(true);
});
it('damaged journals, wrong owners and unavailable storage never dispatch apply', async () => {
  const preview = await previewAgentReversal('alice', proposalId, () => {}, deps); failStorage = true; await expect(confirmAgentReversal('alice', preview, () => {}, deps)).rejects.toThrow(); expect(rpc.mock.calls.some(row => row[0] === 'apply')).toBe(false);
  failStorage = false; failStatus = true; await expect(confirmAgentReversal('alice', preview, () => {}, deps)).rejects.toThrow(); const raw = storage.get(checkpoint)!; failStatus = false; rpc.mockClear();
  storage.set(checkpoint, raw.replace(/"ct":"./, '"ct":"!')); await expect(recoverAgentReversal('alice', () => {}, deps)).rejects.toThrow(); expect(rpc).not.toHaveBeenCalled();
  storage.set(checkpoint, raw); uid = 'bob'; await expect(recoverAgentReversal('alice', () => {}, deps)).rejects.toThrow(); expect(rpc).not.toHaveBeenCalled();
});
it('terminal readback or journal removal failure preserves the exact checkpoint until recovery is confirmed', async () => {
  const preview = await previewAgentReversal('alice', proposalId, () => {}, deps); modeChanged = mode => { if (mode === 'apply') failStatus = true; };
  await expect(confirmAgentReversal('alice', preview, () => {}, deps)).rejects.toThrow(); const raw = storage.get(checkpoint); modeChanged = () => {}; failStatus = false; failRemoval = true;
  await expect(recoverAgentReversal('alice', () => {}, deps)).rejects.toThrow(); expect(storage.get(checkpoint)).toBe(raw); failRemoval = false; expect((await recoverAgentReversal('alice', () => {}, deps)).state).toBe('terminal'); expect(storage.size).toBe(0);
});
it('deleted memories are shown as deleted in review and restore the archived content', async () => {
  current.deletedAt = 1002; const preview = await previewAgentReversal('alice', proposalId, () => {}, deps); expect(preview.deleted).toBe(true);
  await confirmAgentReversal('alice', preview, () => {}, deps); expect('deletedAt' in current).toBe(false); expect(await decryptMemoryEnvelope(current.enc as Parameters<typeof decryptMemoryEnvelope>[0])).toEqual(sourceFields);
});
it.each(['metadata', 'learning', 'presence'] as const)('the direct current read rejects a server %s projection that would hide part of the diff', async change => {
  const call = deps.call; deps.call = async (mode, command) => {
    const value = await call(mode, command); if (mode !== 'prepare') return value;
    const prep = structuredClone(value as AgentReversalPreparation);
    if (change === 'metadata') delete prep.currentMetadata.color;
    if (change === 'learning') prep.currentLearning = { score: 2 };
    if (change === 'presence') { prep.currentLearningPresent = false; prep.currentLearning = null; }
    return prep;
  };
  await expect(previewAgentReversal('alice', proposalId, () => {}, deps)).rejects.toThrow(); expect(storage.size).toBe(0); expect(id).not.toHaveBeenCalled();
});
it('closed admission refuses confirmation before storing or dispatching an unknown reversal', async () => {
  const preview = await previewAgentReversal('alice', proposalId, () => {}, deps); enabled = false; rpc.mockClear();
  await expect(confirmAgentReversal('alice', preview, () => {}, deps)).rejects.toThrow(); expect(storage.size).toBe(0); expect(rpc).not.toHaveBeenCalled();
});
it('revoked recovery clears only after matching terminal reads and never asks for historical keys', async () => {
  await useTeam(); const preview = await previewAgentReversal('alice', proposalId, () => {}, deps); failStatus = true;
  await expect(confirmAgentReversal('alice', preview, () => {}, deps)).rejects.toThrow(); failStatus = false; revoked = true; enabled = false;
  deps.crypto.key = async () => { throw Error('No key reads after revocation'); }; rpc.mockClear();
  const recovery = await recoverAgentReversal('alice', () => {}, deps); expect(recovery.state).toBe('terminal');
  if (recovery.state !== 'terminal') throw Error('Expected revoked receipt'); expect(recovery.outcome.status).toBe('revoked'); expect(storage.size).toBe(0); expect(rpc.mock.calls.map(row => row[0])).toEqual(['status', 'status']);
});
it('real Firestore timestamp data is compared canonically and its creation time survives reversal', async () => {
  current.timestamp = Timestamp.fromMillis(1000); deps.crypto.read = async () => ({ ...current });
  const preview = await previewAgentReversal('alice', proposalId, () => {}, deps);
  expect((await confirmAgentReversal('alice', preview, () => {}, deps)).status).toBe('committed'); expect((current.timestamp as Timestamp).toMillis()).toBe(1000);
});

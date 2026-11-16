import { beforeEach, expect, it, vi } from 'vitest';
import { cancelPendingAttachedMemoryCreation, createMemoryWithAttachments, createPersonalMemory,createTeamMemory, recoverAttachedMemoryCreation, type AttachedMemoryProposal, type AttachedMemoryRecoveryDeps } from './attachedMemoryRecovery';
import { canonicalAttachedMemoryJson, type AttachedMemoryInput } from '../../../functions/src/attachedMemoryContract';
import type { MemoryPermission } from './localAiConfig';
import { decryptTextAesGcm, encryptTextAesGcm } from '../utils/crypto';
vi.mock('../firebase', () => ({ default: {}, auth: { currentUser: null }, db: {} }));
const gate = vi.hoisted(() => ({ writes: true, personal: true,team:true }));
vi.mock('../config/releaseGates', () => ({ get ATTACHMENT_WRITES_ENABLED() { return gate.writes; }, get PERSONAL_MEMORY_CREATION_ENABLED() { return gate.personal; }, get TEAM_WRITES_ENABLED(){return gate.team;} }));
const sessionId = '11111111-1111-4111-8111-111111111111'; const attachmentId = '22222222-2222-4222-8222-222222222222';
const proposal: AttachedMemoryProposal = { uid: 'alice', text: 'Synthetic confidential memory', title: 'Synthetic title',
  attachments: [{ type: 'document', name: 'Anexo cifrado', url: `mnemosyne-attachment:v1:${attachmentId}` }], metadata: { connections: [], tags: ['synthetic'] } };
async function fixture() {
  const storage = new Map<string, string>(); const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const receipts = new Map<string, string>();
  const state = { uid: 'alice' as string | null, ready: true, generation: 0, policy: 'allow-cloud' as MemoryPermission }; let changed = () => undefined;
  const outcome = async (request: AttachedMemoryInput, status: string) => {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalAttachedMemoryJson(request))));
    return { sessionId: request.sessionId, digest: Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join(''), status, createdAt: status === 'unknown' ? null : 1000 };
  };
  const deps: AttachedMemoryRecoveryDeps = { uid: () => state.uid, ready: () => state.ready, generation: () => state.generation, policy: () => state.policy, id: () => sessionId,
    subscribe: callback => { changed = callback; return () => undefined; }, exclusive: async (_name, work) => work(),
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } },
    prepare: vi.fn(async () => ({ teamId: null, keyEpoch: null, keyId: null, enc: { v: 1 as const, iv: 'A'.repeat(16), ct: 'B'.repeat(32) } })),
    create: vi.fn(async request => { receipts.set(request.sessionId, 'committed'); return outcome(request, 'committed'); }),
    status: vi.fn(async request => outcome(request, receipts.get(request.sessionId) ?? 'unknown')),
    cancel: vi.fn(async request => { receipts.set(request.sessionId, 'cancelled'); return outcome(request, 'cancelled'); }),
    forgetUploads: vi.fn(async () => undefined),
    encrypt: async ({ text }) => { const encrypted = await encryptTextAesGcm(text, key); return { v: 1, iv: encrypted.iv, ct: encrypted.data }; },
    decrypt: async envelope => ({ text: await decryptTextAesGcm({ iv: envelope.iv, data: envelope.ct }, key) }) };
  return { deps, state, storage, outcome, changed: () => changed() };
}
beforeEach(() => { gate.writes = true; gate.personal = true;gate.team=true; vi.restoreAllMocks(); });
const teamProposal={uid:'alice',text:'Synthetic team text',title:null,metadata:{connections:[]},teamId:'crew',keyEpoch:2,keyId:'33333333-3333-4333-8333-333333333333'};
it('team text synchronizes ciphertext under the captured epoch without attachment or personal admission and no AI disclosure prompt',async()=>{
  const value=await fixture();value.state.policy='never-cloud';gate.writes=false;gate.personal=false;const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);vi.mocked(value.deps.prepare).mockResolvedValue({teamId:'crew',keyEpoch:2,keyId:teamProposal.keyId,enc:{v:2,iv:'A'.repeat(16),ct:'B'.repeat(32)}});expect(await createTeamMemory(teamProposal,value.deps)).toEqual({id:sessionId});const request=vi.mocked(value.deps.create).mock.calls[0][0];expect(request).toMatchObject({teamId:'crew',keyEpoch:2,keyId:teamProposal.keyId,attachmentIds:[],enc:{v:2}});expect(canonicalAttachedMemoryJson(request)).not.toContain(teamProposal.text);expect(value.deps.forgetUploads).not.toHaveBeenCalled();expect(confirm).not.toHaveBeenCalled();
});
it('team text refuses changed epoch and closed team admission before a journal or outbound command',async()=>{
  for(const mode of ['epoch','gate']){const value=await fixture();if(mode==='gate')gate.team=false;vi.mocked(value.deps.prepare).mockResolvedValue({teamId:'crew',keyEpoch:3,keyId:teamProposal.keyId,enc:{v:2,iv:'A'.repeat(16),ct:'B'.repeat(32)}});await expect(createTeamMemory(teamProposal,value.deps)).rejects.toThrow();expect(value.deps.create).not.toHaveBeenCalled();expect(value.deps.status).not.toHaveBeenCalled();expect(value.storage.size).toBe(0);if(mode==='gate')expect(value.deps.prepare).not.toHaveBeenCalled();gate.team=true;}
});
it('team creation lost reply or late access failure conserves one stable request for closed-gate recovery without new encryption',async()=>{
  for(const mode of ['reply','access']){const value=await fixture();vi.mocked(value.deps.prepare).mockResolvedValue({teamId:'crew',keyEpoch:2,keyId:teamProposal.keyId,enc:{v:2,iv:'A'.repeat(16),ct:'B'.repeat(32)}});if(mode==='reply')vi.mocked(value.deps.create).mockRejectedValueOnce(Error('Synthetic lost ACK'));const access=vi.fn(async()=>{if(mode==='access')throw Error('Synthetic membership revoked');});await expect(createTeamMemory(teamProposal,value.deps,()=>{},access)).rejects.toThrow();const frozen=vi.mocked(value.deps.create).mock.calls[0][0];expect(value.storage.size).toBe(1);gate.team=false;vi.mocked(value.deps.status).mockImplementation(async request=>{expect(request).toEqual(frozen);return value.outcome(request,'committed');});expect((await recoverAttachedMemoryCreation('alice',value.deps)).status).toBe('committed');expect(value.deps.create).toHaveBeenCalledOnce();expect(value.deps.prepare).toHaveBeenCalledOnce();expect(value.storage.size).toBe(0);gate.team=true;}
});
it('confirmed revocation ends only its own encrypted creation journal with no retry, upload cleanup or committed claim',async()=>{
  for(const mode of ['recover','cancel']){
    const value=await fixture();vi.mocked(value.deps.create).mockRejectedValueOnce(Error('Synthetic lost reply'));
    await expect(createMemoryWithAttachments(proposal,value.deps)).rejects.toThrow();const original=[...value.storage.values()][0];
    value.storage.set('mnemosyne:attached-memory-creation:v1:bob',original);gate.writes=false;
    vi.mocked(value.deps.status).mockImplementation(async request=>({...await value.outcome(request,'revoked'),createdAt:null}));
    const result=mode==='recover'?await recoverAttachedMemoryCreation('alice',value.deps):await cancelPendingAttachedMemoryCreation('alice',value.deps);
    expect(result.status).toBe('revoked');expect(value.deps.create).toHaveBeenCalledOnce();expect(value.deps.cancel).not.toHaveBeenCalled();expect(value.deps.forgetUploads).not.toHaveBeenCalled();expect(value.storage.size).toBe(1);expect(value.storage.get('mnemosyne:attached-memory-creation:v1:bob')).toBe(original);gate.writes=true;
  }
});
it('unconfirmed or malformed revocation retains the exact encrypted request',async()=>{
  for(const bad of ['time','digest','changed']){
    const value=await fixture();vi.mocked(value.deps.create).mockRejectedValueOnce(Error('Synthetic lost reply'));await expect(createMemoryWithAttachments(proposal,value.deps)).rejects.toThrow();const original=[...value.storage.values()][0];
    vi.mocked(value.deps.status).mockImplementation(async request=>({...await value.outcome(request,'revoked'),createdAt:bad==='time'?1000:null,...(bad==='digest'?{digest:'f'.repeat(64)}:{})}));
    if(bad==='changed')vi.mocked(value.deps.status).mockImplementationOnce(async request=>({...await value.outcome(request,'revoked'),createdAt:null})).mockImplementationOnce(request=>value.outcome(request,'unknown'));
    await expect(recoverAttachedMemoryCreation('alice',value.deps)).rejects.toThrow();expect([...value.storage.values()][0]).toBe(original);expect(value.deps.forgetUploads).not.toHaveBeenCalled();expect(value.deps.create).toHaveBeenCalledOnce();
  }
});
it('persists and recovers a large valid ciphertext with real journal crypto, reporting its request size in consent', async () => {
  const value = await fixture(); value.state.policy = 'confirm-cloud';
  vi.mocked(value.deps.prepare).mockResolvedValue({ teamId: null, keyEpoch: null, keyId: null, enc: { v: 1, iv: 'A'.repeat(16), ct: 'B'.repeat(390000) } });
  vi.mocked(value.deps.create).mockRejectedValueOnce(Error('synthetic lost reply')); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  await expect(createMemoryWithAttachments(proposal, value.deps)).rejects.toThrow(); expect(value.storage.size).toBe(1);
  const request = vi.mocked(value.deps.create).mock.calls[0][0]; const size = new TextEncoder().encode(canonicalAttachedMemoryJson(request)).length;
  expect(size > 390000).toBe(true); expect(confirm.mock.calls[0][0]).toContain(`Tamanho aproximado: ${size} bytes`);
  vi.mocked(value.deps.status).mockImplementation(input => value.outcome(input, 'committed'));
  expect((await recoverAttachedMemoryCreation('alice', value.deps)).status).toBe('committed'); expect(value.deps.create).toHaveBeenCalledOnce(); expect(value.storage.size).toBe(0);
});
it('commits an encrypted checkpoint before creation; loss of ACK is recovered with the same ID, payload and no new encryption', async () => {
  const value = await fixture(); let request!: AttachedMemoryInput;
  vi.mocked(value.deps.create).mockImplementation(async input => { request = input; expect(value.storage.size).toBe(1); throw Error('synthetic lost ACK'); });
  await expect(createMemoryWithAttachments(proposal, value.deps)).rejects.toThrow('aguarda confirmação');
  expect([...value.storage.values()][0]).not.toContain(proposal.text); expect([...value.storage.values()][0]).not.toContain(sessionId);
  expect(canonicalAttachedMemoryJson(request)).not.toContain(proposal.text);
  await expect(createMemoryWithAttachments({ ...proposal, text: 'other synthetic' }, value.deps)).rejects.toThrow(); expect(value.deps.create).toHaveBeenCalledOnce();
  vi.mocked(value.deps.status).mockImplementation(async input => { expect(input).toEqual(request); return value.outcome(input, 'committed'); }); gate.writes = false;
  expect((await recoverAttachedMemoryCreation('alice', value.deps)).status).toBe('committed');
  expect(value.deps.prepare).toHaveBeenCalledOnce(); expect(value.deps.create).toHaveBeenCalledOnce(); expect(value.deps.forgetUploads).toHaveBeenCalledWith('alice', [attachmentId], expect.any(Function)); expect(value.storage.size).toBe(0);
});
it('denies never-cloud and unknown policies before preparation, and declined personal/team consent before any outbound call', async () => {
  for (const policy of ['never-cloud', 'unknown', 'confirm-cloud']) for (const team of [false, true]) {
    const value = await fixture(); value.state.policy = policy as MemoryPermission; vi.spyOn(window, 'confirm').mockReturnValue(false);
    await expect(createMemoryWithAttachments({ ...proposal, teamId: team ? 'crew' : null }, value.deps)).rejects.toThrow();
    for (const operation of [value.deps.create, value.deps.status, value.deps.cancel]) expect(operation).not.toHaveBeenCalled();
    if (team || policy !== 'confirm-cloud') expect(value.deps.prepare).not.toHaveBeenCalled(); expect(value.storage.size).toBe(0);
  }
});
it('retains exact pending data on unknown status with closed gates, corrupted/transplanted journal and forged success', async () => {
  const value = await fixture(); vi.mocked(value.deps.create).mockRejectedValue(Error('synthetic')); await expect(createMemoryWithAttachments(proposal, value.deps)).rejects.toThrow();
  gate.writes = false; await expect(recoverAttachedMemoryCreation('alice', value.deps)).rejects.toThrow(); expect(value.storage.size).toBe(1);
  vi.mocked(value.deps.status).mockResolvedValue({ sessionId, digest: 'f'.repeat(64), status: 'committed', createdAt: 1000 });
  await expect(recoverAttachedMemoryCreation('alice', value.deps)).rejects.toThrow(); expect(value.deps.forgetUploads).not.toHaveBeenCalled();
  const raw = [...value.storage.values()][0]; value.storage.set([...value.storage.keys()][0], raw.slice(0, -8)); vi.mocked(value.deps.status).mockClear();
  await expect(recoverAttachedMemoryCreation('alice', value.deps)).rejects.toThrow(); expect(value.deps.status).not.toHaveBeenCalled();
  value.storage.clear(); value.storage.set('mnemosyne:attached-memory-creation:v1:bob', raw); value.state.uid = 'bob';
  await expect(recoverAttachedMemoryCreation('bob', value.deps)).rejects.toThrow(); expect(value.deps.status).not.toHaveBeenCalled();
});
it('cancellation asks for serialized status first, preserves sent files and never reports a committed memory as cancelled', async () => {
  for (const committed of [false, true]) {
    const value = await fixture(); vi.mocked(value.deps.create).mockRejectedValueOnce(Error('synthetic')); await expect(createMemoryWithAttachments(proposal, value.deps)).rejects.toThrow();
    if (committed) vi.mocked(value.deps.status).mockImplementation(request => value.outcome(request, 'committed')); gate.writes = false;
    const result = await cancelPendingAttachedMemoryCreation('alice', value.deps); expect(result.status).toBe(committed ? 'committed' : 'cancelled');
    expect(value.deps.cancel).toHaveBeenCalledTimes(committed ? 0 : 1); expect(value.deps.forgetUploads).toHaveBeenCalledTimes(committed ? 1 : 0); expect(value.storage.size).toBe(0); gate.writes = true;
  }
});
it('storage failure prevents creation, and cleanup failure preserves the creation receipt for recovery', async () => {
  const failed = await fixture(); failed.deps.storage.setItem = () => { throw Error('synthetic quota'); };
  await expect(createMemoryWithAttachments(proposal, failed.deps)).rejects.toThrow(); expect(failed.deps.create).not.toHaveBeenCalled();
  const value = await fixture(); vi.mocked(value.deps.forgetUploads).mockRejectedValueOnce(Error('synthetic cleanup failure'));
  await expect(createMemoryWithAttachments(proposal, value.deps)).rejects.toThrow(); expect(value.storage.size).toBe(1);
  vi.mocked(value.deps.status).mockImplementation(request => value.outcome(request, 'committed'));
  expect((await recoverAttachedMemoryCreation('alice', value.deps)).status).toBe('committed'); expect(value.deps.create).toHaveBeenCalledOnce(); expect(value.storage.size).toBe(0);
});
it('loss of account/vault/epoch/policy context during the response conserves the journal and suppresses success', async () => {
  for (const mode of ['account', 'vault', 'epoch', 'policy']) {
    const value = await fixture(); vi.mocked(value.deps.create).mockImplementation(async request => {
      if (mode === 'account') value.state.uid = 'bob'; if (mode === 'vault') value.state.ready = false;
      if (mode === 'epoch') value.state.generation++; if (mode === 'policy') value.state.policy = 'never-cloud'; value.changed(); return value.outcome(request, 'committed');
    });
    await expect(createMemoryWithAttachments(proposal, value.deps)).rejects.toThrow(); expect(value.storage.size).toBe(1); expect(value.deps.forgetUploads).not.toHaveBeenCalled();
  }
});

it('personal ciphertext synchronization works with never-cloud and closed attachment writes without a disclosure prompt', async () => {
  const value = await fixture(); value.state.policy = 'never-cloud'; gate.writes = false;
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  expect(await createPersonalMemory({uid:'alice',text:proposal.text,metadata:{connections:[]}}, value.deps)).toEqual({id:sessionId});
  const request = vi.mocked(value.deps.create).mock.calls[0][0];
  expect(request).toMatchObject({teamId:null,keyEpoch:null,keyId:null,attachmentIds:[]});
  expect(canonicalAttachedMemoryJson(request)).not.toContain(proposal.text);
  expect(value.deps.status).toHaveBeenCalledTimes(2); expect(value.deps.forgetUploads).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled(); expect(value.storage.size).toBe(0);
});
it('personal lost ACK recovers the exact frozen proposal and ciphertext with closed creation gates', async () => {
  const value = await fixture(); value.state.policy = 'never-cloud';
  const input = {uid:'alice',text:proposal.text,metadata:{tags:['original'],connections:[]}};
  vi.mocked(value.deps.prepare).mockImplementationOnce(async captured => {
    input.text='replacement';input.metadata.tags.push('replacement');
    expect(captured.text).toBe(proposal.text); expect(captured.metadata.tags).toEqual(['original']);
    return {teamId:null,keyEpoch:null,keyId:null,enc:{v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)}};
  });
  vi.mocked(value.deps.create).mockRejectedValueOnce(Error('Synthetic lost ACK'));
  await expect(createPersonalMemory(input, value.deps)).rejects.toThrow();
  const request=vi.mocked(value.deps.create).mock.calls[0][0];expect(request.metadata.tags).toEqual(['original']);
  const raw=[...value.storage.values()][0];expect(raw).not.toContain(proposal.text);
  gate.personal=false;gate.writes=false;vi.mocked(value.deps.status).mockImplementation(async replay=>{
    expect(replay).toEqual(request);return value.outcome(replay,'committed');
  });
  expect((await recoverAttachedMemoryCreation('alice',value.deps)).status).toBe('committed');
  expect(value.deps.create).toHaveBeenCalledOnce();expect(value.deps.prepare).toHaveBeenCalledOnce();expect(value.storage.size).toBe(0);
});
it('personal recovery retains unknown receipts with closed gates, and cancellation blocks retry without discarding uploads',async()=>{
  const value=await fixture();value.state.policy='never-cloud';vi.mocked(value.deps.create).mockRejectedValueOnce(Error('Synthetic'));
  await expect(createPersonalMemory({uid:'alice',text:proposal.text,metadata:{}},value.deps)).rejects.toThrow();
  const raw=[...value.storage.values()][0];gate.personal=false;
  await expect(recoverAttachedMemoryCreation('alice',value.deps)).rejects.toThrow();expect([...value.storage.values()][0]).toBe(raw);
  expect((await cancelPendingAttachedMemoryCreation('alice',value.deps)).status).toBe('cancelled');
  expect(value.deps.create).toHaveBeenCalledOnce();expect(value.deps.forgetUploads).not.toHaveBeenCalled();expect(value.storage.size).toBe(0);
});
it('an unknown personal policy or a closed personal gate refuses preparation and every RPC',async()=>{
  for(const mode of ['policy','gate']){
    const value=await fixture();if(mode==='policy')value.state.policy='unknown' as MemoryPermission;else gate.personal=false;
    await expect(createPersonalMemory({uid:'alice',text:proposal.text,metadata:{}},value.deps)).rejects.toThrow();
    expect(value.deps.prepare).not.toHaveBeenCalled();expect(value.deps.create).not.toHaveBeenCalled();expect(value.deps.status).not.toHaveBeenCalled();
    gate.personal=true;
  }
});
it('journal replacement during preparation or receipt confirmation aborts before further writes or cleanup',async()=>{
  for(const stage of ['prepare','status']){
    const value=await fixture();const storageKey='mnemosyne:attached-memory-creation:v1:alice';
    if(stage==='prepare')vi.mocked(value.deps.prepare).mockImplementationOnce(async()=>{
      value.storage.set(storageKey,'foreign journal');return {teamId:null,keyEpoch:null,keyId:null,enc:{v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)}};
    });
    else vi.mocked(value.deps.status).mockImplementationOnce(async request=>{value.storage.set(storageKey,'foreign journal');return value.outcome(request,'committed');});
    await expect(createPersonalMemory({uid:'alice',text:proposal.text,metadata:{}},value.deps)).rejects.toThrow();
    expect(value.storage.get(storageKey)).toBe('foreign journal');expect(value.deps.forgetUploads).not.toHaveBeenCalled();
    expect(value.deps.create).toHaveBeenCalledTimes(stage==='prepare'?0:1);
  }
});
it('inconsistent or unavailable terminal confirmation preserves the encrypted operation even after a create ACK',async()=>{
  for(const mode of ['unknown','cancelled','timestamp','network']){
    const value=await fixture();vi.mocked(value.deps.status).mockImplementationOnce(async request=>{
      if(mode==='network')throw Error('Synthetic unavailable');
      return {...await value.outcome(request, mode==='unknown'?'unknown':mode==='cancelled'?'cancelled':'committed'),...(mode==='timestamp'?{createdAt:1001}:{})};
    });
    await expect(createPersonalMemory({uid:'alice',text:proposal.text,metadata:{}},value.deps)).rejects.toThrow();
    expect(value.storage.size).toBe(1);expect(value.deps.create).toHaveBeenCalledOnce();expect(value.deps.forgetUploads).not.toHaveBeenCalled();
  }
});
it('an enclosing captured context reaches preparation and late receipt checks without clearing the pending operation',async()=>{
  for(const stage of ['prepare','create','status']){
    const value=await fixture();let current=true;const guard=()=>{if(!current)throw Error('Synthetic context changed');};
    if(stage==='prepare')vi.mocked(value.deps.prepare).mockImplementationOnce(async()=>{current=false;return {teamId:null,keyEpoch:null,keyId:null,enc:{v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)}};});
    else vi.mocked(value.deps[stage]).mockImplementationOnce(async request=>{current=false;return value.outcome(request,'committed');});
    await expect(createPersonalMemory({uid:'alice',text:proposal.text,metadata:{}},value.deps,guard)).rejects.toThrow();
    expect(value.storage.size).toBe(stage==='prepare'?0:1);expect(value.deps.forgetUploads).not.toHaveBeenCalled();
  }
});

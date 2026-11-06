import { beforeEach, expect, it, vi } from 'vitest';
import { learnGeneratedImage, learnGeneratedText, reviseLearnedMemory } from './learningService';
import type { AiGenerationContext } from './aiGenerationContext';
import type { SessionData } from '../hooks/useSessions';
import { CURRENT_EMBEDDING_SPACE } from './embeddingModel';
import { IndexedSemanticWriteCorpus } from './indexedSemanticWriteCorpus';
import { IndexedSemanticWriteIndex } from './indexedSemanticWriteIndex';
import { selectSemanticWriteNeighbors } from './semanticWriteClient';
import type { IndexedSemanticWriteMessage } from './indexedSemanticWriteProtocol';

const state = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn(), attached: vi.fn(), upload: vi.fn(), personal: vi.fn(),
  createTeam:vi.fn(),teamFields: vi.fn(), unlock: vi.fn(), semantic: vi.fn(), read: vi.fn(), revisePersonal: vi.fn(),baseline:vi.fn(),teamBaseline:vi.fn(),reviseTeam:vi.fn() }));
vi.mock('./teamRevisionRecovery',()=>({captureTeamRevisionBaseline:(...args:unknown[])=>state.teamBaseline(...args),reviseTeamLearnedMemory:(...args:unknown[])=>state.reviseTeam(...args),TeamRevisionError:class extends Error{constructor(){super('Synthetic team baseline required');}}}));
vi.mock('./personalLearnedRevision', () => ({revisePersonalLearnedMemory: (...args: unknown[]) => state.revisePersonal(...args),
  capturePersonalRevisionBaseline:(...args:unknown[])=>state.baseline(...args),PersonalRevisionError:class extends Error{constructor(){super('Synthetic baseline required');}}}));
vi.mock('../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'alice' } } }));
vi.mock('firebase/firestore', () => ({ addDoc: (...args: unknown[]) => state.add(...args), updateDoc: (...args: unknown[]) => state.update(...args),
  collection: () => ({}), doc: () => ({ id: 'synthetic-id' }), getDocFromServer: () => state.read(), arrayUnion: vi.fn() }));
vi.mock('./attachedMemoryRecovery', () => ({assertTeamMemoryCreationEnabled:vi.fn(),createTeamMemory:(...args:unknown[])=>state.createTeam(...args), assertPersonalMemoryCreationEnabled: vi.fn(), createMemoryWithAttachments: (...args: unknown[]) => state.attached(...args), createPersonalMemory: (...args: unknown[]) => state.add(...args) }));
vi.mock('./personalMemoryMutation', () => ({withPersonalMemoryMutation: async (uid: string, work: (context: unknown) => Promise<unknown>) => work({uid, assertCurrent: () => {}})}));
vi.mock('./attachmentUploadClient', () => ({ uploadEncryptedAttachment: (...args: unknown[]) => state.upload(...args) }));
vi.mock('./memoryCrypto', () => ({ buildEncryptedMemoryFields: (...args: unknown[]) => state.personal(...args), onMemoryCryptoChanged: () => () => {} }));
vi.mock('./aiGenerationContext', () => ({ AiGenerationContextError: class extends Error { constructor() { super('Synthetic generation context changed'); } } }));
vi.mock('./sessionMemoryFields', () => ({ buildSessionWriteFields: (...args: unknown[]) => state.teamFields(...args) }));
vi.mock('./teamKeyAccess', () => ({ unlockTeamKey: (...args: unknown[]) => state.unlock(...args) }));
vi.mock('../utils/sessionMnemonic', () => ({ readSessionMnemonic: () => Array(12).fill('synthetic') }));
vi.mock('../engines/CognitiveEngine', () => ({ cognitiveEngine: { processMemory: (...args: unknown[]) => state.semantic(...args), generateTitle: () => 'Synthetic title' } }));

const keyId = '11111111-1111-4111-8111-111111111111';
const scope = { kind: 'team' as const, teamId: 'synthetic-team', keyEpoch: 1, keyId };
const teamBaseline={sessionId:'synthetic-id',teamId:scope.teamId,authorUid:'alice',ownerUid:'owner',stateHash:'a'.repeat(64),stateDigest:'b'.repeat(64),revision:2,teamStateHash:'c'.repeat(64),epochStateHash:'d'.repeat(64),keyEpoch:1,keyId,priorKeyEpoch:1,priorKeyId:keyId};
const attachment = { type: 'image', name: 'Anexo cifrado', url: 'mnemosyne-attachment:v1:11111111-1111-4111-8111-111111111111' };
function context(personal = false): AiGenerationContext {
  return { uid: 'alice', scope: personal ? { kind: 'personal' } : scope, signal: new AbortController().signal,
    assertCurrent: vi.fn(), assertAccess: vi.fn(async () => {}) };
}
beforeEach(() => {
  Object.values(state).forEach(mock => mock.mockReset()); state.add.mockResolvedValue({ id: 'synthetic-personal-id' });
  state.createTeam.mockImplementation(async(proposal,deps,guard,access)=>{if(proposal.teamId!==scope.teamId||proposal.keyEpoch!==scope.keyEpoch||proposal.keyId!==scope.keyId||deps!==undefined)throw Error('Synthetic scope mismatch');guard();await access();return{id:'synthetic-id'};});
  state.attached.mockResolvedValue({ id: 'synthetic-attached-id' }); state.upload.mockResolvedValue(attachment);
  state.personal.mockResolvedValue({ text: '', title: null, enc: { v: 1 } }); state.unlock.mockResolvedValue({});
  state.teamFields.mockImplementation(async input => ({ teamId: input.teamId, keyEpoch: input.keyEpoch, keyId: input.keyId, text: '', title: null, enc: { v: 2 } }));
  state.read.mockResolvedValue({ data: () => ({ uid: 'alice', teamId: scope.teamId, timestamp: 1, updatedAt: 2, learning: { source: 'text-generation' } }) });
  state.semantic.mockResolvedValue({ embedding: [1], embeddingModel: 'synthetic-local' });
  state.baseline.mockImplementation(async input=>({sessionId:input.id,stateHash:'a'.repeat(64),stateDigest:'b'.repeat(64),revision:2}));
  state.revisePersonal.mockImplementation(async input => {input.assertCurrent?.(); await input.prepare(vi.fn()); input.assertCurrent?.();});
  state.teamBaseline.mockImplementation(async input=>({...teamBaseline,sessionId:input.id}));
  state.reviseTeam.mockImplementation(async input=>{input.assertCurrent?.();await input.prepare(vi.fn());input.assertCurrent?.();});
});
it('team generated text uses captured epoch and the confirmed creation ID without a direct SDK write', async () => {
  const result = await learnGeneratedText('alice', 'Synthetic prompt', 'Synthetic answer', [], context());
  expect(result.id).toBe('synthetic-id'); expect(state.createTeam).toHaveBeenCalledWith(expect.objectContaining({uid:'alice',teamId:scope.teamId,keyEpoch:1,keyId,text:expect.stringContaining('Synthetic answer')}),undefined,expect.any(Function),expect.any(Function));
  expect(state.teamFields).not.toHaveBeenCalled();expect(state.unlock).not.toHaveBeenCalled();
  expect(state.personal).not.toHaveBeenCalled(); expect(state.add).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
});
it('personal generated text remains encrypted in explicit personal scope', async () => {
  await learnGeneratedText('alice', 'Synthetic prompt', 'Synthetic answer', [], context(true));
  expect(state.add).toHaveBeenCalledWith(expect.objectContaining({ uid: 'alice', text: expect.stringContaining('Synthetic answer'), metadata: expect.objectContaining({ connections: [] }) }), undefined, expect.any(Function));
  expect(state.personal).not.toHaveBeenCalled();

});
it('semantic enrichment excludes memories from other scopes, locked data and tombstones', async () => {
  const candidates = [
    { id: 'allowed', teamId: scope.teamId, text: 'Synthetic team memory' },
    { id: 'other-team', teamId: 'another-team', text: 'Synthetic other memory' },
    { id: 'personal', uid: 'alice', text: 'Synthetic personal memory' },
    { id: 'locked', teamId: scope.teamId, encLocked: true }, { id: 'deleted', teamId: scope.teamId, deletedAt: 1 },
  ] as SessionData[];
  await learnGeneratedText('alice', 'Synthetic prompt', 'Synthetic answer', candidates, context());
  expect(state.semantic.mock.calls[0][1].map((candidate: { id: string }) => candidate.id)).toEqual(['allowed']);
});
it('captures only the eligible semantic fields, preserves their vectors and supplies the operation guard to inference', async () => {
  const allowed = { id: 'allowed', uid: 'bob', teamId: scope.teamId, embedding: [1, 0], embeddingModel: CURRENT_EMBEDDING_SPACE, position: [1, 2, 3] } as SessionData;
  for (const key of ['text', 'attachments', 'enc']) Object.defineProperty(allowed, key, { get() { throw Error('Unnecessary source content read'); } });
  const denied = { id: 'denied', uid: 'alice' } as SessionData; Object.defineProperty(denied, 'embedding', { get() { throw Error('Wrong scope vector read'); } });
  const captured = context(); state.semantic.mockImplementationOnce(async (_text, candidates, options) => {
    expect(candidates).toHaveLength(1); expect(candidates[0].embedding).not.toBe(allowed.embedding); expect(Object.hasOwn(candidates[0], 'text')).toBe(false);
    allowed.embedding![0] = 99; expect(candidates[0].embedding).toEqual([1, 0]); captured.assertCurrent(); options.assertCurrent(); return { embedding: [1], embeddingModel: 'synthetic-local' };
  });
  await learnGeneratedText('alice', 'Synthetic prompt', 'Synthetic answer', [denied, allowed], captured); expect(state.createTeam).toHaveBeenCalledOnce();
});
it.each([false,true])('generated text uses its published index without enumerating source metadata (personal=%s)', async personal => {
  const values=[{id:'personal',uid:'alice',timestamp:0,embedding:[1,0],embeddingModel:CURRENT_EMBEDDING_SPACE},
    {id:'team',uid:'bob',teamId:scope.teamId,timestamp:0,embedding:[1,0],embeddingModel:CURRENT_EMBEDDING_SPACE}];
  class TestWorker extends EventTarget{index=new IndexedSemanticWriteIndex();terminate(){this.index.clear();}postMessage(message:IndexedSemanticWriteMessage){const data={v:1,seq:message.seq,ok:true,...this.index.handle(structuredClone(message))};queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data})));}}
  const owner=new IndexedSemanticWriteCorpus({uid:'alice',teamIds:new Set([scope.teamId])},id=>values.find(value=>value.id===id),()=>new TestWorker() as unknown as Worker);
  owner.apply('source',{changed:values.map(value=>({id:value.id,value})),removed:[],order:{reset:values.map(value=>value.id),changes:[]}});
  const source=new Proxy(values,{get(target,key,receiver){if(key===Symbol.iterator)throw Error('Enumerated original');return Reflect.get(target,key,receiver);}});owner.associate(source);
  let selected:{count:number;id:string}|undefined;
  state.semantic.mockImplementationOnce(async(_text,candidates,options)=>{const result=await selectSemanticWriteNeighbors([1,0],candidates,options);selected={count:result.count,id:result.neighbors[0].candidate.id};return{embedding:[1,0],embeddingModel:CURRENT_EMBEDDING_SPACE};});
  try{await learnGeneratedText('alice','Synthetic prompt','Synthetic answer',source as unknown as SessionData[],context(personal));expect(selected).toEqual({count:1,id:personal?'personal':'team'});expect(state.semantic).toHaveBeenCalledOnce();expect(personal?state.add:state.createTeam).toHaveBeenCalledOnce();}finally{owner.clear();}
});
it('refuses actor mismatch and revocation during enrichment without any persistence', async () => {
  await expect(learnGeneratedText('bob', 'Synthetic prompt', 'Synthetic answer', [], context())).rejects.toThrow(/context changed/);
  const captured = context(); state.semantic.mockImplementation(async () => { vi.mocked(captured.assertAccess).mockRejectedValue(Error('Synthetic revoked')); return {}; });
  await expect(learnGeneratedText('alice', 'Synthetic prompt', 'Synthetic answer', [], captured)).rejects.toThrow('Synthetic revoked');
   expect(state.add).not.toHaveBeenCalled(); expect(state.attached).not.toHaveBeenCalled();
});
it('a rejected captured epoch creation never downgrades to a personal write or captures a replacement baseline', async () => {
  state.createTeam.mockRejectedValueOnce(Error('Synthetic generation context changed'));
  await expect(learnGeneratedText('alice', 'Synthetic prompt', 'Synthetic answer', [], context())).rejects.toThrow(/context changed/);
  expect(state.teamFields).not.toHaveBeenCalled(); expect(state.personal).not.toHaveBeenCalled(); expect(state.add).not.toHaveBeenCalled();
  expect(state.teamBaseline).not.toHaveBeenCalled();
});
it('generated images upload and associate encrypted bytes in the same team scope', async () => {
  const image = { dataUrl: 'data:image/png;base64,c3ludGhldGlj', mediaType: 'image/png', provider: 'synthetic' };
  await learnGeneratedImage('alice', 'Synthetic image prompt', image, [], context());
  expect(state.upload).toHaveBeenCalledWith(expect.objectContaining({ uid: 'alice', teamId: scope.teamId, file: expect.any(File) }));
  expect(state.attached).toHaveBeenCalledWith(expect.objectContaining({ uid: 'alice', teamId: scope.teamId, attachments: [attachment],expectedTeamEpoch:{keyEpoch:scope.keyEpoch,keyId} }), undefined, expect.any(Function),expect.any(Function));
  expect(state.add).not.toHaveBeenCalled(); expect(state.personal).not.toHaveBeenCalled();
});
it('does not claim to learn an image when its encrypted upload fails', async () => {
  state.upload.mockRejectedValue(Error('Synthetic upload failed'));
  await expect(learnGeneratedImage('alice', 'Synthetic prompt', { dataUrl: 'data:image/png;base64,c3ludGhldGlj', mediaType: 'image/png', provider: 'synthetic' }, [], context())).rejects.toThrow('Synthetic upload failed');
  expect(state.attached).not.toHaveBeenCalled(); expect(state.add).not.toHaveBeenCalled();
});
it('team revisions use the captured baseline and guarded local enrichment', async () => {
  await reviseLearnedMemory('synthetic-id', 'alice', 'Synthetic revised memory', [], context(),undefined,teamBaseline);
  const input = state.reviseTeam.mock.calls[0][0]; expect(input).toMatchObject({ teamId: scope.teamId, baseline:teamBaseline });
  expect(await input.prepare(vi.fn())).toMatchObject({text:'Synthetic revised memory',embedding:[1],processingMethod:'learned:revision+local-embedding'});
  expect(state.read).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled(); expect(state.personal).not.toHaveBeenCalled();
});
it('personal revisions delegate local enrichment to guarded atomic history persistence', async () => {
  const captured = context(true);
  const baseline={sessionId:'synthetic-id',stateHash:'a'.repeat(64),stateDigest:'b'.repeat(64),revision:2};
  await reviseLearnedMemory('synthetic-id', 'alice', 'Synthetic revised memory', [], captured,baseline);
  expect(state.revisePersonal).toHaveBeenCalledWith(expect.objectContaining({uid: 'alice', id: 'synthetic-id',baseline, assertCurrent: captured.assertCurrent}));
  const input = state.revisePersonal.mock.calls[0][0];
  expect(await input.prepare(vi.fn())).toMatchObject({text: 'Synthetic revised memory', embedding: [1], processingMethod: 'learned:revision+local-embedding'});
  expect(state.add).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
});
it('refuses a missing or mismatched team baseline before enrichment', async () => {
  for(const value of [undefined,{...teamBaseline,teamId:'other-team'},{...teamBaseline,keyEpoch:2},{...teamBaseline,keyId:'other-key'}])await expect(reviseLearnedMemory('synthetic-id','alice','Synthetic revision',[],context(),undefined,value)).rejects.toThrow('baseline');
  await expect(reviseLearnedMemory('synthetic-id','bob','Synthetic revision',[],context(),undefined,teamBaseline)).rejects.toThrow('context changed');
  expect(state.semantic).not.toHaveBeenCalled();expect(state.reviseTeam).not.toHaveBeenCalled(); expect(state.personal).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
});
it('personal generated results capture their displayed content before returning a revision baseline',async()=>{
  const result=await learnGeneratedText('alice','Synthetic prompt','Synthetic answer',[],context(true));
  expect(result.personalRevisionBaseline).toMatchObject({sessionId:result.id,revision:2});
  expect(state.baseline).toHaveBeenCalledWith(expect.objectContaining({uid:'alice',id:result.id,expected:{text:'[Texto gerado e aprendido]\n\nPedido: Synthetic prompt\n\nSynthetic answer',title:'Synthetic title'},assertCurrent:expect.any(Function)}));
});
it('a personal revision without its displayed baseline refuses inference and persistence',async()=>{
  await expect(reviseLearnedMemory('note','alice','Synthetic new text',[],context(true))).rejects.toThrow('baseline');
  expect(state.semantic).not.toHaveBeenCalled();expect(state.revisePersonal).not.toHaveBeenCalled();
});
it('a failed post-commit baseline read conserves the created ID instead of reporting creation failure',async()=>{
  state.baseline.mockRejectedValueOnce(Error('Synthetic unavailable preparation'));const result=await learnGeneratedText('alice','Synthetic prompt','Synthetic answer',[],context(true));
  expect(result).toMatchObject({id:'synthetic-personal-id',personalRevisionUnavailable:true});expect(result.personalRevisionBaseline).toBeUndefined();expect(state.add).toHaveBeenCalledOnce();
});
it('team generation captures the displayed text and author before returning an editable result',async()=>{
  const result=await learnGeneratedText('alice','Synthetic prompt','Synthetic answer',[],context());expect(result.teamRevisionBaseline).toEqual(teamBaseline);
  expect(state.teamBaseline).toHaveBeenCalledWith(expect.objectContaining({uid:'alice',id:result.id,teamId:scope.teamId,keyEpoch:1,keyId,expected:{text:'[Texto gerado e aprendido]\n\nPedido: Synthetic prompt\n\nSynthetic answer',title:'Synthetic title',authorUid:'alice'}}));
});
it('a failed team capture conserves the committed ID and marks the draft unavailable',async()=>{
  state.teamBaseline.mockRejectedValueOnce(Error('Synthetic unavailable team read'));const result=await learnGeneratedText('alice','Synthetic prompt','Synthetic answer',[],context());
  expect(result).toMatchObject({id:'synthetic-id',teamRevisionUnavailable:true});expect(result.teamRevisionBaseline).toBeUndefined();expect(state.createTeam).toHaveBeenCalledOnce();
});

import { beforeEach, expect, it, vi } from 'vitest';
import { persistLearnedMemory } from './learningService';
const state = vi.hoisted(() => ({ createAttached: vi.fn(), addDoc: vi.fn(), encrypt: vi.fn(), link:vi.fn(),enabled:true }));
vi.mock('./personalLearnedRevision',()=>({capturePersonalRevisionBaseline:vi.fn(),revisePersonalLearnedMemory:vi.fn(),PersonalRevisionError:class extends Error{}}));
vi.mock('./personalConnections',()=>({assertPersonalConnectionWrites:()=>{if(!state.enabled)throw Error('Synthetic closed');},changePersonalConnection:(...args:unknown[])=>state.link(...args)}));
vi.mock('../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ addDoc: (...args: unknown[]) => state.addDoc(...args), collection: () => ({}), doc: () => ({}), updateDoc: vi.fn(), arrayUnion: vi.fn() }));
vi.mock('./attachedMemoryRecovery', () => ({ assertPersonalMemoryCreationEnabled: vi.fn(), createMemoryWithAttachments: (...args: unknown[]) => state.createAttached(...args), createPersonalMemory: (...args: unknown[]) => state.addDoc(...args) }));
vi.mock('./personalMemoryMutation', () => ({withPersonalMemoryMutation: async (uid: string, work: (context: unknown) => Promise<unknown>) => work({uid, assertCurrent: () => {}})}));
vi.mock('./attachmentUploadClient', () => ({ uploadEncryptedAttachment: vi.fn() }));
vi.mock('./memoryCrypto', () => ({ buildEncryptedMemoryFields: (...args: unknown[]) => state.encrypt(...args), onMemoryCryptoChanged: () => () => {} }));
vi.mock('../engines/CognitiveEngine', () => ({ cognitiveEngine: { processMemory: vi.fn(), generateTitle: () => 'Synthetic title' } }));
const file = { type: 'document' as const, name: 'Anexo cifrado', url: 'mnemosyne-attachment:v1:11111111-1111-4111-8111-111111111111' };
beforeEach(() => {state.enabled=true; [state.createAttached, state.addDoc, state.encrypt,state.link].forEach(mock => mock.mockReset()); state.createAttached.mockResolvedValue({ id: 'fixed-synthetic-id' });
  state.addDoc.mockResolvedValue({id:'new'});state.encrypt.mockResolvedValue({text:'',title:null,enc:{v:1}});state.link.mockResolvedValue({status:'committed'}); });
it('initial learning with an attachment uses durable creation and never bypasses it with addDoc', async () => {
  const result = await persistLearnedMemory({ uid: 'alice', text: 'Synthetic memory', attachments: [file], source: 'document-upload', modality: 'document', skipSemantic: true });
  expect(result.id).toBe('fixed-synthetic-id'); expect(state.createAttached).toHaveBeenCalledWith(expect.objectContaining({ uid: 'alice', text: 'Synthetic memory', attachments: [file],
    metadata: expect.objectContaining({ learning: expect.objectContaining({ attachmentCount: 1 }) }) }), undefined, expect.any(Function),expect.any(Function));
  expect(state.addDoc).not.toHaveBeenCalled(); expect(state.encrypt).not.toHaveBeenCalled();
});
it('late access validation reaches attachment creation before the confirmed ID or reciprocal links are returned',async()=>{
  let current=true;const guard=()=>{if(!current)throw Error('Synthetic late import access changed');};state.createAttached.mockImplementationOnce(async(_proposal,_deps,_current,access)=>{current=false;await access();return{id:'unconfirmed'};});await expect(persistLearnedMemory({uid:'alice',text:'Synthetic memory',attachments:[file],source:'document-upload',modality:'document',skipSemantic:true,assertCurrent:guard})).rejects.toThrow('late import access changed');expect(state.addDoc).not.toHaveBeenCalled();expect(state.link).not.toHaveBeenCalled();
});
it('an unknown create response is propagated and does not silently save a second memory without attachments', async () => {
  state.createAttached.mockRejectedValue(Error('synthetic pending acknowledgement'));
  await expect(persistLearnedMemory({ uid: 'alice', text: 'Synthetic memory', attachments: [file], source: 'image-generation', modality: 'image', skipSemantic: true })).rejects.toThrow('pending acknowledgement');
  expect(state.addDoc).not.toHaveBeenCalled();
});
it('explicit links are written through the reciprocal operation after a connection-free creation; link failure is propagated',async()=>{
  state.link.mockRejectedValue(Error('Synthetic pending link'));
  await expect(persistLearnedMemory({uid:'alice',text:'Synthetic',connections:['peer'],source:'obsidian-vault',modality:'text',skipSemantic:true})).rejects.toThrow('pending link');
  expect(state.addDoc).toHaveBeenCalledWith(expect.objectContaining({uid:'alice',metadata:expect.objectContaining({connections:[]})}),undefined,expect.any(Function));expect(state.addDoc).toHaveBeenCalledOnce();
  expect(state.link).toHaveBeenCalledWith('alice','new','peer','link',expect.any(Function));
});
it('closed reciprocal writes refuse explicit links before encryption or note creation',async()=>{
  state.enabled=false;await expect(persistLearnedMemory({uid:'alice',text:'Synthetic',connections:['peer'],source:'obsidian-vault',modality:'text',skipSemantic:true})).rejects.toThrow('closed');
  expect(state.encrypt).not.toHaveBeenCalled();expect(state.addDoc).not.toHaveBeenCalled();expect(state.createAttached).not.toHaveBeenCalled();
});
it('an enclosing import guard reaches durable creation and aborts after creation before any reciprocal call',async()=>{
  let current=true;const guard=()=>{if(!current)throw Error('Synthetic import changed');};
  state.addDoc.mockImplementationOnce(async (_proposal, _deps, currentGuard)=>{current=false;currentGuard();return{id:'unused'};});
  await expect(persistLearnedMemory({uid:'alice',text:'Synthetic',source:'obsidian-vault',modality:'text',skipSemantic:true,assertCurrent:guard})).rejects.toThrow('import changed');expect(state.encrypt).not.toHaveBeenCalled();
  current=true;state.addDoc.mockImplementationOnce(async()=>{current=false;return{id:'created'};});
  await expect(persistLearnedMemory({uid:'alice',text:'Synthetic',connections:['peer'],source:'obsidian-vault',modality:'text',skipSemantic:true,assertCurrent:guard})).rejects.toThrow('import changed');expect(state.link).not.toHaveBeenCalled();
});

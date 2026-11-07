import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryDetail } from './MemoryDetail';
import { useUniverseStore } from '../../store/universeStore';
import type { MemoryObject } from '../../types/universe';

vi.mock('../../firebase', () => ({ default: {}, auth: { currentUser: { uid: 'alice' } }, db: {}, storage: {} }));
vi.mock('../../config/releaseGates',async original=>({...await original<typeof import('../../config/releaseGates')>(),TEAM_WRITES_ENABLED:true,PERSONAL_REVISION_WRITES_ENABLED:true}));
const records=vi.hoisted(()=>new Map<string,unknown>());
vi.mock('firebase/auth',()=>({onAuthStateChanged:()=>()=>{}}));
vi.mock('firebase/firestore',async original=>({...await original<typeof import('firebase/firestore')>(),doc:()=>({}),getDocFromServer:async()=>({data:()=>({name:'Synthetic team',ownerUid:'alice',memberUids:['alice'],wrappedKeys:{alice:{v:1,alg:'RSA-OAEP',ct:'AQ=='}},activeKeyEpoch:1,activeKeyId:'11111111-1111-4111-8111-111111111111',keyRotationStatus:'active'})})}));
vi.mock('../../services/clipCaptureService',()=>({withClipCaptureLock:async(_key:string,work:()=>Promise<unknown>)=>work()}));
vi.mock('../../services/memoryEditRecovery',async original=>({...await original<typeof import('../../services/memoryEditRecovery')>(),hasPendingMemoryEdit:()=>false,captureMemoryEditBaseline:async(input:{id:string;assertCurrent:()=>void})=>{input.assertCurrent();return{kind:'team',sessionId:input.id,teamId:'crew',authorUid:'alice',ownerUid:'alice',stateHash:'a'.repeat(64),stateDigest:'b'.repeat(64),revision:10,teamStateHash:'c'.repeat(64),epochStateHash:'d'.repeat(64),keyEpoch:1,keyId:'11111111-1111-4111-8111-111111111111',priorKeyEpoch:1,priorKeyId:'11111111-1111-4111-8111-111111111111'};}}));
vi.mock('../../services/memoryEditorDraftStore',()=>({memoryEditorDraftStore:{get:async(uid:string,id:string)=>structuredClone(records.get(uid+'/'+id)),compareExchange:async(uid:string,id:string,expected:string|null,next:unknown,guard:()=>void)=>{guard();const key=uid+'/'+id,old=records.get(key);if((old?JSON.stringify(old):null)!==expected)throw Error('Synthetic conflict');if(next===null)records.delete(key);else records.set(key,structuredClone(next));}}}));
import {setMemoryCryptoMnemonic} from '../../services/memoryCrypto';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
vi.mock('../AttachmentPreviewGrid', () => ({ AttachmentPreviewGrid: () => null }));
vi.mock('../MemoryAttachmentsPanel', () => ({ MemoryAttachmentsPanel: () => null }));
vi.mock('../TeamMemoryConnectionsPanel', () => ({ TeamMemoryConnectionsPanel: () => null }));
const memory: MemoryObject = { id: 'synthetic-memory', uid: 'alice', teamId: 'crew', text: 'Synthetic original',
  celestialType: 'planet', position: [0, 0, 0], embedding: [], connections: [], importance: 0.5,
  timestamp: 1, updatedAt: 10, persistedUpdatedAt: 10,persistedTitle:null,persistedStateDigest:'b'.repeat(64) };
function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  records.clear();setMemoryCryptoMnemonic(words);
  useUniverseStore.setState({ memories: [{ ...memory }], selectedMemoryId: memory.id, deletingMemoryId: null });
});
afterEach(() => { cleanup();setMemoryCryptoMnemonic(null);vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); useUniverseStore.setState({ memories: [], selectedMemoryId: null }); });

it('retains a refused team draft and updates local content only after a successful acknowledgement', async () => {
  const first = deferred(); const second = deferred(); const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(<MemoryDetail onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  await waitFor(()=>expect(screen.getByRole('textbox')).toBeEnabled());
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Synthetic draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(useUniverseStore.getState().memories[0].text === memory.text).toBe(true);
  await waitFor(()=>expect(save).toHaveBeenCalledOnce());
  await act(async () => first.reject(new Error('Synthetic refusal')));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value === 'Synthetic draft').toBe(true);
  expect(useUniverseStore.getState().memories[0].text === memory.text).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));
  await act(async () => second.resolve());
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(useUniverseStore.getState().memories[0].text === memory.text).toBe(true);
  expect(save.mock.calls[1][1]).toMatchObject({kind:'edit',baseline:{sessionId:memory.id,stateDigest:'b'.repeat(64)}});
});

it('keeps a refused deletion visible and starts the animation only after acknowledgement', async () => {
  vi.useFakeTimers();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const first = deferred(); const second = deferred(); const remove = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(<MemoryDetail onDelete={remove} />);
  fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
  expect(useUniverseStore.getState().deletingMemoryId).toBeNull();
  await act(async () => first.reject(new Error('Synthetic refusal')));
  expect(useUniverseStore.getState().memories).toHaveLength(1);
  expect(useUniverseStore.getState().deletingMemoryId).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
  await act(async () => second.resolve());
  expect(useUniverseStore.getState().deletingMemoryId).toBe(memory.id);
});

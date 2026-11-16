import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,act,cleanup} from '@testing-library/react';
const state=vi.hoisted(()=>({ready:true,enabled:true,pending:false,crypto:new Set<()=>void>(),changed:new Set<()=>void>(),review:vi.fn(),apply:vi.fn(),reset:vi.fn()}));
vi.mock('../config/releaseGates',()=>({get PERSONAL_REVISION_WRITES_ENABLED(){return state.enabled;}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.crypto.add(callback);return()=>{state.crypto.delete(callback);};}}));
vi.mock('../services/embeddingIndexRecovery',()=>({hasPendingEmbeddingIndex:()=>state.pending,observeEmbeddingIndexRequests:(callback:()=>void)=>{state.changed.add(callback);return()=>{state.changed.delete(callback);};},EmbeddingIndexRecoveryError:class extends Error{reason:string;constructor(reason:string){super(reason);this.reason=reason;}}}));
vi.mock('../services/embeddingStorageManagement',()=>({reviewEmbeddingStorage:state.review,applyEmbeddingStoragePlan:state.apply,resetEmbeddingStorageProgress:state.reset}));
vi.mock('../utils/translations',()=>({useTranslation:()=>({t:(key:string,params?:Record<string,unknown>)=>key+(params?' '+JSON.stringify(params):'')})}));
import {EmbeddingStoragePanel} from './EmbeddingStoragePanel';
const plan=(label='Synthetic label')=>({uid:'alice',cursorRaw:null,nextCursor:'last',scanned:25,skipped:24,items:[{id:'one',label,dimensions:384,baseline:{sessionId:'one',ownerUid:'alice',stateHash:'a'.repeat(64),stateDigest:'b'.repeat(64),contentDigest:'c'.repeat(64),revision:10}}]});
beforeEach(()=>{state.ready=true;state.enabled=true;state.pending=false;state.crypto.clear();state.changed.clear();state.review.mockReset();state.review.mockResolvedValue(plan());state.apply.mockReset();state.apply.mockResolvedValue({completed:1,scanned:25,finished:false});state.reset.mockReset();state.reset.mockResolvedValue(undefined);});
afterEach(()=>{cleanup();expect(state.crypto.size).toBe(0);expect(state.changed.size).toBe(0);});
it('reviews without writing, focuses confirmation and lets Escape discard the preview',async()=>{
  render(<EmbeddingStoragePanel uid="alice"/>);expect(state.review).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'storageOptimizeReview'}));
  const confirm=await screen.findByRole('button',{name:'storageOptimizeConfirm'});await waitFor(()=>expect(confirm).toHaveFocus());expect(screen.getByText('Synthetic label')).toBeInTheDocument();expect(state.apply).not.toHaveBeenCalled();
  fireEvent.keyDown(confirm,{key:'Escape'});expect(screen.queryByRole('group')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'storageOptimizeReview'})).toHaveFocus();expect(state.apply).not.toHaveBeenCalled();
});
it('sends only an explicitly confirmed review and reports progress from confirmed operations',async()=>{
  let finish!:(value:unknown)=>void;state.apply.mockImplementation(async(_plan,scope)=>{scope.onProgress(1,2);return new Promise(resolve=>{finish=resolve;});});
  render(<EmbeddingStoragePanel uid="alice"/>);fireEvent.click(screen.getByRole('button',{name:'storageOptimizeReview'}));fireEvent.click(await screen.findByRole('button',{name:'storageOptimizeConfirm'}));
  await waitFor(()=>expect(state.apply).toHaveBeenCalledOnce());expect(screen.getByRole('button',{name:'storageOptimizeReview'})).toBeDisabled();expect(screen.getByRole('status')).toHaveTextContent('storageOptimizeWorking');
  await act(async()=>{finish({completed:2,scanned:25,finished:false});});expect(screen.getByRole('status')).toHaveTextContent('storageOptimizeDone');expect(screen.getByRole('status')).toHaveFocus();
});
it('retires a deferred review on account ABA without blocking a fresh review or restoring old labels',async()=>{
  let finish!:(value:unknown)=>void;state.review.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const {rerender}=render(<EmbeddingStoragePanel uid="alice"/>);fireEvent.click(screen.getByRole('button',{name:'storageOptimizeReview'}));
  rerender(<EmbeddingStoragePanel uid="bob"/>);rerender(<EmbeddingStoragePanel uid="alice"/>);state.review.mockResolvedValue(plan('Fresh label'));fireEvent.click(screen.getByRole('button',{name:'storageOptimizeReview'}));await screen.findByText('Fresh label');
  await act(async()=>{finish(plan('Old hidden label'));});expect(screen.queryByText('Old hidden label')).not.toBeInTheDocument();expect(screen.getByText('Fresh label')).toBeInTheDocument();expect(state.apply).not.toHaveBeenCalled();
});
it('vault transitions hide labels and retire a delayed confirmation without showing success in the new scope',async()=>{
  let finish!:(value:unknown)=>void;state.apply.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<EmbeddingStoragePanel uid="alice"/>);fireEvent.click(screen.getByRole('button',{name:'storageOptimizeReview'}));fireEvent.click(await screen.findByRole('button',{name:'storageOptimizeConfirm'}));
  act(()=>{[...state.crypto].forEach(callback=>callback());});expect(screen.queryByText('Synthetic label')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'storageOptimizeReview'})).not.toBeDisabled();
  await act(async()=>{finish({completed:1,scanned:25,finished:true});});expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('keeps writes closed or blocked by recovery and resets only after an explicit local action',async()=>{
  state.enabled=false;const {rerender}=render(<EmbeddingStoragePanel uid="alice"/>);expect(screen.getByText('storageOptimizeClosed')).toBeInTheDocument();expect(screen.getByRole('button',{name:'storageOptimizeReview'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'storageOptimizeReset'}));await waitFor(()=>expect(state.reset).toHaveBeenCalledOnce());expect(state.apply).not.toHaveBeenCalled();
  state.enabled=true;act(()=>{state.pending=true;[...state.changed].forEach(callback=>callback());});rerender(<EmbeddingStoragePanel uid="alice"/>);expect(screen.getByText('storageOptimizePending')).toBeInTheDocument();expect(screen.getByRole('button',{name:'storageOptimizeReview'})).toBeDisabled();expect(screen.getByRole('button',{name:'storageOptimizeReset'})).toBeDisabled();expect(state.review).not.toHaveBeenCalled();
});

import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
import type {SessionData} from '../hooks/useSessions';
const state=vi.hoisted(()=>({ready:true,enabled:true,pending:false,crypto:new Set<()=>void>(),changed:new Set<()=>void>(),review:vi.fn(),publish:vi.fn(),inspect:vi.fn(),recover:vi.fn(),cancel:vi.fn(),backup:vi.fn(),restore:vi.fn(),history:vi.fn(),capture:vi.fn(),rollback:vi.fn(),download:vi.fn()}));
vi.mock('../config/releaseGates',()=>({get PERSONAL_REVISION_WRITES_ENABLED(){return state.enabled;}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.crypto.add(callback);return()=>{state.crypto.delete(callback);};}}));
vi.mock('../utils/translations',()=>({useTranslation:()=>({language:'en',t:(key:string,params?:Record<string,unknown>)=>key+(params?' '+JSON.stringify(params):'')})}));
vi.mock('../utils/export',()=>({triggerBlobDownload:state.download}));
vi.mock('../services/embeddingIndexRecovery',()=>({
  EmbeddingIndexRecoveryError:class extends Error{reason:string;constructor(reason:string){super(reason);this.reason=reason;}},
  hasPendingEmbeddingIndex:()=>state.pending,observeEmbeddingIndexRequests:(callback:()=>void)=>{state.changed.add(callback);return()=>{state.changed.delete(callback);};},
  captureEmbeddingIndexBaseline:state.capture,rollbackPublishedEmbedding:state.rollback,recoverPendingEmbeddingIndex:state.recover,cancelPendingEmbeddingIndex:state.cancel,
  inspectPendingEmbeddingIndex:state.inspect,exportPendingEmbeddingIndex:state.backup,importPendingEmbeddingIndex:state.restore,
}));
vi.mock('../services/embeddingIndexManagement',()=>({reviewEmbeddingPublication:state.review,publishEmbeddingPlan:state.publish,loadEmbeddingIndexHistory:state.history,
  personalEmbeddingCandidate:(row:SessionData,uid:string)=>row.uid===uid&&row.teamId==null&&!row.encLocked&&row.encrypted===true&&!row.teamScopeAmbiguous&&row.deletedAt==null&&!row.sharedWithIds,
  needsEmbeddingPublication:(row:SessionData)=>!row.embeddingModel,
}));
import {EmbeddingPublicationPanel} from './EmbeddingPublicationPanel';
const note:SessionData={id:'note',uid:'alice',text:'Alpha private source',timestamp:1,updatedAt:10,encrypted:true,syncConflictDigest:'a'.repeat(64)};
const baseline={sessionId:'note',ownerUid:'alice',revision:10,stateDigest:'a'.repeat(64),stateHash:'b'.repeat(64),contentDigest:'c'.repeat(64)};
const entry={versionId:'embedding-index-11111111-1111-4111-8111-111111111111',createdAt:10,previousRevision:1,space:'Xenova/all-MiniLM-L6-v2@legacy-main',dimensions:384,rollbackAllowed:true};
const setPending=(value:boolean)=>{state.pending=value;state.changed.forEach(changed=>changed());};
beforeEach(()=>{state.ready=true;state.enabled=true;state.pending=false;state.crypto.clear();state.changed.clear();
  for(const fn of [state.review,state.publish,state.inspect,state.recover,state.cancel,state.backup,state.restore,state.history,state.capture,state.rollback,state.download])fn.mockReset();
  state.review.mockResolvedValue({uid:'alice',items:[{id:'note',viewDigest:'a'.repeat(64),revision:10}],remaining:0});state.publish.mockImplementation(async(_plan,_current,options)=>{options.onProgress(1,1);return{completed:1};});state.inspect.mockResolvedValue({sessionId:'note',kind:'publish'});
  state.recover.mockImplementation(async()=>{setPending(false);return{status:'committed'};});state.cancel.mockImplementation(async()=>{setPending(false);return{status:'cancelled'};});state.backup.mockResolvedValue('{"encrypted":"opaque"}');state.restore.mockImplementation(async()=>{setPending(true);return{};});state.history.mockResolvedValue({entries:[entry],next:null,invalid:0});state.capture.mockResolvedValue(baseline);state.rollback.mockResolvedValue({status:'committed'});
});
it('requires a captured review and explicit confirmation before publication, with keyboard focus on confirmation',async()=>{
  render(<EmbeddingPublicationPanel uid="alice" sessions={[note]} />);expect(state.review).not.toHaveBeenCalled();expect(state.publish).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'indexPublishReview'}));
  const group=await screen.findByRole('group',{name:'indexPublishReview'});expect(group).toHaveTextContent('indexPublishPreview');expect(state.publish).not.toHaveBeenCalled();await waitFor(()=>expect(within(group).getByRole('button',{name:'indexPublishConfirm'})).toHaveFocus());fireEvent.click(within(group).getByRole('button',{name:'indexPublishConfirm'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('indexPublishStatus_published'));expect(state.publish).toHaveBeenCalledOnce();
});
it('returning from review restores focus to its trigger without writing',async()=>{
  render(<EmbeddingPublicationPanel uid="alice" sessions={[note]} />);const trigger=screen.getByRole('button',{name:'indexPublishReview'});fireEvent.click(trigger);await screen.findByRole('group');fireEvent.click(screen.getByRole('button',{name:'indexPublishBack'}));expect(screen.queryByRole('group')).not.toBeInTheDocument();expect(trigger).toHaveFocus();expect(state.publish).not.toHaveBeenCalled();
});
it('returns focus only after the review group has left the document',async()=>{
  render(<EmbeddingPublicationPanel uid="alice" sessions={[note]} />);const trigger=screen.getByRole('button',{name:'indexPublishReview'});
  fireEvent.click(trigger);const back=await screen.findByRole('button',{name:'indexPublishBack'});await waitFor(()=>expect(back).toBeEnabled());
  const focus=trigger.focus.bind(trigger);let groupPresentAtFocus:boolean|undefined;
  const observation=vi.spyOn(trigger,'focus').mockImplementation(()=>{groupPresentAtFocus=screen.queryByRole('group')!==null;focus();});
  try{fireEvent.click(back);await waitFor(()=>expect(observation).toHaveBeenCalledOnce());expect(groupPresentAtFocus).toBe(false);expect(trigger).toHaveFocus();expect(state.publish).not.toHaveBeenCalled();}
  finally{observation.mockRestore();}
});
it('surfaces lost ACK custody and recovers with closed admission without another publication',async()=>{
  state.publish.mockImplementationOnce(async()=>{setPending(true);state.enabled=false;throw Error('Synthetic lost ACK');});render(<EmbeddingPublicationPanel uid="alice" sessions={[note]} />);fireEvent.click(screen.getByRole('button',{name:'indexPublishReview'}));fireEvent.click(await screen.findByRole('button',{name:'indexPublishConfirm'}));await screen.findByText('indexPublishPending');await waitFor(()=>expect(screen.getByRole('button',{name:'indexPublishReviewPending'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'indexPublishReviewPending'}));fireEvent.click(await screen.findByRole('button',{name:'indexPublishConfirm'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('indexPublishStatus_confirmed'));expect(state.publish).toHaveBeenCalledOnce();expect(state.recover).toHaveBeenCalledOnce();
});
it('cancellation can confirm an already committed request without presenting it as a rollback',async()=>{
  state.pending=true;state.enabled=false;state.cancel.mockImplementationOnce(async()=>{setPending(false);return{status:'committed'};});render(<EmbeddingPublicationPanel uid="alice" sessions={[]} />);fireEvent.click(screen.getByRole('button',{name:'indexPublishCancelPending'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('indexPublishStatus_confirmed'));expect(state.rollback).not.toHaveBeenCalled();expect(state.publish).not.toHaveBeenCalled();
});
it('shows only readable personal sources, reviews a compatible archive, and disables changed-content rollback',async()=>{
  state.history.mockResolvedValueOnce({entries:[entry,{...entry,versionId:'other',rollbackAllowed:false}],next:null,invalid:1});render(<EmbeddingPublicationPanel uid="alice" sessions={[note,{...note,id:'foreign',uid:'bob'},{...note,id:'team',teamId:'crew'},{...note,id:'locked',encLocked:true}]} />);
  expect(screen.getAllByRole('option')).toHaveLength(2);fireEvent.change(screen.getByRole('combobox'),{target:{value:'note'}});fireEvent.click(screen.getByRole('button',{name:'indexPublishHistory'}));await screen.findByText('indexPublishDifferentContent');const buttons=screen.getAllByRole('button',{name:'indexPublishRollback'});expect(buttons[1]).toBeDisabled();fireEvent.click(buttons[0]);fireEvent.click(await screen.findByRole('button',{name:'indexPublishConfirm'}));await waitFor(()=>expect(state.rollback).toHaveBeenCalledWith(expect.objectContaining({uid:'alice',id:'note',baseline,versionId:entry.versionId,assertCurrent:expect.any(Function)})));expect(state.publish).not.toHaveBeenCalled();
});
it('a UID change or key ABA closes an unconfirmed review and never reuses a previous account source',async()=>{
  const view=render(<EmbeddingPublicationPanel uid="alice" sessions={[note]} />);fireEvent.click(screen.getByRole('button',{name:'indexPublishReview'}));await screen.findByRole('group');act(()=>{state.ready=false;state.crypto.forEach(callback=>callback());state.ready=true;state.crypto.forEach(callback=>callback());});expect(screen.queryByRole('group')).not.toBeInTheDocument();expect(state.publish).not.toHaveBeenCalled();
  state.review.mockImplementationOnce(()=>new Promise(resolve=>{setTimeout(()=>resolve({uid:'alice',items:[],remaining:0}),10);}));fireEvent.click(screen.getByRole('button',{name:'indexPublishReview'}));view.rerender(<EmbeddingPublicationPanel uid="bob" sessions={[note]} />);await waitFor(()=>expect(screen.getByRole('button',{name:'indexPublishStop'})).toBeDisabled());expect(screen.queryByRole('group')).not.toBeInTheDocument();expect(screen.queryByRole('option',{name:'Alpha private source'})).not.toBeInTheDocument();
});
it('exports an encrypted pending request and restores a file without applying it automatically',async()=>{
  state.pending=true;render(<EmbeddingPublicationPanel uid="alice" sessions={[note]} />);fireEvent.click(screen.getByRole('button',{name:'indexPublishExport'}));await waitFor(()=>expect(state.download).toHaveBeenCalledWith(expect.any(Blob),'mnemosyne-embedding-request.json'));act(()=>setPending(false));
  const file=new File(['opaque-backup'],'request.json',{type:'application/json'});Object.defineProperty(file,'text',{value:async()=>'opaque-backup'});fireEvent.change(screen.getByLabelText('indexPublishImport'),{target:{files:[file]}});await waitFor(()=>expect(state.restore).toHaveBeenCalledWith('alice','opaque-backup',expect.any(Function)));expect(state.publish).not.toHaveBeenCalled();expect(state.recover).not.toHaveBeenCalled();
});
it('a late history response for a changed source is discarded and never enables rollback',async()=>{
  let finish!:(value:unknown)=>void;state.history.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const view=render(<EmbeddingPublicationPanel uid="alice" sessions={[note]} />);fireEvent.change(screen.getByRole('combobox'),{target:{value:'note'}});fireEvent.click(screen.getByRole('button',{name:'indexPublishHistory'}));view.rerender(<EmbeddingPublicationPanel uid="alice" sessions={[{...note,syncConflictDigest:'d'.repeat(64)}]} />);await act(async()=>finish({entries:[entry],next:null,invalid:0}));expect(screen.queryByRole('button',{name:'indexPublishRollback'})).not.toBeInTheDocument();expect(state.capture).not.toHaveBeenCalled();
});
it('an own committed rollback snapshot arriving before its ACK still confirms without reporting a stale view',async()=>{
  const view=render(<EmbeddingPublicationPanel uid="alice" sessions={[note]} />);fireEvent.change(screen.getByRole('combobox'),{target:{value:'note'}});fireEvent.click(screen.getByRole('button',{name:'indexPublishHistory'}));fireEvent.click(await screen.findByRole('button',{name:'indexPublishRollback'}));await screen.findByRole('group');
  state.rollback.mockImplementationOnce(async input=>{view.rerender(<EmbeddingPublicationPanel uid="alice" sessions={[{...note,updatedAt:1000,syncConflictDigest:'e'.repeat(64)}]} />);await Promise.resolve();input.assertCurrent();return{status:'committed'};});
  fireEvent.click(screen.getByRole('button',{name:'indexPublishConfirm'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('indexPublishStatus_confirmed'));
});
it('closed publication and locked vault disable new mutations while retaining pending custody',()=>{
  state.enabled=false;state.ready=false;state.pending=true;render(<EmbeddingPublicationPanel uid="alice" sessions={[note]} />);expect(screen.getByRole('button',{name:'indexPublishReview'})).toBeDisabled();expect(screen.getByRole('button',{name:'indexPublishCancelPending'})).toBeDisabled();expect(screen.getByRole('button',{name:'indexPublishReviewPending'})).toBeDisabled();expect(screen.getAllByRole('option')).toHaveLength(1);expect(state.cancel).not.toHaveBeenCalled();
});

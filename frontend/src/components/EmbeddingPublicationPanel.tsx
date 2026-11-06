import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import type {SessionData} from '../hooks/useSessions';
import {PERSONAL_REVISION_WRITES_ENABLED} from '../config/releaseGates';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {captureEmbeddingIndexBaseline,rollbackPublishedEmbedding,recoverPendingEmbeddingIndex,cancelPendingEmbeddingIndex,
  hasPendingEmbeddingIndex,observeEmbeddingIndexRequests,inspectPendingEmbeddingIndex,exportPendingEmbeddingIndex,importPendingEmbeddingIndex,
  EmbeddingIndexRecoveryError,type EmbeddingIndexBaseline} from '../services/embeddingIndexRecovery';
import {reviewEmbeddingPublication,publishEmbeddingPlan,personalEmbeddingCandidate,needsEmbeddingPublication,loadEmbeddingIndexHistory,
  type EmbeddingPublicationPlan,type EmbeddingIndexHistoryEntry,type EmbeddingIndexHistoryCursor} from '../services/embeddingIndexManagement';
import {embeddingProfileForSpace} from '../services/embeddingProfile';
import {LEGACY_EMBEDDING_SPACE} from '../services/embeddingModel';
import {triggerBlobDownload} from '../utils/export';
import {useTranslation} from '../utils/translations';

type Preview={kind:'publish';plan:EmbeddingPublicationPlan}|{kind:'rollback';id:string;viewDigest:string;baseline:EmbeddingIndexBaseline;entry:EmbeddingIndexHistoryEntry}
  |{kind:'recover';id:string;operation:'publish'|'rollback'};
type Feedback='published'|'confirmed'|'cancelled'|'imported'|'failed'|EmbeddingIndexRecoveryError['reason'];
export function EmbeddingPublicationPanel({uid,sessions}:{uid:string|null;sessions:SessionData[]}) {
  const {t,language}=useTranslation();
  const ready=useSyncExternalStore(onMemoryCryptoChanged,isMemoryCryptoReady,()=>false);
  const subscribe=useCallback((callback:()=>void)=>observeEmbeddingIndexRequests(callback,()=>uid),[uid]);
  const readPending=useCallback(()=>uid?hasPendingEmbeddingIndex(uid):false,[uid]);
  const pending=useSyncExternalStore(subscribe,readPending,()=>false);
  const byId=useMemo(()=>new Map(sessions.map(memory=>[memory.id,memory])),[sessions]),current=useRef({uid,byId});current.current={uid,byId};
  const epoch=useRef(0),mounted=useRef(true),job=useRef<{uid:string;epoch:number;control:AbortController}|null>(null),confirmButton=useRef<HTMLButtonElement>(null),reviewTrigger=useRef<HTMLButtonElement|null>(null),statusElement=useRef<HTMLParagraphElement>(null),returnFocus=useRef(false);
  const [running,setRunning]=useState<{completed:number;total:number}|null>(null),[selected,setSelected]=useState('');
  const [preview,setPreview]=useState<{uid:string;epoch:number;value:Preview}|null>(null);
  const [feedback,setFeedback]=useState<{uid:string;epoch:number;kind:Feedback;count:number}|null>(null);
  const [history,setHistory]=useState<{uid:string;epoch:number;id:string;viewDigest:string;entries:EmbeddingIndexHistoryEntry[];next:EmbeddingIndexHistoryCursor|null;invalid:number}|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;job.current?.control.abort();};},[]);
  useEffect(()=>{returnFocus.current=false;const stop=onMemoryCryptoChanged(()=>{returnFocus.current=false;epoch.current++;job.current?.control.abort();setPreview(null);setHistory(null);setFeedback(null);});return()=>{stop();job.current?.control.abort();};},[uid]);
  const shownPreview=ready&&preview?.uid===uid&&preview.epoch===epoch.current?preview.value:null;
  useEffect(()=>{
    if(shownPreview&&!running)confirmButton.current?.focus();
    else if(!shownPreview&&!running&&returnFocus.current){returnFocus.current=false;reviewTrigger.current?.focus();}
  },[shownPreview,running]);
  const candidates=useMemo(()=>ready&&uid?sessions.filter(memory=>personalEmbeddingCandidate(memory,uid)):[],[ready,uid,sessions]);
  const publicationCount=useMemo(()=>uid?candidates.filter(memory=>needsEmbeddingPublication(memory,uid)).length:0,[candidates,uid]);
  const memory=ready?candidates.find(row=>row.id===selected):undefined;
  const shownHistory=memory&&history?.uid===uid&&history.epoch===epoch.current&&history.id===memory.id&&history.viewDigest===memory.syncConflictDigest?history:null;
  const shownFeedback=feedback?.uid===uid&&feedback.epoch===epoch.current?feedback:null;
  useEffect(()=>{if(shownFeedback&&!running)statusElement.current?.focus();},[shownFeedback,running]);
  const busy=running!==null,button='rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-40';
  const begin=()=>{
    if(!uid||!isMemoryCryptoReady()||job.current)return null;const task={uid,epoch:epoch.current,control:new AbortController()};job.current=task;setRunning({completed:0,total:0});setFeedback(null);
    const guard=()=>{if(!mounted.current||current.current.uid!==task.uid||epoch.current!==task.epoch||task.control.signal.aborted||!isMemoryCryptoReady())throw new Error('Index view changed');};
    return{task,guard,signal:task.control.signal};
  };
  const perform=async(work:(scope:NonNullable<ReturnType<typeof begin>>)=>Promise<void>)=>{
    const scope=begin();if(!scope)return;
    try{await work(scope);}catch(error){if(mounted.current&&current.current.uid===scope.task.uid&&epoch.current===scope.task.epoch){const kind=error instanceof EmbeddingIndexRecoveryError?error.reason:'failed';setFeedback({uid:scope.task.uid,epoch:scope.task.epoch,kind,count:0});}}
    finally{if(job.current===scope.task){job.current=null;if(mounted.current)setRunning(null);}}
  };
  const review=()=>perform(async scope=>{
    const plan=await reviewEmbeddingPublication(scope.task.uid,sessions,id=>current.current.byId.get(id),{signal:scope.signal,assertCurrent:scope.guard});scope.guard();
    setPreview({uid:scope.task.uid,epoch:scope.task.epoch,value:{kind:'publish',plan}});
  });
  const reviewPending=()=>perform(async scope=>{
    const summary=await inspectPendingEmbeddingIndex(scope.task.uid,scope.guard);scope.guard();setPreview({uid:scope.task.uid,epoch:scope.task.epoch,value:{kind:'recover',id:summary.sessionId,operation:summary.kind}});
  });
  const confirm=()=>perform(async scope=>{
    const captured=shownPreview;if(!captured)return;setPreview(null);
    if(captured.kind==='publish'){
      const result=await publishEmbeddingPlan(captured.plan,id=>current.current.byId.get(id),{signal:scope.signal,assertCurrent:scope.guard,onProgress:(completed,total)=>{scope.guard();setRunning({completed,total});}});scope.guard();setFeedback({uid:scope.task.uid,epoch:scope.task.epoch,kind:'published',count:result.completed});
    }else if(captured.kind==='rollback'){
      scope.guard();if(current.current.byId.get(captured.id)?.syncConflictDigest!==captured.viewDigest)throw new EmbeddingIndexRecoveryError('baseline');
      // The source is bound again by the client baseline and server CAS. Its own
      // committed snapshot can legitimately arrive before the callable ACK.
      await rollbackPublishedEmbedding({uid:scope.task.uid,id:captured.id,baseline:captured.baseline,versionId:captured.entry.versionId,assertCurrent:scope.guard});scope.guard();setHistory(null);setFeedback({uid:scope.task.uid,epoch:scope.task.epoch,kind:'confirmed',count:1});
    }else{const result=await recoverPendingEmbeddingIndex(scope.task.uid,scope.guard);scope.guard();setFeedback({uid:scope.task.uid,epoch:scope.task.epoch,kind:result.status==='cancelled'?'cancelled':'confirmed',count:1});}
  });
  const cancel=()=>perform(async scope=>{const result=await cancelPendingEmbeddingIndex(scope.task.uid,scope.guard);scope.guard();setPreview(null);setFeedback({uid:scope.task.uid,epoch:scope.task.epoch,kind:result.status==='cancelled'?'cancelled':'confirmed',count:1});});
  const backup=()=>perform(async scope=>{const data=await exportPendingEmbeddingIndex(scope.task.uid,scope.guard);scope.guard();triggerBlobDownload(new Blob([data],{type:'application/json'}),'mnemosyne-embedding-request.json');});
  const restore=(file:File)=>perform(async scope=>{if(file.size>300000)throw new EmbeddingIndexRecoveryError('checkpoint');const data=await file.text();scope.guard();await importPendingEmbeddingIndex(scope.task.uid,data,scope.guard);scope.guard();setFeedback({uid:scope.task.uid,epoch:scope.task.epoch,kind:'imported',count:1});});
  const loadHistory=(more=false)=>perform(async scope=>{
    const captured=memory;if(!captured?.syncConflictDigest)return;const guard=()=>{scope.guard();if(current.current.byId.get(captured.id)?.syncConflictDigest!==captured.syncConflictDigest)throw new EmbeddingIndexRecoveryError('baseline');};
    const page=await loadEmbeddingIndexHistory({uid:scope.task.uid,id:captured.id,viewDigest:captured.syncConflictDigest,cursor:more?shownHistory?.next:null,assertCurrent:guard});guard();
    const rows=new Map((more?shownHistory?.entries??[]:[]).map(entry=>[entry.versionId,entry]));for(const entry of page.entries)rows.set(entry.versionId,entry);
    setHistory({uid:scope.task.uid,epoch:scope.task.epoch,id:captured.id,viewDigest:captured.syncConflictDigest,entries:[...rows.values()],next:page.next,invalid:(more?shownHistory?.invalid??0:0)+page.invalid});
  });
  const reviewRollback=(entry:EmbeddingIndexHistoryEntry)=>perform(async scope=>{
    const captured=memory;if(!captured?.syncConflictDigest||!entry.rollbackAllowed)return;const guard=()=>{scope.guard();if(current.current.byId.get(captured.id)?.syncConflictDigest!==captured.syncConflictDigest)throw new EmbeddingIndexRecoveryError('baseline');};
    const baseline=await captureEmbeddingIndexBaseline({uid:scope.task.uid,id:captured.id,viewDigest:captured.syncConflictDigest,assertCurrent:guard});guard();setPreview({uid:scope.task.uid,epoch:scope.task.epoch,value:{kind:'rollback',id:captured.id,viewDigest:captured.syncConflictDigest,baseline,entry}});
  });
  const model=(space:string)=>t(space===LEGACY_EMBEDDING_SPACE?'indexModelLegacy':embeddingProfileForSpace(space)==='multilingualCandidate'?'indexModelMultilingual':embeddingProfileForSpace(space)==='englishPinned'?'indexModelEnglish':'indexModelUnknown');
  return <section aria-label={t('indexPublishTitle')} className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
    <h3 className="text-sm font-medium">{t('indexPublishTitle')}</h3><p className="text-xs text-slate-400">{t('indexPublishDescription')}</p>
    {!ready&&<p className="text-xs text-amber-200">{t('activityUnlock')}</p>}
    {!PERSONAL_REVISION_WRITES_ENABLED&&<p className="text-xs text-amber-200">{t('indexPublishClosed')}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!uid||!ready||busy||pending||!publicationCount||!PERSONAL_REVISION_WRITES_ENABLED} onClick={event=>{reviewTrigger.current=event.currentTarget;void review();}}>{t('indexPublishReview')}</button>
      <button type="button" className={button} disabled={!busy} onClick={()=>job.current?.control.abort()}>{t('indexPublishStop')}</button></div>
    {pending&&<div className="space-y-2 rounded-lg border border-amber-300/30 p-3"><p className="text-sm">{t('indexPublishPending')}</p><p className="text-xs text-slate-400">{t('indexPublishRetention')}</p><p className="text-xs text-slate-400">{t('indexPublishCancelHint')}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!ready||busy} onClick={event=>{reviewTrigger.current=event.currentTarget;void reviewPending();}}>{t('indexPublishReviewPending')}</button><button type="button" className={button} disabled={!ready||busy} onClick={()=>void cancel()}>{t('indexPublishCancelPending')}</button><button type="button" className={button} disabled={!ready||busy} onClick={()=>void backup()}>{t('indexPublishExport')}</button></div></div>}
    <label className="block space-y-1 text-xs"><span>{t('indexPublishImport')}</span><input type="file" accept="application/json,.json" disabled={!uid||!ready||busy||pending} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void restore(file);}} className="block max-w-full" /></label>
    {shownPreview&&<div role="group" aria-label={t('indexPublishReview')} className="space-y-3 rounded-lg border border-purple-300/40 p-3">
      <p className="text-sm">{shownPreview.kind==='publish'?t('indexPublishPreview',{count:shownPreview.plan.items.length,remaining:shownPreview.plan.remaining}):shownPreview.kind==='rollback'?t('indexPublishRollbackPreview',{model:model(shownPreview.entry.space)}):t('indexPublishPendingPreview',{id:shownPreview.id,operation:t(shownPreview.operation==='publish'?'indexPublishTitle':'indexPublishRollback')})}</p>
      <div className="flex gap-2"><button ref={confirmButton} type="button" className={button} disabled={busy||!ready} onClick={()=>void confirm()}>{t('indexPublishConfirm')}</button><button type="button" className={button} disabled={busy} onClick={()=>{returnFocus.current=true;setPreview(null);}}>{t('indexPublishBack')}</button></div>
    </div>}
    <div className="space-y-2 border-t border-white/10 pt-3"><label className="block text-xs">{t('indexPublishMemory')}<select value={memory?.id??''} disabled={!ready||busy} className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-900 p-2" onChange={event=>{setSelected(event.target.value);setHistory(null);setPreview(null);}}>
      <option value="">{t('indexPublishSelect')}</option>{candidates.map(row=><option key={row.id} value={row.id}>{row.title?.trim()||row.text.slice(0,60)||row.id}</option>)}</select></label>
      <button type="button" className={button} disabled={!memory||busy} onClick={()=>void loadHistory()}>{t('indexPublishHistory')}</button>
      {shownHistory&&<><ul className="space-y-2">{shownHistory.entries.map(entry=><li key={entry.versionId} className="rounded-lg border border-white/10 p-2 text-xs"><p>{t('indexPublishHistoryEntry',{date:new Date(entry.createdAt).toLocaleString(language),model:model(entry.space),count:entry.dimensions})}</p>
        {!entry.rollbackAllowed&&<p>{t('indexPublishDifferentContent')}</p>}<button type="button" className={button} disabled={busy||pending||!entry.rollbackAllowed||!PERSONAL_REVISION_WRITES_ENABLED} onClick={event=>{reviewTrigger.current=event.currentTarget;void reviewRollback(entry);}}>{t('indexPublishRollback')}</button></li>)}</ul>
        {!shownHistory.entries.length&&<p className="text-xs">{t('indexPublishHistoryEmpty')}</p>}{shownHistory.invalid>0&&<p className="text-xs text-amber-200">{t('indexPublishHistoryInvalid',{count:shownHistory.invalid})}</p>}
        {shownHistory.next&&<button type="button" className={button} disabled={busy} onClick={()=>void loadHistory(true)}>{t('indexPublishHistoryMore')}</button>}</>}
    </div>
    {(busy||shownFeedback)&&<p ref={statusElement} tabIndex={-1} role="status" aria-label={t('indexPublishTitle')} aria-live="polite" className="text-xs text-slate-300">{busy?t('indexPublishWorking',{count:running.completed,total:running.total}):shownFeedback&&t(`indexPublishStatus_${shownFeedback.kind}`,{count:shownFeedback.count})}</p>}
  </section>;
}

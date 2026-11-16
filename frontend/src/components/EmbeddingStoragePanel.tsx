import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {PERSONAL_REVISION_WRITES_ENABLED} from '../config/releaseGates';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {hasPendingEmbeddingIndex,observeEmbeddingIndexRequests,EmbeddingIndexRecoveryError} from '../services/embeddingIndexRecovery';
import {reviewEmbeddingStorage,applyEmbeddingStoragePlan,resetEmbeddingStorageProgress,type EmbeddingStoragePlan} from '../services/embeddingStorageManagement';
import {useTranslation,type TranslationKey} from '../utils/translations';

type Owned<T>={uid:string;epoch:number;value:T};
export function EmbeddingStoragePanel({uid}:{uid:string|null}){
  const {t}=useTranslation(),ready=useSyncExternalStore(onMemoryCryptoChanged,isMemoryCryptoReady,()=>false);
  const pending=useSyncExternalStore(callback=>observeEmbeddingIndexRequests(callback,()=>uid),()=>uid?hasPendingEmbeddingIndex(uid):false,()=>false);
  const current=useRef(uid);current.current=uid;const epoch=useRef(0),mounted=useRef(true),job=useRef<AbortController|null>(null);
  const [plan,setPlan]=useState<Owned<EmbeddingStoragePlan>|null>(null),[feedback,setFeedback]=useState<Owned<{key:TranslationKey;count:number}>|null>(null);
  const [running,setRunning]=useState<{count:number;total:number}|null>(null),confirmRef=useRef<HTMLButtonElement>(null),reviewRef=useRef<HTMLButtonElement>(null),statusRef=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;job.current?.abort();};},[]);
  useEffect(()=>{const retire=()=>{epoch.current++;job.current?.abort();job.current=null;setRunning(null);setPlan(null);setFeedback(null);};retire();const stop=onMemoryCryptoChanged(retire);return()=>{stop();job.current?.abort();job.current=null;};},[uid]);
  const shown=ready&&plan?.uid===uid&&plan.epoch===epoch.current?plan.value:null;
  const status=ready&&feedback?.uid===uid&&feedback.epoch===epoch.current?feedback.value:null;
  useEffect(()=>{if(shown&&!running)confirmRef.current?.focus();},[shown,running]);
  useEffect(()=>{if(status&&!running)statusRef.current?.focus();},[status,running]);
  const perform=async(run:(owner:string,scope:{signal:AbortSignal;assertCurrent:()=>void},report:(key:TranslationKey,count?:number)=>void)=>Promise<void>)=>{
    if(!uid||!isMemoryCryptoReady()||job.current)return;const owner=uid,generation=epoch.current,control=new AbortController();job.current=control;setRunning({count:0,total:0});setFeedback(null);
    const guard=()=>{if(!mounted.current||current.current!==owner||epoch.current!==generation||control.signal.aborted||!isMemoryCryptoReady())throw new Error('Storage view changed');};
    const report=(key:TranslationKey,count=0)=>{guard();setFeedback({uid:owner,epoch:generation,value:{key,count}});};
    try{await run(owner,{signal:control.signal,assertCurrent:guard},report);}
    catch(error){if(mounted.current&&current.current===owner&&epoch.current===generation){const key=error instanceof EmbeddingIndexRecoveryError&&error.reason==='pending'?'storageOptimizePending':'storageOptimizeFailed';setFeedback({uid:owner,epoch:generation,value:{key,count:0}});}}
    finally{if(job.current===control){job.current=null;if(mounted.current)setRunning(null);}}
  };
  const review=()=>perform(async(owner,scope)=>{const value=await reviewEmbeddingStorage(owner,scope);scope.assertCurrent();setPlan({uid:owner,epoch:epoch.current,value});});
  const apply=()=>perform(async(_owner,scope,report)=>{const captured=shown;if(!captured)return;setPlan(null);setRunning({count:0,total:captured.items.length});
    const result=await applyEmbeddingStoragePlan(captured,{...scope,onProgress:(count,total)=>{scope.assertCurrent();setRunning({count,total});}});scope.assertCurrent();report(result.finished?'storageOptimizeFinished':'storageOptimizeDone',result.completed);});
  const reset=()=>perform(async(owner,scope,report)=>{await resetEmbeddingStorageProgress(owner,scope);scope.assertCurrent();setPlan(null);report('storageOptimizeResetDone');});
  const busy=running!==null,button='rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-40';
  return <section className="space-y-3 rounded-xl border border-white/10 p-4" aria-label={t('storageOptimizeTitle')}
    onKeyDown={event=>{if(event.key==='Escape'&&shown&&!busy){event.preventDefault();event.stopPropagation();setPlan(null);reviewRef.current?.focus();}}}>
    <h4 className="text-sm font-semibold">{t('storageOptimizeTitle')}</h4><p className="text-xs text-slate-300">{t('storageOptimizeBody')}</p>
    {!PERSONAL_REVISION_WRITES_ENABLED&&<p className="text-xs text-amber-200">{t('storageOptimizeClosed')}</p>}
    {!ready&&<p className="text-xs">{t('storageOptimizeLocked')}</p>}{pending&&<p className="text-xs text-amber-200">{t('storageOptimizePending')}</p>}
    <div className="flex flex-wrap gap-2"><button ref={reviewRef} type="button" className={button} disabled={!uid||!ready||busy||pending||!PERSONAL_REVISION_WRITES_ENABLED} onClick={()=>void review()}>{t('storageOptimizeReview')}</button>
      <button type="button" className={button} disabled={!uid||!ready||busy||pending} onClick={()=>void reset()}>{t('storageOptimizeReset')}</button></div>
    {shown&&<div className="space-y-2 rounded-lg border border-cyan-400/30 p-3" role="group" aria-label={t('storageOptimizePreviewLabel')}>
      <p className="text-sm">{t('storageOptimizePreview',{count:shown.items.length,scanned:shown.scanned})}</p>
      {shown.items.length>0&&<><p className="text-xs text-slate-300">{t('storageOptimizeCosts')}</p><ul className="max-h-40 overflow-auto text-xs">{shown.items.map(item=><li key={item.id}>{item.label||t('storageOptimizeUntitled')}</li>)}</ul></>}
      <div className="flex gap-2"><button ref={confirmRef} type="button" className={button} disabled={busy||pending||!ready||!PERSONAL_REVISION_WRITES_ENABLED} onClick={()=>void apply()}>{t(shown.items.length?'storageOptimizeConfirm':'storageOptimizeContinue')}</button>
        <button type="button" className={button} disabled={busy} onClick={()=>{setPlan(null);reviewRef.current?.focus();}}>{t('indexPublishBack')}</button></div>
    </div>}
    {(busy||status)&&<p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="text-xs text-slate-300">{busy?(running.total?t('storageOptimizeWorking',{count:running.count,total:running.total}):t('storageOptimizeChecking')):status&&t(status.key,{count:status.count})}</p>}
  </section>;
}

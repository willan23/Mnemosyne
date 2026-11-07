import {useCallback,useEffect,useRef,useState} from 'react';
import {auth} from '../firebase';
import {useSyncFeedback} from './useSyncFeedback';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {getTeamKeyCacheGeneration,onTeamKeyChanged} from '../services/teamVault';
import {loadCognitiveDraft,saveCognitiveDraft,discardCognitiveDraft,CognitiveDraftError,type CognitiveDraft,type DraftGeneration} from '../services/cognitiveDraft';
import type {GeneratedImageResult} from '../services/aiGenerationService';
import type {TeamRecord} from '../services/teamsService';
import {parseAiGenerationScope,type AiGenerationScope} from '../../../functions/src/aiCostPolicy';

const empty=(uid:string):CognitiveDraft=>({v:1,uid,scope:{kind:'personal'},text:'',generation:null,image:null,imagePrompt:''});
type View={scope:string;draft:CognitiveDraft;loaded:boolean;dirty:boolean;message:string|null};
type Local={scope:string;draft:CognitiveDraft;raw:string|null;edit:number;saved:number;live:()=>boolean};
export function useCognitiveDraft(teams:TeamRecord[]){
  const {capture,epoch}=useSyncFeedback();const uid=auth.currentUser?.uid??null;const [,setTick]=useState(0);
  const teamState=JSON.stringify(teams.map(team=>[team.id,team.memberUids,team.roles,Boolean(uid&&team.wrappedKeys?.[uid]),team.activeKeyEpoch,team.activeKeyId,team.keyRotationStatus,team.pendingRotationId]).sort());
  const scope=JSON.stringify([uid,epoch,getTeamKeyCacheGeneration(),teamState]);
  const renderedScope=useRef(scope);renderedScope.current=scope;
  const [view,setView]=useState<View>(()=>({scope,draft:empty(uid??''),loaded:false,dirty:false,message:null}));
  const local=useRef<Local|null>(null),running=useRef<Promise<void>|null>(null),loading=useRef<Promise<void>|null>(null);
  const visible=view.scope===scope&&Boolean(uid)&&isMemoryCryptoReady();const draft=visible?view.draft:empty(uid??'');
  const ready=visible&&view.loaded;const message=visible?view.message:null;
  useEffect(()=>{const refresh=()=>setTick(value=>value+1);const a=onTeamKeyChanged(refresh),b=onMemoryCryptoChanged(refresh);return()=>{a();b();};},[]);
  const flush=useCallback(async function flushDraft():Promise<void>{
    if(running.current){await running.current;if(local.current?.live()&&local.current.edit!==local.current.saved)await flushDraft();return;}
    const job=(async()=>{
      let item=local.current;
      while(item&&item.live()&&item.edit!==item.saved){
        const edited=item.edit,proposed=structuredClone(item.draft);
        try{
          const raw=await saveCognitiveDraft(proposed.uid,proposed,item.raw,()=>{if(!item!.live()||local.current!==item||item!.edit!==edited)throw Error('Draft changed');});
          if(!item.live()||local.current!==item)return;item.raw=raw;item.saved=edited;
          const confirmed=item;setView(old=>old.scope===confirmed.scope?{...old,dirty:confirmed.edit!==confirmed.saved,message:null}:old);
        }catch(error){
          if(!item.live()||local.current!==item)return;
          if(error instanceof CognitiveDraftError&&error.committedRaw!==undefined)item.raw=error.committedRaw;
          if(item.edit!==edited){item=local.current;continue;}
          const failed=item;setView(old=>old.scope===failed.scope?{...old,dirty:true,message:'Não foi possível guardar o rascunho cifrado. Mantém esta vista aberta e tenta novamente. O registo guardado foi conservado.'}:old);return;
        }
        item=local.current;
      }
    })();running.current=job;try{await job;}finally{if(running.current===job)running.current=null;}
  },[]);
  useEffect(()=>{
    let active=true;const current=uid?capture(uid):()=>false;const live=()=>active&&renderedScope.current===scope&&current();
    local.current=null;
    if(!uid||!live())return()=>{active=false;};
    // A retired operation still owns its native lock until its guarded work unwinds.
    // Queue this view's reads behind its own work; other windows keep the fail-fast lock policy.
    const previous=loading.current;
    const job=(async()=>{
      if(previous)await previous.catch(()=>{});
      if(running.current)await running.current.catch(()=>{});
      if(!live())return;
      try{
        const saved=await loadCognitiveDraft(uid,()=>{if(!live())throw Error('Draft context changed');});
        if(!live())return;const draft=saved.draft??empty(uid);local.current={scope,draft,raw:saved.raw,edit:0,saved:0,live};
        setView({scope,draft,loaded:true,dirty:false,message:null});
      }catch{if(live())setView({scope,draft:empty(uid),loaded:false,dirty:false,message:'Não foi possível abrir o rascunho cifrado. A cópia guardada foi conservada. Confirma a conta/cofre/equipa ou elimina explicitamente este rascunho local.'});}
    })();
    loading.current=job;
    const finish=()=>{if(loading.current===job)loading.current=null;};void job.then(finish,finish);
    return()=>{active=false;};
  },[scope,uid,capture]);
  useEffect(()=>{if(!view.dirty||view.scope!==scope)return;const timer=setTimeout(()=>{void flush();},150);return()=>clearTimeout(timer);},[view,scope,flush]);
  function update(work:(value:CognitiveDraft)=>CognitiveDraft){
    const item=local.current;if(!ready||!item||item.scope!==scope||!item.live())return;
    item.draft=work(item.draft);item.edit++;setView({scope,draft:item.draft,loaded:true,dirty:true,message:null});
  }
  const setText=(text:string)=>update(value=>({...value,text}));
  const setGeneratedImage=(image:GeneratedImageResult|null)=>update(value=>({...value,image:image?{...image}:null}));
  const setGeneratedImagePrompt=(imagePrompt:string)=>update(value=>({...value,imagePrompt}));
  const normalizeGeneration=(scope:AiGenerationScope,generation:DraftGeneration)=>scope.kind==='personal'&&!generation.personalRevisionBaseline?{...generation,personalRevisionUnavailable:true as const}:scope.kind==='team'&&!generation.teamRevisionBaseline?{...generation,teamRevisionUnavailable:true as const}:generation;
  const setLearnedGeneration=(generation:DraftGeneration|null)=>update(value=>({...value,generation:generation?structuredClone(normalizeGeneration(value.scope,generation)):null}));
  const setGenerationResult=(result:{text:string;image:GeneratedImageResult|null;imagePrompt:string;generation:DraftGeneration;scope:AiGenerationScope})=>update(value=>{
    const scope=parseAiGenerationScope(result.scope);if(!scope||result.generation.uid!==value.uid||scope.kind!==value.scope.kind||scope.kind==='team'&&(value.scope.kind!=='team'||scope.teamId!==value.scope.teamId))return value;
    const generation=normalizeGeneration(scope,result.generation);
    return{...value,scope,text:result.text,image:result.image?{...result.image}:null,imagePrompt:result.imagePrompt,generation:structuredClone(generation)};
  });
  const setTargetTeamId=(id:string)=>update(value=>{
    if(!id)return{...value,scope:{kind:'personal'}};const team=teams.find(item=>item.id===id);
    const scope=team&&parseAiGenerationScope({kind:'team',teamId:id,keyEpoch:team.activeKeyEpoch,keyId:team.activeKeyId});
    if(!scope||!team?.memberUids.includes(value.uid)||!team.wrappedKeys[value.uid]||team.keyRotationStatus!=='active'||team.pendingRotationId)return value;
    return{...value,scope};
  });
  async function discard(){
    if(!uid||!window.confirm('Eliminar este rascunho local, incluindo texto, resultado e edição não guardada? As memórias já criadas não serão eliminadas.'))return;
    const current=capture(uid);if(!current())return;const previous=local.current;local.current=null;
    try{if(running.current)await running.current;if(!current())return;await discardCognitiveDraft(uid,()=>{if(!current())throw Error('Draft changed');});if(!current())return;
      const draft=empty(uid);local.current={scope,draft,raw:null,edit:0,saved:0,live:current};setView({scope,draft,loaded:true,dirty:false,message:null});
    }catch{if(current()){local.current=previous;setView(old=>old.scope===scope?{...old,message:'Não foi possível eliminar o rascunho local. A cópia guardada foi conservada.'}:old);}}
  }
  return{text:draft.text,setText,generatedImage:draft.image,setGeneratedImage,generatedImagePrompt:draft.imagePrompt,setGeneratedImagePrompt,
    learnedGeneration:draft.generation,setLearnedGeneration,targetTeamId:draft.scope.kind==='team'?draft.scope.teamId:'',setTargetTeamId,
    ready,message,dirty:visible&&view.dirty,flush,discard,scope,setGenerationResult,
    capture:()=>{const captured=local.current;return()=>Boolean(captured&&captured===local.current&&captured.live());},
    captureEdit:()=>{const captured=local.current,edit=captured?.edit;return()=>Boolean(captured&&captured===local.current&&captured.live()&&captured.edit===edit);}};
}

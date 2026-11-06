import {useEffect,useRef,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {useSyncFeedback} from './useSyncFeedback';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {getTeamKeyCacheGeneration,onTeamKeyChanged} from '../services/teamVault';
import {captureMemoryEditBaseline,hasPendingMemoryEdit} from '../services/memoryEditRecovery';
import {loadMemoryEditorDraft,saveMemoryEditorDraft,discardMemoryEditorDraft,MemoryEditorDraftError,type MemoryEditorDraft} from '../services/memoryEditorDraft';
import {TEAM_WRITES_ENABLED,PERSONAL_REVISION_WRITES_ENABLED} from '../config/releaseGates';
import type {MemoryObject,MemorySaveCallback} from '../types/universe';
type Item={scope:string;source:MemoryObject;draft:MemoryEditorDraft;raw:string|null;edit:number;saved:number;editing:boolean;persist:boolean;retired:boolean;failed:boolean;owner:()=>boolean;view:()=>boolean;stop:()=>void;running:Promise<void>|null};
type View={scope:string;editing:boolean;busy:boolean;ready:boolean;dirty:boolean;draft:MemoryEditorDraft|null;message:string|null};
const empty=(scope:string):View=>({scope,editing:false,busy:false,ready:false,dirty:false,draft:null,message:null});
export function useMemoryEditor(selected:MemoryObject|null|undefined,onSave?:MemorySaveCallback,active=true){
  const feedback=useSyncFeedback(),uid=auth.currentUser?.uid??null,[,tick]=useState(0);const generation=getTeamKeyCacheGeneration(),scope=JSON.stringify([uid,feedback.epoch,generation,selected?.id??null,active]);
  const rendered=useRef(scope);rendered.current=scope;const sourceRef=useRef(selected);sourceRef.current=selected;const saveRef=useRef(onSave);saveRef.current=onSave;
  const alive=useRef(false),local=useRef<Item|null>(null),cache=useRef(new Map<string,Item>()),[view,setView]=useState<View>(()=>empty(scope));const visible=view.scope===scope&&Boolean(uid)&&isMemoryCryptoReady();
  useEffect(()=>{alive.current=true;const stop=onTeamKeyChanged(()=>tick(value=>value+1));return()=>{alive.current=false;stop();const item=local.current;if(item){item.editing=false;item.retired=true;if(!item.running)item.stop();}};},[]);
  useEffect(()=>{const old=local.current;if(old&&old.scope!==scope){old.editing=false;old.retired=true;if(!old.running)old.stop();local.current=null;}},[scope]);
  function publish(item:Item,message:string|null=null,busy?:boolean){if(item.view())setView(old=>({scope:item.scope,editing:item.editing,busy:busy??(old.scope===item.scope&&old.busy),ready:true,dirty:item.edit!==item.saved,draft:{...item.draft},message}));}
  async function flush(item:Item,force=false):Promise<boolean>{
    if(item.running){await item.running;if(item.owner()&&item.persist&&item.edit!==item.saved&&!item.failed)return flush(item);return item.edit===item.saved;}
    if(!item.owner()||!item.persist||item.failed&&!force)return false;item.failed=false;
    const job=(async()=>{while(item.owner()&&item.persist&&item.edit!==item.saved){const edited=item.edit,proposed=structuredClone(item.draft);try{const raw=await saveMemoryEditorDraft(proposed.uid,proposed.baseline.sessionId,proposed,item.raw,()=>{if(!item.owner()||!item.persist||item.edit!==edited)throw Error('Editor draft changed');});item.raw=raw;item.saved=edited;if(item.view())publish(item);}
      catch(error){if(error instanceof MemoryEditorDraftError&&error.committedRaw!==undefined)item.raw=error.committedRaw;if(!item.owner())return;if(item.edit!==edited&&item.persist)continue;item.failed=true;if(item.view())publish(item,'Não foi possível guardar o rascunho cifrado. Mantém esta vista aberta e tenta novamente. A cópia guardada foi conservada.');return;}}
    })();item.running=job;try{await job;return item.edit===item.saved;}finally{if(item.running===job)item.running=null;if(item.retired)item.stop();}
  }
  function captureView(actor:string){const current=feedback.capture(actor),captured=scope;return()=>alive.current&&rendered.current===captured&&current();}
  async function begin(){
    const source=sourceRef.current;if(!active||!uid||!source||source.encLocked||source.teamScopeAmbiguous||!source.persistedStateDigest||source.persistedTitle===undefined||!source.teamId&&source.uid!==uid)return;
    const current=captureView(uid);if(!current())return;const captured=structuredClone(source);setView({...empty(scope),editing:true,busy:true});
    try{
      const cached=cache.current.get(JSON.stringify([uid,captured.id]));let draft:MemoryEditorDraft,raw:string|null;
      if(cached?.owner()&&cached.edit!==cached.saved){if(cached.running)await cached.running;if(!current())return;draft=structuredClone(cached.draft);raw=cached.raw;}
      else{const loaded=await loadMemoryEditorDraft(uid,captured.id,()=>{if(!current())throw Error('Editor view changed');});if(!current())return;raw=loaded.raw;
        if(loaded.draft){draft=loaded.draft;if(draft.baseline.teamId!==(captured.teamId??null))throw Error('Editor scope changed');}
        else{const baseline=await captureMemoryEditBaseline({uid,id:captured.id,teamId:captured.teamId??null,viewDigest:captured.persistedStateDigest!,expected:{text:captured.text,title:captured.persistedTitle!,authorUid:captured.uid},assertCurrent:()=>{if(!current())throw Error('Editor view changed');}});if(!current())return;draft={v:1,uid,baseline,sourceText:captured.text,sourceTitle:captured.persistedTitle!,text:captured.text,title:captured.title??'',titleDirty:false,metadata:{}};}
      }
      if(!current())return;let changed=false;const ownerFeedback=feedback.capture(uid),cryptoGeneration=getTeamKeyCacheGeneration(),stopAuth=onAuthStateChanged(auth,user=>{if(user?.uid!==uid)changed=true;}),stopVault=onMemoryCryptoChanged(()=>{changed=true;}),stopTeam=onTeamKeyChanged(()=>{changed=true;});
      const owner=()=>!changed&&auth.currentUser?.uid===uid&&isMemoryCryptoReady()&&getTeamKeyCacheGeneration()===cryptoGeneration&&(alive.current?ownerFeedback():true);
      const item:Item={scope,source:{...captured,text:draft.sourceText,persistedTitle:draft.sourceTitle,persistedStateDigest:draft.baseline.stateDigest},draft,raw,edit:raw===null||cached?.edit!==cached?.saved?1:0,saved:0,editing:true,persist:true,retired:false,failed:false,owner,view:()=>alive.current&&rendered.current===scope&&current()&&local.current===item&&item.editing,stop:()=>{stopAuth();stopVault();stopTeam();},running:null};
      const previous=local.current;if(previous&&previous!==cached){previous.editing=false;previous.retired=true;if(!previous.running)previous.stop();}local.current=item;cache.current.set(JSON.stringify([uid,captured.id]),item);
      if(item.edit!==item.saved&&!await flush(item,true)){if(item.view())publish(item,'Não foi possível guardar o rascunho cifrado. Mantém esta vista aberta e tenta novamente. A cópia guardada foi conservada.',false);return;}if(item.view())publish(item,null,false);
    }catch{if(current())setView({...empty(scope),editing:true,message:'Não foi possível abrir a edição. O rascunho guardado foi conservado. Confirma a conta, cofre e versão da memória.'});}
  }
  function update(work:(draft:MemoryEditorDraft)=>MemoryEditorDraft){const item=local.current;if(!item?.view()||!view.ready||view.busy)return;item.draft=work(item.draft);item.edit++;publish(item);void flush(item);}
  const setText=(text:string)=>update(draft=>({...draft,text})),setTitle=(title:string)=>update(draft=>({...draft,title,titleDirty:true}));
  function close(){const item=local.current;if(item){item.editing=false;item.retired=true;if(!item.running)item.stop();}if(visible)setView(old=>({...old,editing:false,busy:false}));}
  async function submit(){const item=local.current,save=saveRef.current;if(!item?.view()||!save||!view.ready||view.busy||!(item.draft.baseline.kind==='team'?TEAM_WRITES_ENABLED:PERSONAL_REVISION_WRITES_ENABLED)||sourceRef.current?.persistedStateDigest!==item.draft.baseline.stateDigest||!item.draft.text.trim()||hasPendingMemoryEdit(item.draft.uid))return;const edited=item.edit,guard=()=>{if(!item.view()||item.edit!==edited)throw Error('Editor revision changed');};let committed=false;setView(old=>old.scope===scope?{...old,busy:true,message:null}:old);
    try{if(!await flush(item,true))return;guard();const proposed=structuredClone(item.draft),title=proposed.titleDirty?proposed.title.trim()||null:proposed.sourceTitle;await save({...item.source,text:proposed.text,title:title??undefined},{kind:'edit',baseline:proposed.baseline,title,metadata:proposed.metadata,refreshSemantic:proposed.text!==proposed.sourceText,assertCurrent:guard});guard();committed=true;item.persist=false;if(item.running)await item.running;guard();await discardMemoryEditorDraft(proposed.uid,proposed.baseline.sessionId,item.raw,guard);guard();item.raw=null;item.editing=false;item.retired=true;item.stop();cache.current.delete(JSON.stringify([proposed.uid,proposed.baseline.sessionId]));setView(empty(scope));return true;}
    catch{if(item.view())publish(item,committed?'A memória foi guardada. Não foi possível eliminar o rascunho local; a cópia foi conservada.':'A alteração não foi confirmada. O pedido e o rascunho foram conservados.');return false;}
    finally{if(item.view())setView(old=>old.scope===scope?{...old,busy:false}:old);}
  }
  async function discardAndReopen(){const item=local.current;if(view.busy)return;
    // An initial read can fail before creating an editor item; begin reloads durable drafts without discarding them.
    if(!item?.view()){if(visible&&view.editing&&!view.ready&&view.draft===null&&view.message)await begin();return;}
    if(!window.confirm('Eliminar este rascunho de edição e abrir a versão atual da memória? As memórias guardadas não serão eliminadas.'))return;const guard=()=>{if(!item.view())throw Error('Editor view changed');};item.persist=false;
    try{if(item.running)await item.running;guard();await discardMemoryEditorDraft(item.draft.uid,item.draft.baseline.sessionId,item.raw,guard);guard();item.editing=false;item.retired=true;item.stop();cache.current.delete(JSON.stringify([item.draft.uid,item.draft.baseline.sessionId]));local.current=null;await begin();}catch{if(item.view()){item.persist=true;publish(item,'Não foi possível eliminar o rascunho. A cópia guardada foi conservada.');}}
  }
  async function saveMetadata(metadata:Record<string,unknown>){const source=sourceRef.current,save=saveRef.current;if(!active||!uid||!source||!save||source.encLocked||source.teamScopeAmbiguous||!(source.teamId?TEAM_WRITES_ENABLED:PERSONAL_REVISION_WRITES_ENABLED)||hasPendingMemoryEdit(uid)||!source.persistedStateDigest||source.persistedTitle===undefined)return false;const current=captureView(uid),guard=()=>{if(!current())throw Error('Memory metadata view changed');};const captured=structuredClone(source);
    try{const baseline=await captureMemoryEditBaseline({uid,id:captured.id,teamId:captured.teamId??null,viewDigest:captured.persistedStateDigest!,expected:{text:captured.text,title:captured.persistedTitle!,authorUid:captured.uid},assertCurrent:guard});guard();await save(captured,{kind:'edit',baseline,title:captured.persistedTitle!,metadata:structuredClone(metadata),refreshSemantic:false,assertCurrent:guard});guard();return true;}catch{return false;}
  }
  const stale=Boolean(visible&&view.draft&&selected?.persistedStateDigest&&view.draft.baseline.stateDigest!==selected.persistedStateDigest),ready=visible&&view.ready,gate=view.draft?.baseline.kind==='team'?TEAM_WRITES_ENABLED:PERSONAL_REVISION_WRITES_ENABLED;
  return{scope,writesEnabled:selected?.teamId?TEAM_WRITES_ENABLED:PERSONAL_REVISION_WRITES_ENABLED,editing:visible&&view.editing,busy:visible&&view.busy,ready,canRetryOpening:visible&&view.editing&&!view.ready&&!view.busy&&view.draft===null&&Boolean(view.message),dirty:visible&&view.dirty,text:visible?view.draft?.text??'':'',title:visible?view.draft?.title??'':'',setText,setTitle,begin,close,submit,discardAndReopen,saveMetadata,
    canSubmit:ready&&gate&&!view.busy&&!stale&&Boolean(view.draft?.text.trim())&&!(uid&&hasPendingMemoryEdit(uid)),message:visible?(stale?'A memória recebeu alterações. O rascunho original foi conservado. Revê a versão atual antes de voltar a guardar.':view.message):null};
}

import {useEffect,useRef,useState} from 'react';
import toast from 'react-hot-toast';
import {auth} from '../firebase';
import {TEAM_WRITES_ENABLED} from '../config/releaseGates';
import {isMemoryCryptoReady} from '../services/memoryCrypto';
import {getTeamKeyCacheGeneration,onTeamKeyChanged} from '../services/teamVault';
import {captureTeamConnectionBaselines,changeTeamMemoryConnection,hasPendingTeamConnection,observeTeamConnections} from '../services/teamConnections';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import type {MemoryObject} from '../types/universe';
import {useTranslation} from '../utils/translations';
type Props={memory:MemoryObject;peers:MemoryObject[]};
export function TeamMemoryConnectionsPanel(props:Props){
  const feedback=useSyncFeedback(),[,tick]=useState(0),uid=auth.currentUser?.uid??null,generation=getTeamKeyCacheGeneration();
  useEffect(()=>onTeamKeyChanged(()=>tick(value=>value+1)),[]);
  return <ConnectionView key={JSON.stringify([uid,feedback.epoch,generation,props.memory.teamId,props.memory.id])} {...props} uid={uid} capture={feedback.capture}/>;
}
function ConnectionView({memory,peers,uid,capture}:Props&{uid:string|null;capture:(uid:string)=>()=>boolean}){
  const {t}=useTranslation(),[targetId,setTargetId]=useState(''),[,tick]=useState(0),selectionEdit=useRef(0),alive=useRef(false);
  const candidates=peers.filter(peer=>peer.id!==memory.id&&peer.teamId===memory.teamId&&!peer.teamScopeAmbiguous&&!peer.encLocked),target=candidates.find(peer=>peer.id===targetId);
  const scope=JSON.stringify([uid,memory.teamId,memory.id,memory.persistedStateDigest,target?.id,target?.persistedStateDigest,selectionEdit.current]),rendered=useRef(scope);rendered.current=scope;
  const [state,setState]=useState({scope,busy:false}),busy=state.scope===scope&&state.busy;
  useEffect(()=>{alive.current=true;const stop=observeTeamConnections(()=>tick(value=>value+1));return()=>{alive.current=false;stop();};},[]);
  const permitted=Boolean(uid&&memory.teamId&&isMemoryCryptoReady()&&!memory.teamScopeAmbiguous&&!memory.encLocked&&target&&Number.isFinite(memory.persistedUpdatedAt)&&Number.isFinite(target.persistedUpdatedAt)&&memory.persistedStateDigest&&target.persistedStateDigest&&memory.persistedTitle!==undefined&&target.persistedTitle!==undefined&&TEAM_WRITES_ENABLED&&!hasPendingTeamConnection(uid));
  const here=Boolean(target&&memory.connections.includes(target.id)),there=Boolean(target&&target.connections.includes(memory.id));
  const change=async(operation:'link'|'unlink')=>{
    if(!permitted||!uid||!memory.teamId||!target||busy)return;const current=capture(uid),selected=selectionEdit.current,capturedGeneration=getTeamKeyCacheGeneration(),capturedScope=scope,pair=structuredClone([memory,target]) as [MemoryObject,MemoryObject];
    const valid=()=>alive.current&&current()&&getTeamKeyCacheGeneration()===capturedGeneration&&rendered.current===capturedScope&&selectionEdit.current===selected,guard=()=>{if(!valid())throw Error('Connection view changed');};if(!valid())return;setState({scope,busy:true});
    try{const baselines=await captureTeamConnectionBaselines({uid,teamId:memory.teamId,views:pair.map(item=>({id:item.id,viewDigest:item.persistedStateDigest!,expected:{text:item.text,title:item.persistedTitle!,authorUid:item.uid}})) as Parameters<typeof captureTeamConnectionBaselines>[0]['views'],assertCurrent:guard});guard();
      const label=(item:MemoryObject)=>item.title||item.text.slice(0,60)||item.id;
      if(!window.confirm(`${t(operation==='link'?'teamLinkConfirm':'teamUnlinkConfirm')}\n\n${label(pair[0])} ↔ ${label(pair[1])}`))return;guard();
      const result=await changeTeamMemoryConnection({uid,operation,baselines,assertCurrent:guard});guard();toast.success(t(result.changed?'teamLinkDone':'teamLinkAlready'));
    }catch{if(valid())toast.error(t('teamLinkFailed'));}finally{if(valid())setState({scope,busy:false});}
  };
  return <section aria-label={t('teamLinkTitle')} className="space-y-2 rounded-xl border border-white/10 p-3 text-xs text-white/65">
    <h4 className="font-semibold">{t('teamLinkTitle')}</h4><p>{t('teamLinkHint')}</p>
    <label className="block">{t('teamLinkTarget')}<select value={targetId} onChange={event=>{selectionEdit.current++;setTargetId(event.target.value);setState({scope:'',busy:false});}} disabled={busy} className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-900 p-2">
      <option value="">{t('teamLinkChoose')}</option>{candidates.map(peer=><option key={peer.id} value={peer.id}>{peer.title||peer.text.slice(0,60)}</option>)}
    </select></label>
    {!TEAM_WRITES_ENABLED&&<p>{t('teamLinkClosed')}</p>}
    {uid&&hasPendingTeamConnection(uid)&&<p>Uma alteração de ligações aguarda confirmação. Recupera ou cancela o pedido conservado.</p>}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={!permitted||busy||(here&&there)} onClick={()=>void change('link')} className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">{t('teamLinkAdd')}</button>
    <button type="button" disabled={!permitted||busy||(!here&&!there)} onClick={()=>void change('unlink')} className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">{t('teamLinkRemove')}</button></div>
  </section>;
}

import {useEffect,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {hasPendingSemanticRelations,observeSemanticRelations,recoverSemanticRelation,cancelSemanticRelation} from '../services/semanticRelationRecovery';
export function SemanticRelationRecoveryPanel(){
  const [uid,setUid]=useState(()=>auth.currentUser?.uid??null),[,refresh]=useState(0),feedback=useSyncFeedback(),scope=JSON.stringify([uid,feedback.epoch]);
  const [state,setState]=useState<{scope:string;busy:boolean;message:string|null}>({scope,busy:false,message:null}),ready=isMemoryCryptoReady(),pending=Boolean(uid&&hasPendingSemanticRelations(uid)),busy=state.scope===scope&&state.busy,message=state.scope===scope?state.message:null;
  useEffect(()=>{const change=()=>refresh(value=>value+1),a=onAuthStateChanged(auth,user=>setUid(user?.uid??null)),b=onMemoryCryptoChanged(change),c=observeSemanticRelations(change);return()=>{a();b();c();};},[]);
  async function operate(cancel:boolean){if(!uid||!ready||busy)return;const current=feedback.capture(uid),guard=()=>{if(!current())throw Error('O contexto mudou.');};if(!current())return;if(cancel&&!window.confirm('Cancelar a operação de relações pendente? Uma operação já gravada será confirmada.'))return;if(!current())return;setState({scope,busy:true,message:null});
    try{const result=cancel?await cancelSemanticRelation(uid,guard):await recoverSemanticRelation(uid,guard);if(!current())return;setState({scope,busy:false,message:result.status==='committed'?'Operação de relações confirmada.':result.status==='revoked'?'As memórias já não estão disponíveis. O pedido local foi encerrado.':'Operação de relações cancelada.'});}
    catch{if(current())setState({scope,busy:false,message:'Não foi possível confirmar a operação. O pedido cifrado foi conservado.'});}
  }
  if(!pending&&!message)return null;return <section aria-label="Recuperação de relações" className="rounded-xl border border-amber-300/30 bg-slate-950/95 p-3 text-sm text-white/80">{pending&&<p>Uma criação ou revisão de relações aguarda confirmação.</p>}{pending&&!ready&&<p>Desbloqueia o cofre desta conta para continuar.</p>}{pending&&<div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy||!ready} onClick={()=>void operate(false)} className="rounded border px-3 py-2 disabled:opacity-40">Recuperar relações</button><button type="button" disabled={busy||!ready} onClick={()=>void operate(true)} className="rounded border px-3 py-2 disabled:opacity-40">Cancelar operação de relações</button></div>}{message&&<p role="status" aria-live="polite">{message}</p>}</section>;
}

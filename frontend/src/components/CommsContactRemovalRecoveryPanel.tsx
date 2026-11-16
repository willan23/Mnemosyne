import {useEffect,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {hasPendingCommsContactRemoval,observeCommsContactRemoval,continueCommsContactRemoval,cancelCommsContactRemoval} from '../services/commsContactRemoval';
export function CommsContactRemovalRecoveryPanel({active=true,isCurrent=()=>true,onChanged=()=>{}}:{active?:boolean;isCurrent?:()=>boolean;onChanged?:()=>void}){
  const [uid,setUid]=useState(()=>auth.currentUser?.uid??null),[,setVersion]=useState(0),feedback=useSyncFeedback(active);
  const scope=JSON.stringify([uid,feedback.epoch]);const[state,setState]=useState({scope,busy:false,message:''}),busy=state.scope===scope&&state.busy,message=state.scope===scope?state.message:'';
  const pending=Boolean(uid&&hasPendingCommsContactRemoval(uid)),ready=isMemoryCryptoReady();
  useEffect(()=>{const refresh=()=>setVersion(value=>value+1),a=onAuthStateChanged(auth,user=>setUid(user?.uid??null)),v=onMemoryCryptoChanged(refresh),s=observeCommsContactRemoval(refresh);return()=>{a();v();s();};},[]);
  async function advance(cancel=false){
    if(!uid||!ready||busy)return;const captured=feedback.capture(uid),current=()=>captured()&&isCurrent();if(!current())return;
    if(cancel&&!window.confirm('Cancelar apenas a intenção de remoção ainda não admitida? Uma remoção já iniciada será conservada para conclusão.'))return;if(!current())return;
    setState({scope,busy:true,message:''});const guard=()=>{if(!current())throw Error('Contact removal view changed');};
    try{const result=await (cancel?cancelCommsContactRemoval(uid,guard):continueCommsContactRemoval(uid,guard));guard();onChanged();guard();setState({scope,busy:false,message:result.status==='pending'?`A remoção continua pendente. ${result.removedCount} pedido(s) retirado(s).`:result.status==='cancelled'?'Intenção não admitida cancelada. Nenhum contacto foi retirado por esta operação.':result.status==='revoked'?'O contacto já não está disponível.':'Contacto retirado. As mensagens já entregues foram conservadas.'});}
    catch{if(current())setState({scope,busy:false,message:'Não foi possível confirmar a remoção. A cópia cifrada local foi conservada.'});}
  }
  if(!active||!pending&&!message)return null;
  return <section aria-label="Recuperação de remoção de contacto" className="mb-3 rounded-xl border border-amber-300/30 p-3 text-sm text-white/80">
    {pending&&<p>Uma remoção de contacto aguarda conclusão. Continua a mesma operação antes de retirar outro contacto.</p>}
    {pending&&!ready&&<p>Desbloqueia o cofre desta conta para continuar a remoção.</p>}
    {pending&&<button type="button" disabled={busy||!ready} onClick={()=>void advance()} className="mt-2 rounded border px-3 py-2 disabled:opacity-40">Continuar remoção de contacto</button>}
    {pending&&<button type="button" disabled={busy||!ready} onClick={()=>void advance(true)} className="ml-2 mt-2 rounded border px-3 py-2 disabled:opacity-40">Cancelar intenção não admitida</button>}
    {message&&<p role="status" aria-live="polite">{message}</p>}
  </section>;
}

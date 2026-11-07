import {useEffect,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {hasPendingCommsDelivery,observeCommsDeliveries,recoverCommsDelivery,cancelCommsDelivery} from '../services/commsDelivery';
export function CommsDeliveryRecoveryPanel({active=true,isCurrent=()=>true}:{active?:boolean;isCurrent?:()=>boolean}){
  const [uid,setUid]=useState(()=>auth.currentUser?.uid??null),[,setVersion]=useState(0);const feedback=useSyncFeedback(active),scope=JSON.stringify([uid,feedback.epoch]);
  const[state,setState]=useState({scope,busy:false,message:''}),busy=state.scope===scope&&state.busy,message=state.scope===scope?state.message:'';const pending=Boolean(uid&&hasPendingCommsDelivery(uid)),ready=isMemoryCryptoReady();
  useEffect(()=>{const refresh=()=>setVersion(value=>value+1),a=onAuthStateChanged(auth,user=>setUid(user?.uid??null)),v=onMemoryCryptoChanged(refresh),s=observeCommsDeliveries(refresh);return()=>{a();v();s();};},[]);
  async function operate(cancel:boolean){
    if(!uid||!ready||busy)return;const captured=feedback.capture(uid),current=()=>captured()&&isCurrent();if(!current())return;
    if(cancel&&!window.confirm('Cancelar o envio pendente? A cápsula já lida ou copiada pelo destinatário não pode ser recuperada.'))return;if(!current())return;
    setState({scope,busy:true,message:''});const guard=()=>{if(!current())throw Error('Delivery view changed');};
    try{const result=cancel?await cancelCommsDelivery(uid,guard):await recoverCommsDelivery(uid,guard);if(!current())return;setState({scope,busy:false,message:result.status==='revoked'?'A conta destinatária está em eliminação. Este pedido já não pode ser entregue; cópias conhecidas não são revogadas.':result.status==='cancelled'?'Envio cancelado. Cópias já conhecidas pelo destinatário não são revogadas.':result.status==='received'?'Leitura confirmada pelo destinatário.':'Cápsula cifrada aceite pelo relay; leitura ainda não confirmada.'});}
    catch{if(current())setState({scope,busy:false,message:'Não foi possível confirmar o envio. O pedido cifrado local foi conservado.'});}
  }
  if(!active||!pending&&!message)return null;
  return <section aria-label="Recuperação de envio Comms" className="mb-3 rounded-xl border border-amber-300/30 p-3 text-sm text-white/80">
    {pending&&<p>Um envio aguarda confirmação. Recupera o mesmo pedido ou cancela antes de transmitir outra cápsula.</p>}
    {pending&&!ready&&<p>Desbloqueia o cofre desta conta para recuperar o pedido cifrado.</p>}
    {pending&&<div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy||!ready} onClick={()=>void operate(false)} className="rounded border px-3 py-2 disabled:opacity-40">Recuperar envio Comms</button><button type="button" disabled={busy||!ready} onClick={()=>void operate(true)} className="rounded border px-3 py-2 disabled:opacity-40">Cancelar envio Comms</button></div>}
    {message&&<p role="status" aria-live="polite">{message}</p>}
  </section>;
}

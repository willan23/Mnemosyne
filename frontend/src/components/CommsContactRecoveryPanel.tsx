import {useEffect,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {hasPendingCommsContact,observeCommsContacts,recoverCommsContact,cancelCommsContact} from '../services/commsContacts';
import {CommsContactRemovalRecoveryPanel} from './CommsContactRemovalRecoveryPanel';
export function CommsContactRecoveryPanel(props:{active?:boolean;isCurrent?:()=>boolean;onChanged?:()=>void}){return <><CommsContactRequestRecoveryPanel {...props}/><CommsContactRemovalRecoveryPanel {...props}/></>;}
function CommsContactRequestRecoveryPanel({active=true,isCurrent=()=>true,onChanged=()=>{}}:{active?:boolean;isCurrent?:()=>boolean;onChanged?:()=>void}){
  const [uid,setUid]=useState(()=>auth.currentUser?.uid??null),[,setVersion]=useState(0);const feedback=useSyncFeedback(active);
  const scope=JSON.stringify([uid,feedback.epoch]);const[state,setState]=useState({scope,busy:false,message:''});const busy=state.scope===scope&&state.busy,message=state.scope===scope?state.message:'';
  const pending=Boolean(uid&&hasPendingCommsContact(uid)),ready=isMemoryCryptoReady();
  useEffect(()=>{const refresh=()=>setVersion(value=>value+1),a=onAuthStateChanged(auth,user=>setUid(user?.uid??null)),v=onMemoryCryptoChanged(refresh),s=observeCommsContacts(refresh);return()=>{a();v();s();};},[]);
  async function operate(cancel:boolean){
    if(!uid||!ready||busy)return;const captured=feedback.capture(uid),current=()=>captured()&&isCurrent();if(!current())return;
    if(cancel&&!window.confirm('Cancelar o pedido de contacto pendente? Um contacto já aceite será conservado.'))return;if(!current())return;
    setState({scope,busy:true,message:''});const guard=()=>{if(!current())throw Error('Contact view changed');};
    try{const result=cancel?await cancelCommsContact(uid,guard):await recoverCommsContact(uid,guard);if(!current())return;if(result.status==='revoked')onChanged();if(!current())return;setState({scope,busy:false,message:result.status==='revoked'?'O destinatário já não está disponível. O pedido local foi encerrado.':result.status==='cancelled'?'Pedido de contacto cancelado.':'Estado do pedido de contacto confirmado.'});}
    catch{if(current())setState({scope,busy:false,message:'Não foi possível confirmar o pedido. A cópia cifrada local foi conservada.'});}
  }
  if(!active||!pending&&!message)return null;
  return <section aria-label="Recuperação de contacto Comms" className="mb-3 rounded-xl border border-amber-300/30 p-3 text-sm text-white/80">
    {pending&&<p>Um pedido de contacto aguarda confirmação. Recupera ou cancela antes de criar outro.</p>}
    {pending&&!ready&&<p>Desbloqueia o cofre desta conta para recuperar o pedido local.</p>}
    {pending&&<div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy||!ready} onClick={()=>void operate(false)} className="rounded border px-3 py-2 disabled:opacity-40">Recuperar pedido de contacto</button><button type="button" disabled={busy||!ready} onClick={()=>void operate(true)} className="rounded border px-3 py-2 disabled:opacity-40">Cancelar pedido de contacto</button></div>}
    {message&&<p role="status" aria-live="polite">{message}</p>}
  </section>;
}

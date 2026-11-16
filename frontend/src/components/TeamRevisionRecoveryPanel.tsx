import {useEffect,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {hasPendingTeamRevision,observeTeamRevisions,recoverPendingTeamRevision,cancelPendingTeamRevision} from '../services/teamRevisionRecovery';
export function TeamRevisionRecoveryPanel(){
  const [uid,setUid]=useState(()=>auth.currentUser?.uid??null),[,setVersion]=useState(0),feedback=useSyncFeedback();const scope=JSON.stringify([uid,feedback.epoch]);
  const [state,setState]=useState<{scope:string;busy:boolean;message:string|null}>({scope,busy:false,message:null});const busy=state.scope===scope&&state.busy,message=state.scope===scope?state.message:null,pending=Boolean(uid&&hasPendingTeamRevision(uid)),ready=isMemoryCryptoReady();
  useEffect(()=>{const refresh=()=>setVersion(value=>value+1),a=onAuthStateChanged(auth,user=>setUid(user?.uid??null)),v=onMemoryCryptoChanged(refresh),s=observeTeamRevisions(refresh);return()=>{a();v();s();};},[]);
  async function operate(cancel:boolean){
    if(!uid||!ready||busy)return;const captured=feedback.capture(uid),guard=()=>{if(!captured())throw Error('Team revision view changed');};if(!captured())return;
    if(cancel&&!window.confirm('Cancelar a revisão de equipa ainda não confirmada? Uma revisão já gravada será confirmada. O rascunho atual será conservado.'))return;if(!captured())return;setState({scope,busy:true,message:null});
    try{const result=cancel?await cancelPendingTeamRevision(uid,guard):await recoverPendingTeamRevision(uid,guard);if(!captured())return;setState({scope,busy:false,message:result.status==='committed'?'Revisão de equipa confirmada. O rascunho foi conservado; abre a memória atual antes de voltar a editar.':result.status==='revoked'?'O acesso à equipa ou à memória já não está disponível. O pedido local foi encerrado; o rascunho foi conservado.':'Revisão de equipa pendente cancelada. O rascunho atual foi conservado.'});}
    catch{if(captured())setState({scope,busy:false,message:'Não foi possível confirmar a revisão de equipa. O pedido e o rascunho foram conservados.'});}
  }
  if(!pending&&!message)return null;
  return <section aria-label="Recuperação da revisão de equipa" className="mb-3 rounded-xl border border-amber-300/30 p-3 text-sm text-white/80">
    {pending&&<p>Uma revisão de memória de equipa aguarda confirmação. Recupera ou cancela o pedido; o rascunho atual será conservado.</p>}{pending&&!ready&&<p>Desbloqueia o cofre desta conta para continuar.</p>}
    {pending&&<div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy||!ready} onClick={()=>void operate(false)} className="rounded border px-3 py-2 disabled:opacity-40">Recuperar revisão de equipa</button><button type="button" disabled={busy||!ready} onClick={()=>void operate(true)} className="rounded border px-3 py-2 disabled:opacity-40">Cancelar revisão de equipa</button></div>}
    {message&&<p role="status" aria-live="polite">{message}</p>}
  </section>;
}

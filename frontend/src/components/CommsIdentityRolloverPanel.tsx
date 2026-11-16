import {useEffect,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {hasPendingCommsIdentityRollover,observeCommsIdentityRollovers,recoverCommsIdentityRollover,cancelCommsIdentityRollover,inspectCommsIdentityConflict,republishCommsIdentityConflict,CommsIdentitySupersededError,type CommsIdentityConflictPreview} from '../services/commsIdentityRollover';
import {COMMS_IDENTITY_ROLLOVERS_ENABLED} from '../config/releaseGates';
export function CommsIdentityRolloverPanel({mnemonic,active=true,isCurrent=()=>true}:{mnemonic:string[]|null;active?:boolean;isCurrent?:()=>boolean}){
  const [uid,setUid]=useState(()=>auth.currentUser?.uid??null),[,setVersion]=useState(0);const feedback=useSyncFeedback(active);
  const scope=JSON.stringify([uid,feedback.epoch]);const [state,setState]=useState<{scope:string;busy:boolean;message:string|null;conflict:boolean;preview:CommsIdentityConflictPreview|null}>({scope,busy:false,message:null,conflict:false,preview:null});
  const busy=state.scope===scope&&state.busy,message=state.scope===scope?state.message:null,conflict=state.scope===scope&&state.conflict,preview=state.scope===scope?state.preview:null;
  const pending=Boolean(uid&&hasPendingCommsIdentityRollover(uid)),ready=isMemoryCryptoReady()&&mnemonic?.length===12;
  useEffect(()=>{const refresh=()=>setVersion(value=>value+1),a=onAuthStateChanged(auth,user=>setUid(user?.uid??null)),v=onMemoryCryptoChanged(refresh),s=observeCommsIdentityRollovers(refresh);return()=>{a();v();s();};},[]);
  async function operate(mode:'recover'|'cancel'|'inspect'|'republish'){
    if(!uid||!ready||!mnemonic||busy)return;const captured=feedback.capture(uid),words=[...mnemonic];const current=()=>captured()&&isCurrent();if(!current())return;
    if(mode==='cancel'&&!window.confirm('Cancelar a troca de identidade pendente? Uma troca já confirmada será recuperada. As cifras antiga e nova serão conservadas localmente.'))return;
    if(mode==='republish'&&(!COMMS_IDENTITY_ROLLOVERS_ENABLED||!preview||!window.confirm(`Publicar a identidade conservada neste dispositivo?\nAtual: ${preview.baseline.priorFingerprint}\nA publicar: ${preview.candidateFingerprint}\nA chave atual será substituída apenas se continuar igual. As mensagens cifradas para ela podem exigir o outro dispositivo ou uma cópia de segurança.`)))return;
    if(!current())return;
    setState({scope,busy:true,message:null,conflict,preview});const guard=()=>{if(!current())throw Error('Identity view changed');};
    try{
      if(mode==='inspect'){const inspected=await inspectCommsIdentityConflict(uid,words,guard);if(current())setState({scope,busy:false,message:null,conflict:true,preview:inspected});return;}
      const result=mode==='cancel'?await cancelCommsIdentityRollover(uid,words,guard):(mode==='republish'?await republishCommsIdentityConflict(uid,words,preview!,guard):await recoverCommsIdentityRollover(uid,words,guard)).result;if(!current())return;
      setState({scope,busy:false,conflict:false,preview:null,message:result.status==='committed'?'Troca de identidade confirmada. As identidades anteriores permanecem cifradas neste dispositivo.':'Troca pendente cancelada. A identidade local anterior foi conservada.'});
    }catch(error){if(current())setState({scope,busy:false,preview:null,conflict:conflict||error instanceof CommsIdentitySupersededError,message:error instanceof CommsIdentitySupersededError?
      'Esta troca foi confirmada, mas outra identidade está agora publicada. Verifica o conflito antes de escolher uma resolução.':
      'Não foi possível confirmar a troca. As cifras e o pedido local foram conservados. Se a identidade remota mudou, verifica novamente o conflito.'});}
  }
  if(!active||!pending&&!message)return null;
  return <section aria-label="Recuperação da identidade Comms" className="mb-3 rounded-xl border border-amber-300/30 p-3 text-sm text-white/80">
    {pending&&<p>Uma troca de identidade aguarda confirmação. Recupera ou cancela antes de publicar outra identidade.</p>}
    {pending&&!ready&&<p>Desbloqueia o cofre desta conta para recuperar as cifras locais.</p>}
    {pending&&<div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy||!ready} onClick={()=>void operate('recover')} className="rounded border px-3 py-2 disabled:opacity-40">Recuperar identidade Comms</button>
      <button type="button" disabled={busy||!ready} onClick={()=>void operate('cancel')} className="rounded border px-3 py-2 disabled:opacity-40">Cancelar troca de identidade</button>
      {conflict&&<button type="button" disabled={busy||!ready} onClick={()=>void operate('inspect')} className="rounded border px-3 py-2 disabled:opacity-40">Verificar conflito de identidade</button>}</div>}
    {pending&&preview&&<div className="mt-3 space-y-2">
      <p>Identidade atualmente publicada: <code className="break-all">{preview.baseline.priorFingerprint}</code></p>
      <p>Identidade conservada para publicar: <code className="break-all">{preview.candidateFingerprint}</code></p>
      <p>As cifras antiga e nova deste dispositivo serão conservadas. As mensagens destinadas à chave atualmente publicada podem exigir o outro dispositivo ou uma cópia de segurança.</p>
      <button type="button" disabled={busy||!ready||!COMMS_IDENTITY_ROLLOVERS_ENABLED} onClick={()=>void operate('republish')} className="rounded border px-3 py-2 disabled:opacity-40">Confirmar publicação da identidade conservada</button>
      {!COMMS_IDENTITY_ROLLOVERS_ENABLED&&<p>A publicação de outra identidade ainda não está disponível nesta versão.</p>}
    </div>}
    {message&&<p role="status" aria-live="polite">{message}</p>}
  </section>;
}

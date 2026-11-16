import {useEffect,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {hasPendingCommsImport,observeCommsImports,recoverPendingCommsImport,cancelPendingCommsImport} from '../services/commsMemoryImport';

export function CommsImportRecoveryPanel(){
  const [uid,setUid]=useState(()=>auth.currentUser?.uid??null);const [,setVersion]=useState(0);const feedback=useSyncFeedback();
  const scope=JSON.stringify([uid,feedback.epoch]);
  const [result,setResult]=useState<{scope:string;busy:boolean;message:string|null}>({scope,busy:false,message:null});
  const busy=result.scope===scope&&result.busy;const message=result.scope===scope?result.message:null;
  const pending=Boolean(uid&&hasPendingCommsImport(uid));const ready=isMemoryCryptoReady();
  useEffect(()=>{const stopAuth=onAuthStateChanged(auth,user=>setUid(user?.uid??null));const refresh=()=>setVersion(value=>value+1);
    const stopStorage=observeCommsImports(refresh);const stopVault=onMemoryCryptoChanged(refresh);return()=>{stopAuth();stopStorage();stopVault();};},[]);
  async function operate(cancel:boolean){
    if(!uid||busy)return;const current=feedback.capture(uid);if(!current())return;
    if(cancel&&!window.confirm('Cancelar a importação pendente do Comms? Uma memória já gravada será confirmada. Um ficheiro já preparado pode permanecer disponível para recuperação.'))return;
    if(!current())return;setResult({scope,busy:true,message:null});
    try{
      const outcome=await(cancel?cancelPendingCommsImport:recoverPendingCommsImport)(uid);if(!current())return;
      setResult({scope,busy:false,message:outcome.status==='committed'?'Importação do Comms confirmada.':'Importação pendente do Comms cancelada.'});
    }catch{if(current())setResult({scope,busy:false,message:'Não foi possível confirmar. A importação pendente foi conservada.'});}
  }
  if(!pending&&!message)return null;
  return <section aria-label="Recuperação do Comms" className="mb-3 rounded-xl border border-amber-300/30 bg-slate-950 p-3 text-sm text-white/80">
    {pending&&<p>Uma importação do Comms aguarda confirmação. Recupera ou cancela antes de importar outra mensagem.</p>}
    {pending&&!ready&&<p>Desbloqueia o cofre para consultar ou retomar.</p>}
    {pending&&<div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy||!ready} onClick={()=>void operate(false)} className="rounded border border-white/20 px-3 py-2 disabled:opacity-40">Recuperar importação do Comms</button>
      <button type="button" disabled={busy||!ready} onClick={()=>void operate(true)} className="rounded border border-white/20 px-3 py-2 disabled:opacity-40">Cancelar importação do Comms</button></div>}
    {message&&<p role="status" aria-live="polite">{message}</p>}
  </section>;
}

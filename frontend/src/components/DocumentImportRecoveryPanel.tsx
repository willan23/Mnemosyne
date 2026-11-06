import {useEffect,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {hasPendingDocumentImport,observeDocumentImports,recoverPendingDocumentImport,cancelPendingDocumentImport} from '../services/documentImportRecovery';

export function DocumentImportRecoveryPanel({onMemoryCreated}:{onMemoryCreated?:(id:string)=>void}){
  const [uid,setUid]=useState(()=>auth.currentUser?.uid??null);const [,setVersion]=useState(0);const feedback=useSyncFeedback();const scope=JSON.stringify([uid,feedback.epoch]);
  const [result,setResult]=useState<{scope:string;busy:boolean;message:string|null}>({scope,busy:false,message:null});
  const busy=result.scope===scope&&result.busy;const message=result.scope===scope?result.message:null;const pending=Boolean(uid&&hasPendingDocumentImport(uid));const ready=isMemoryCryptoReady();
  useEffect(()=>{const stopAuth=onAuthStateChanged(auth,user=>setUid(user?.uid??null));const refresh=()=>setVersion(value=>value+1);const stopJournal=observeDocumentImports(refresh);const stopVault=onMemoryCryptoChanged(refresh);return()=>{stopAuth();stopJournal();stopVault();};},[]);
  async function operate(cancel:boolean){
    if(!uid||busy)return;const current=feedback.capture(uid);if(!current())return;
    if(cancel&&!window.confirm('Cancelar os passos restantes desta importação? As documentos e ligações já confirmadas serão conservadas.'))return;
    if(!current())return;setResult({scope,busy:true,message:null});
    try{
      const outcome=await(cancel?cancelPendingDocumentImport:recoverPendingDocumentImport)(uid);if(!current())return;
      const complete=outcome.status.status==='complete';setResult({scope,busy:false,message:complete?`Importação confirmada: ${outcome.importedConfirmed} documentos e ${outcome.linksConfirmed} ligações entre pastas e documentos.`:`Importação cancelada. Os anexos já enviados continuam disponíveis no painel de anexos. Foram conservadas as operações confirmadas de ${outcome.importedConfirmed} documentos e ${outcome.linksConfirmed} ligações entre pastas e documentos.`});
      if(complete&&outcome.result.hubId)onMemoryCreated?.(outcome.result.hubId);
    }catch{if(current())setResult({scope,busy:false,message:'Não foi possível concluir. O plano cifrado foi conservado para retomar ou cancelar.'});}
  }
  if(!pending&&!message)return null;
  return <section aria-label="Recuperação de documentos" className="mb-3 rounded-xl border border-cyan-300/30 bg-slate-950 p-3 text-sm text-white/80">
    {pending&&<p>Uma importação aguarda confirmação. O plano cifrado conserva as documentos e ligações restantes.</p>}
    {pending&&!ready&&<p>Desbloqueia o cofre para consultar ou retomar.</p>}
    {pending&&<div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy||!ready} onClick={()=>void operate(false)} className="rounded border border-white/20 px-3 py-2 disabled:opacity-40">Retomar importação</button>
      <button type="button" disabled={busy||!ready} onClick={()=>void operate(true)} className="rounded border border-white/20 px-3 py-2 disabled:opacity-40">Cancelar importação pendente</button></div>}
    {message&&<p role="status" aria-live="polite">{message}</p>}
  </section>;
}

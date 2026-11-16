import {useEffect,useState} from 'react';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {onMemoryCryptoChanged,isMemoryCryptoReady} from '../services/memoryCrypto';
import {observeSyncCheckpoints} from '../services/mobileSyncCheckpoints';
import {hasPendingSyncOutbox,recoverPendingSyncOutbox,cancelPendingSyncOutbox} from '../services/mobileSyncOutbox';
import {hasPendingSyncImport,confirmPendingMobileSyncImport} from '../services/mobileSyncImport';
import {syncOutboxMessage} from '../services/mobileSyncMessages';
type Direction='desktop-to-mobile'|'mobile-to-desktop';
export function SyncRecoveryActions({uid,deviceId,outgoing}:{uid:string;deviceId:string;outgoing:Direction}){
  const feedback=useSyncFeedback();const [,setVersion]=useState(0);
  const scope=JSON.stringify([uid,deviceId,outgoing,feedback.epoch]);
  const [result,setResult]=useState<{scope:string;busy:boolean;message:string|null}>({scope,busy:false,message:null});
  const busy=result.scope===scope&&result.busy;const message=result.scope===scope?result.message:null;
  const incoming:Direction=outgoing==='desktop-to-mobile'?'mobile-to-desktop':'desktop-to-mobile';
  const outgoingPending=hasPendingSyncOutbox(uid,deviceId,outgoing);const incomingPending=hasPendingSyncImport(uid,deviceId,incoming);const ready=isMemoryCryptoReady();
  useEffect(()=>{const change=()=>setVersion(value=>value+1);const stopStorage=observeSyncCheckpoints(change);const stopVault=onMemoryCryptoChanged(change);return()=>{stopStorage();stopVault();};},[]);
  async function operate(mode:'recover'|'cancel'|'confirm'){
    const current=feedback.capture(uid);if(!current())return;setResult({scope,busy:true,message:null});
    try{
      if(mode==='confirm'){
        const result=await confirmPendingMobileSyncImport(uid,deviceId,incoming);if(!current())return;
        setResult({scope,busy:false,message:result.status==='complete'?`${result.imported} alteração(ões) confirmada(s); ${result.conflicts} conflito(s) conservado(s).`:`Estão confirmadas ${result.cursor} de ${result.memoryCount} alterações. Retoma a importação neste dispositivo.`});
      }else{
        const result=await (mode==='cancel'?cancelPendingSyncOutbox:recoverPendingSyncOutbox)(uid,deviceId,outgoing);if(!current())return;setResult({scope,busy:false,message:syncOutboxMessage(result)});
      }
    }catch{if(current())setResult({scope,busy:false,message:'Não foi possível confirmar. Os dados de recuperação foram conservados.'});}
  }
  if(!outgoingPending&&!incomingPending&&!message)return null;
  return <section aria-label="Recuperação de sincronização" className="mt-3 space-y-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
    {(outgoingPending||incomingPending)&&<p className="text-xs text-slate-200">Há uma sincronização pendente neste dispositivo.</p>}
    {!ready&&(outgoingPending||incomingPending)&&<p className="text-xs text-slate-400">Desbloqueia o cofre para consultar ou retomar.</p>}
    <div className="flex flex-wrap gap-2">
      {outgoingPending&&<><button type="button" disabled={busy||!ready} onClick={()=>void operate('recover')} className="rounded border border-white/15 px-3 py-2 text-xs disabled:opacity-40">Retomar envio</button>
        <button type="button" disabled={busy||!ready} onClick={()=>void operate('cancel')} className="rounded border border-rose-400/30 px-3 py-2 text-xs disabled:opacity-40">Cancelar envio</button></>}
      {incomingPending&&<button type="button" disabled={busy||!ready} onClick={()=>void operate('confirm')} className="rounded border border-white/15 px-3 py-2 text-xs disabled:opacity-40">Confirmar importação</button>}
    </div>
    {message&&<p role="status" aria-live="polite" className="text-xs text-slate-200">{message}</p>}
  </section>;
}

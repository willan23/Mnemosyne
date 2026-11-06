import {useEffect,useRef,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {observeCommsIdentityRollovers} from '../services/commsIdentityRollover';
import {downloadCommsIdentityBackup,inspectCommsIdentityBackup,restoreCommsIdentityBackup,purgeCommsIdentityHistory,recoverCommsIdentityBackup,cancelCommsIdentityBackup,hasPendingCommsIdentityBackup,COMMS_IDENTITY_BACKUP_MAX_BYTES,type CommsIdentityBackupPreview} from '../services/commsIdentityBackup';

export function CommsIdentityBackupPanel({mnemonic,active=true}:{mnemonic:string[]|null;active?:boolean}){
  return active?<CommsIdentityBackupView mnemonic={mnemonic}/>:null;
}
function CommsIdentityBackupView({mnemonic}:{mnemonic:string[]|null}){
  const [uid,setUid]=useState(()=>auth.currentUser?.uid??null),[,setVersion]=useState(0),[fileEpoch,setFileEpoch]=useState(0);const revision=useRef(0),input=useRef<HTMLInputElement>(null),feedback=useSyncFeedback();
  const scope=JSON.stringify([uid,feedback.epoch,fileEpoch]);
  const [file,setFile]=useState<{scope:string;value:File}|null>(null),[state,setState]=useState<{scope:string;busy:boolean;message:string|null;preview:CommsIdentityBackupPreview|null;selected:string[]}>({scope,busy:false,message:null,preview:null,selected:[]});
  const busy=state.scope===scope&&state.busy,preview=state.scope===scope?state.preview:null,message=state.scope===scope?state.message:null,selected=state.scope===scope?state.selected:[];
  const chosen=file?.scope===scope?file.value:null,ready=Boolean(uid&&isMemoryCryptoReady()&&mnemonic?.length===12),pending=Boolean(uid&&hasPendingCommsIdentityBackup(uid));
  useEffect(()=>{const refresh=()=>{setVersion(value=>value+1);setState(prior=>({...prior,preview:null,selected:[]}));};const retire=()=>{revision.current++;setFile(null);if(input.current)input.current.value='';refresh();};let owner=auth.currentUser?.uid??null;
    const stopAuth=onAuthStateChanged(auth,user=>{const next=user?.uid??null;if(next!==owner){owner=next;retire();}setUid(next);}),stopVault=onMemoryCryptoChanged(retire),stopIdentity=observeCommsIdentityRollovers(refresh);return()=>{stopAuth();stopVault();stopIdentity();};},[]);
  function choose(value:File|null){revision.current++;const nextEpoch=fileEpoch+1,nextScope=JSON.stringify([uid,feedback.epoch,nextEpoch]);setFileEpoch(nextEpoch);setState({scope:nextScope,busy:false,message:null,preview:null,selected:[]});setFile(value?{scope:nextScope,value}:null);}
  async function operate(mode:'export'|'inspect'|'restore'|'retain'|'purge'|'recover'|'cancel'){
    if(!uid||!ready||!mnemonic||busy)return;const captured=feedback.capture(uid),version=revision.current,words=[...mnemonic];const current=()=>captured()&&revision.current===version;if(!current())return;
    if(['inspect','restore','retain','purge'].includes(mode)&&!chosen)return;
    if(mode==='restore'&&(!preview?.canRestore||!window.confirm(`Restaurar a identidade ${preview.restorableFingerprint} neste dispositivo?\nPublicada: ${preview.publishedFingerprint??'não verificada'}\nA chave local anterior será conservada. O restauro não altera a chave publicada. Os pedidos pendentes compatíveis serão conservados.`)))return;
    if(mode==='retain'&&(!preview?.canRetain||!window.confirm('Importar as identidades para leitura histórica? A identidade ativa e o pedido pendente deste dispositivo serão conservados.')) )return;
    if(mode==='purge'&&(!preview||!selected.length||!window.confirm(`Remover ${selected.length} cópias históricas deste dispositivo?\nO ficheiro selecionado será relido e verificado. As mensagens antigas podem exigir esse backup e as 12 palavras para voltar a abrir. A identidade ativa e o pedido pendente serão conservados.`)))return;
    if(mode==='cancel'&&!window.confirm('Reverter a operação local de restauro ou retenção pendente? As alterações já feitas serão revertidas para o estado anterior. O ficheiro de backup e a identidade publicada não são alterados.'))return;
    if(!current())return;const guard=()=>{if(!current())throw Error('Identity backup view changed');};setState({scope,busy:true,message:null,preview,selected});
    try{
      if(mode==='export'){const result=await downloadCommsIdentityBackup(uid,words,guard);if(current())setState({scope,busy:false,preview:null,selected:[],message:`Download iniciado com ${result.identityCount} identidades cifradas. Guarda o ficheiro e seleciona-o abaixo para verificar a cópia.`});return;}
      if(mode==='inspect'){const result=await inspectCommsIdentityBackup(uid,words,chosen!,guard);if(current())setState({scope,busy:false,preview:result,selected:[],message:'Backup lido e verificado para esta conta e cofre.'});return;}
      const result=mode==='recover'?await recoverCommsIdentityBackup(uid,words,guard):mode==='cancel'?await cancelCommsIdentityBackup(uid,words,guard):mode==='purge'?await purgeCommsIdentityHistory(uid,words,chosen!,preview!,selected,guard):await restoreCommsIdentityBackup(uid,words,chosen!,preview!,mode,guard);
      if(current())setState({scope,busy:false,preview:null,selected:[],message:result.status==='cancelled'?'Operação local revertida. As identidades anteriores foram conservadas.':result.mode==='purge'?'Cópias selecionadas removidas deste dispositivo. Conserva o backup e as 12 palavras.':result.mode==='retain'?'Identidades históricas importadas. A identidade ativa foi conservada.':'Identidade restaurada localmente. Guarda um novo backup para incluir as identidades conservadas neste dispositivo.'});
    }catch{if(current())setState({scope,busy:false,preview:null,selected:[],message:'Não foi possível confirmar esta operação. As identidades e qualquer recuperação local foram conservadas. Verifica novamente o ficheiro e o estado da conta.'});}
  }
  const button='rounded border border-white/20 px-3 py-2 text-sm disabled:opacity-40';
  return <section aria-label="Backup das identidades Comms" className="space-y-3 rounded-xl border border-white/10 p-4 text-sm text-slate-200">
    <h3 className="font-medium">Backup das identidades Comms</h3>
    <p>Este ficheiro conserva as chaves cifradas para mensagens e chaves de equipa. Precisas também das 12 palavras e da mesma conta. As palavras sozinhas não recriam estas identidades.</p>
    {!ready&&<p>Desbloqueia o cofre desta conta para continuar.</p>}
    {pending?<div className="space-y-2"><p>Uma operação local aguarda recuperação. Recupera ou reverte antes de iniciar outra.</p><div className="flex flex-wrap gap-2"><button className={button} type="button" disabled={busy||!ready} onClick={()=>void operate('recover')}>Recuperar restauro ou retenção</button><button className={button} type="button" disabled={busy||!ready} onClick={()=>void operate('cancel')}>Reverter operação local</button></div></div>:
      <div className="space-y-3"><button className={button} type="button" disabled={busy||!ready} onClick={()=>void operate('export')}>Guardar backup cifrado das identidades</button>
        <label className="block">Selecionar backup para verificar<input ref={input} type="file" accept=".json,application/json" disabled={busy||!ready} className="mt-1 block w-full" onChange={event=>{const picked=event.target.files?.[0]??null;if(picked&&picked.size>COMMS_IDENTITY_BACKUP_MAX_BYTES){choose(null);setState({scope:JSON.stringify([uid,feedback.epoch,fileEpoch+1]),busy:false,preview:null,selected:[],message:'O ficheiro excede o limite de 4 MiB.'});return;}choose(picked);}}/></label>
        {chosen&&<><p>Ficheiro: {chosen.name}</p><button className={button} type="button" disabled={busy||!ready} onClick={()=>void operate('inspect')}>Verificar backup das identidades</button></>}
      </div>}
    {!pending&&preview&&<div className="space-y-3">
      <p>{preview.identityCount} identidades, {preview.historyCount} cópias históricas{preview.pending?' e um pedido de troca pendente':''}.</p>
      <p>Identidade publicada: <code className="break-all">{preview.publishedFingerprint??'não verificada'}</code></p>
      {preview.restorableFingerprint&&<p>Identidade a restaurar: <code className="break-all">{preview.restorableFingerprint}</code></p>}
      {!preview.canRestore&&<p>O restauro da identidade ativa exige a verificação remota, chaves adequadas, pedidos compatíveis e espaço no histórico. Podes importar apenas as chaves históricas quando essa opção estiver disponível.</p>}
      <div className="flex flex-wrap gap-2"><button className={button} type="button" disabled={busy||!ready||!preview.canRestore} onClick={()=>void operate('restore')}>Confirmar restauro da identidade</button><button className={button} type="button" disabled={busy||!ready||!preview.canRetain} onClick={()=>void operate('retain')}>Importar apenas identidades históricas</button></div>
      {preview.purgeableKeys.length>0&&<fieldset className="space-y-2"><legend>Cópias históricas verificadas neste backup</legend>{preview.purgeableKeys.map(({operationId,fingerprints})=><label key={operationId} className="flex items-start gap-2"><input type="checkbox" disabled={busy||!ready} checked={selected.includes(operationId)} onChange={event=>setState(prior=>({...prior,selected:event.target.checked?[...prior.selected,operationId]:prior.selected.filter(value=>value!==operationId)}))}/><span className="min-w-0">{fingerprints.length===1?'Chave conservada':'Chaves conservadas'}{fingerprints.map(fp=><code key={fp} className="block break-all text-xs">{fp}{fp===preview.publishedFingerprint?' (publicada)':''}</code>)}</span></label>)}<button className={button} type="button" disabled={busy||!ready||!selected.length} onClick={()=>void operate('purge')}>Remover cópias locais selecionadas</button></fieldset>}
    </div>}
    {message&&<p role="status" aria-live="polite">{message}</p>}
  </section>;
}

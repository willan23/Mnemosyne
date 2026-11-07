import React, {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import QRCode from 'qrcode';
import {auth} from '../firebase';
import {CAPSULE_PUBLICATION_ENABLED} from '../config/releaseGates';
import {capsulePublicationService,type PreparedCapsulePublication} from '../services/capsulePublicationService';
import {isMemoryCryptoReady} from '../services/memoryCrypto';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {buildCapsuleDeepLink} from '../utils/deepLinks';
import {downloadMemory} from '../utils/export';
import type {SessionData} from '../hooks/useSessions';
interface ShareModalProps {session:SessionData|null;relatedSessions?:SessionData[];onClose:()=>void;onOpenComms?:()=>void}
function containKeys(event:React.KeyboardEvent<HTMLDialogElement>){
  event.stopPropagation();if(event.key!=='Tab'||event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey)return;
  const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]'))
    .filter(node=>node.tabIndex>=0&&!node.matches(':disabled')&&!node.closest('[hidden],[inert]')&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden');
  const first=controls[0],last=controls[controls.length-1],active=document.activeElement;
  if(!first||!last){event.preventDefault();return;}
  if(event.shiftKey?active===first||!controls.includes(active as HTMLElement):active===last||!controls.includes(active as HTMLElement)){
    event.preventDefault();(event.shiftKey?last:first).focus();
  }
}
export function ShareModal(props:ShareModalProps){
  const feedback=useSyncFeedback(Boolean(props.session)),uid=auth.currentUser?.uid,session=props.session;
  if(!uid||!session||session.encLocked||session.teamScopeAmbiguous||!isMemoryCryptoReady()||!session.teamId&&session.uid!==uid)return null;
  const scope=JSON.stringify([uid,session.id,session.teamId??null,session.updatedAt,feedback.epoch]);
  return <ShareDialog key={scope} {...props} session={session} capture={()=>feedback.capture(uid)}/>;
}
function ShareDialog({session,relatedSessions=[],onClose,onOpenComms,capture}:Omit<ShareModalProps,'session'>&{session:SessionData;capture:()=>()=>boolean}){
  const dialog=useRef<HTMLDialogElement>(null),alive=useRef(false),busyRef=useRef(false),prepared=useRef<PreparedCapsulePublication|null>(null);
  const presentation=useRef<{pass:string;embed:boolean}|null>(null);
  const [busy,setBusy]=useState(false),[pending,setPending]=useState(false),[passphrase,setPassphrase]=useState(''),[days,setDays]=useState(7);
  const [linked,setLinked]=useState(false),[embed,setEmbed]=useState(false),[link,setLink]=useState(''),[savedPass,setSavedPass]=useState('');
  const [message,setMessage]=useState(''),[qr,setQr]=useState(''),[copied,setCopied]=useState(false);
  const related=relatedSessions.filter(row=>row.id!==session.id&&!row.encLocked&&!row.teamScopeAmbiguous&&
    (row.teamId??null)===(session.teamId??null)&&(session.teamId||row.uid===session.uid)&&row.text.trim()).slice(0,12);
  useLayoutEffect(()=>{alive.current=true;const node=dialog.current;node?.showModal();return()=>{alive.current=false;prepared.current?.dispose();node?.close();};},[]);
  useEffect(()=>{let active=true;setQr('');if(link)void QRCode.toDataURL(link,{width:220,margin:2,errorCorrectionLevel:'M'}).then(value=>{if(active)setQr(value);}).catch(()=>undefined);return()=>{active=false;};},[link]);
  const close=()=>{alive.current=false;prepared.current?.dispose();onClose();};
  const copy=async(value:string)=>{const current=capture();if(!alive.current||!current())return;try{await navigator.clipboard.writeText(value);if(alive.current&&current())setCopied(true);}catch{if(alive.current&&current())setMessage('Não foi possível copiar.');}};
  const send=async(mode:'publish'|'status'|'cancel')=>{
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setMessage('');
    const accountCurrent=capture(),current=()=>alive.current&&accountCurrent();
    try{
      if(!prepared.current){
        if(mode!=='publish')return;
        const display={pass:passphrase.trim(),embed};presentation.current=display;
        const command=await capsulePublicationService.prepare([session,...(linked?related:[])],display.pass,days,current);
        if(!current()){command.dispose();return;}prepared.current=command;setPending(true);
      }
      const result=await prepared.current.send(mode);if(!current())return;
      if(result.status==='committed'){
        const display=presentation.current;if(!display)return;
        setSavedPass(display.pass);setLink(buildCapsuleDeepLink(result.publicationId,display.embed?display.pass:undefined));
        setMessage(mode==='cancel'?'A publicação já estava confirmada. Podes retirar a cápsula na gestão.':'Cápsula confirmada.');
      }else if(['cancelled','withdrawn','expired'].includes(result.status)){
        setMessage(result.status==='cancelled'?'Pedido cancelado.':result.status==='withdrawn'?'A cápsula foi retirada.':'O pedido expirou. Podes iniciar uma nova cápsula.');
        prepared.current.dispose();prepared.current=null;presentation.current=null;setPending(false);setLink('');setSavedPass('');
      }else setMessage('Ainda não há confirmação. Podes retomar o mesmo pedido ou cancelá-lo.');
    }catch{if(current())setMessage('Não foi possível confirmar. Retoma o mesmo pedido ou consulta a gestão de cápsulas.');}
    finally{busyRef.current=false;if(current())setBusy(false);}
  };
  const button='rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-40';
  return <dialog ref={dialog} aria-modal="true" aria-labelledby="capsule-dialog-title" onCancel={event=>{event.preventDefault();event.stopPropagation();close();}}
    onKeyDown={containKeys} onClick={event=>{if(event.target===dialog.current)close();}}
    className="fixed inset-0 m-auto max-h-[92dvh] w-[min(36rem,94vw)] overflow-y-auto rounded-2xl border border-white/15 bg-[#07101f] p-0 text-slate-100 shadow-2xl backdrop:bg-black/80">
    <div className="space-y-5 p-6">
      <header className="flex items-center justify-between gap-4"><h2 id="capsule-dialog-title" className="text-xl font-semibold">Partilhar memória</h2><button type="button" onClick={close} aria-label="Fechar partilha" className={button}>Fechar</button></header>
      <p className="text-sm text-slate-300">A cápsula é uma cópia cifrada para partilha externa. Guarda a passphrase: não é possível recuperá-la. Retirar o link não apaga cópias já descarregadas ou importadas.</p>
      {session.teamId&&<p className="text-sm text-amber-200">Esta memória pertence a uma equipa. Uma cópia partilhada fora da equipa não acompanha futuras alterações de membros ou chaves.</p>}
      {onOpenComms&&<button type="button" className={button} onClick={()=>{close();onOpenComms();}}>Enviar por Comms E2E</button>}
      <section aria-label="Cápsula cifrada" className="space-y-4 rounded-xl border border-white/10 p-4">
        {!link?<>
          {!CAPSULE_PUBLICATION_ENABLED&&<p className="text-sm text-amber-200">A criação de novos links está temporariamente indisponível. Podes gerir cápsulas existentes ou exportar a memória localmente.</p>}
          <label className="block space-y-1"><span>Passphrase, pelo menos 8 caracteres</span><input type="password" autoComplete="new-password" maxLength={256} value={passphrase} disabled={busy||pending}
            onChange={event=>setPassphrase(event.target.value)} className="w-full rounded-lg border border-white/15 bg-black/30 p-2"/></label>
          <label className="flex items-center gap-3"><span>Expira em</span><select aria-label="Prazo da cápsula" value={days} disabled={busy||pending} onChange={event=>setDays(Number(event.target.value))}
            className="rounded-lg bg-slate-800 p-2"><option value={1}>1 dia</option><option value={7}>7 dias</option><option value={30}>30 dias</option></select></label>
          {related.length>0&&<label className="flex items-start gap-2"><input type="checkbox" checked={linked} disabled={busy||pending} onChange={event=>setLinked(event.target.checked)}/><span>Incluir {related.length} memória(s) ligada(s) do mesmo cofre.</span></label>}
          <label className="flex items-start gap-2"><input type="checkbox" checked={embed} disabled={busy||pending} onChange={event=>setEmbed(event.target.checked)}/><span>Incluir a passphrase no fragmento do link. Qualquer pessoa com o URL completo poderá ler a cópia; o URL pode ficar no histórico do navegador.</span></label>
          <button type="button" disabled={busy||!CAPSULE_PUBLICATION_ENABLED} onClick={()=>void send('publish')} className={button}>{busy?'A confirmar…':pending?'Retomar publicação':'Gerar cápsula cifrada'}</button>
        </>:<>
          <label className="block space-y-1"><span>Link da cápsula confirmada</span><input readOnly value={link} className="w-full rounded-lg bg-black/30 p-2 text-sm"/></label>
          <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={()=>void copy(link)}>{copied?'Copiado':'Copiar link'}</button>
            <button type="button" className={button} onClick={()=>void copy(savedPass)}>Copiar passphrase</button></div>
          <p className="text-sm text-slate-300">{presentation.current?.embed?'O link contém a chave de leitura.':'Envia o link e a passphrase em canais separados.'}</p>
          {qr&&<figure className="space-y-2"><img src={qr} width={180} height={180} alt="QR da cápsula cifrada"/>
            <button type="button" className={button} onClick={()=>{if(!alive.current||!capture()())return;const anchor=document.createElement('a');anchor.href=qr;anchor.download='mnemosyne-capsula-qr.png';anchor.click();}}>Descarregar QR</button></figure>}
        </>}
        {pending&&!link&&<div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={button} onClick={()=>void send('status')}>Consultar confirmação</button>
          <button type="button" disabled={busy} className={button} onClick={()=>void send('cancel')}>Cancelar pedido</button></div>}
        {message&&<p role="status" className="text-sm text-cyan-100">{message}</p>}
        <Link to={'/capsules'+(prepared.current?'#share='+encodeURIComponent(prepared.current.request.publicationId):'')} onClick={close} className="inline-block text-cyan-200 underline">Gerir e retirar cápsulas</Link>
      </section>
      <section aria-label="Exportar localmente" className="space-y-3 border-t border-white/10 pt-4"><h3 className="font-medium">Cópia local</h3><div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={()=>void copy(session.text)}>Copiar texto</button>
        {(['txt','md','json'] as const).map(format=><button type="button" key={format} className={button} onClick={()=>{if(alive.current&&capture()())downloadMemory(session,format);}}>Exportar {format.toUpperCase()}</button>)}
      </div></section>
    </div>
  </dialog>;
}

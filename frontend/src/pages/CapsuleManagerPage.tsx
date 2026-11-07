import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {auth} from '../firebase';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {capsuleOwnerService,type OwnedCapsule} from '../services/capsuleOwnerService';
import {revokePublicCapsule} from '../services/publicCapsuleService';
import {publicCapsuleIdValid} from '../../../functions/src/publicCapsuleContract';
import {buildCapsuleDeepLink} from '../utils/deepLinks';
interface View {scope:string;rows:readonly OwnedCapsule[];nextAfter:string|null;busy:boolean;ready:boolean;message:string}
const date=(value:number|null)=>value===null?'Não disponível':new Date(value).toLocaleString('pt-PT');
export function CapsuleManagerPage(){
  const navigate=useNavigate(),location=useLocation(),{epoch,captureAccount}=useSyncFeedback(),uid=auth.currentUser?.uid??null;
  const requested=new URLSearchParams(location.hash.slice(1)).get('share')??undefined;
  const scope=JSON.stringify([uid,requested??null,epoch]),scopeRef=useRef(''),requestRef=useRef(0),busyRef=useRef(false);
  const focusAfter=useRef<{scope:string;id:string}|null>(null),heading=useRef<HTMLHeadingElement>(null);
  const [stored,setStored]=useState<View>({scope:'',rows:[],nextAfter:null,busy:false,ready:false,message:''});
  const view=useMemo<View>(()=>stored.scope===scope?stored:{scope,rows:[],nextAfter:null,busy:false,ready:false,message:''},[stored,scope]);
  useLayoutEffect(()=>{const requests=requestRef;scopeRef.current=scope;heading.current?.focus();return()=>{scopeRef.current='';requests.current++;};},[scope]);
  useLayoutEffect(()=>{const target=focusAfter.current;if(target?.scope===scope&&!view.busy){const node=document.getElementById('capsule-row-'+target.id);if(node){node.focus();focusAfter.current=null;}}},[scope,view]);
  const load=useCallback(async(after:string|null=null)=>{
    if(!uid||requested&&!publicCapsuleIdValid(requested))return;
    if(after&&busyRef.current)return;
    const ticket=++requestRef.current,account=captureAccount(uid),current=()=>ticket===requestRef.current&&scopeRef.current===scope&&account();
    busyRef.current=true;setStored(old=>({scope,rows:after&&old.scope===scope?old.rows:[],nextAfter:null,busy:true,ready:false,message:''}));
    try{const page=await capsuleOwnerService.read(requested?{shareId:requested}:after?{after}:{},current);if(!current())return;
      if(after&&page.nextAfter===after)throw Error('Repeated capsule cursor');
      if(after&&page.rows[0])focusAfter.current={scope,id:page.rows[0].shareId};
      setStored(old=>{const previous=after&&old.scope===scope?old.rows:[],seen=new Set(previous.map(row=>row.shareId));return{scope,rows:[...previous,...page.rows.filter(row=>!seen.has(row.shareId))],nextAfter:page.nextAfter,busy:false,ready:true,message:''};});
    }catch{if(current())setStored(old=>({...old,scope,busy:false,ready:true,message:'Não foi possível consultar as cápsulas. Tenta novamente.'}));}
    finally{if(current())busyRef.current=false;}
  },[uid,requested,scope,captureAccount]);
  useEffect(()=>{void load();},[load]);
  const withdraw=async(row:OwnedCapsule)=>{
    if(!uid||busyRef.current)return;const account=captureAccount(uid),ticket=++requestRef.current,current=()=>ticket===requestRef.current&&scopeRef.current===scope&&account();
    if(!current())return;busyRef.current=true;setStored(old=>({...old,busy:true,message:''}));
    try{await revokePublicCapsule(row,current);if(current()){focusAfter.current={scope,id:row.shareId};setStored(old=>({...old,busy:false,rows:old.rows.map(value=>value.shareId===row.shareId&&value.sourceToken===row.sourceToken?{...value,revoked:true,revokedAt:null}:value),message:'Cápsula retirada. As cópias já guardadas continuam disponíveis a quem as recebeu.'}));}}
    catch{if(current())setStored(old=>({...old,busy:false,message:'Não foi possível retirar a cápsula. Atualiza a lista antes de tentar novamente.'}));}
    finally{if(current())busyRef.current=false;}
  };
  const copy=async(row:OwnedCapsule)=>{if(!uid)return;const current=captureAccount(uid);if(!current()||scopeRef.current!==scope)return;
    try{await navigator.clipboard.writeText(buildCapsuleDeepLink(row.shareId));if(current()&&scopeRef.current===scope)setStored(old=>({...old,message:'Link copiado sem passphrase.'}));}
    catch{if(current()&&scopeRef.current===scope)setStored(old=>({...old,message:'Não foi possível copiar o link.'}));}
  };
  const button='rounded-lg border border-white/20 px-4 py-2 text-sm disabled:opacity-40';
  return <main className="min-h-screen bg-[#050816] p-6 text-slate-100"><div className="mx-auto max-w-3xl space-y-5">
    <button type="button" className={button} onClick={()=>navigate('/')}>Voltar à app</button>
    <h1 ref={heading} tabIndex={-1} className="text-3xl font-semibold">Gestão de cápsulas</h1>
    <p>Retirar uma cápsula impede novas leituras e importações pelo link. Não apaga cópias já descarregadas ou importadas. Esta página não guarda nem recupera passphrases.</p>
    <p className="text-sm text-slate-400">Os totais podem incluir dados antigos. Aberturas não medem visitantes únicos.</p>
    {!uid?<><p>Entra na tua conta para gerir os links que criaste.</p><button type="button" className={button} onClick={()=>navigate('/')}>Entrar</button></>:requested&&!publicCapsuleIdValid(requested)?<p role="alert">Link de gestão inválido.</p>:<>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={view.busy} className={button} onClick={()=>void load()}>Atualizar lista</button>
        {requested&&<button type="button" className={button} onClick={()=>navigate('/capsules')}>Todas as cápsulas</button>}</div>
      {view.message&&<p role="status">{view.message}</p>}{view.busy&&<p role="status">A consultar…</p>}
      {view.ready&&!view.busy&&view.rows.length===0&&!view.message&&<p>Não foram encontradas cápsulas da tua conta nesta consulta.</p>}
      <div className="space-y-4">{view.rows.map(row=><article id={'capsule-row-'+row.shareId} tabIndex={-1} key={row.shareId} className="space-y-3 rounded-xl border border-white/15 p-5 focus-visible:outline focus-visible:outline-cyan-200">
        <h2 className="text-lg font-medium">Cápsula {row.shareId.slice(0,8)}</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm"><dt>Criada</dt><dd>{date(row.createdAt)}</dd><dt>Expira</dt><dd>{date(row.expiresAt)}</dd>
          <dt>Estado</dt><dd>{row.revoked?'Retirada':'Não retirada'}</dd>
          <dt>Memórias</dt><dd>{row.itemCount??'Não disponível'}</dd><dt>Aberturas</dt><dd>{row.views??'Não disponível'}</dd><dt>Importações</dt><dd>{row.importCount??'Não disponível'}</dd></dl>
        <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={view.busy||row.revoked} onClick={()=>void copy(row)}>Copiar link sem chave</button>
          <button type="button" className={button} disabled={view.busy||row.revoked} onClick={()=>void withdraw(row)}>Retirar cápsula</button></div>
      </article>)}</div>
      {view.nextAfter&&<button type="button" className={button} disabled={view.busy} onClick={()=>void load(view.nextAfter)}>Carregar mais cápsulas</button>}
    </>}
  </div></main>;
}

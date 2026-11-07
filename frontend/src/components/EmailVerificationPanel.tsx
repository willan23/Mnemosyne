import {useEffect, useRef, useState} from 'react';
import type {User} from 'firebase/auth';
import {useTranslation, type AppLocale} from '../utils/translations';
import {AccountEmailContextChanged, sendAccountEmailVerification, refreshAccountEmailVerification} from '../services/accountEmailVerification';

const copies: Record<AppLocale, {title:string;body:string;send:string;refresh:string;sent:string;waiting:string;verified:string;failed:string}> = {
  'pt-pt': {title:'Verificação de email',body:'Verifica este endereço para que possa ser usado na descoberta de contactos e nos convites de equipa.',send:'Enviar verificação',refresh:'Já verifiquei: atualizar',sent:'Pedido de verificação enviado. Abre a mensagem e confirma o endereço; depois atualiza o estado aqui.',waiting:'O endereço ainda não aparece como verificado.',verified:'Email verificado.',failed:'Não foi possível confirmar a operação. Verifica a ligação e tenta novamente.'},
  'pt-br': {title:'Verificação de email',body:'Verifique este endereço para que possa ser usado na busca de contatos e nos convites de equipe.',send:'Enviar verificação',refresh:'Já verifiquei: atualizar',sent:'Pedido de verificação enviado. Abra a mensagem e confirme o endereço; depois atualize o estado aqui.',waiting:'O endereço ainda não aparece como verificado.',verified:'Email verificado.',failed:'Não foi possível confirmar a operação. Verifique a conexão e tente novamente.'},
  en: {title:'Email verification',body:'Verify this address before it can be used for contact discovery and team invitations.',send:'Send verification',refresh:'I verified it: refresh',sent:'Verification requested. Open the message and confirm the address, then refresh its status here.',waiting:'This address is not verified yet.',verified:'Email verified.',failed:'The operation could not be confirmed. Check your connection and try again.'},
  fr: {title:'Vérification de l’email',body:'Vérifiez cette adresse pour la recherche de contacts et les invitations d’équipe.',send:'Envoyer la vérification',refresh:'J’ai vérifié : actualiser',sent:'Vérification demandée. Ouvrez le message et confirmez l’adresse, puis actualisez son état ici.',waiting:'Cette adresse n’est pas encore vérifiée.',verified:'Email vérifié.',failed:'L’opération n’a pas pu être confirmée. Vérifiez la connexion et réessayez.'},
};
export function EmailVerificationPanel({user,active=()=>true}: {user: User | null;active?:()=>boolean}) {
  const {language} = useTranslation(), copy = copies[language], scope = JSON.stringify([user?.uid, user?.email]);
  const currentUser = useRef(user); currentUser.current = user;
  const activeView = useRef(active); activeView.current = active;
  const lifetime = useRef<object | null>(null), operation = useRef<object | null>(null);
  const [state, setState] = useState<{scope:string;busy:boolean;message:''|'sent'|'waiting'|'failed'}>({scope, busy:false, message:''});
  useEffect(() => {const token = {}; lifetime.current = token; operation.current = null; return () => {if (lifetime.current === token) {lifetime.current = null; operation.current = null;}};}, [scope]);
  const own = state.scope === scope ? state : {scope,busy:false,message:'' as const};
  async function run(kind: 'send' | 'refresh') {
    if (!user || operation.current || !lifetime.current) return;
    const account = user, life = lifetime.current, token = {}; operation.current = token;
    const current = () => activeView.current() && lifetime.current === life && JSON.stringify([currentUser.current?.uid,currentUser.current?.email]) === scope;
    const guard = () => {if (!current()) throw new AccountEmailContextChanged();};
    setState({scope,busy:true,message:''});
    try {
      const verified = kind === 'send' ? await sendAccountEmailVerification(account,guard).then(() => false) : await refreshAccountEmailVerification(account,guard);
      guard(); setState({scope,busy:false,message:kind === 'send'?'sent':verified?'':'waiting'});
    } catch (error) {if (current() && !(error instanceof AccountEmailContextChanged)) setState({scope,busy:false,message:'failed'});}
    finally {if (operation.current === token) {operation.current = null; if (lifetime.current) setState(previous => ({...previous,busy:false}));}}
  }
  if (!user?.email) return null;
  return <section aria-label={copy.title} className="space-y-3 rounded-xl border border-white/15 p-4">
    <h3 className="font-medium text-white">{copy.title}</h3><p className="break-all text-sm text-slate-300">{user.email}</p>
    {user.emailVerified ? <p role="status">{copy.verified}</p> : <p className="text-sm text-slate-300">{copy.body}</p>}
    <div className="flex flex-wrap gap-3">
      {!user.emailVerified && <button type="button" disabled={own.busy} onClick={() => void run('send')}>{copy.send}</button>}
      <button type="button" disabled={own.busy} onClick={() => void run('refresh')}>{copy.refresh}</button>
    </div>
    {own.message && (!user.emailVerified || own.message==='failed') && <p role={own.message==='failed'?'alert':'status'}>{copy[own.message]}</p>}
  </section>;
}

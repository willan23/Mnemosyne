import {onAuthStateChanged} from 'firebase/auth';
import {getFunctions,httpsCallable} from 'firebase/functions';
import app,{auth} from '../firebase';
import {CAPSULE_PUBLICATION_ENABLED} from '../config/releaseGates';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from './memoryCrypto';
import {getTeamKeyCacheGeneration,onTeamKeyChanged} from './teamVault';
import {encryptSharePayload} from '../utils/encryptedShare';
import {encodeCapsulePack} from './capsuleService';
import {publicCapsuleIdValid,publicCapsuleHashValid,publicCapsuleTimeValid} from '../../../functions/src/publicCapsuleContract';
import {captureCapsulePublication,capsulePublicationBytes,captureCapsulePublicationOutcome,CAPSULE_MAX_SOURCES,CAPSULE_PLAIN_MAX_BYTES,
  type CapsulePublicationRequest,type CapsulePublicationOutcome,type CapsulePublicationMode} from '../../../functions/src/capsulePublicationContract';
import type {SessionData} from '../hooks/useSessions';
type Source=Pick<SessionData,'id'|'uid'|'teamId'|'updatedAt'|'text'|'title'|'tags'|'encLocked'|'teamScopeAmbiguous'>;
export class CapsulePublicationError extends Error { constructor(){super('Não foi possível confirmar a cápsula. Conserva a passphrase e retoma o mesmo pedido ou consulta a gestão de cápsulas.');} }
export interface PreparedCapsulePublication {
  readonly request:CapsulePublicationRequest; readonly digest:string;
  send:(mode:CapsulePublicationMode)=>Promise<CapsulePublicationOutcome>; dispose:()=>void;
}
export interface CapsulePublicationClientDeps {
  enabled:()=>boolean;uid:()=>string|null;ready:()=>boolean;generation:()=>number;subscribe:(changed:()=>void)=>()=>void;
  now:()=>number;id:()=>string;encrypt:typeof encryptSharePayload;hash:(text:string)=>Promise<string>;
  call:(mode:CapsulePublicationMode,request:CapsulePublicationRequest)=>Promise<unknown>;
}
const defaults=():CapsulePublicationClientDeps=>({enabled:()=>CAPSULE_PUBLICATION_ENABLED,uid:()=>auth.currentUser?.uid??null,ready:isMemoryCryptoReady,generation:getTeamKeyCacheGeneration,
  subscribe:changed=>{const uid=auth.currentUser?.uid,stopAuth=onAuthStateChanged(auth,user=>{if(user?.uid!==uid)changed();}),stopVault=onMemoryCryptoChanged(changed),stopTeam=onTeamKeyChanged(changed);return()=>{stopAuth();stopVault();stopTeam();};},
  now:Date.now,id:()=>crypto.randomUUID(),encrypt:encryptSharePayload,
  hash:async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join(''),
  call:async(mode,request)=>(await httpsCallable(getFunctions(app,'europe-west1'),'mutateCapsulePublication')({mode,request})).data});
export function createCapsulePublicationService(deps=defaults()) {
  return {async prepare(sources:readonly Source[],passphrase:string,days:number,current:()=>boolean=()=>true):Promise<PreparedCapsulePublication>{
    const uid=deps.uid(),generation=deps.generation();let retired=false,disposed=false;
    const stop=deps.subscribe(()=>{retired=true;});
    const dispose=()=>{retired=true;if(!disposed){disposed=true;stop();}};
    const guard=()=>{if(retired||!uid||deps.uid()!==uid||!deps.ready()||deps.generation()!==generation||!current())throw new CapsulePublicationError();};
    try{
      guard();if(!deps.enabled()||!Number.isInteger(days)||days<1||days>30||!Array.isArray(sources)||sources.length<1||sources.length>CAPSULE_MAX_SOURCES)throw new CapsulePublicationError();
      const captured=sources.map(source=>({id:source.id,uid:source.uid,teamId:source.teamId??null,revision:source.updatedAt,text:source.text,title:source.title,tags:source.tags?[...source.tags]:undefined,locked:source.encLocked,ambiguous:source.teamScopeAmbiguous}));
      const teamId=captured[0].teamId;
      if(teamId!==null&&!publicCapsuleIdValid(teamId))throw new CapsulePublicationError();
      if(captured.some(source=>!publicCapsuleIdValid(source.id)||!publicCapsuleTimeValid(source.revision)||source.teamId!==teamId||source.locked||source.ambiguous||
        typeof source.text!=='string'||!source.text.trim()||teamId===null&&source.uid!==uid)||new Set(captured.map(source=>source.id)).size!==captured.length)throw new CapsulePublicationError();
      const key=passphrase.trim();if(key.length<8||new TextEncoder().encode(key).byteLength>1024)throw new CapsulePublicationError();
      const plain=captured.length===1?captured[0].text:encodeCapsulePack(captured.map(source=>({text:source.text,...(source.title?{title:source.title}:{}),...(source.tags?{tags:source.tags}:{})})));
      if(new TextEncoder().encode(plain).byteLength>CAPSULE_PLAIN_MAX_BYTES)throw new CapsulePublicationError();
      const publicationId=deps.id(),expiresAt=deps.now()+days*86400000;
      const ciphertext=await deps.encrypt(plain,key);guard();
      const request=captureCapsulePublication({v:1,actorUid:uid,publicationId,sources:captured.map(source=>({sessionId:source.id,teamId:source.teamId,revision:source.revision})),ciphertext,expiresAt});
      const digest=await deps.hash(capsulePublicationBytes(request));guard();if(!publicCapsuleHashValid(digest))throw new CapsulePublicationError();
      return Object.freeze({request,digest,dispose,send:async(mode:CapsulePublicationMode)=>{guard();if(mode==='publish'&&!deps.enabled())throw new CapsulePublicationError();
        try{const result=await deps.call(mode,request);guard();return captureCapsulePublicationOutcome(result,request,digest);}catch{throw new CapsulePublicationError();}}});
    }catch{dispose();throw new CapsulePublicationError();}
  }};
}
export const capsulePublicationService=createCapsulePublicationService();

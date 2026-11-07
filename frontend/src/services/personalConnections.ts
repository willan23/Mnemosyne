import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {PERSONAL_CONNECTION_WRITES_ENABLED} from '../config/releaseGates';
import {decryptMemoryEnvelope,encryptMemoryFields,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {parsePersonalConnectionPair,parsePersonalConnectionRequest,personalConnectionRequestBytes,
  type PersonalConnectionPair,type PersonalConnectionPreparation,type PersonalConnectionRequest,type PersonalConnectionOutcome} from '../../../functions/src/personalConnectionContract';
import {syncHashValid} from '../../../functions/src/mobileSyncImportContract';

export class PersonalConnectionError extends Error {
  readonly reason: 'closed'|'pending'|'storage'|'checkpoint'|'confirmation';
  constructor(reason: PersonalConnectionError['reason']) {
    super(reason === 'closed' ? 'As ligações estão em validação antes do lançamento.' : 'A ligação aguarda confirmação. Recupera ou cancela a operação pendente antes de repetir.');
    this.reason=reason;
  }
}
export interface PersonalConnectionClientDeps {
  enabled: () => boolean; storage: Pick<Storage,'getItem'|'setItem'|'removeItem'>;
  exclusive: <T>(name: string,work: () => Promise<T>) => Promise<T>; id: () => string;
  encryptJournal: typeof encryptMemoryFields; decryptJournal: typeof decryptMemoryEnvelope;
  call: (mode: 'prepare'|'apply'|'status'|'cancel',request: PersonalConnectionPair|PersonalConnectionRequest) => Promise<unknown>;
  mutation?: PersonalMemoryMutationDeps;
}
const names={prepare:'preparePersonalConnection',apply:'applyPersonalConnection',status:'getPersonalConnectionStatus',cancel:'cancelPersonalConnection'};
const defaults=(): PersonalConnectionClientDeps => ({enabled:()=>PERSONAL_CONNECTION_WRITES_ENABLED,storage:localStorage,id:()=>crypto.randomUUID(),
  exclusive:withClipCaptureLock,encryptJournal:encryptMemoryFields,decryptJournal:decryptMemoryEnvelope,
  call:async(mode,request)=>(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(request)).data});
export const personalConnectionCheckpointKey=(uid: string)=>`mnemosyne:personal-connections:v1:${encodeURIComponent(uid)}`;
const event='mnemosyne:personal-connections-changed';
const notify=()=>window.dispatchEvent(new Event(event));
export function hasPendingPersonalConnection(uid: string) {try{return localStorage.getItem(personalConnectionCheckpointKey(uid))!==null;}catch{return true;}}
export function observePersonalConnections(callback:()=>void) {
  window.addEventListener(event,callback);window.addEventListener('storage',callback);
  return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',callback);};
}
export function assertPersonalConnectionWrites(enabled=PERSONAL_CONNECTION_WRITES_ENABLED) {if(!enabled)throw new PersonalConnectionError('closed');}
const digest=async(request:PersonalConnectionRequest)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(personalConnectionRequestBytes(request)))),byte=>byte.toString(16).padStart(2,'0')).join('');
function preparation(value:unknown,pair:PersonalConnectionPair):PersonalConnectionPreparation {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='sourceHash,sourceId,targetHash,targetId')throw new PersonalConnectionError('confirmation');
  const data=value as PersonalConnectionPreparation;
  if(data.sourceId!==pair.sourceId||data.targetId!==pair.targetId||!syncHashValid(data.sourceHash)||!syncHashValid(data.targetHash))throw new PersonalConnectionError('confirmation');
  return data;
}
function outcome(value:unknown,request:PersonalConnectionRequest,hash:string):PersonalConnectionOutcome {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='changed,createdAt,digest,operationId,status')throw new PersonalConnectionError('confirmation');
  const data=value as PersonalConnectionOutcome;
  if(data.operationId!==request.operationId||data.digest!==hash||!['unknown','committed','cancelled'].includes(data.status)||typeof data.changed!=='boolean'||
    (data.status!=='committed'&&data.changed)||(data.status==='unknown'?data.createdAt!==null:!Number.isSafeInteger(data.createdAt)||data.createdAt!<1))throw new PersonalConnectionError('confirmation');
  return {...data};
}
async function readJournal(raw:string,uid:string,deps:PersonalConnectionClientDeps,guard:()=>void):Promise<PersonalConnectionRequest> {
  try{
    if(raw.length>16000)throw new Error();const envelope:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(envelope))throw new Error();
    const text=(await deps.decryptJournal(envelope)).text;guard();if(text.length>8000)throw new Error();
    const journal=JSON.parse(text);
    if(!journal||typeof journal!=='object'||Array.isArray(journal)||Object.keys(journal).sort().join(',')!=='request,uid,v'||journal.v!==1||journal.uid!==uid)throw new Error();
    return parsePersonalConnectionRequest(journal.request);
  }catch{guard();throw new PersonalConnectionError('checkpoint');}
}
async function operate(uid:string,mode:'start'|'recover'|'cancel',pair:PersonalConnectionPair|undefined,operation:'link'|'unlink',outerGuard:()=>void,injected?:PersonalConnectionClientDeps):Promise<PersonalConnectionOutcome> {
  if(mode==='start')assertPersonalConnectionWrites(injected?injected.enabled():PERSONAL_CONNECTION_WRITES_ENABLED);
  const deps=injected??defaults();outerGuard();
  return withPersonalMemoryMutation(uid,async context=>deps.exclusive(personalConnectionCheckpointKey(uid),async()=>{
    const key=personalConnectionCheckpointKey(uid);
    const scope=()=>{context.assertCurrent();outerGuard();};scope();
    const stored=()=>{try{return deps.storage.getItem(key);}catch{throw new PersonalConnectionError('storage');}};
    let raw=stored();
    const guard=()=>{scope();if(stored()!==raw)throw new PersonalConnectionError('checkpoint');};
    let request:PersonalConnectionRequest;
    if(raw!==null){
      if(mode==='start')throw new PersonalConnectionError('pending');
      request=await readJournal(raw,uid,deps,guard);guard();
    }else{
      if(mode!=='start'||!pair)throw new PersonalConnectionError('pending');
      const captured=parsePersonalConnectionPair(pair);guard();
      const prepared=preparation(await deps.call('prepare',captured),captured);guard();
      request=parsePersonalConnectionRequest({...captured,operation,operationId:deps.id(),expectedSourceHash:prepared.sourceHash,expectedTargetHash:prepared.targetHash});
      const encrypted=await deps.encryptJournal({text:JSON.stringify({v:1,uid,request})});guard();
      if(!isEncryptedMemoryEnvelope(encrypted))throw new PersonalConnectionError('checkpoint');
      const next=JSON.stringify(encrypted);if(next.length>16000)throw new PersonalConnectionError('checkpoint');
      try{deps.storage.setItem(key,next);raw=next;if(stored()!==raw)throw new Error();}catch{throw new PersonalConnectionError('storage');}
      guard();notify();guard();
    }
    const hash=await digest(request);guard();
    let result=outcome(await deps.call('status',request),request,hash);guard();
    if(result.status==='unknown'){
      if(mode!=='cancel'&&!deps.enabled())throw new PersonalConnectionError('pending');
      result=outcome(await deps.call(mode==='cancel'?'cancel':'apply',request),request,hash);guard();
      if(result.status==='unknown')throw new PersonalConnectionError('confirmation');
    }
    // Confirm durable status before removing the only local recovery plan.
    const confirmed=outcome(await deps.call('status',request),request,hash);guard();
    if(confirmed.status!==result.status||confirmed.changed!==result.changed||confirmed.createdAt!==result.createdAt)throw new PersonalConnectionError('confirmation');
    try{guard();deps.storage.removeItem(key);raw=null;if(stored()!==null)throw new Error();}catch{throw new PersonalConnectionError('storage');}
    guard();notify();guard();return confirmed;
  }),deps.mutation);
}
export async function changePersonalConnection(uid:string,sourceId:string,targetId:string,operation:'link'|'unlink'='link',assertCurrent:()=>void=()=>{},deps?:PersonalConnectionClientDeps) {
  const result=await operate(uid,'start',{sourceId,targetId},operation,assertCurrent,deps);
  if(result.status!=='committed')throw new PersonalConnectionError('confirmation');return result;
}
export const recoverPendingPersonalConnection=(uid:string,deps?:PersonalConnectionClientDeps)=>operate(uid,'recover',undefined,'link',()=>{},deps);
export const cancelPendingPersonalConnection=(uid:string,deps?:PersonalConnectionClientDeps)=>operate(uid,'cancel',undefined,'link',()=>{},deps);

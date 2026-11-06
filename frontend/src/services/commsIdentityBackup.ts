import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {openEncryptedIdentity,clearVolatileIdentities} from '../utils/crypto';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {commsIdentityBackupRecoveryKey,commsIdentityHistoryPrefix,commsIdentityRolloverKey,notifyCommsIdentityChanged,openCommsIdentityHistory,openCommsIdentityJournal,type CommsIdentityJournal} from './commsIdentityRollover';
import {attachmentActorIdValid,attachmentIdValid} from '../../../functions/src/attachmentEnvelope';
import {parseCommsIdentityBaseline,commsIdentityRequestBytes,type CommsIdentityBaseline,type CommsIdentityRolloverRequest,type CommsIdentityRolloverOutcome} from '../../../functions/src/commsIdentityContract';

export const COMMS_IDENTITY_BACKUP_FORMAT='mnemosyne.comms-identity-backup';
export const COMMS_IDENTITY_BACKUP_MAX_BYTES=4*1024*1024;
const primary=(uid:string)=>`mnemosyne_identity_vault_${uid}`;
const sha=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const digestValid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export class CommsIdentityBackupError extends Error{constructor(){super('Não foi possível confirmar esta operação. As identidades e a recuperação local foram conservadas.');}}
const fail=()=>new CommsIdentityBackupError();
type History={operationId:string;raw:string};
type Snapshot={primaryRaw:string|null;pendingRaw:string|null;history:History[]};
type Backup={v:1;uid:string;backupId:string;createdAt:number;snapshot:Snapshot};
type Operation={v:1;uid:string;operationId:string;backupId:string;backupDigest:string;createdAt:number;mode:'restore'|'retain'|'purge';before:Snapshot;after:Snapshot;baseline:CommsIdentityBaseline|null};
export interface CommsIdentityBackupSource{readonly size:number;text:()=>Promise<string>}
export interface CommsIdentityBackupPreview{
  uid:string;backupId:string;fileDigest:string;snapshotDigest:string;identityCount:number;historyCount:number;pending:boolean;
  publishedFingerprint:string|null;restorableFingerprint:string|null;canRestore:boolean;canRetain:boolean;purgeableIds:string[];purgeableKeys:Array<{operationId:string;fingerprints:string[]}>;baseline:CommsIdentityBaseline|null;
}
export interface CommsIdentityBackupDeps{
  storage:Storage;mutation?:PersonalMemoryMutationDeps;exclusive:typeof withClipCaptureLock;id:()=>string;now:()=>number;
  open:typeof openEncryptedIdentity;encrypt:typeof encryptMemoryFields;decrypt:typeof decryptMemoryEnvelope;retire:()=>void;
  remote:(uid:string,request?:CommsIdentityRolloverRequest)=>Promise<unknown>;
  observeStorage:(uid:string,changed:()=>void)=>()=>void;
  download:(text:string,name:string,guard:()=>void)=>void;
}
export function hasPendingCommsIdentityBackup(uid:string){try{return localStorage.getItem(commsIdentityBackupRecoveryKey(uid))!==null;}catch{return true;}}
const defaults=():CommsIdentityBackupDeps=>({storage:localStorage,exclusive:withClipCaptureLock,id:()=>crypto.randomUUID(),now:Date.now,open:openEncryptedIdentity,encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,retire:clearVolatileIdentities,
  remote:async(uid,request)=>(await httpsCallable(getFunctions(app,'europe-west1'),request?'getCommsIdentityRolloverStatus':'prepareCommsIdentityRollover')({actorUid:uid,request:request??{}})).data,
  observeStorage:(uid,changed)=>{const listener=(event:StorageEvent)=>{if(event.key===null||event.key===primary(uid)||event.key===commsIdentityRolloverKey(uid)||event.key===commsIdentityBackupRecoveryKey(uid)||event.key?.startsWith(commsIdentityHistoryPrefix(uid)))changed();};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},
  download:(text,name,guard)=>{guard();const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));try{const link=document.createElement('a');link.href=url;link.download=name;guard();link.click();guard();}finally{URL.revokeObjectURL(url);}},
});
function exact(value:unknown,keys:string[]):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw fail();}
const boundedRaw=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length>0&&value.length<=max;
const timeValid=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
function parseSnapshot(value:unknown):Snapshot{
  exact(value,['primaryRaw','pendingRaw','history']);if(value.primaryRaw!==null&&!boundedRaw(value.primaryRaw,16_384)||value.pendingRaw!==null&&!boundedRaw(value.pendingRaw,100_000)||!Array.isArray(value.history)||value.history.length>20)throw fail();
  const seen=new Set<string>();const history=value.history.map((row:unknown)=>{exact(row,['operationId','raw']);if(!attachmentIdValid(row.operationId)||!boundedRaw(row.raw,100_000)||seen.has(row.operationId))throw fail();seen.add(row.operationId);return{operationId:row.operationId,raw:row.raw};}).sort((a,b)=>a.operationId.localeCompare(b.operationId));
  return{primaryRaw:value.primaryRaw as string|null,pendingRaw:value.pendingRaw as string|null,history};
}
function snapshot(uid:string,storage:Storage):Snapshot{
  const prefix=commsIdentityHistoryPrefix(uid),history:History[]=[];
  for(let index=0;index<storage.length;index++){const key=storage.key(index);if(key?.startsWith(prefix)){const raw=storage.getItem(key);if(raw===null)throw fail();history.push({operationId:key.slice(prefix.length),raw});}}
  return parseSnapshot({primaryRaw:storage.getItem(primary(uid)),pendingRaw:storage.getItem(commsIdentityRolloverKey(uid)),history});
}
const bytes=(value:Snapshot)=>JSON.stringify(value);
const sameSnapshot=(a:Snapshot,b:Snapshot)=>a.primaryRaw===b.primaryRaw&&a.pendingRaw===b.pendingRaw&&a.history.length===b.history.length&&a.history.every((row,index)=>row.operationId===b.history[index].operationId&&row.raw===b.history[index].raw);
type Scope={guard:()=>void;read:()=>Snapshot;checkpoint:()=>string|null;write:(next:Snapshot)=>void;stage:(raw:string|null)=>void};
async function scoped<T>(uid:string,words:string[],outer:()=>void,deps:CommsIdentityBackupDeps,work:(scope:Scope,phrase:string[])=>Promise<T>){
  const phrase=[...words];if(!attachmentActorIdValid(uid)||phrase.length!==12)throw fail();
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(`mnemosyne:comms-identity:v1:${encodeURIComponent(uid)}`,async()=>{
    let changed=false,current:Snapshot|null=null,raw:string|null=null;const stop=deps.observeStorage(uid,()=>{changed=true;});
    const basic=()=>{outer();context.assertCurrent();if(changed)throw fail();};
    const guard=()=>{basic();if(!current||!sameSnapshot(snapshot(uid,deps.storage),current)||deps.storage.getItem(commsIdentityBackupRecoveryKey(uid))!==raw)throw fail();};
    try{
      basic();raw=deps.storage.getItem(commsIdentityBackupRecoveryKey(uid));current=snapshot(uid,deps.storage);guard();
      const scope:Scope={guard,read:()=>parseSnapshot(current),checkpoint:()=>raw,stage:next=>{guard();const key=commsIdentityBackupRecoveryKey(uid);if(next===null)deps.storage.removeItem(key);else deps.storage.setItem(key,next);raw=next;guard();notifyCommsIdentityChanged();},
        write:next=>{guard();const old=current!;const rows:Array<[string,string|null,string|null]>=[...new Set([...old.history.map(row=>row.operationId),...next.history.map(row=>row.operationId)])].sort().map(id=>[commsIdentityHistoryPrefix(uid)+id,old.history.find(row=>row.operationId===id)?.raw??null,next.history.find(row=>row.operationId===id)?.raw??null]);
          rows.push([commsIdentityRolloverKey(uid),old.pendingRaw,next.pendingRaw],[primary(uid),old.primaryRaw,next.primaryRaw]);
          // Retained copies are installed before the pending request and primary;
          // deletes run last. Each committed value is immediately read back.
          const ordered=[...rows.filter(row=>row[2]!==null&&row[0].startsWith(commsIdentityHistoryPrefix(uid))),...rows.filter(row=>!row[0].startsWith(commsIdentityHistoryPrefix(uid))),...rows.filter(row=>row[2]===null&&row[0].startsWith(commsIdentityHistoryPrefix(uid)))];
          for(const [key,prior,value]of ordered){if(prior===value)continue;guard();if(value===null)deps.storage.removeItem(key);else deps.storage.setItem(key,value);
            const expected=parseSnapshot(current);if(key===primary(uid))expected.primaryRaw=value;else if(key===commsIdentityRolloverKey(uid))expected.pendingRaw=value;else{const id=key.slice(commsIdentityHistoryPrefix(uid).length);expected.history=expected.history.filter(row=>row.operationId!==id);if(value!==null)expected.history.push({operationId:id,raw:value});expected.history.sort((a,b)=>a.operationId.localeCompare(b.operationId));}current=expected;guard();
          }
        }};
      return await work(scope,phrase);
    }finally{stop();}
  }),deps.mutation);
}
async function envelopeText(raw:string,guard:()=>void,deps:CommsIdentityBackupDeps){
  if(!boundedRaw(raw,COMMS_IDENTITY_BACKUP_MAX_BYTES))throw fail();const value:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(value))throw fail();exact(value,['v','iv','ct']);const text=(await deps.decrypt(value)).text;guard();if(text.length>3*1024*1024)throw fail();return text;
}
async function readFile(source:CommsIdentityBackupSource,guard:()=>void){
  const size=source.size,read=source.text.bind(source);if(!Number.isSafeInteger(size)||size<1||size>COMMS_IDENTITY_BACKUP_MAX_BYTES)throw fail();guard();const raw=await read();guard();if(!boundedRaw(raw,COMMS_IDENTITY_BACKUP_MAX_BYTES)||new TextEncoder().encode(raw).length>COMMS_IDENTITY_BACKUP_MAX_BYTES)throw fail();return raw;
}
async function readBackup(raw:string,uid:string,guard:()=>void,deps:CommsIdentityBackupDeps):Promise<Backup>{
  const value:unknown=JSON.parse(raw);exact(value,['format','v','enc']);if(value.format!==COMMS_IDENTITY_BACKUP_FORMAT||value.v!==1)throw fail();const payload:unknown=JSON.parse(await envelopeText(JSON.stringify(value.enc),guard,deps));guard();exact(payload,['v','uid','backupId','createdAt','snapshot']);
  if(payload.v!==1||payload.uid!==uid||!attachmentIdValid(payload.backupId)||!timeValid(payload.createdAt))throw fail();return{v:1,uid,backupId:payload.backupId,createdAt:payload.createdAt,snapshot:parseSnapshot(payload.snapshot)};
}
function validator(uid:string,words:string[],guard:()=>void,deps:CommsIdentityBackupDeps){
  const opened=new Map<string,Awaited<ReturnType<typeof openEncryptedIdentity>>>();
  const open:typeof openEncryptedIdentity=async(_uid,_words,raw,inner=()=>{})=>{guard();inner();if(_uid!==uid)throw fail();const cached=opened.get(raw);if(cached)return cached;
    const identity=await deps.open(uid,words,raw,guard);guard();const algorithm=identity.publicKey.algorithm as RsaHashedKeyAlgorithm;
    if(algorithm.name!=='RSA-OAEP'||algorithm.modulusLength<2048||algorithm.modulusLength>4096||algorithm.hash.name!=='SHA-256'||Array.from(algorithm.publicExponent).join(',')!=='1,0,1')throw fail();
    const probe=new TextEncoder().encode('Mnemosyne identity backup v1'),cipher=await crypto.subtle.encrypt({name:'RSA-OAEP'},identity.publicKey,probe);guard();const plain=new Uint8Array(await crypto.subtle.decrypt({name:'RSA-OAEP'},identity.privateKey,cipher));guard();if(plain.length!==probe.length||plain.some((byte,index)=>byte!==probe[index]))throw fail();opened.set(raw,identity);return identity;
  };
  return async(value:Snapshot)=>{
    const vaults=new Map<string,string>(),rawFingerprints=new Map<string,string>(),historyFingerprints=new Set<string>(),historyKeys=new Map<string,string[]>();const add=async(raw:string,historical=false)=>{const identity=await open(uid,words,raw,guard),fingerprint=await sha(identity.pemPublic);guard();vaults.set(fingerprint,raw);rawFingerprints.set(raw,fingerprint);if(historical)historyFingerprints.add(fingerprint);return fingerprint;};
    const primaryFingerprint=value.primaryRaw?await add(value.primaryRaw):null;
    let pending:Awaited<ReturnType<typeof openCommsIdentityJournal>>|null=null;
    if(value.pendingRaw){pending=await openCommsIdentityJournal(uid,words,value.pendingRaw,guard,{open,decrypt:deps.decrypt});guard();await add(pending.journal.oldVaultRaw);await add(pending.journal.newVaultRaw);}
    for(const row of value.history){const decoded=await openCommsIdentityHistory(uid,words,row.raw,guard,{open,decrypt:deps.decrypt});guard();if(decoded.operationId!==row.operationId)throw fail();const keys=new Set<string>();for(const vault of decoded.vaults)keys.add(await add(vault.raw,true));historyKeys.set(row.operationId,[...keys].sort());}
    return{vaults,rawFingerprints,historyFingerprints,historyKeys,primaryFingerprint,pending};
  };
}
async function remote(uid:string,pending:CommsIdentityJournal|null,guard:()=>void,deps:CommsIdentityBackupDeps){
  try{
    const baseline=parseCommsIdentityBaseline(await deps.remote(uid));guard();let status:CommsIdentityRolloverOutcome|null=null;
    if(pending){const value=await deps.remote(uid,pending.request);guard();exact(value,['operationId','digest','fingerprint','status','current','createdAt']);const digest=await sha(commsIdentityRequestBytes(pending.request)),fingerprint=await sha(pending.request.publicKeyPem);guard();
      if(value.operationId!==pending.request.operationId||value.digest!==digest||value.fingerprint!==fingerprint||!['unknown','committed','cancelled'].includes(String(value.status))||typeof value.current!=='boolean'||value.current&&value.status!=='committed'||(value.status==='unknown'?value.createdAt!==null:!timeValid(value.createdAt)))throw fail();status=value as unknown as CommsIdentityRolloverOutcome;
    }return{baseline,status};
  }catch{guard();return{baseline:null,status:null};}
}
function capturePreview(uid:string,value:CommsIdentityBackupPreview){
  const copy:unknown=JSON.parse(JSON.stringify(value));exact(copy,['uid','backupId','fileDigest','snapshotDigest','identityCount','historyCount','pending','publishedFingerprint','restorableFingerprint','canRestore','canRetain','purgeableIds','purgeableKeys','baseline']);
  if(copy.uid!==uid||!attachmentIdValid(copy.backupId)||!digestValid(copy.fileDigest)||!digestValid(copy.snapshotDigest)||!Array.isArray(copy.purgeableIds)||copy.purgeableIds.some(id=>!attachmentIdValid(id))||copy.purgeableIds.length>20||new Set(copy.purgeableIds).size!==copy.purgeableIds.length||typeof copy.canRestore!=='boolean'||typeof copy.canRetain!=='boolean'||typeof copy.pending!=='boolean'||typeof copy.identityCount!=='number'||!Number.isSafeInteger(copy.identityCount)||copy.identityCount<1||copy.identityCount>43||typeof copy.historyCount!=='number'||!Number.isSafeInteger(copy.historyCount)||copy.historyCount<0||copy.historyCount>20||copy.publishedFingerprint!==null&&!digestValid(copy.publishedFingerprint)||copy.restorableFingerprint!==null&&!digestValid(copy.restorableFingerprint))throw fail();
  if(!Array.isArray(copy.purgeableKeys)||copy.purgeableKeys.length!==copy.purgeableIds.length)throw fail();const seen=new Set<string>();for(const row of copy.purgeableKeys){exact(row,['operationId','fingerprints']);if(!attachmentIdValid(row.operationId)||seen.has(row.operationId)||!copy.purgeableIds.includes(row.operationId)||!Array.isArray(row.fingerprints)||row.fingerprints.length<1||row.fingerprints.length>2||row.fingerprints.some(fp=>!digestValid(fp))||new Set(row.fingerprints).size!==row.fingerprints.length)throw fail();seen.add(row.operationId);}
  if(copy.baseline!==null)copy.baseline=parseCommsIdentityBaseline(copy.baseline);if(copy.canRestore&&(copy.baseline===null||copy.restorableFingerprint===null))throw fail();return copy as unknown as CommsIdentityBackupPreview;
}
async function inspectData(uid:string,words:string[],raw:string,base:Snapshot,guard:()=>void,deps:CommsIdentityBackupDeps){
  const backup=await readBackup(raw,uid,guard,deps),validate=validator(uid,words,guard,deps),local=await validate(base),incoming=await validate(backup.snapshot);guard();
  const conflict=Boolean(base.pendingRaw&&backup.snapshot.pendingRaw&&base.pendingRaw!==backup.snapshot.pendingRaw),pending=local.pending??incoming.pending;
  const observation=await remote(uid,pending?.journal??null,guard,deps);guard();let selected:string|null=null;
  if(observation.baseline){
    if(pending&&observation.status){const journal=pending.journal,cancelRaw=journal.v===1?journal.oldVaultRaw:journal.cancelVaultRaw;
      const rawFingerprints=new Map([...local.rawFingerprints,...incoming.rawFingerprints]),options=[journal.oldVaultRaw,journal.newVaultRaw],preferred=backup.snapshot.primaryRaw?incoming.rawFingerprints.get(backup.snapshot.primaryRaw):null;
      selected=observation.status.status==='cancelled'?cancelRaw:options.find(raw=>rawFingerprints.get(raw)===observation.baseline!.priorFingerprint&&incoming.vaults.has(observation.baseline!.priorFingerprint))??options.find(raw=>rawFingerprints.get(raw)===preferred)??journal.oldVaultRaw;
      if(!incoming.vaults.has(rawFingerprints.get(selected)!))selected=null;
    }else if(!pending)selected=incoming.vaults.get(observation.baseline.priorFingerprint)??null;
  }
  const selectedFingerprint=selected?incoming.rawFingerprints.get(selected)??local.rawFingerprints.get(selected)??null:null;
  const covered=new Set(base.history.map(row=>row.operationId));let historyConflict=false;
  for(const row of backup.snapshot.history){const existing=base.history.find(local=>local.operationId===row.operationId);if(existing&&existing.raw!==row.raw)historyConflict=true;covered.add(row.operationId);}
  for(const [cipher,decoded]of [[backup.snapshot.pendingRaw,incoming.pending],[base.pendingRaw,local.pending]] as const){if(cipher&&decoded){const id=decoded.journal.request.operationId,existing=base.history.find(row=>row.operationId===id)??backup.snapshot.history.find(row=>row.operationId===id);if(existing&&existing.raw!==cipher)historyConflict=true;covered.add(id);}}
  const coverage=new Set([...local.historyFingerprints,...incoming.historyFingerprints]);if(incoming.pending)for(const identity of [incoming.pending.old,incoming.pending.next])coverage.add(await sha(identity.pemPublic));if(local.pending)for(const identity of [local.pending.old,local.pending.next])coverage.add(await sha(identity.pemPublic));guard();
  const retainExtra=incoming.primaryFingerprint&&!coverage.has(incoming.primaryFingerprint)&&incoming.primaryFingerprint!==local.primaryFingerprint?1:0;
  const restoreExtra=local.primaryFingerprint&&selectedFingerprint!==local.primaryFingerprint&&!coverage.has(local.primaryFingerprint)?1:0;
  const incomingExtra=incoming.primaryFingerprint&&incoming.primaryFingerprint!==selectedFingerprint&&incoming.primaryFingerprint!==local.primaryFingerprint&&!coverage.has(incoming.primaryFingerprint)?1:0;
  const fileRows=[...backup.snapshot.history,...(backup.snapshot.pendingRaw&&incoming.pending?[{operationId:incoming.pending.journal.request.operationId,raw:backup.snapshot.pendingRaw}]:[])];
  const purgeableIds=base.history.filter(row=>row.operationId!==local.pending?.journal.request.operationId&&fileRows.some(item=>item.operationId===row.operationId&&item.raw===row.raw)).map(row=>row.operationId);
  const preview:CommsIdentityBackupPreview={uid,backupId:backup.backupId,fileDigest:await sha(raw),snapshotDigest:await sha(bytes(base)),identityCount:incoming.vaults.size,historyCount:backup.snapshot.history.length,pending:Boolean(incoming.pending),publishedFingerprint:observation.baseline?.priorFingerprint??null,restorableFingerprint:selectedFingerprint,canRestore:!conflict&&!historyConflict&&selected!==null&&covered.size+restoreExtra+incomingExtra<=20,canRetain:!historyConflict&&covered.size+retainExtra<=20,purgeableIds,purgeableKeys:purgeableIds.map(operationId=>({operationId,fingerprints:local.historyKeys.get(operationId)!})),baseline:observation.baseline};guard();
  return{backup,local,incoming,pending,selected,preview,validate};
}
async function retained(uid:string,raw:string,fingerprint:string,ids:Set<string>,guard:()=>void,deps:CommsIdentityBackupDeps):Promise<History>{
  const operationId=deps.id();if(!attachmentIdValid(operationId)||ids.has(operationId))throw fail();ids.add(operationId);const cipher=JSON.stringify(await deps.encrypt({text:JSON.stringify({v:3,uid,operationId,vaultRaw:raw,fingerprint})}));guard();if(!boundedRaw(cipher,100_000))throw fail();return{operationId,raw:cipher};
}
async function operationText(operation:Operation,guard:()=>void){
  // Store each ciphertext once, so removing one of twenty large archives does
  // not duplicate all unchanged history in the recovery journal.
  const ciphers=new Map<string,string>();const ref=async(raw:string|null)=>{if(raw===null)return null;const digest=await sha(raw);guard();const existing=ciphers.get(digest);if(existing!==undefined&&existing!==raw)throw fail();ciphers.set(digest,raw);return digest;};
  const encode=async(value:Snapshot)=>({primaryRaw:await ref(value.primaryRaw),pendingRaw:await ref(value.pendingRaw),history:await Promise.all(value.history.map(async row=>({operationId:row.operationId,raw:await ref(row.raw)})))});
  const before=await encode(operation.before),after=await encode(operation.after);guard();return JSON.stringify({...operation,v:2,before,after,ciphers:[...ciphers].sort(([a],[b])=>a.localeCompare(b)).map(([digest,raw])=>({digest,raw}))});
}
async function expandOperation(value:unknown,guard:()=>void){
  if((value as {v?:unknown})?.v!==2)return value;
  exact(value,['v','uid','operationId','backupId','backupDigest','createdAt','mode','before','after','baseline','ciphers']);if(!Array.isArray(value.ciphers)||value.ciphers.length>44||!value.ciphers.length)throw fail();
  const ciphers=new Map<string,string>(),used=new Set<string>();for(const row of value.ciphers){exact(row,['digest','raw']);if(!digestValid(row.digest)||!boundedRaw(row.raw,100_000)||ciphers.has(row.digest)||await sha(row.raw)!==row.digest)throw fail();guard();ciphers.set(row.digest,row.raw);}
  const resolve=(digest:unknown)=>{if(digest===null)return null;if(!digestValid(digest)||!ciphers.has(digest))throw fail();used.add(digest);return ciphers.get(digest)!;};
  const decode=(snapshot:unknown)=>{exact(snapshot,['primaryRaw','pendingRaw','history']);if(!Array.isArray(snapshot.history)||snapshot.history.length>20)throw fail();return{primaryRaw:resolve(snapshot.primaryRaw),pendingRaw:resolve(snapshot.pendingRaw),history:snapshot.history.map(row=>{exact(row,['operationId','raw']);return{operationId:row.operationId,raw:resolve(row.raw)};})};};
  const before=decode(value.before),after=decode(value.after);if(used.size!==ciphers.size)throw fail();const {ciphers:discarded,...rest}=value;void discarded;return{...rest,v:1,before,after};
}
async function stageOperation(operation:Operation,words:string[],scope:Scope,deps:CommsIdentityBackupDeps){
  if(!attachmentIdValid(operation.operationId)||!timeValid(operation.createdAt))throw fail();const text=await operationText(operation,scope.guard),raw=JSON.stringify(await deps.encrypt({text}));scope.guard();if(raw.length>COMMS_IDENTITY_BACKUP_MAX_BYTES)throw fail();
  if(await envelopeText(raw,scope.guard,deps)!==text)throw fail();await validateOperation(operation.uid,words,raw,scope.guard,deps);scope.guard();scope.stage(raw);deps.retire();
}
function allowedPartial(now:Snapshot,before:Snapshot,after:Snapshot){
  if(![before.primaryRaw,after.primaryRaw].includes(now.primaryRaw)||![before.pendingRaw,after.pendingRaw].includes(now.pendingRaw))throw fail();
  const ids=new Set([...before.history,...after.history,...now.history].map(row=>row.operationId));for(const id of ids){const get=(s:Snapshot)=>s.history.find(row=>row.operationId===id)?.raw??null;if(![get(before),get(after)].includes(get(now)))throw fail();}
}
async function validateOperation(uid:string,words:string[],raw:string,guard:()=>void,deps:CommsIdentityBackupDeps):Promise<Operation>{
  const row:unknown=await expandOperation(JSON.parse(await envelopeText(raw,guard,deps)),guard);guard();exact(row,['v','uid','operationId','backupId','backupDigest','createdAt','mode','before','after','baseline']);
  if(row.v!==1||row.uid!==uid||!attachmentIdValid(row.operationId)||!attachmentIdValid(row.backupId)||!digestValid(row.backupDigest)||!timeValid(row.createdAt)||!['restore','retain','purge'].includes(String(row.mode)))throw fail();
  const before=parseSnapshot(row.before),after=parseSnapshot(row.after),baseline=row.baseline===null?null:parseCommsIdentityBaseline(row.baseline),validate=validator(uid,words,guard,deps),old=await validate(before),next=await validate(after);guard();
  if(row.mode==='purge'){
    if(baseline!==null||before.primaryRaw!==after.primaryRaw||before.pendingRaw!==after.pendingRaw||after.history.some(item=>!before.history.some(prior=>prior.operationId===item.operationId&&prior.raw===item.raw))||old.pending&&!after.history.some(item=>item.operationId===old.pending!.journal.request.operationId)&&before.history.some(item=>item.operationId===old.pending!.journal.request.operationId))throw fail();
  }else{
    if(before.history.some(item=>!after.history.some(next=>next.operationId===item.operationId&&next.raw===item.raw))||before.pendingRaw!==null&&before.pendingRaw!==after.pendingRaw)throw fail();
    if(row.mode==='retain'&&(baseline!==null||before.primaryRaw!==after.primaryRaw||before.pendingRaw!==after.pendingRaw))throw fail();
    if(row.mode==='restore'&&(!baseline||!after.primaryRaw||old.primaryFingerprint!==next.primaryFingerprint&&old.primaryFingerprint!==null&&!next.historyFingerprints.has(old.primaryFingerprint)||next.pending&&![next.pending.journal.oldVaultRaw,next.pending.journal.newVaultRaw].includes(after.primaryRaw)||!next.pending&&next.primaryFingerprint!==baseline?.priorFingerprint))throw fail();
  }
  return{v:1,uid,operationId:row.operationId,backupId:row.backupId,backupDigest:row.backupDigest,createdAt:row.createdAt,mode:row.mode as Operation['mode'],before,after,baseline};
}
async function completeOperation(operation:Operation,scope:Scope,deps:CommsIdentityBackupDeps,undo=false){
  allowedPartial(scope.read(),operation.before,operation.after);scope.guard();
  const verifyRemote=async()=>{if(operation.baseline&&!undo){const current=parseCommsIdentityBaseline(await deps.remote(operation.uid));scope.guard();if(JSON.stringify(current)!==JSON.stringify(operation.baseline))throw fail();}};
  await verifyRemote();scope.guard();scope.write(undo?operation.before:operation.after);await verifyRemote();scope.guard();scope.stage(null);deps.retire();return{status:undo?'cancelled' as const:'complete' as const,mode:operation.mode};
}
export async function downloadCommsIdentityBackup(uid:string,words:string[],outer:()=>void=()=>{},deps=defaults()){
  return scoped(uid,words,outer,deps,async(scope,phrase)=>{
    if(scope.checkpoint()!==null)throw fail();const current=scope.read();if(!current.primaryRaw&&!current.pendingRaw&&!current.history.length)throw fail();const info=await validator(uid,phrase,scope.guard,deps)(current);scope.guard();
    const backupId=deps.id(),createdAt=deps.now();if(!attachmentIdValid(backupId)||!timeValid(createdAt))throw fail();const payload:Backup={v:1,uid,backupId,createdAt,snapshot:current};
    const enc=await deps.encrypt({text:JSON.stringify(payload)});scope.guard();const raw=JSON.stringify({format:COMMS_IDENTITY_BACKUP_FORMAT,v:1,enc});if(raw.length>COMMS_IDENTITY_BACKUP_MAX_BYTES)throw fail();
    // Check the generated ciphertext before initiating a download. Saved-file
    // verification is performed only by re-reading a user-selected file.
    const checked=await readBackup(raw,uid,scope.guard,deps);scope.guard();if(bytes(checked.snapshot)!==bytes(current))throw fail();deps.download(raw,`mnemosyne-comms-identities-${backupId}.json`,scope.guard);scope.guard();return{backupId,identityCount:info.vaults.size,historyCount:current.history.length};
  });
}
export async function inspectCommsIdentityBackup(uid:string,words:string[],source:CommsIdentityBackupSource,outer:()=>void=()=>{},deps=defaults()){
  return scoped(uid,words,outer,deps,async(scope,phrase)=>{if(scope.checkpoint()!==null)throw fail();const raw=await readFile(source,scope.guard);return(await inspectData(uid,phrase,raw,scope.read(),scope.guard,deps)).preview;});
}
export async function restoreCommsIdentityBackup(uid:string,words:string[],source:CommsIdentityBackupSource,preview:CommsIdentityBackupPreview,mode:'restore'|'retain',outer:()=>void=()=>{},deps=defaults()){
  const captured=capturePreview(uid,preview);if(!['restore','retain'].includes(mode))throw fail();
  return scoped(uid,words,outer,deps,async(scope,phrase)=>{
    if(scope.checkpoint()!==null)throw fail();const raw=await readFile(source,scope.guard),before=scope.read(),data=await inspectData(uid,phrase,raw,before,scope.guard,deps);scope.guard();
    if(data.preview.fileDigest!==captured.fileDigest||data.preview.snapshotDigest!==captured.snapshotDigest||data.preview.backupId!==captured.backupId||mode==='restore'&&(!data.preview.canRestore||!captured.canRestore||data.preview.restorableFingerprint!==captured.restorableFingerprint||JSON.stringify(data.preview.baseline)!==JSON.stringify(captured.baseline))||mode==='retain'&&!data.preview.canRetain)throw fail();
    const after=parseSnapshot(before),ids=new Set([...after.history,...data.backup.snapshot.history].map(row=>row.operationId));
    const merge=(row:History)=>{const existing=after.history.find(item=>item.operationId===row.operationId);if(existing&&existing.raw!==row.raw)throw fail();if(!existing){after.history.push({...row});ids.add(row.operationId);}};
    for(const row of data.backup.snapshot.history)merge(row);
    for(const [cipher,info]of [[data.backup.snapshot.pendingRaw,data.incoming.pending],[before.pendingRaw,data.local.pending]] as const)if(cipher&&info)merge({operationId:info.journal.request.operationId,raw:cipher});
    const coverage=new Set([...data.local.historyFingerprints,...data.incoming.historyFingerprints]);for(const info of [data.incoming.pending,data.local.pending])if(info)for(const identity of [info.old,info.next])coverage.add(await sha(identity.pemPublic));scope.guard();
    if(mode==='restore'){
      if(!data.selected)throw fail();after.primaryRaw=data.selected;after.pendingRaw=before.pendingRaw??data.backup.snapshot.pendingRaw;
      if(data.local.primaryFingerprint&&data.local.primaryFingerprint!==data.preview.restorableFingerprint&&!coverage.has(data.local.primaryFingerprint)){merge(await retained(uid,before.primaryRaw!,data.local.primaryFingerprint,ids,scope.guard,deps));coverage.add(data.local.primaryFingerprint);}
      if(data.incoming.primaryFingerprint&&data.incoming.primaryFingerprint!==data.preview.restorableFingerprint&&!coverage.has(data.incoming.primaryFingerprint))merge(await retained(uid,data.backup.snapshot.primaryRaw!,data.incoming.primaryFingerprint,ids,scope.guard,deps));
    }else if(data.incoming.primaryFingerprint&&data.incoming.primaryFingerprint!==data.local.primaryFingerprint&&!coverage.has(data.incoming.primaryFingerprint))merge(await retained(uid,data.backup.snapshot.primaryRaw!,data.incoming.primaryFingerprint,ids,scope.guard,deps));
    after.history.sort((a,b)=>a.operationId.localeCompare(b.operationId));const target=parseSnapshot(after);scope.guard();if(bytes(before)===bytes(target))return{status:'complete' as const,mode};
    const operation:Operation={v:1,uid,operationId:deps.id(),backupId:data.backup.backupId,backupDigest:captured.fileDigest,createdAt:deps.now(),mode,before,after:target,baseline:mode==='restore'?data.preview.baseline:null};
    await stageOperation(operation,phrase,scope,deps);return completeOperation(operation,scope,deps);
  });
}
export async function purgeCommsIdentityHistory(uid:string,words:string[],source:CommsIdentityBackupSource,preview:CommsIdentityBackupPreview,selectedIds:string[],outer:()=>void=()=>{},deps=defaults()){
  const captured=capturePreview(uid,preview),selected=[...selectedIds];if(!selected.length||selected.length>20||new Set(selected).size!==selected.length||selected.some(id=>!attachmentIdValid(id)||!captured.purgeableIds.includes(id)))throw fail();
  return scoped(uid,words,outer,deps,async(scope,phrase)=>{
    if(scope.checkpoint()!==null)throw fail();const raw=await readFile(source,scope.guard),before=scope.read(),data=await inspectData(uid,phrase,raw,before,scope.guard,deps);scope.guard();
    if(data.preview.fileDigest!==captured.fileDigest||data.preview.snapshotDigest!==captured.snapshotDigest||data.preview.backupId!==captured.backupId||JSON.stringify(data.preview.purgeableKeys)!==JSON.stringify(captured.purgeableKeys)||selected.some(id=>!data.preview.purgeableIds.includes(id)))throw fail();
    const after=parseSnapshot(before);after.history=after.history.filter(row=>!selected.includes(row.operationId));const operation:Operation={v:1,uid,operationId:deps.id(),backupId:data.backup.backupId,backupDigest:captured.fileDigest,createdAt:deps.now(),mode:'purge',before,after,baseline:null};
    await stageOperation(operation,phrase,scope,deps);return completeOperation(operation,scope,deps);
  });
}
async function recover(uid:string,words:string[],outer:()=>void,deps:CommsIdentityBackupDeps,undo:boolean){
  return scoped(uid,words,outer,deps,async(scope,phrase)=>{const raw=scope.checkpoint();if(!raw)throw fail();const operation=await validateOperation(uid,phrase,raw,scope.guard,deps);scope.guard();return completeOperation(operation,scope,deps,undo);});
}
export async function recoverCommsIdentityBackup(uid:string,words:string[],outer:()=>void=()=>{},deps=defaults()){return recover(uid,words,outer,deps,false);}
export async function cancelCommsIdentityBackup(uid:string,words:string[],outer:()=>void=()=>{},deps=defaults()){return recover(uid,words,outer,deps,true);}

import * as admin from 'firebase-admin';
import {createHash,randomUUID} from 'node:crypto';
import {liveAccountInTransaction} from './accountAccess';
import {canonicalSyncState,syncHashValid,syncIdValid,syncInteger} from './mobileSyncImportContract';

export const MOBILE_SYNC_RETENTION_MS=30*86400000;
export const MOBILE_SYNC_RETENTION_PAGE_SIZE=50;
export interface SyncRetentionDeps{firestore:FirebaseFirestore.Firestore;now:()=>number;id:()=>string}
const unavailable=()=>new Error('Sync retention unavailable');
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const time=(value:unknown):value is number=>syncInteger(value)&&Number(value)>0;
function millis(value:unknown):number|null{
  if(value instanceof admin.firestore.Timestamp){const at=value.toMillis();return time(at)?at:null;}
  return time(value)?value:null;
}
const hash=(value:unknown)=>createHash('sha256').update(canonicalSyncState(value)).digest('hex');
interface SyncProofs{progress?:Record<string,unknown>;publication?:Record<string,unknown>;cancellation?:Record<string,unknown>}

/** Only immutable receipts bound to these ciphertext bytes authorize purging an envelope.
 * Tombstones, memory versions, receipts, budgets and legacy failures are never deleted here. */
export function syncEnvelopePurgeEligible(id:string,value:unknown,proofs:SyncProofs,now:number):boolean{
  try{
    if(!syncIdValid(id)||!time(now)||!object(value)||!syncIdValid(value.ownerUid)||!syncIdValid(value.deviceId)||
      !['mobile-to-desktop','desktop-to-mobile'].includes(String(value.direction))||!['memory-snapshot','memory-delta'].includes(String(value.payloadType))||
      !syncInteger(value.memoryCount)||Number(value.memoryCount)>2500||!time(value.expiresAt)||value.expiresAt>=now-MOBILE_SYNC_RETENTION_MS)return false;
    const permitted=new Set(['ownerUid','deviceId','direction','payloadType','status','senderPublicKeyJwk','encryptedPayload','memoryCount','tombstoneIds','expiresAt','createdAt','updatedAt','pulledAt','error']);
    if(Object.keys(value).some(key=>!permitted.has(key)))return false;
    const payload=value.encryptedPayload;
    if(!object(payload)||Object.keys(payload).sort().join(',')!=='data,iv'||typeof payload.iv!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(payload.iv)||
      typeof payload.data!=='string'||payload.data.length<24||payload.data.length>900000||payload.data.length%4===1||!/^[A-Za-z0-9_-]+$/.test(payload.data))return false;
    const created=millis(value.createdAt),updated=millis(value.updatedAt);
    if(!created||!updated||created>updated||updated>now)return false;
    const payloadDigest=hash(payload),bound=(row:Record<string,unknown>)=>row.uid===value.ownerUid&&row.envelopeId===id&&row.deviceId===value.deviceId&&row.direction===value.direction&&row.payloadDigest===payloadDigest;
    let terminalAt:number;
    if(value.status==='pulled'){
      const progress=proofs.progress,pulled=millis(value.pulledAt);
      if(!progress||progress.v!==1||!bound(progress)||progress.status!=='complete'||progress.memoryCount!==value.memoryCount||progress.cursor!==value.memoryCount||
        !syncInteger(progress.imported)||!syncInteger(progress.conflicts)||Number(progress.imported)+Number(progress.conflicts)>Number(progress.cursor)||
        !time(progress.startedAt)||!time(progress.updatedAt)||progress.startedAt>progress.updatedAt||progress.updatedAt>now||!pulled||pulled>now)return false;
      terminalAt=Math.max(updated,pulled,progress.updatedAt);
    }else if(value.status==='failed'&&value.error==='cancelled'){
      const publication=proofs.publication,cancellation=proofs.cancellation;
      if(proofs.progress||!publication||!cancellation||publication.v!==2||cancellation.v!==2||!bound(publication)||!bound(cancellation)||
        !syncHashValid(publication.digest)||publication.digest!==cancellation.digest||!time(publication.createdAt)||!time(cancellation.createdAt)||
        cancellation.createdAt<publication.createdAt||cancellation.createdAt>now)return false;
      terminalAt=Math.max(updated,cancellation.createdAt);
    }else return false;
    return terminalAt<now-MOBILE_SYNC_RETENTION_MS;
  }catch{return false;}
}

/** The read, receipt validation, account fence and delete share one transaction. */
export async function purgeTerminalSyncEnvelope(id:string,deps:SyncRetentionDeps):Promise<boolean>{
  const now=deps.now();if(!syncIdValid(id)||!time(now))throw unavailable();const db=deps.firestore,ref=db.doc('mobileSyncEnvelopes/'+id);
  return db.runTransaction(async tx=>{
    const [envelope,progress,publication,cancellation]=await tx.getAll(ref,db.doc('mobileSyncImports/'+id),db.doc('mobileSyncPublications/'+id),db.doc('mobileSyncPublicationCancellations/'+id));
    if(!envelope.exists||!syncEnvelopePurgeEligible(id,envelope.data(),{progress:progress.data(),publication:publication.data(),cancellation:cancellation.data()},now))return false;
    if(!await liveAccountInTransaction(tx,db,envelope.data()!.ownerUid))return false;
    tx.delete(ref);return true;
  });
}
interface Cursor{expiresAt:number;id:string}
interface State{v:1;after:Cursor|null;updatedAt:number;revision:string}
function state(value:unknown):State|null{
  if(value===undefined)return null;
  if(!object(value)||Object.keys(value).sort().join(',')!=='after,revision,updatedAt,v'||value.v!==1||!time(value.updatedAt)||typeof value.revision!=='string'||!/^[a-f0-9-]{36}$/.test(value.revision))throw unavailable();
  const after=value.after;
  if(after!==null&&(!object(after)||Object.keys(after).sort().join(',')!=='expiresAt,id'||!time(after.expiresAt)||!syncIdValid(after.id)))throw unavailable();
  return {v:1,after:after as Cursor|null,updatedAt:value.updatedAt,revision:value.revision};
}
/** A durable CAS cursor advances past retained/legacy rows and survives the run deadline. */
export async function runMobileSyncRetentionPage(deps:SyncRetentionDeps={firestore:admin.firestore(),now:Date.now,id:randomUUID}){
  const now=deps.now();if(!time(now))throw unavailable();const db=deps.firestore,stateRef=db.doc('mobileSyncCleanup/state'),previous=state((await stateRef.get()).data());
  if(previous&&previous.updatedAt>now)throw unavailable();
  let query=db.collection('mobileSyncEnvelopes').where('expiresAt','>',0).where('expiresAt','<',now-MOBILE_SYNC_RETENTION_MS)
    .orderBy('expiresAt').orderBy(admin.firestore.FieldPath.documentId()).select('expiresAt').limit(MOBILE_SYNC_RETENTION_PAGE_SIZE+1);
  if(previous?.after)query=query.startAfter(previous.after.expiresAt,previous.after.id);
  const page=await query.get(),rows=page.docs.slice(0,MOBILE_SYNC_RETENTION_PAGE_SIZE);let deleted=0,retained=0,failed=0;
  for(const row of rows){try{if(await purgeTerminalSyncEnvelope(row.id,deps))deleted++;else retained++;}catch{failed++;}}
  const last=rows.at(-1),after=page.size>MOBILE_SYNC_RETENTION_PAGE_SIZE&&last?{expiresAt:last.data().expiresAt,id:last.id}:null,revision=deps.id();
  if(typeof revision!=='string'||!/^[a-f0-9-]{36}$/.test(revision))throw unavailable();
  const cursorAdvanced=await db.runTransaction(async tx=>{
    const current=state((await tx.get(stateRef)).data());if(JSON.stringify(current)!==JSON.stringify(previous))return false;
    tx.set(stateRef,{v:1,after,updatedAt:now,revision});return true;
  });
  return {scanned:rows.length,deleted,retained,failed,more:after!==null,cursorAdvanced,tombstonesDeleted:0};
}

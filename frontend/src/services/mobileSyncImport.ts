import {collection, doc, getDocFromServer, getDocs, limit, onSnapshot, query, where} from 'firebase/firestore';
import {getFunctions, httpsCallable} from 'firebase/functions';
import app, {db} from '../firebase';
import {MOBILE_SYNC_WRITES_ENABLED} from '../config/releaseGates';
import {buildEncryptedMemoryFields, decryptMemoryEnvelope, encryptMemoryFields, isEncryptedMemoryEnvelope} from './memoryCrypto';
import {withPersonalMemoryMutation, type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {notifySyncCheckpoints} from './mobileSyncCheckpoints';
import {invalidSync, memoryMetadata, parseMobileSyncPayload, syncFields, syncRecord} from './mobileSyncPayload';
import type {MobileMemoryDelta, MobileSyncEnvelope} from './mobileSync';
import {canonicalSyncState, normalizedSyncMetadata, MOBILE_SYNC_BATCH_SIZE, parseSyncCipher, parseSyncImportBatch, parseSyncImportStatusInput, syncHashValid, syncIdValid, syncInteger,
  type SyncImportBatch, type SyncImportChange, type SyncImportPreparation, type SyncImportStatus, type SyncImportTarget} from '../../../functions/src/mobileSyncImportContract';

type Identity = Omit<SyncImportBatch, 'cursor'|'changes'>;
type Checkpoint = {v: 1; uid: string; identity: Identity; memoryCount: number};
export interface MobileSyncImportDeps {
  enabled: () => boolean;
  list: (uid: string, deviceId: string, direction: Identity['direction']) => Promise<Array<{id: string; data: unknown}>>;
  read: (envelopeId: string) => Promise<unknown>; device: (deviceId: string) => Promise<unknown>;
  observeDevice: (deviceId: string, changed: (value: unknown) => void, failed: () => void) => () => void;
  decrypt: (envelope: MobileSyncEnvelope, privateKey: JsonWebKey, guard: () => void) => Promise<unknown>;
  verifyPrivate: (privateKey: JsonWebKey, publicKey: JsonWebKey, guard: () => void) => Promise<void>;
  prepare: typeof buildEncryptedMemoryFields; resolve: typeof decryptMemoryEnvelope;
  encryptJournal: typeof encryptMemoryFields; decryptJournal: typeof decryptMemoryEnvelope;
  digest: (value: unknown) => Promise<string>;
  call: (mode: 'status'|'prepare'|'apply', request: unknown) => Promise<unknown>;
  storage: Pick<Storage, 'getItem'|'setItem'|'removeItem'>;
  exclusive: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  mutation?: PersonalMemoryMutationDeps;
}
export const mobileSyncImportCheckpointKey = (uid: string, deviceId: string, direction: Identity['direction']) => `mnemosyne:sync-import:v1:${encodeURIComponent(uid)}:${encodeURIComponent(deviceId)}:${direction}`;
export function hasPendingSyncImport(uid:string,deviceId:string,direction:Identity['direction']){try{return localStorage.getItem(mobileSyncImportCheckpointKey(uid,deviceId,direction))!==null;}catch{return true;}}
const encoder = new TextEncoder();
function bytes(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
}
export function syncPublicKey(value: unknown): JsonWebKey {
  const data = syncRecord(value); syncFields(data, ['kty','crv','x','y','ext','key_ops']);
  if (data.kty !== 'EC' || data.crv !== 'P-256' || typeof data.x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.x) || typeof data.y !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.y) ||
    ('ext' in data && typeof data.ext !== 'boolean') || ('key_ops' in data && (!Array.isArray(data.key_ops) || data.key_ops.length !== 0))) throw invalidSync();
  return data as JsonWebKey;
}
export const syncPoint = (key: JsonWebKey) => canonicalSyncState({kty: key.kty, crv: key.crv, x: key.x, y: key.y});
export async function verifySyncImportPrivateKey(privateKey: JsonWebKey, publicKey: JsonWebKey, guard: () => void) {
  if (syncPoint(privateKey) !== syncPoint(syncPublicKey(publicKey)) || typeof privateKey.d !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(privateKey.d)) throw invalidSync();
  await crypto.subtle.importKey('jwk', privateKey, {name:'ECDH',namedCurve:'P-256'}, false, ['deriveKey']); guard();
}
export async function decryptSyncImportEnvelope(envelope: MobileSyncEnvelope, privateKey: JsonWebKey, guard: () => void): Promise<unknown> {
  const privateCrypto = await crypto.subtle.importKey('jwk',privateKey,{name:'ECDH',namedCurve:'P-256'},false,['deriveKey']); guard();
  const publicCrypto = await crypto.subtle.importKey('jwk',syncPublicKey(envelope.senderPublicKeyJwk),{name:'ECDH',namedCurve:'P-256'},false,[]); guard();
  const key = await crypto.subtle.deriveKey({name:'ECDH',public:publicCrypto},privateCrypto,{name:'AES-GCM',length:256},false,['decrypt']); guard();
  const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.encryptedPayload.iv)},key,bytes(envelope.encryptedPayload.data)); guard();
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));
}
function defaults(): MobileSyncImportDeps {
  const names = {status: 'getMobileSyncImportStatus', prepare: 'prepareMobileSyncImportBatch', apply: 'applyMobileSyncImportBatch'};
  return {enabled: () => MOBILE_SYNC_WRITES_ENABLED, storage: localStorage, exclusive: withClipCaptureLock,
    list: async (uid, deviceId, direction) => (await getDocs(query(collection(db,'mobileSyncEnvelopes'), where('ownerUid','==',uid), where('deviceId','==',deviceId), where('direction','==',direction), where('status','==','queued'), limit(20)))).docs.map(snapshot => ({id: snapshot.id, data: snapshot.data()})),
    read: async id => {const snapshot = await getDocFromServer(doc(db,'mobileSyncEnvelopes',id)); if (!snapshot.exists()) throw invalidSync(); return snapshot.data();},
    device: async id => {const snapshot = await getDocFromServer(doc(db,'trustedDevices',id)); if (!snapshot.exists()) throw invalidSync(); return snapshot.data();},
    observeDevice: (id, changed, failed) => onSnapshot(doc(db,'trustedDevices',id), snapshot => {if (snapshot.metadata.fromCache) return; changed(snapshot.exists() ? snapshot.data() : null);}, failed),
    verifyPrivate: verifySyncImportPrivateKey, decrypt: decryptSyncImportEnvelope,
    prepare: buildEncryptedMemoryFields, resolve: decryptMemoryEnvelope, encryptJournal: encryptMemoryFields, decryptJournal: decryptMemoryEnvelope,
    digest: async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(canonicalSyncState(value)))), byte => byte.toString(16).padStart(2,'0')).join(''),
    call: async (mode, request) => (await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(request)).data};
}
function envelope(value: unknown, id: string, uid: string, deviceId: string, direction: Identity['direction']): MobileSyncEnvelope {
  const data = syncRecord(value); const payload = syncRecord(data.encryptedPayload); syncFields(payload,['iv','data']);
  if (!syncIdValid(id) || data.ownerUid !== uid || data.deviceId !== deviceId || data.direction !== direction || !['memory-snapshot','memory-delta'].includes(String(data.payloadType)) ||
    !['queued','pulled'].includes(String(data.status)) || !syncInteger(data.expiresAt) || !syncInteger(data.memoryCount) || data.memoryCount > 2500 ||
    typeof payload.iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(payload.iv) || typeof payload.data !== 'string' || !/^[A-Za-z0-9_-]+$/.test(payload.data) || payload.data.length < 24 || payload.data.length > 900000 || payload.data.length % 4 === 1) throw invalidSync();
  syncPublicKey(data.senderPublicKeyJwk);
  return {...data, id} as unknown as MobileSyncEnvelope;
}
function status(value: unknown, checkpoint: Checkpoint): SyncImportStatus {
  const data = syncRecord(value); syncFields(data,['envelopeId','payloadDigest','cursor','memoryCount','imported','conflicts','status']);
  if (data.envelopeId !== checkpoint.identity.envelopeId || data.payloadDigest !== checkpoint.identity.payloadDigest || data.memoryCount !== checkpoint.memoryCount ||
    !syncInteger(data.cursor) || !syncInteger(data.imported) || !syncInteger(data.conflicts) || data.cursor > checkpoint.memoryCount || data.imported + data.conflicts > data.cursor ||
    !['unknown','pending','complete'].includes(String(data.status)) ||
    (data.status === 'unknown' && (data.cursor !== 0 || data.imported !== 0 || data.conflicts !== 0)) ||
    (data.status === 'pending' && (data.cursor < 1 || data.cursor === checkpoint.memoryCount)) ||
    (data.status === 'complete' && data.cursor !== checkpoint.memoryCount)) throw invalidSync();
  return data as unknown as SyncImportStatus;
}
function prepared(value: unknown, checkpoint: Checkpoint, cursor: number, ids: string[]): SyncImportPreparation {
  const data = syncRecord(value); syncFields(data,['status','targets']); const state = status(data.status,checkpoint);
  if (!Array.isArray(data.targets)) throw invalidSync();
  if (state.status === 'complete') {if (data.targets.length) throw invalidSync(); return {status:state,targets:[]};}
  if (state.cursor !== cursor || data.targets.length !== ids.length) throw invalidSync();
  const targets = data.targets.map((value,index) => {
    const target = syncRecord(value); syncFields(target,['sessionId','exists','stateHash','metadataHash','revision','timestamp','deleted','enc']);
    if (target.sessionId !== ids[index] || typeof target.exists !== 'boolean' || typeof target.deleted !== 'boolean') throw invalidSync();
    if (target.exists) {if (!syncHashValid(target.stateHash) || !syncHashValid(target.metadataHash) || !syncInteger(target.revision) || !syncInteger(target.timestamp)) throw invalidSync(); parseSyncCipher(target.enc);}
    else if (target.stateHash !== null || target.metadataHash !== null || target.revision !== null || target.timestamp !== null || target.deleted || target.enc !== null) throw invalidSync();
    return target as unknown as SyncImportTarget;
  }); return {status:state,targets};
}
function deviceBinding(value: unknown, uid: string, deviceId: string) {
  const data = syncRecord(value);
  if (data.deviceId !== deviceId || data.ownerUid !== uid || data.status !== 'active') throw invalidSync();
  const publicKeyJwk = syncPublicKey(data.publicKeyJwk); const desktopPublicKeyJwk = syncPublicKey(data.desktopPublicKeyJwk);
  return {deviceId,ownerUid:uid,status:'active',publicKeyJwk,desktopPublicKeyJwk};
}
async function changesForBatch(changes: MobileMemoryDelta['changes'], targets: SyncImportTarget[], deps: MobileSyncImportDeps, guard: () => void): Promise<SyncImportChange[]> {
  const result: SyncImportChange[] = [];
  for (let index=0; index<changes.length; index++) {
    guard(); const {op,memory} = changes[index]; const target = targets[index];
    let action: SyncImportChange['action'];
    if (!target.exists) action = op === 'delete' ? 'tombstone' : 'create';
    else if (target.deleted) action = 'skip';
    else if (op === 'delete') action = memory.updatedAt >= target.revision! ? 'delete' : 'skip';
    else if (memory.updatedAt > target.revision!) action = 'update';
    else {
      const current = await deps.resolve(parseSyncCipher(target.enc)); guard();
      const metadataHash = await deps.digest(normalizedSyncMetadata(memoryMetadata(memory))); guard();
      action = current.text === memory.text && (current.title ?? null) === (memory.title?.trim() ? memory.title : null) && metadataHash === target.metadataHash ? 'skip' : 'conflict';
    }
    const change: SyncImportChange = {sessionId:memory.id,expectedStateHash:target.stateHash,action,incomingRevision:memory.updatedAt,timestamp:memory.timestamp};
    if (['create','tombstone','update','conflict'].includes(action)) {
      const title = action === 'conflict' ? `${memory.title?.slice(0,970) || 'Memória'} (conflito de sync)` : memory.title || null;
      const fields = await deps.prepare(memory.text,title); guard(); change.enc = parseSyncCipher(fields.enc); change.metadata = memoryMetadata(memory);
    }
    result.push(change);
  } return result;
}
async function readCheckpoint(raw: string, uid: string, deviceId: string, direction: Identity['direction'], deps: MobileSyncImportDeps, guard: () => void): Promise<Checkpoint> {
  if (raw.length > 16384) throw invalidSync(); const cipher: unknown = JSON.parse(raw); if (!isEncryptedMemoryEnvelope(cipher)) throw invalidSync();
  const plain = await deps.decryptJournal(cipher); guard(); if (plain.text.length > 4096) throw invalidSync();
  const data = syncRecord(JSON.parse(plain.text)); syncFields(data,['v','uid','identity','memoryCount']); const identity = parseSyncImportStatusInput(data.identity);
  if (data.v !== 1 || data.uid !== uid || identity.deviceId !== deviceId || identity.direction !== direction || !syncInteger(data.memoryCount) || data.memoryCount > 2500) throw invalidSync();
  return {v:1,uid,identity,memoryCount:data.memoryCount};
}
/** Batches use ciphertext CAS and server receipts. Lost ACK keeps the journal; a new invocation first observes the committed cursor. */
export async function importPersonalMobileSync(uid: string, deviceId: string, direction: Identity['direction'], privateKey: JsonWebKey, deps = defaults()): Promise<{importedMemories:number;pulledEnvelopes:number;conflicts:number}> {
  if (!deps.enabled()) throw new Error('A sincronização está temporariamente em validação. Os envelopes existentes foram conservados.');
  if (!syncIdValid(deviceId) || !['desktop-to-mobile','mobile-to-desktop'].includes(direction)) throw invalidSync();
  try {
    return await withPersonalMemoryMutation(uid, async context => deps.exclusive(mobileSyncImportCheckpointKey(uid,deviceId,direction), async () => {
      const guard = context.assertCurrent; guard(); const key = mobileSyncImportCheckpointKey(uid,deviceId,direction); const totals = {importedMemories:0,pulledEnvelopes:0,conflicts:0};
      const clear = (raw: string) => {guard(); if (deps.storage.getItem(key) !== raw) throw invalidSync(); deps.storage.removeItem(key); if (deps.storage.getItem(key) !== null) throw invalidSync();notifySyncCheckpoints();};
      let pendingRaw = deps.storage.getItem(key); let pending: Checkpoint|null = pendingRaw === null ? null : await readCheckpoint(pendingRaw,uid,deviceId,direction,deps,guard); guard();
      const add = (state: SyncImportStatus) => {totals.importedMemories += state.imported; totals.conflicts += state.conflicts; totals.pulledEnvelopes++;};
      // Confirmation of a committed receipt does not require a still-active device or its private key.
      if (pending) {
        const known = status(await deps.call('status',pending.identity),pending); guard();
        if (known.status === 'complete') {clear(pendingRaw!); add(known); return totals;}
      }
      const entries = pending ? [{id:pending.identity.envelopeId,data:await deps.read(pending.identity.envelopeId)}] : await deps.list(uid,deviceId,direction); guard();
      if (entries.length > 20 || new Set(entries.map(entry => entry.id)).size !== entries.length) throw invalidSync();
      if (!entries.length) return totals;
      const initial = deviceBinding(await deps.device(deviceId),uid,deviceId); guard();
      await deps.verifyPrivate(privateKey,direction === 'desktop-to-mobile' ? initial.publicKeyJwk : initial.desktopPublicKeyJwk,guard); guard();
      const fingerprint = canonicalSyncState(initial); let changed = false;
      const stop = deps.observeDevice(deviceId,value => {try {if (canonicalSyncState(deviceBinding(value,uid,deviceId)) !== fingerprint) changed = true;} catch {changed = true;}}, () => {changed = true;});
      const active = () => {guard(); if (changed) throw invalidSync();};
      try {
        for (const entry of entries) {
          active(); const source = envelope(entry.data,entry.id,uid,deviceId,direction);
          if (direction === 'mobile-to-desktop' && canonicalSyncState(source.senderPublicKeyJwk) !== canonicalSyncState(initial.publicKeyJwk)) throw invalidSync();
          const digest = await deps.digest(source.encryptedPayload); active();
          const checkpoint: Checkpoint = {v:1,uid,identity:parseSyncImportStatusInput({envelopeId:source.id,deviceId,direction,payloadDigest:digest}),memoryCount:source.memoryCount};
          if (pending && canonicalSyncState(pending) !== canonicalSyncState(checkpoint)) throw invalidSync();
          let current = status(await deps.call('status',checkpoint.identity),checkpoint); active();
          if (current.status === 'complete') {if (pendingRaw !== null) clear(pendingRaw); add(current); pending=null; pendingRaw=null; continue;}
          if (source.status !== 'queued') throw invalidSync();
          // Started imports can resume past initial expiry; the server enforces its bounded resume window.
          if (current.status === 'unknown' && source.expiresAt <= Date.now()) throw invalidSync();
          const payload = await deps.decrypt(source,privateKey,active); active(); const incoming = parseMobileSyncPayload(payload,source);
          if (pendingRaw === null) {
            const cipher = await deps.encryptJournal({text:JSON.stringify(checkpoint)}); active(); if (!isEncryptedMemoryEnvelope(cipher)) throw invalidSync();
            pendingRaw = JSON.stringify(cipher); deps.storage.setItem(key,pendingRaw); if (deps.storage.getItem(key) !== pendingRaw) throw invalidSync(); pending=checkpoint;notifySyncCheckpoints();
          }
          while (current.status !== 'complete') {
            active(); const chunk = incoming.slice(current.cursor,current.cursor+MOBILE_SYNC_BATCH_SIZE);
            const projection = prepared(await deps.call('prepare',{...checkpoint.identity,cursor:current.cursor,sessionIds:chunk.map(change=>change.memory.id)}),checkpoint,current.cursor,chunk.map(change=>change.memory.id)); active();
            if (projection.status.status === 'complete') {current=projection.status; break;}
            const plans = await changesForBatch(chunk,projection.targets,deps,active); active();
            const fresh = deviceBinding(await deps.device(deviceId),uid,deviceId); active(); if (canonicalSyncState(fresh) !== fingerprint) throw invalidSync();
            const request = parseSyncImportBatch({...checkpoint.identity,cursor:current.cursor,changes:plans});
            const before = current; current = status(await deps.call('apply',request),checkpoint); active();
            if (current.cursor !== before.cursor+plans.length || current.imported < before.imported || current.conflicts < before.conflicts || current.status === 'unknown' ||
              current.imported-before.imported !== plans.filter(change=>!['skip','conflict'].includes(change.action)).length || current.conflicts-before.conflicts !== plans.filter(change=>change.action==='conflict').length) throw invalidSync();
          }
          // Query the aggregate receipt before clearing local recovery state; a forged/late response cannot clear another journal.
          const confirmed = status(await deps.call('status',checkpoint.identity),checkpoint); active();
          if (confirmed.status !== 'complete' || canonicalSyncState(confirmed) !== canonicalSyncState(current)) throw invalidSync();
          clear(pendingRaw!); add(confirmed); pending=null; pendingRaw=null;
        }
        active(); return totals;
      } finally {stop();}
    }), deps.mutation);
  } catch {throw invalidSync();}
}
/** Status-only recovery remains available with the writing gate closed. It never decrypts source payload or starts another batch. */
export async function confirmPendingMobileSyncImport(uid:string,deviceId:string,direction:Identity['direction'],deps=defaults()):Promise<SyncImportStatus>{
  if(!syncIdValid(deviceId)||!['desktop-to-mobile','mobile-to-desktop'].includes(direction))throw invalidSync();
  try{return await withPersonalMemoryMutation(uid,async context=>deps.exclusive(mobileSyncImportCheckpointKey(uid,deviceId,direction),async()=>{
    const guard=context.assertCurrent;guard();const key=mobileSyncImportCheckpointKey(uid,deviceId,direction);const raw=deps.storage.getItem(key);if(raw===null)throw invalidSync();
    const checkpoint=await readCheckpoint(raw,uid,deviceId,direction,deps,guard);guard();const known=status(await deps.call('status',checkpoint.identity),checkpoint);guard();
    if(deps.storage.getItem(key)!==raw)throw invalidSync();
    if(known.status==='complete'){deps.storage.removeItem(key);if(deps.storage.getItem(key)!==null)throw invalidSync();guard();notifySyncCheckpoints();}
    return known;
  }),deps.mutation);}catch{throw invalidSync();}
}

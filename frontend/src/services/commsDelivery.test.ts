import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{currentUser:null}}));
import {sendCommsDelivery,recoverCommsDelivery,cancelCommsDelivery,acknowledgeCommsTransmission,commsDeliveryPendingKey,type CommsDeliveryClientDeps} from './commsDelivery';
import {setMemoryCryptoMnemonic,encryptMemoryFields,decryptMemoryEnvelope} from './memoryCrypto';
import {commsDeliveryRequestBytes,commsTransmissionBytes,type CommsDeliveryRequest,type CommsDeliveryOutcome,type CommsDeliveryDescriptor} from '../../../functions/src/commsDeliveryContract';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'],id='11111111-1111-4111-8111-111111111111',key=commsDeliveryPendingKey('alice');
const envelope={encryptedKey:btoa('\0'.repeat(256)),encryptedPayload:btoa('\0'.repeat(32)),payloadIv:btoa('\0'.repeat(12)),hasAttachment:false,attachmentName:null},input={recipientUid:'bob',senderFingerprint:'a'.repeat(64),recipientFingerprint:'b'.repeat(64),envelope};
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
beforeEach(()=>setMemoryCryptoMnemonic(words));
function fixture(){
  const records=new Map<string,string>(),listeners=new Set<()=>void>();const state={uid:'alice',ready:true,enabled:true,receipt:null as CommsDeliveryOutcome|null,loseAck:false,failCreate:false,failStage:false,creates:0,storageChanged:()=>{},duringStatus:undefined as undefined|(()=>void)};
  const storage:Storage={get length(){return records.size;},key:index=>[...records.keys()][index]??null,getItem:k=>records.get(k)??null,setItem:(k,value)=>{if(state.failStage)throw Error();records.set(k,value);},removeItem:k=>{records.delete(k);},clear:()=>records.clear()};
  const call=vi.fn(async(mode:string,value:unknown)=>{
    if(mode==='ack'){const row=value as{transmissionId:string;digest:string};return{transmissionId:row.transmissionId,digest:row.digest,status:'received',updatedAt:1000};}
    const request=value as CommsDeliveryRequest,descriptor=value as CommsDeliveryDescriptor,digest=mode==='create'?await hash(commsDeliveryRequestBytes(request)):descriptor.digest,base:CommsDeliveryOutcome={requestId:request.requestId,digest,status:'unknown',createdAt:null,updatedAt:null};
    if(mode==='status'){state.duringStatus?.();return state.receipt??base;}
    if(mode==='cancel'){if(state.receipt?.status==='received')return state.receipt;state.receipt={...base,status:'cancelled',createdAt:1000,updatedAt:1000};return state.receipt;}
    expect(records.get(key)).toBeTruthy();state.creates++;if(state.failCreate)throw Error('Synthetic unavailable');state.receipt={...base,status:'sent',createdAt:1000,updatedAt:1000};if(state.loseAck)throw Error('Synthetic ACK lost');return state.receipt;
  });
  const deps:CommsDeliveryClientDeps={enabled:()=>state.enabled,storage,id:()=>id,exclusive:async(_key,work)=>work(),encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,call,
    mutation:{uid:()=>state.uid,ready:()=>state.ready,subscribe:changed=>{listeners.add(changed);return()=>listeners.delete(changed);}},observeStorage:(_uid,changed)=>{state.storageChanged=changed;return()=>{state.storageChanged=()=>{};};}};
  return{records,state,listeners,deps,call};
}
it('durably encrypts one request before creation and lost ACK recovers the same ID/ciphertext with the gate closed',async()=>{
  const f=fixture();f.state.loseAck=true;await expect(sendCommsDelivery('alice',input,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key)!;expect(raw).toBeTruthy();expect(raw.includes('recipientUid')).toBe(false);const journal=JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text);expect(journal.request.requestId).toBe(id);expect(journal.request.envelope).toEqual(envelope);f.state.enabled=false;expect((await recoverCommsDelivery('alice',()=>{},f.deps)).status).toBe('sent');expect(f.state.creates).toBe(1);expect(f.records.has(key)).toBe(false);
});
it('a failed durable stage makes no RPC and a second start cannot replace pending ciphertext',async()=>{
  const f=fixture();f.state.failStage=true;await expect(sendCommsDelivery('alice',input,()=>{},f.deps)).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();f.state.failStage=false;f.state.failCreate=true;await expect(sendCommsDelivery('alice',input,()=>{},f.deps)).rejects.toThrow();const original=f.records.get(key);await expect(sendCommsDelivery('alice',input,()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(original);expect(f.state.creates).toBe(1);
});
it('cancel unknown is terminal while confirmed received status cannot be withdrawn',async()=>{
  const f=fixture();f.state.failCreate=true;await expect(sendCommsDelivery('alice',input,()=>{},f.deps)).rejects.toThrow();f.state.enabled=false;expect((await cancelCommsDelivery('alice',()=>{},f.deps)).status).toBe('cancelled');expect(f.records.has(key)).toBe(false);
  const g=fixture();g.state.loseAck=true;await expect(sendCommsDelivery('alice',input,()=>{},g.deps)).rejects.toThrow();g.state.receipt!.status='received';expect((await cancelCommsDelivery('alice',()=>{},g.deps)).status).toBe('received');expect(g.call.mock.calls.filter(row=>row[0]==='cancel')).toHaveLength(0);
});
it('a wrong coffer or a journal copied to another UID never reaches RPC or deletes the copy',async()=>{
  const f=fixture();f.state.failCreate=true;await expect(sendCommsDelivery('alice',input,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key)!;f.call.mockClear();setMemoryCryptoMnemonic([...words].reverse());await expect(recoverCommsDelivery('alice',()=>{},f.deps)).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();expect(f.records.get(key)).toBe(raw);setMemoryCryptoMnemonic(words);f.state.uid='carol';f.records.set(commsDeliveryPendingKey('carol'),raw);await expect(recoverCommsDelivery('carol',()=>{},f.deps)).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();expect(f.records.get(commsDeliveryPendingKey('carol'))).toBe(raw);
});
it.each(['account','coffer','storage'] as const)('a %s round trip permanently invalidates completion and preserves the pending journal',async mode=>{
  const f=fixture();f.state.duringStatus=()=>{if(mode==='account'){f.state.uid='carol';for(const listener of f.listeners)listener();f.state.uid='alice';}if(mode==='coffer'){f.state.ready=false;for(const listener of f.listeners)listener();f.state.ready=true;}if(mode==='storage')f.state.storageChanged();};await expect(sendCommsDelivery('alice',input,()=>{},f.deps)).rejects.toThrow();expect(f.state.creates).toBe(0);expect(f.records.get(key)).toBeTruthy();expect(f.listeners.size).toBe(0);
});
it('an unknown request with a closed gate is conserved without a second creation attempt',async()=>{
  const f=fixture();f.state.failCreate=true;await expect(sendCommsDelivery('alice',input,()=>{},f.deps)).rejects.toThrow();f.state.enabled=false;const previous=f.state.creates;await expect(recoverCommsDelivery('alice',()=>{},f.deps)).rejects.toThrow();expect(f.state.creates).toBe(previous);expect(f.records.has(key)).toBe(true);
});
it('a mismatched receipt cannot confirm, delete or silently replace the immutable pending request',async()=>{
  const f=fixture();f.state.loseAck=true;await expect(sendCommsDelivery('alice',input,()=>{},f.deps)).rejects.toThrow();const original=f.records.get(key);f.state.receipt!.digest='c'.repeat(64);await expect(recoverCommsDelivery('alice',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(original);
});
it('a permanent recipient revocation closes the pending journal without creating new remote metadata',async()=>{
  const f=fixture();f.state.failCreate=true;await expect(sendCommsDelivery('alice',input,()=>{},f.deps)).rejects.toThrow();const pending=f.records.get(key)!;const journal=JSON.parse((await decryptMemoryEnvelope(JSON.parse(pending))).text);f.state.receipt={requestId:id,digest:await hash(commsDeliveryRequestBytes(journal.request)),status:'revoked',createdAt:null,updatedAt:null};const calls=f.state.creates;expect((await cancelCommsDelivery('alice',()=>{},f.deps)).status).toBe('revoked');expect(f.state.creates).toBe(calls);expect(f.call.mock.calls.filter(row=>row[0]==='cancel')).toHaveLength(0);expect(f.records.has(key)).toBe(false);
});
it('receipt ACK binds the exact legacy ciphertext and recipient and checks a minimal matching server response',async()=>{
  const f=fixture(),data={senderId:'bob',recipientId:'alice',timestamp:1,encryptedData:envelope.encryptedKey,status:'sent'},digest=await hash(commsTransmissionBytes('legacy',data));f.call.mockImplementation(async(_mode,value)=>{const row=value as{transmissionId:string;digest:string};return{transmissionId:row.transmissionId,digest:row.digest,status:'received',updatedAt:1000};});
  await acknowledgeCommsTransmission('alice','legacy',data,()=>{},f.deps);expect(f.call.mock.calls[0]).toEqual(['ack',{transmissionId:'legacy',senderUid:'bob',recipientUid:'alice',digest}]);f.call.mockClear();await expect(acknowledgeCommsTransmission('alice','legacy',{...data,recipientId:'carol'},()=>{},f.deps)).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();
});
it('initial storage failure always retires observers and a missing exclusive lock never dispatches',async()=>{
  const f=fixture();f.deps.storage.getItem=()=>{throw Error();};await expect(sendCommsDelivery('alice',input,()=>{},f.deps)).rejects.toThrow();expect(f.listeners.size).toBe(0);expect(f.call).not.toHaveBeenCalled();const g=fixture();g.deps.exclusive=async()=>{throw Error('Synthetic other tab');};await expect(sendCommsDelivery('alice',input,()=>{},g.deps)).rejects.toThrow();expect(g.call).not.toHaveBeenCalled();
});
